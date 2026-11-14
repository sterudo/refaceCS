import { createArpeggiator } from './arpeggiator.js';
import { createLooper } from './looper.js';
import { captureParameters, controlNumber, decodeControl, decodeParameter, encodeControl, encodeParameter, tempoRange,
  parameterMessage, requestMessage } from './synth-midi.js';

export function setupMidiDiscovery(onNotesChanged, onSynthValue, onArpeggiatorTempo, onLooperMode, groove = {}) {
  const connect = document.querySelector('#midi-connect');   
  const badge = document.querySelector('#midi-badge');
  const status = document.querySelector('#midi-status');
  const refaceInput = document.querySelector('#midi-reface-input');
  const refaceOutput = document.querySelector('#midi-reface-output');
  const controllerInput = document.querySelector('#midi-controller-input');
  const modwheelTarget = document.querySelector('#midi-modwheel-target');
  const modwheelValue = document.querySelector('#midi-modwheel-value');
  const modwheelReadout = document.querySelector('#midi-modwheel-readout');
  const mappingStatus = document.querySelector('#midi-mapping-status');
  const selected = { input: '', output: '', controller: '' };
  const manuallySelected = { input: false, output: false, controller: false };
  const names = new Map();
  const listening = new Map();
  const received = new Map();
  const forwarded = new Map();
  const localNotes = new Map();
  const outputNotes = new Map();
  const queuedNotes = [];
  let queueBase;
  const activeSustain = new Map();
  const ccValues = new Map();
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
  let modwheelCC = 74;
  let mappingError = '';
  const mappingKey = 'refaceCS.modwheelCC';
  const panelFaders = [...document.querySelectorAll('#synth .fader[data-label]')];
  const controlLabels = new Map(panelFaders
    .map((fader) => [controlNumber(fader.id), fader.dataset.label]));
  for (const fader of panelFaders) {
    const message = encodeControl(fader.id, Number(fader.dataset.value));
    if (message && (message[0] & 0xf0) === 0xb0) ccValues.set(message[1], message[2]);
  }
  for (let cc = 0; cc < 128; cc++) {
    const description = cc === 1 ? 'Pass through' : controlLabels.get(cc);
    modwheelTarget.add(new Option(`CC ${cc}${description ? ` — ${description}` : ''}`, String(cc)));
  }
  try {
    const saved = localStorage.getItem(mappingKey);
    if (saved !== null) {
      if (/^(0|[1-9]\d*)$/.test(saved) && Number(saved) <= 127) modwheelCC = Number(saved);
      else mappingError = 'Saved modulation-wheel mapping is invalid; filter cutoff is selected.';
    }
  } catch (error) {
    mappingError = `Could not load modulation-wheel mapping: ${error.message || error}. Filter cutoff is selected.`;
  }
  modwheelTarget.value = String(modwheelCC);
  setModwheelDisplay(ccValues.get(modwheelCC) ?? Number(modwheelValue.value));
  updateMappingStatus();
  const looper = createLooper((message, owner) => sendOwned(output, message, owner), onLooperMode, setSharedTempo, {
    clock: groove.clock,
    sendScheduled: (message, owner, at) => queueOwned(message, owner, at),
    cancelScheduled,
    onStop: () => groove.onLooperStopped?.(),
  });
  const arpeggiator = createArpeggiator((message) => sendLive(output, message, 'arpeggiator'), changeRouting,
    () => muted, () => transpose, onArpeggiatorTempo);

  function reportError(message) {
    lastError = message;
    status.textContent = message;
  }

  function setSharedTempo(bpm) {
    onSynthValue('tempo', bpm);
    if (output) setControl('tempo', bpm);
  }

  function setControl(id, value) {
    const revision = (revisions.get(id) || 0) + 1;
    revisions.set(id, revision);
    const message = encodeControl(id, value);
    if (message) {
      if ((message[0] & 0xf0) === 0xb0) rememberCC(message[1], message[2]);
      send(output, message);
    }
    else if (encodeParameter(id, value)) void sendParameter(id, value, revision);
  }

  function sendPatchControls(controls) {
    const values = Object.entries(controls);
    if (!output || output.state !== 'connected') {
      reportError('MIDI output unavailable; patch values were not sent.');
      return { sent: 0, failed: values.length, total: values.length, unavailable: true };
    }

    let sent = 0;
    let failed = 0;
    for (const [id, value] of values) {
      const message = encodeControl(id, value);
      if (!message || (message[0] & 0xf0) !== 0xb0) {
        failed++;
        continue;
      }
      rememberCC(message[1], message[2]);
      if (send(output, message)) sent++;
      else failed++;
    }
    return { sent, failed, total: values.length, unavailable: false };
  }

  function send(port, message, timestamp) {
    if (!port || port.state !== 'connected') {
      reportError('MIDI output unavailable; message was not sent.');
      return false;
    }
    try {
      if (timestamp === undefined) port.send(message);
      else port.send(message, timestamp);
      return true;
    } catch (error) {
      reportError(`MIDI send failed: ${error.message || error}`);
      return false;
    }
  }

  function setModwheelDisplay(value) {
    modwheelValue.value = String(value);
    modwheelValue.setAttribute('aria-label', `Modulation wheel value, CC ${modwheelCC}`);
    modwheelReadout.textContent = String(value);
  }

  function rememberCC(cc, value) {
    ccValues.set(cc, value);
    if (cc === modwheelCC) setModwheelDisplay(value);
  }

  function updateMappingStatus() {
    const held = modwheelCC !== 64 && [...activeSustain.values()]
      .some((source) => source === 'modwheel' || source === 'slider');
    mappingStatus.textContent = [mappingError,
      held ? 'Sustain remains active; send CC 64 off or use MIDI Reset.' : ''].filter(Boolean).join(' ');
  }

  function sendControllerCC(message, source) {
    const channel = message[0] & 0x0f;
    if (message[1] >= 120 && queuedNotes.length) looper.invalidateSchedule();
    if (!send(output, message)) return;
    if (message[1] === 64) {
      if (message[2] >= 64) activeSustain.set(channel, source);
      else activeSustain.delete(channel);
    } else if (message[1] === 121) {
      activeSustain.delete(channel);
    }
    updateMappingStatus();
    if (message[1] === 120 || message[1] === 123 || message[1] >= 124) {
      for (const [key, owners] of outputNotes) {
        if (!key.startsWith(`${channel}:`)) continue;
        for (const queue of owners.values()) queue.fill(false);
      }
    }
  }

  function mirrorControl(message) {
    const control = decodeControl(message);
    if (control) {
      revisions.set(control.id, (revisions.get(control.id) || 0) + 1);
      onSynthValue(control.id, control.value);
    }
  }

  function copyOwners(source) {
    return new Map([...source].map(([key, owners]) => [key,
      new Map([...owners].map(([owner, queue]) => [owner, [...queue]]))]));
  }

  function cancelScheduled() {
    if (queuedNotes.length) {
      try {
        output?.clear();
      } catch (error) {
        reportError(`Could not cancel scheduled MIDI: ${error.message || error}`);
      }
      const now = performance.now();
      outputNotes.clear();
      for (const [key, owners] of queueBase) outputNotes.set(key, owners);
      for (const event of queuedNotes) {
        if (event.at <= now) applyOwned(event.message, event.owner, outputNotes, () => true);
      }
      queuedNotes.length = 0;
      queueBase = undefined;
    }
    const active = [];
    for (const [key, owners] of outputNotes) {
      const [channel, pitch] = key.split(':').map(Number);
      for (const [owner, queue] of owners) {
        if (typeof owner === 'string' && owner.startsWith('looper:') && queue.includes(true)) {
          active.push({ id: Number(owner.slice(7)), channel, pitch });
        }
      }
    }
    return active;
  }

  function queueOwned(message, owner, at) {
    const now = performance.now();
    while (queuedNotes.length && queuedNotes[0].at <= now) {
      const event = queuedNotes.shift();
      applyOwned(event.message, event.owner, queueBase, () => true);
    }
    if (!queuedNotes.length) queueBase = copyOwners(outputNotes);
    if (!applyOwned(message, owner, outputNotes, (data) => send(output, data, at))) return false;
    queuedNotes.push({ message, owner, at });
    return true;
  }

  function sendOwned(port, message, owner) {
    if (queuedNotes.length) looper.invalidateSchedule();
    return applyOwned(message, owner, outputNotes, (data) => send(port, data));
  }

  function applyOwned(message, owner, state, emit) {
    const channel = message[0] & 0x0f;
    const key = `${channel}:${message[1]}`;
    const on = (message[0] & 0xf0) === 0x90 && message[2] !== 0;
    let owners = state.get(key);
    if (on) {
      const activeOwners = owners ? [...owners].filter(([, queue]) => queue.includes(true)) : [];
      if (activeOwners.length) {
        if (!emit([0x80 | channel, message[1], 0])) return false;
        for (const queue of owners.values()) queue.fill(false);
      }
      if (!emit(message)) return false;
      if (!owners) state.set(key, owners = new Map());
      const queue = owners.get(owner) || [];
      queue.push(true);
      owners.set(owner, queue);
      return true;
    }
    if (!owners?.has(owner)) return true;
    const queue = owners.get(owner);
    const active = queue[0];
    const anotherActive = queue.slice(1).includes(true)
      || [...owners].some(([other, entries]) => other !== owner && entries.includes(true));
    if (active && !anotherActive && !emit(message)) return false;
    queue.shift();
    if (!queue.length) owners.delete(owner);
    if (!owners.size) state.delete(key);
    return true;
  }

  function sendLive(port, message, owner) {
    const on = (message[0] & 0xf0) === 0x90 && message[2] !== 0;
    if (on) looper.noteOn(owner, message[0] & 0x0f, message[1], message[2]);
    else looper.noteOff(owner);
    return sendOwned(port, message, owner);
  }

  function releaseForwarded(port, includeSlider = false) {
    for (const [owner, { channel, notes }] of forwarded) {
      for (const note of notes) {
        if (note !== null) sendLive(port, [0x80 | channel, note, 0], owner);
        else looper.noteOff(owner);
      }
    }
    forwarded.clear();
    for (const [channel, source] of activeSustain) {
      if (source === 'slider' && !includeSlider) continue;
      send(port, [0xb0 | channel, 64, 0]);
      rememberCC(64, 0);
      activeSustain.delete(channel);
    }
    updateMappingStatus();
  }

  function releaseDirect(port) {
    releaseForwarded(port, true);
    for (const [owner, note] of localNotes) sendLive(port, [0x80, note, 0], owner);
    localNotes.clear();
  }

  function releaseOutput(port) {
    looper.stop();
    arpeggiator.clear();
    releaseDirect(port);
    outputNotes.clear();
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
        const sent = note !== null && sendLive(output, [0x90 | value.channel, note, value.velocity], owner);
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
    const type = data[0] & 0xf0;
    if (port.id === selected.input && type === 0x90 && data[1] < 128 && data[2] > 0 && data[2] < 128
      && groove.onRefaceNote?.(event.timeStamp, port.id)) return;
    if (port.id === selected.controller && (data[0] & 0x0f) === 9) {
      if (data[1] > 127 || data[2] > 127) {
        reportError('Invalid drum MIDI data; message was not played.');
        return;
      }
      if (type === 0x90 && data[2] > 0) groove.onDrumNote?.(data[1], data[2]);
      else if (type === 0xb0 && (data[1] === 120 || data[1] === 123)) groove.onDrumStop?.();
      return;
    }
    if (port.id === selected.input) {
      if (type === 0xb0 && data[1] < 128 && data[2] < 128) rememberCC(data[1], data[2]);
      const control = decodeControl(data);
      if (control) {
        revisions.set(control.id, (revisions.get(control.id) || 0) + 1);
        onSynthValue(control.id, control.value);
        return;
      }
    }
    if (port === controllerPort && port.id !== selected.input && (type === 0xb0 || type === 0xe0)) {
      if (data[1] > 127 || data[2] > 127) {
        reportError('Invalid controller MIDI data; message was not sent.');
        return;
      }
      const fromModwheel = type === 0xb0 && data[1] === 1;
      const message = [data[0], fromModwheel ? modwheelCC : data[1], data[2]];
      if (type === 0xb0) {
        rememberCC(data[1], data[2]);
        rememberCC(message[1], message[2]);
        sendControllerCC(message, fromModwheel ? 'modwheel' : 'controller');
      } else {
        send(output, message);
      }
      mirrorControl(message);
      return;
    }
    if ((type !== 0x80 && type !== 0x90) || data[1] > 127 || data[2] > 127) return;
    const channel = data[0] & 0x0f;
    const note = data[1];
    const on = type === 0x90 && data[2] !== 0;
    const key = `${port.id}:${channel}:${note}`;
    const count = received.get(key)?.count || 0;
    if (on) received.set(key, { port, channel, note, count: count + 1 });
    else if (count > 1) received.set(key, { port, channel, note, count: count - 1 });
    else received.delete(key);
    onNotesChanged();

    if (port.id === selected.input) {
      const owner = `reface:${key}`;
      if (on) {
        looper.noteOn(owner, channel, note, data[2]);
      } else {
        looper.noteOff(owner);
      }
    }
    if (port !== controllerPort || port.id === selected.input) return;
    if (on) arpeggiator.noteOn(key, note, data[2], channel, 'controller');
    else arpeggiator.noteOff(key);
    if (arpeggiator.enabled) return;
    if (on) {
      const target = muted ? null : transposedNote(note);
      const sent = target !== null && sendLive(output, [data[0], target, data[2]], key);
      rememberForwarded(key, channel, sent ? target : null);
    } else {
      const active = forwarded.get(key);
      if (!active) return;
      const target = active.notes[0];
      if (target !== null && !sendLive(output, [data[0], target, data[2]], key)) return;
      if (target === null) looper.noteOff(key);
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
        if (value.port === port) {
          for (let count = 0; count < value.count; count++) looper.noteOff(`reface:${key}`);
          received.delete(key);
        }
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
        } else if (result.id === 'tempo' && (result.value < tempoRange.min || result.value > tempoRange.max)) {
          missing.push(`tempo (${result.value} BPM outside ${tempoRange.min}–${tempoRange.max} BPM)`);
        } else {
          const message = encodeControl(result.id, result.value);
          if (message && (message[0] & 0xf0) === 0xb0) rememberCC(message[1], message[2]);
          onSynthValue(result.id, result.value);
          captured++;
        }
      }
      captureStatus.textContent = `Captured ${captured} settings. Not captured: expression, octave, looper, pitch bend${missing.length ? `, ${missing.join(', ')}` : ''}.`;
    } finally {
      capturing = false;
      button.disabled = false;
    }
  }

  document.querySelector('#capture-synth').addEventListener('click', captureSynth);
  document.getElementById("capture-synth").setAttribute("disabled", true);
  modwheelTarget.addEventListener('change', () => {
    const next = Number(modwheelTarget.value);
    modwheelCC = next;
    setModwheelDisplay(ccValues.get(next) ?? Number(modwheelValue.value));
    try {
      localStorage.setItem(mappingKey, String(next));
      mappingError = '';
    } catch (error) {
      mappingError = `Could not save modulation-wheel mapping: ${error.message || error}. The mapping will reset on reload.`;
    }
    updateMappingStatus();
  });
  modwheelValue.addEventListener('input', () => {
    const value = Number(modwheelValue.value);
    const message = [0xb0, modwheelCC, value];
    rememberCC(modwheelCC, value);
    sendControllerCC(message, 'slider');
    mirrorControl(message);
  });
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
      connect.textContent = 'MIDI connected';
      connect.classList.remove('notconnectedmidi');
      connect.classList.add('connectedmidi');
      document.getElementById('capture-synth').removeAttribute('disabled'); 
      document.getElementById('capture-synth').classList.add('notconnectedmidi');
    } catch (error) {
      badge.dataset.state = 'error';
      badge.textContent = 'MIDI access failed';
      status.textContent = `Could not access MIDI: ${error.message || error}. Check browser permissions and try again.`;
      connect.disabled = false;
    }
  });

  function resetNotes(clearLocalNotes = groove.clearLocalNotes) {
    const hadScheduled = queuedNotes.length > 0;
    const notesToRelease = new Map();
    for (const [key, owners] of outputNotes) {
      for (const queue of owners.values()) {
        for (const active of queue) {
          if (active) notesToRelease.set(key, (notesToRelease.get(key) || 0) + 1);
        }
      }
    }
    for (const { message } of queuedNotes) {
      const key = `${message[0] & 0x0f}:${message[1]}`;
      if (!notesToRelease.has(key)) notesToRelease.set(key, 1);
    }
    for (const note of received.values()) {
      if (note.port.id !== selected.input) continue;
      const key = `${note.channel}:${note.note}`;
      notesToRelease.set(key, (notesToRelease.get(key) || 0) + note.count);
    }
    groove.onDrumStop?.();
    looper.stop();
    arpeggiator.clear();
    cancelScheduled();
    let failed = 0;
    let firstError = '';
    const channels = new Set([...activeSustain.keys(), ...Array.from({ length: 16 }, (_, channel) => channel)]);
    const messages = [...channels].map((channel) => [0xb0 | channel, 64, 0]);
    // Queue clearing can discard note-offs sent while stopping the generators.
    for (const [key, count] of notesToRelease) {
      const [channel, pitch] = key.split(':').map(Number);
      for (let index = 0; index < count; index++) messages.push([0x80 | channel, pitch, 0]);
    }
    for (let channel = 0; channel < 16; channel++) {
      for (const controller of [123, 120]) messages.push([0xb0 | channel, controller, 0]);
    }
    if (output && output.state === 'connected') {
      try {
        if (typeof output.clear === 'function') output.clear();
        else if (hadScheduled) throw new Error('The MIDI output cannot cancel scheduled messages');
      } catch (error) {
        firstError = `Could not cancel scheduled MIDI: ${error.message || error}`;
      }
      for (const message of messages) {
        try {
          output.send(message);
          if ((message[0] & 0xf0) === 0xb0) rememberCC(message[1], message[2]);
        } catch (error) {
          failed++;
          if (!firstError) firstError = error.message || String(error);
        }
      }
    } else {
      firstError = 'MIDI output unavailable';
    }

    localNotes.clear();
    forwarded.clear();
    outputNotes.clear();
    activeSustain.clear();
    updateMappingStatus();
    received.clear();
    clearLocalNotes?.();
    onNotesChanged();

    if (firstError) {
      reportError(`MIDI reset failed${failed ? ` (${failed} of ${messages.length} messages)` : ''}: ${firstError}. Held-note state cleared.`);
    } else {
      lastError = '';
      status.textContent = 'MIDI reset messages sent. Release and play held keys again.';
    }
  }

  window.addEventListener('pagehide', () => releaseOutput(output));

  return {
    setMuted(value) {
      muted = value;
      looper.setMuted(value);
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
    setArpeggiatorTempo(value) {
      arpeggiator.setTempo(value);
      groove.clock?.setTempo(value);
      looper.setTempo(value);
    },
    setLooperMode(value, startAt) {
      if (value === 0) {
        resetNotes();
        return;
      }
      if (startAt === undefined && groove.onLooperStartRequest?.(value)) return;
      if (value !== 2 && value !== 3) groove.onLooperStartCancelled?.();
      looper.setMode(value, startAt);
    },
    sendPatchControls,
    setControl,
    setTempo: setSharedTempo,
    getRefaceInput() {
      const input = midiAccess?.inputs.get(selected.input);
      return input?.state === 'connected' ? input.id : null;
    },
    resetNotes,
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
      if (target !== null && sendLive(output, [0x90, target, velocity], owner)) localNotes.set(owner, target);
    },
    endNote(owner) {
      arpeggiator.noteOff(owner);
      if (!localNotes.has(owner)) {
        looper.noteOff(owner);
        return;
      }
      sendLive(output, [0x80, localNotes.get(owner), 0], owner);
      localNotes.delete(owner);
    },
    stopForVisibility() {
      releaseOutput(output);
    },
  };
}
