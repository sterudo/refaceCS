import { createArpeggiator } from './arpeggiator.js';
import { captureParameters, decodeControl, decodeParameter, encodeControl, encodeParameter,
  parameterMessage, requestMessage } from './synth-midi.js';

export function setupMidiDiscovery(onNotesChanged, onSynthValue) {
  const connect = document.querySelector('#midi-connect');
  const badge = document.querySelector('#midi-badge');
  const status = document.querySelector('#midi-status');
  const refaceInput = document.querySelector('#midi-reface-input');
  const refaceOutput = document.querySelector('#midi-reface-output');
  const controllerInput = document.querySelector('#midi-controller-input');
  const selected = { input: '', output: '', controller: '' };
  const manuallySelected = { input: false, output: false, controller: false };
  const names = new Map();
  const listening = new Map();
  const received = new Map();
  const forwarded = new Map();
  const localNotes = new Map();
  const revisions = new Map();
  const captureStatus = document.querySelector('#capture-status');
  let midiAccess;
  let sysexAccess;
  let sysexInput;
  let sysexPromise;
  let pendingParameter;
  let capturing = false;
  let midiControlStatus = 'unknown';
  let muted = false;
  let transpose = 0;
  let output;
  let controllerPort;
  let lastError = '';
  const arpeggiator = createArpeggiator((message) => send(output, message), changeRouting, () => muted, () => transpose);

  function reportError(message) {
    lastError = message;
    status.textContent = message;
  }

  function send(port, message) {
    if (!port || port.state !== 'connected') {
      reportError('MIDI output unavailable; message was not sent.');
      return false;
    }
    try {
      port.send(message);
      return true;
    } catch (error) {
      reportError(`MIDI send failed: ${error.message || error}`);
      return false;
    }
  }

  function releaseForwarded(port) {
    for (const { channel, notes } of forwarded.values()) {
      for (const note of notes) if (note !== null) send(port, [0x80 | channel, note, 0]);
    }
    forwarded.clear();
  }

  function releaseDirect(port) {
    releaseForwarded(port);
    for (const note of localNotes.values()) send(port, [0x80, note, 0]);
    localNotes.clear();
  }

  function releaseOutput(port) {
    arpeggiator.clear();
    releaseDirect(port);
  }

  function transposedNote(note) {
    const result = note + transpose;
    if (result < 0 || result > 127) {
      reportError(`Transposed note ${result} is outside the MIDI range 0–127; note was not sent.`);
      return null;
    }
    return result;
  }

  function rememberForwarded(owner, channel, note) {
    const active = forwarded.get(owner) || { channel, notes: [] };
    active.notes.push(note);
    forwarded.set(owner, active);
  }

  function changeRouting(enableArpeggiator) {
    if (enableArpeggiator) {
      releaseDirect(output);
      return;
    }
    if (muted) return;
    for (const [owner, value] of arpeggiator.getHeld()) {
      for (let i = 0; i < value.count; i++) {
        const note = transposedNote(value.note);
        const sent = note !== null && send(output, [0x90 | value.channel, note, value.velocity]);
        if (value.source === 'local') {
          if (sent) localNotes.set(owner, note);
        } else {
          rememberForwarded(owner, value.channel, sent ? note : null);
        }
      }
    }
  }

  function handleMessage(port, event) {
    const data = event.data;
    if (!data || data.length !== 3) return;
    if (port.id === selected.input) {
      const control = decodeControl(data);
      if (control) {
        revisions.set(control.id, (revisions.get(control.id) || 0) + 1);
        onSynthValue(control.id, control.value);
        return;
      }
    }
    const type = data[0] & 0xf0;
    if ((type !== 0x80 && type !== 0x90) || data[1] > 127 || data[2] > 127) return;
    const channel = data[0] & 0x0f;
    const note = data[1];
    const on = type === 0x90 && data[2] !== 0;
    const key = `${port.id}:${channel}:${note}`;
    const count = received.get(key)?.count || 0;
    if (on) received.set(key, { port, note, count: count + 1 });
    else if (count > 1) received.set(key, { port, note, count: count - 1 });
    else received.delete(key);
    onNotesChanged();

    if (port !== controllerPort || port.id === selected.input) return;
    if (on) arpeggiator.noteOn(key, note, data[2], channel, 'controller');
    else arpeggiator.noteOff(key);
    if (arpeggiator.enabled) return;
    if (on) {
      const target = muted ? null : transposedNote(note);
      const sent = target !== null && send(output, [data[0], target, data[2]]);
      rememberForwarded(key, channel, sent ? target : null);
    } else {
      const active = forwarded.get(key);
      if (!active) return;
      const target = active.notes[0];
      if (target !== null && !send(output, [data[0], target, data[2]])) return;
      active.notes.shift();
      if (active.notes.length === 0) forwarded.delete(key);
    }
  }

  function updateListeners(inputs) {
    const desired = inputs.filter((port) => port.id === selected.input || port.id === selected.controller);
    const nextController = desired.find((port) => port.id === selected.controller);
    const forwards = nextController && nextController.id !== selected.input ? nextController : undefined;
    if (controllerPort && controllerPort !== forwards) {
      releaseForwarded(output);
      arpeggiator.removeSource('controller');
    }
    controllerPort = forwards;
    for (const [port, listener] of listening) {
      if (desired.includes(port)) continue;
      port.removeEventListener('midimessage', listener);
      listening.delete(port);
      for (const [key, value] of received) {
        if (value.port === port) received.delete(key);
      }
      onNotesChanged();
    }
    for (const port of desired) {
      if (listening.has(port)) continue;
      const listener = (event) => handleMessage(port, event);
      listening.set(port, listener);
      port.addEventListener('midimessage', listener);
    }
  }

  function availablePorts(ports) {
    return [...ports.values()].filter((port) => port.state === 'connected');
  }

  function portName(port) {
    return port.name || port.manufacturer || `MIDI port ${port.id}`;
  }

  function findReface(ports) {
    const matches = ports.filter((port) => /\breface\b/i.test(port.name || ''));
    return matches.length === 1 ? matches[0].id : '';
  }

  function renderSelect(select, ports, value) {
    select.replaceChildren(new Option('Not selected', ''));
    for (const port of ports) {
      const name = portName(port);
      names.set(port.id, name);
      select.add(new Option(name, port.id));
    }
    if (value && !ports.some((port) => port.id === value)) {
      select.add(new Option(`${names.get(value) || value} (disconnected)`, value));
    }
    select.value = value;
    select.disabled = false;
  }

  function refresh() {
    const inputs = availablePorts(midiAccess.inputs);
    const outputs = availablePorts(midiAccess.outputs);
    if (!selected.input && !manuallySelected.input) selected.input = findReface(inputs);
    if (!selected.output && !manuallySelected.output) selected.output = findReface(outputs);
    if (!selected.controller && !manuallySelected.controller) selected.controller = selected.input;
    const nextOutput = outputs.find((port) => port.id === selected.output);
    if (output && output !== nextOutput) releaseOutput(output);
    output = nextOutput;
    updateListeners(inputs);
    bindSysexInput();
    renderSelect(refaceInput, inputs, selected.input);
    renderSelect(refaceOutput, outputs, selected.output);
    renderSelect(controllerInput, inputs, selected.controller);

    const inputAvailable = inputs.some((port) => port.id === selected.input);
    const outputAvailable = outputs.some((port) => port.id === selected.output);
    const controllerAvailable = inputs.some((port) => port.id === selected.controller);
    const connected = inputAvailable && outputAvailable;
    badge.dataset.state = connected ? 'connected' : 'disconnected';
    badge.textContent = connected ? 'reface MIDI ports available' : 'reface MIDI ports unavailable';
    status.textContent = `reface input ${inputAvailable ? 'available' : 'unavailable'}; output ${outputAvailable ? 'available' : 'unavailable'}; controller input ${controllerAvailable ? 'available' : 'unavailable'}. MIDI Control: ${midiControlStatus}; it must be enabled on the synth for panel CCs. Port names do not verify hardware identity.${lastError ? ` ${lastError}` : ''}`;
  }

  function bindSysexInput() {
    const port = sysexAccess?.inputs.get(selected.input);
    const next = port?.state === 'connected' ? port : undefined;
    if (next === sysexInput) return;
    if (sysexInput) sysexInput.removeEventListener('midimessage', handleSysex);
    sysexInput = next;
    if (sysexInput) sysexInput.addEventListener('midimessage', handleSysex);
    if (pendingParameter) pendingParameter.finish(null);
  }

  function handleSysex(event) {
    const data = [...event.data];
    if (data.length < 11 || data[0] !== 0xf0 || data[1] !== 0x43
      || (data[2] & 0xf0) !== 0x10 || data[3] !== 0x7f || data[4] !== 0x1c
      || data[5] !== 0x03 || data.at(-1) !== 0xf7) return;
    const address = data.slice(6, 9);
    const decoded = decodeParameter(address, data.slice(9, -1));
    if (pendingParameter && pendingParameter.address.every((part, index) => part === address[index])) {
      pendingParameter.finish(decoded);
    }
  }

  async function ensureSysex() {
    if (!midiAccess || !output) {
      reportError('Connect the reface MIDI output before using SysEx.');
      return false;
    }
    if (sysexAccess?.sysexEnabled) return true;
    if (!sysexPromise) {
      sysexPromise = navigator.requestMIDIAccess({ sysex: true }).then((access) => {
        if (!access.sysexEnabled) throw new Error('SysEx access was not granted');
        sysexAccess = access;
        access.addEventListener('statechange', bindSysexInput);
        bindSysexInput();
        return true;
      }).catch((error) => {
        reportError(`SysEx access failed: ${error.message || error}. Ordinary MIDI remains available.`);
        return false;
      }).finally(() => { sysexPromise = undefined; });
    }
    return sysexPromise;
  }

  async function sendParameter(id, value, revision) {
    const inputId = selected.input;
    const outputId = selected.output;
    if (!await ensureSysex()) return;
    if (selected.input !== inputId || selected.output !== outputId || revisions.get(id) !== revision) return;
    const target = sysexAccess.outputs.get(outputId);
    const parameter = encodeParameter(id, value);
    send(target, parameterMessage(parameter.address, parameter.data));
  }

  function requestParameter(parameter, target) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => pendingParameter?.finish(null), 300);
      pendingParameter = {
        address: parameter.address,
        finish(value) {
          clearTimeout(timer);
          pendingParameter = undefined;
          resolve(value);
        },
      };
      if (!send(target, requestMessage(parameter.address))) pendingParameter?.finish(null);
    });
  }

  async function captureSynth() {
    if (capturing) return;
    capturing = true;
    const button = document.querySelector('#capture-synth');
    button.disabled = true;
    const inputId = selected.input;
    const outputId = selected.output;
    const initialRevisions = new Map(revisions);
    try {
      captureStatus.textContent = 'Requesting synth settings...';
      midiControlStatus = 'unknown';
      if (midiAccess) refresh();
      if (!await ensureSysex()) {
        captureStatus.textContent = 'Capture failed: SysEx access or MIDI connection unavailable.';
        return;
      }
      const target = sysexAccess.outputs.get(outputId);
      if (!sysexInput || !target || target.state !== 'connected') {
        captureStatus.textContent = 'Capture failed: selected SysEx input or output is unavailable.';
        return;
      }
      const missing = [];
      let captured = 0;
      for (const parameter of captureParameters) {
        if (selected.input !== inputId || selected.output !== outputId || target.state !== 'connected') {
          captureStatus.textContent = 'Capture stopped because the MIDI connection changed.';
          return;
        }
        captureStatus.textContent = `Capturing synth: ${captured} received; requesting ${parameter.id}.`;
        const revision = initialRevisions.get(parameter.id) || 0;
        const result = await requestParameter(parameter, target);
        if (selected.input !== inputId || selected.output !== outputId || !sysexInput || target.state !== 'connected') {
          captureStatus.textContent = 'Capture stopped because the MIDI connection changed.';
          return;
        }
        if (!result || (revisions.get(parameter.id) || 0) !== revision) {
          missing.push(parameter.id);
        } else if (result.id === 'midi-control') {
          midiControlStatus = result.value ? 'on' : 'off';
          refresh();
        } else {
          onSynthValue(result.id, result.value);
          captured++;
        }
      }
      captureStatus.textContent = `Captured ${captured} settings. Not captured: velocity, octave, looper, pitch bend${missing.length ? `, ${missing.join(', ')}` : ''}.`;
    } finally {
      capturing = false;
      button.disabled = false;
    }
  }

  document.querySelector('#capture-synth').addEventListener('click', captureSynth);
  refaceInput.addEventListener('change', () => {
    lastError = '';
    const previous = selected.input;
    midiControlStatus = 'unknown';
    manuallySelected.input = true;
    selected.input = refaceInput.value;
    if (!manuallySelected.controller && selected.controller === previous) selected.controller = selected.input;
    refresh();
  });
  refaceOutput.addEventListener('change', () => {
    lastError = '';
    manuallySelected.output = true;
    midiControlStatus = 'unknown';
    selected.output = refaceOutput.value;
    refresh();
  });
  controllerInput.addEventListener('change', () => {
    lastError = '';
    manuallySelected.controller = true;
    selected.controller = controllerInput.value;
    refresh();
  });

  connect.addEventListener('click', async () => {
    if (!navigator.requestMIDIAccess) {
      badge.dataset.state = 'error';
      badge.textContent = 'MIDI unavailable';
      status.textContent = 'Web MIDI is unavailable. Use Chrome or Edge in a secure context.';
      return;
    }
    connect.disabled = true;
    badge.textContent = 'Requesting MIDI access';
    status.textContent = 'Waiting for browser MIDI permission.';
    try {
      midiAccess = await navigator.requestMIDIAccess();
      midiAccess.addEventListener('statechange', refresh);
      refresh();
      connect.textContent = 'MIDI access enabled';
    } catch (error) {
      badge.dataset.state = 'error';
      badge.textContent = 'MIDI access failed';
      status.textContent = `Could not access MIDI: ${error.message || error}. Check browser permissions and try again.`;
      connect.disabled = false;
    }
  });

  window.addEventListener('pagehide', () => releaseOutput(output));

  return {
    setMuted(value) {
      muted = value;
      if (muted) {
        arpeggiator.silence();
        releaseDirect(output);
      }
    },
    setTranspose(value) {
      if (transpose === value) return;
      transpose = value;
      arpeggiator.transposeChanged();
    },
    setControl(id, value) {
      const revision = (revisions.get(id) || 0) + 1;
      revisions.set(id, revision);
      const message = encodeControl(id, value);
      if (message) send(output, message);
      else if (encodeParameter(id, value)) void sendParameter(id, value, revision);
    },
    resetNotes(clearLocalNotes) {
      let failed = 0;
      let firstError = '';
      if (output && output.state === 'connected') {
        for (let channel = 0; channel < 16; channel++) {
          for (const controller of [123, 120]) {
            try {
              output.send([0xb0 | channel, controller, 0]);
            } catch (error) {
              failed++;
              if (!firstError) firstError = error.message || String(error);
            }
          }
        }
      } else {
        firstError = 'MIDI output unavailable';
      }

      localNotes.clear();
      forwarded.clear();
      received.clear();
      arpeggiator.clear();
      clearLocalNotes();
      onNotesChanged();

      if (firstError) {
        reportError(`MIDI reset failed${failed ? ` (${failed} of 32 messages)` : ''}: ${firstError}. Held-note state cleared.`);
      } else {
        lastError = '';
        status.textContent = 'MIDI reset messages sent. Release and play held keys again.';
      }
    },
    isNoteHeld(note) {
      return [...received.values()].some((value) => value.note === note);
    },
    getHeldNotes() {
      return [...received.values()].map((value) => value.note);
    },
    startNote(owner, note, velocity) {
      arpeggiator.noteOn(owner, note, velocity, 0, 'local');
      if (arpeggiator.enabled) return;
      if (muted) return;
      const target = transposedNote(note);
      if (target !== null && send(output, [0x90, target, velocity])) localNotes.set(owner, target);
    },
    endNote(owner) {
      arpeggiator.noteOff(owner);
      if (!localNotes.has(owner)) return;
      send(output, [0x80, localNotes.get(owner), 0]);
      localNotes.delete(owner);
    },
    stopForVisibility() {
      releaseOutput(output);
    },
  };
}
