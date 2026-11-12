export function setupMidiDiscovery(onNotesChanged) {
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
  let midiAccess;
  let output;
  let controllerPort;
  let lastError = '';

  function reportError(message) {
    lastError = message;
    status.textContent = message;
  }

  function send(port, message) {
    if (!port || port.state !== 'connected') {
      reportError('MIDI output unavailable; note was not sent.');
      return false;
    }
    try {
      port.send(message);
      return true;
    } catch (error) {
      reportError(`MIDI note send failed: ${error.message || error}`);
      return false;
    }
  }

  function releaseForwarded(port) {
    for (const { channel, note, count } of forwarded.values()) {
      for (let i = 0; i < count; i++) send(port, [0x80 | channel, note, 0]);
    }
    forwarded.clear();
  }

  function releaseOutput(port) {
    releaseForwarded(port);
    for (const note of localNotes.values()) send(port, [0x80, note, 0]);
    localNotes.clear();
  }

  function handleMessage(port, event) {
    const data = event.data;
    if (!data || data.length !== 3) return;
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
    const active = forwarded.get(key);
    if (on) {
      if (send(output, [...data])) {
        forwarded.set(key, { channel, note, count: (active?.count || 0) + 1 });
      }
    } else if (active && send(output, [...data])) {
      if (active.count > 1) active.count--;
      else forwarded.delete(key);
    }
  }

  function updateListeners(inputs) {
    const desired = inputs.filter((port) => port.id === selected.input || port.id === selected.controller);
    const nextController = desired.find((port) => port.id === selected.controller);
    const forwards = nextController && nextController.id !== selected.input ? nextController : undefined;
    if (controllerPort && controllerPort !== forwards) releaseForwarded(output);
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
    renderSelect(refaceInput, inputs, selected.input);
    renderSelect(refaceOutput, outputs, selected.output);
    renderSelect(controllerInput, inputs, selected.controller);

    const inputAvailable = inputs.some((port) => port.id === selected.input);
    const outputAvailable = outputs.some((port) => port.id === selected.output);
    const controllerAvailable = inputs.some((port) => port.id === selected.controller);
    const connected = inputAvailable && outputAvailable;
    badge.dataset.state = connected ? 'connected' : 'disconnected';
    badge.textContent = connected ? 'reface MIDI ports available' : 'reface MIDI ports unavailable';
    status.textContent = `reface input ${inputAvailable ? 'available' : 'unavailable'}; output ${outputAvailable ? 'available' : 'unavailable'}; controller input ${controllerAvailable ? 'available' : 'unavailable'}. Automatic detection uses port names, not hardware verification.${lastError ? ` ${lastError}` : ''}`;
  }

  refaceInput.addEventListener('change', () => {
    lastError = '';
    const previous = selected.input;
    manuallySelected.input = true;
    selected.input = refaceInput.value;
    if (!manuallySelected.controller && selected.controller === previous) selected.controller = selected.input;
    refresh();
  });
  refaceOutput.addEventListener('change', () => {
    lastError = '';
    manuallySelected.output = true;
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
      clearLocalNotes();

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
    startNote(owner, note) {
      if (send(output, [0x90, note, 100])) localNotes.set(owner, note);
    },
    endNote(owner) {
      if (!localNotes.has(owner)) return;
      send(output, [0x80, localNotes.get(owner), 0]);
      localNotes.delete(owner);
    },
  };
}
