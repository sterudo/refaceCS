import { createReporter } from './notifications.js';
import { getPreference, setPreference } from './preferences.js';

export function createMidiLearn(faders, onControl) {
  const toggle = document.querySelector('#midi-learn');
  const status = createReporter('midi', 'midi-learn-status');
  const assignments = document.querySelector('#midi-learn-assignments');
  const clear = document.querySelector('#midi-learn-clear');
  const targets = new Map(faders.map((fader) => [fader.id, fader]));
  const pickup = new Map();
  let controller;
  let enabled = false;
  let target;
  let mappings = [];
  const saved = getPreference('midiLearn', (value) => value !== undefined, []);
  const keys = new Set();
  const keyOf = ({ port, channel, cc }) => JSON.stringify([port, channel, cc]);
  function mappedValue(fader, raw) {
    const min = Number(fader.dataset.min ?? 0);
    return min + Math.round(raw * (Number(fader.dataset.max) - min) / 127);
  }
  const valid = Array.isArray(saved) && saved.every((mapping) => {
    if (!mapping || typeof mapping.port !== 'string' || !mapping.port
      || !Number.isInteger(mapping.channel) || mapping.channel < 0 || mapping.channel > 15
      || !Number.isInteger(mapping.cc) || mapping.cc < 0 || mapping.cc >= 120
      || !targets.has(mapping.target) || keys.has(keyOf(mapping))) return false;
    keys.add(keyOf(mapping));
    return true;
  });
  if (valid) mappings = saved;

  function show(message) {
    status(message);
  }

  function selectTarget(id) {
    if (!enabled || !targets.has(id)) return;
    if (target) targets.get(target).classList.remove('is-midi-learn-target');
    target = id;
    targets.get(target).classList.add('is-midi-learn-target');
    show(`Move a MIDI control to assign ${targets.get(target).dataset.label}.`);
  }

  function clearTarget() {
    if (target) targets.get(target).classList.remove('is-midi-learn-target');
    target = undefined;
  }

  function renderAssignments() {
    const previous = assignments.value;
    assignments.replaceChildren();
    for (const mapping of mappings.filter((item) => item.port === controller?.id)) {
      assignments.add(new Option(
        `Ch ${mapping.channel + 1}, CC ${mapping.cc} -> ${targets.get(mapping.target).dataset.label}`,
        keyOf(mapping)));
    }
    if ([...assignments.options].some((option) => option.value === previous)) assignments.value = previous;
    if (!assignments.options.length) assignments.add(new Option('No learned assignments', ''));
    assignments.disabled = !assignments.value;
    clear.disabled = !assignments.value;
  }

  function setEnabled(value) {
    enabled = value;
    toggle.setAttribute('aria-pressed', String(enabled));
    clearTarget();
    show(enabled ? 'Move an on-screen synth fader, then a MIDI control.'
      : controller ? 'MIDI Learn off. Learned assignments remain active with pickup.'
        : 'Connect MIDI and select a separate Controller input to use MIDI Learn.');
  }

  toggle.addEventListener('click', () => setEnabled(!enabled));
  clear.addEventListener('click', () => {
    const mapping = mappings.find((item) => keyOf(item) === assignments.value);
    if (!mapping) return;
    mappings = mappings.filter((item) => item !== mapping);
    pickup.delete(keyOf(mapping));
    setPreference('midiLearn', mappings);
    renderAssignments();
    show(`Cleared CC ${mapping.cc} on channel ${mapping.channel + 1}.${enabled ? ' Move an on-screen synth fader.' : ''}`);
    clearTarget();
  });

  setEnabled(false);
  renderAssignments();
  if (!valid) show('Invalid saved MIDI Learn assignments; no assignments were restored.');

  return {
    selectTarget,
    setController(port) {
      if (port === controller) return;
      controller = port;
      pickup.clear();
      toggle.disabled = !controller;
      setEnabled(false);
      renderAssignments();
    },
    resetPickup() {
      pickup.clear();
    },
    valueChanged(id) {
      for (const mapping of mappings) {
        if (mapping.target === id) {
          const state = pickup.get(keyOf(mapping));
          if (state) state.active = false;
        }
      }
    },
    handleMessage(port, data) {
      if (port !== controller || data.length !== 3 || (data[0] & 0xf0) !== 0xb0
        || data[1] > 127 || data[2] > 127) return false;
      const source = { port: port.id, channel: data[0] & 0x0f, cc: data[1] };
      const key = keyOf(source);
      let mapping = mappings.find((item) => keyOf(item) === key);
      if (enabled && target) {
        if (source.cc >= 120) {
          show('Channel-mode CCs 120-127 cannot be learned. Move an absolute CC knob or slider.');
          return false;
        }
        mapping = { ...source, target };
        mappings = mappings.filter((item) => keyOf(item) !== key);
        mappings.push(mapping);
        setPreference('midiLearn', mappings);
        renderAssignments();
        assignments.value = key;
        const label = targets.get(target).dataset.label;
        clearTarget();
        show(`CC ${source.cc}, channel ${source.channel + 1} assigned to ${label}. Move another on-screen synth fader, or turn MIDI Learn off.`);
        const fader = targets.get(mapping.target);
        pickup.set(key, { previous: mappedValue(fader, data[2]), active: false });
        return true;
      }
      if (!mapping) return false;
      const fader = targets.get(mapping.target);
      const value = mappedValue(fader, data[2]);
      const current = Number(fader.dataset.value);
      const state = pickup.get(key) || { active: false };
      const crossed = state.previous !== undefined
        && (state.previous - current) * (value - current) <= 0;
      if (!state.active && value !== current && !crossed) {
        pickup.set(key, { previous: value, active: false });
        return true;
      }
      onControl(mapping.target, value, source.channel);
      // Other updates re-arm every mapping for this fader; this source now owns it.
      pickup.set(key, { previous: value, active: true });
      return true;
    },
  };
}
