import { getPreference, setPreference } from './preferences.js';
import { createReporter } from './notifications.js';
import { DRUM_VOICES } from './drum-audio.js';

const xgKits = [
  [1, 'Standard'], [2, 'Standard 2'], [3, 'Dry'], [4, 'Brilliant'], [9, 'Room'],
  [10, 'Dark Room'], [17, 'Rock'], [18, 'Rock 2'], [25, 'Electro'], [26, 'Analog'],
  [27, 'Analog 2'], [28, 'Dance'], [29, 'Hip Hop'], [30, 'Jungle'],
  [33, 'Jazz'], [34, 'Jazz 2'], [41, 'Brush'], [49, 'Symphony'],
];
const performances = [
  [123, '9o9 Kit'], [124, '8o8 Kit'], [125, '4 by 4'],
  [126, 'Elec Kit'], [127, 'B900 Kit'], [128, 'Session'],
];
const defaults = { routing: 'internal', port: '', channel: 10, kit: 'current',
  msb: 0, lsb: 0, program: 1, performance: 1, mappings: {} };
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const validMapping = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.entries(value).every(([voice, note]) => DRUM_VOICES.some((item) => item.id === voice) && integer(note, 0, 127));
const validSettings = (value) => value && typeof value === 'object'
  && ['internal', 'midi', 'both'].includes(value.routing) && typeof value.port === 'string'
  && integer(value.channel, 1, 16) && typeof value.kit === 'string'
  && integer(value.msb, 0, 127) && integer(value.lsb, 0, 127)
  && integer(value.program, 1, 128) && integer(value.performance, 1, 128)
  && value.mappings && typeof value.mappings === 'object' && !Array.isArray(value.mappings)
  && Object.values(value.mappings).every(validMapping)
  && (value.octaves === undefined || (value.octaves && typeof value.octaves === 'object' && !Array.isArray(value.octaves)
    && Object.values(value.octaves).every((octave) => integer(octave, -3, 3))))
  && (value.reverb === undefined || integer(value.reverb, 0, 127));

export function createDrumMidi({ onRouteChange, onMappingChange, onError }) {
  const el = (name) => document.querySelector(`#drum-${name}`);
  const dialog = el('midi-settings');
  const report = createReporter('groove', 'drum-midi-status');
  const routing = el('routing');
  const portSelect = el('midi-port');
  const kitSelect = el('midi-kit');
  const mappingList = el('midi-mappings');
  const saved = getPreference('grooveMidi', validSettings, defaults);
  const settings = structuredClone(saved);
  settings.reverb ??= 0;
  settings.octaves ??= {};
  let access;
  let connecting;
  let settingsRevision = 0;
  const pending = new Set();
  const active = new Map();
  const kitOptions = [
    { id: 'current', name: 'Keep current sound' },
    ...xgKits.map(([program, name]) => ({ id: `xg-${program}`, name: `CS2x XG: ${name}`, msb: 127, lsb: 0, program })),
    ...[1, 2].map((program) => ({ id: `xg-sfx-${program}`, name: `CS2x XG: SFX ${program}`, msb: 126, lsb: 0, program })),
    ...performances.map(([program, name]) => ({ id: `preset2-${program}`, name: `CS2x Performance 2-${program}: ${name}`, msb: 63, lsb: 66, program })),
    { id: 'preset1', name: 'CS2x preset Performance bank 1', msb: 63, lsb: 64 },
    { id: 'preset2', name: 'CS2x preset Performance bank 2', msb: 63, lsb: 66 },
    { id: 'user1', name: 'CS2x user Performance bank 1', msb: 63, lsb: 65 },
    { id: 'user2', name: 'CS2x user Performance bank 2', msb: 63, lsb: 67 },
    { id: 'custom', name: 'Custom bank / program' },
  ];
  if (!kitOptions.some((item) => item.id === settings.kit)) settings.kit = 'current';
  kitSelect.replaceChildren(...kitOptions.map((item) => new Option(item.name, item.id)));
  const selectedKit = () => kitOptions.find((item) => item.id === settings.kit);
  const mappingKey = () => {
    const kit = selectedKit();
    return kit.msb === 63 ? `performance:${kit.lsb}:${kit.program ?? settings.performance}` : 'global';
  };
  const mapping = () => settings.mappings[mappingKey()] || {};
  const noteFor = (voice) => mapping()[voice.id] ?? voice.note;
  const persist = () => setPreference('grooveMidi', settings);
  const external = () => settings.routing !== 'internal';
  const internal = () => settings.routing !== 'midi';
  const port = () => access?.outputs.get(settings.port);

  function renderMappings() {
    const key = mappingKey();
    el('midi-octave').value = String(settings.octaves[key] ?? 0);
    mappingList.replaceChildren(...DRUM_VOICES.map((voice) => {
      const label = document.createElement('label');
      label.textContent = `${voice.name} `;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '127';
      input.step = '1';
      input.value = String(settings.mappings[key]?.[voice.id] ?? voice.note);
      input.setAttribute('aria-label', `${voice.name} MIDI note`);
      input.addEventListener('change', () => {
        const value = Number(input.value);
        if (input.value.trim() === '' || !integer(value, 0, 127)) {
          input.value = String(noteFor(voice));
          report('MIDI notes must be whole numbers from 0 to 127.');
          return;
        }
        settings.mappings[key] ??= {};
        settings.mappings[key][voice.id] = value;
        persist();
        if (key === mappingKey()) onMappingChange();
      });
      label.append(input);
      return label;
    }));
  }

  function render() {
    routing.value = settings.routing;
    kitSelect.value = settings.kit;
    for (const field of ['channel', 'msb', 'lsb', 'program', 'performance']) el(`midi-${field}`).value = String(settings[field]);
    el('midi-bank-controls').hidden = settings.kit !== 'custom';
    el('midi-performance-label').hidden = !['preset1', 'preset2', 'user1', 'user2'].includes(settings.kit);
    el('midi-reverb').value = String(settings.reverb);
    el('midi-reverb-value').textContent = String(settings.reverb);
    renderSound();
    renderMappings();
  }

  function renderSound() {
    const kit = selectedKit();
    el('midi-sound').textContent = kit.id === 'current' ? ''
      : kit.id === 'custom' ? `Bank ${settings.msb}/${settings.lsb}, program ${settings.program}`
        : kit.msb === 63 && kit.program === undefined ? `${kit.name}: ${settings.performance}` : kit.name;
  }

  function refreshPorts() {
    const previous = portSelect.selectedOptions[0]?.textContent;
    const outputs = [...(access?.outputs.values() || [])].filter((item) => item.state === 'connected');
    portSelect.replaceChildren(new Option('Not selected', ''));
    for (const output of outputs) portSelect.add(new Option(output.name || output.id, output.id));
    if (settings.port && !outputs.some((item) => item.id === settings.port)) {
      portSelect.add(new Option(`${previous || settings.port} (disconnected)`, settings.port));
    }
    portSelect.value = settings.port;
    if (settings.port && port()?.state !== 'connected') {
      stop();
      onRouteChange('Selected drum MIDI output is disconnected. Reconnect it or select another output.');
      report('Selected drum MIDI output is disconnected. Reconnect it or select another output.', 'error');
    }
  }

  async function connect() {
    if (access) { refreshPorts(); return; }
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI is unavailable; use Chrome or Edge in a secure context.');
    connecting ??= navigator.requestMIDIAccess().then(setAccess).finally(() => { connecting = undefined; });
    await connecting;
  }

  function setAccess(result) {
    if (access === result) return;
    access?.removeEventListener('statechange', refreshPorts);
    access = result;
    access.addEventListener('statechange', refreshPorts);
    refreshPorts();
  }

  async function ensureReady() {
    if (!external()) return;
    await connect();
    if (!settings.port || port()?.state !== 'connected') throw new Error('Select an available drum MIDI output in MIDI settings.');
  }

  function send(output, message) {
    if (!output || output.state !== 'connected') throw new Error('Drum MIDI output is unavailable.');
    output.send(message);
  }

  function cancelFuture() {
    for (const timer of pending) clearTimeout(timer);
    pending.clear();
  }

  function stop() {
    cancelFuture();
    for (const [key, hit] of active) {
      clearTimeout(hit.timer);
      try { send(hit.port, [0x80 | hit.channel, hit.note, 0]); }
      catch (error) { report(`Could not release drum MIDI note: ${error.message || error}`, 'error'); }
      active.delete(key);
    }
  }

  function silenceVoice(voice) {
    for (const [key, hit] of active) {
      if (hit.voice !== voice) continue;
      clearTimeout(hit.timer);
      try {
        send(hit.port, [0x80 | hit.channel, hit.note, 0]);
        active.delete(key);
      } catch (error) {
        onError(`Drum MIDI note-off failed: ${error.message || error}`);
        return;
      }
    }
  }

  function trigger(voiceId, velocity, at = performance.now()) {
    if (!external() || document.hidden) return;
    const voice = DRUM_VOICES.find((item) => item.id === voiceId);
    if (!voice) throw new Error(`Unknown drum voice: ${voiceId}`);
    const output = port();
    if (!output || output.state !== 'connected') throw new Error('Drum MIDI output is unavailable.');
    const channel = settings.channel - 1;
    const note = noteFor(voice) + (settings.octaves[mappingKey()] ?? 0) * 12;
    if (!integer(note, 0, 127)) {
      report(`Skipped ${voice.name}: shifted MIDI note ${note} is outside 0-127. Adjust Octave or the lane mapping.`, 'warning');
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(timer);
      if (performance.now() - at > 100) {
        report('A late drum MIDI note was skipped. Check browser or system load.', 'warning');
        return;
      }
      const key = `${channel}:${note}`;
      try {
        const old = active.get(key);
        if (old) {
          clearTimeout(old.timer);
          send(old.port, [0x80 | channel, note, 0]);
          active.delete(key);
        }
        send(output, [0x90 | channel, note, velocity]);
        const release = setTimeout(() => {
          try {
            send(output, [0x80 | channel, note, 0]);
            active.delete(key);
          }
          catch (error) { onError(`Drum MIDI note-off failed: ${error.message || error}`); }
        }, 50);
        active.set(key, { port: output, channel, note, voice: voiceId, timer: release });
      } catch (error) { onError(`Drum MIDI send failed: ${error.message || error}`); }
    }, Math.max(0, at - performance.now()));
    pending.add(timer);
  }

  async function applyKit() {
    const kit = selectedKit();
    if (kit.id === 'current') { report('Keeping the device’s current sound.'); return; }
    const revision = settingsRevision;
    try {
      await connect();
      if (revision !== settingsRevision) return;
      if (!settings.port || port()?.state !== 'connected') throw new Error('Select an available MIDI output first.');
      onRouteChange();
      stop();
      const msb = kit.id === 'custom' ? settings.msb : kit.msb;
      const lsb = kit.id === 'custom' ? settings.lsb : kit.lsb;
      const program = kit.id === 'custom' ? settings.program : kit.program ?? settings.performance;
      const channel = settings.channel - 1;
      send(port(), [0xb0 | channel, 0, msb]);
      send(port(), [0xb0 | channel, 32, lsb]);
      send(port(), [0xc0 | channel, program - 1]);
      report('Kit / Performance sent. Verify the instrument’s mode and sound.');
    } catch (error) { report(`Could not apply kit / Performance: ${error.message || error}`, 'error'); }
  }

  routing.addEventListener('change', () => {
    settingsRevision++;
    onRouteChange();
    stop();
    settings.routing = routing.value;
    persist();
  });
  portSelect.addEventListener('change', () => {
    settingsRevision++;
    onRouteChange();
    stop();
    settings.port = portSelect.value;
    persist();
  });
  kitSelect.addEventListener('change', () => {
    settingsRevision++;
    onRouteChange();
    stop();
    settings.kit = kitSelect.value;
    if (selectedKit().msb === 63) settings.channel = 1;
    else if (settings.kit.startsWith('xg-')) settings.channel = 10;
    persist();
    render();
    if (settings.kit === 'custom') report('Edit the bank and program, then choose Apply.');
    else void applyKit();
  });
  for (const [field, min, max] of [['channel', 1, 16], ['msb', 0, 127], ['lsb', 0, 127], ['program', 1, 128], ['performance', 1, 128]]) {
    const input = el(`midi-${field}`);
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (input.value.trim() === '' || !integer(value, min, max)) {
        input.value = String(settings[field]);
        report(`${field} must be a whole number from ${min} to ${max}.`);
        return;
      }
      settingsRevision++;
      onRouteChange();
      stop();
      settings[field] = value;
      persist();
      renderSound();
      if (field === 'performance') { renderMappings(); void applyKit(); }
    });
  }
  el('midi-settings-open').addEventListener('click', () => {
    render();
    dialog.showModal();
    void connect().catch((error) => { report(`Could not access MIDI: ${error.message || error}`, 'error'); });
  });
  el('midi-connect').addEventListener('click', () => {
    void connect().then(() => {
      if (!settings.port || port()?.state === 'connected') report('MIDI outputs refreshed.');
    }).catch((error) => { report(`Could not access MIDI: ${error.message || error}`, 'error'); });
  });
  el('midi-apply').addEventListener('click', () => { void applyKit(); });
  el('midi-octave').addEventListener('change', () => {
    const value = Number(el('midi-octave').value);
    if (el('midi-octave').value === '' || !integer(value, -3, 3)) {
      el('midi-octave').value = String(settings.octaves[mappingKey()] ?? 0);
      report('External MIDI octave must be a whole number from -3 to +3.');
      return;
    }
    stop();
    settings.octaves[mappingKey()] = value;
    persist();
    onMappingChange();
  });
  el('midi-reverb').addEventListener('input', () => {
    settings.reverb = Number(el('midi-reverb').value);
    el('midi-reverb-value').textContent = String(settings.reverb);
    persist();
    const revision = settingsRevision;
    void connect().then(() => {
      if (revision !== settingsRevision) return;
      send(port(), [0xb0 | settings.channel - 1, 91, settings.reverb]);
      report(`External MIDI reverb sent: ${settings.reverb}.`);
    }).catch((error) => { report(`Could not send external reverb: ${error.message || error}`, 'error'); });
  });
  el('midi-close').addEventListener('click', () => dialog.close());
  render();
  return { internal, external, ensureReady, trigger, cancelFuture, stop, silenceVoice, setAccess };
}
