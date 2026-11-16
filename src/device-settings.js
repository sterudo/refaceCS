import { createReporter } from './notifications.js';
import { deviceParameters } from './synth-midi.js';
import { createDevicePanel } from './device-panel.js';

const onOff = [['Off', 0], ['On', 1]];
const channels = Array.from({ length: 16 }, (_, index) => [`Channel ${index + 1}`, index]);
const fields = [
  { id: 'midi-transmit', label: 'MIDI transmit channel', options: [...channels, ['Off', 127]], defaultValue: 0 },
  { id: 'midi-receive', label: 'MIDI receive channel', options: [...channels, ['All', 16]], defaultValue: 16 },
  { id: 'local-control', label: 'Local Control', options: onOff, defaultValue: 1 },
  { id: 'midi-control', label: 'MIDI Control', options: onOff, defaultValue: 0 },
  { id: 'speaker-output', label: 'Speaker output', options: onOff, defaultValue: 1 },
  { id: 'auto-power', label: 'Auto Power-Off', options: onOff, defaultValue: 1 },
  { id: 'master-tune', label: 'Master Tune (cents)', min: -102.4, max: 102.3, step: 0.1 },
  { id: 'pitch-direction', label: 'Pitch-bend direction', options: [['Normal', 1], ['Inverted', -1]], defaultValue: 1 },
  { id: 'pitch-magnitude', label: 'Pitch-bend range (semitones)', min: 0, max: 24, step: 1, defaultValue: 12 },
  { id: 'tone-volume', label: 'Tone-generator volume', min: 0, max: 127, step: 1 },
  { id: 'sustain-pedal', label: 'Sustain pedal type (experimental)', options: [['FC3', 0], ['FC4/5', 1]] },
  { id: 'foot-mode', label: 'Foot volume/sustain (experimental)', options: [['Foot volume', 0], ['Sustain', 1]] },
];

export function setupDeviceSettings(midi, { onPitchRead, onPitchUnconfirmed }) {
  const dialog = document.querySelector('#device-settings');
  const status = createReporter('reface', 'device-settings-status');
  const validation = document.querySelector('#device-settings-status');
  const controls = new Map();
  const current = new Map();
  const dirty = new Set();
  const buttons = ['read', 'reset', 'close', 'discard', 'apply']
    .map((name) => document.querySelector(`#device-settings-${name}`));
  let busy = false;
  const idleWaiters = [];
  let connectionRevision = 0;
  const panel = createDevicePanel((id, value) => applyPanel(id, value));

  for (const field of fields) {
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = field.label;
    const value = document.createElement('td');
    value.textContent = 'Unknown';
    const edit = document.createElement('td');
    const input = document.createElement(field.options ? 'select' : 'input');
    input.setAttribute('aria-label', field.label);
    if (field.options) {
      input.add(new Option('No change', ''));
      for (const [label, optionValue] of field.options) input.add(new Option(label, String(optionValue)));
    } else {
      input.type = 'number';
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);
      input.placeholder = 'No change';
    }
    const result = document.createElement('td');
    result.textContent = '—';
    input.addEventListener('input', () => {
      validation.textContent = '';
      if (input.value === '') dirty.delete(field.id);
      else if (current.has(field.id) && Number(input.value) === current.get(field.id)) dirty.delete(field.id);
      else dirty.add(field.id);
      result.textContent = dirty.has(field.id) ? 'Changed' : '—';
    });
    edit.append(input);
    row.append(heading, value, edit, result);
    document.querySelector('#device-settings-fields').append(row);
    controls.set(field.id, { field, input, value, result });
  }

  function displayValue(field, value) {
    if (value === null) return 'Unknown';
    return field.options?.find(([, optionValue]) => optionValue === value)?.[0] ?? String(value);
  }

  function updateField(id, value, state, preserveDraft = true) {
    const control = controls.get(id);
    if (!control) return;
    if (value === null) current.delete(id);
    else current.set(id, value);
    control.value.textContent = displayValue(control.field, value);
    control.result.textContent = state === 'read' ? 'Read' : state === 'unknown' ? 'No response' : state;
    if (!preserveDraft || !dirty.has(id)) control.input.value = value === null ? '' : String(value);
  }

  function result(id, value, state) {
    if (state === 'failed') {
      const ids = id === 'pitch-range' ? ['pitch-direction', 'pitch-magnitude'] : [id];
      ids.forEach((key) => { controls.get(key).result.textContent = 'failed'; });
      return;
    }
    if (state === 'sent') {
      if (id !== 'pitch-range') {
        updateField(id, value, 'Sent; unconfirmed');
        panel.update(id, value, 'unconfirmed');
      }
      return;
    }
    if (id === 'pitch-range') {
      updateField('pitch-magnitude', value === null ? null : Math.abs(value), state);
      updateField('pitch-direction', value === null || value === 0 ? null : Math.sign(value), state);
      if (value !== null) onPitchRead(value, state);
      else onPitchUnconfirmed();
      return;
    }
    updateField(id, value, state);
    panel.update(id, value, state === 'read' || state === 'confirmed' ? 'confirmed' : 'unconfirmed');
  }

  function setBusy(value) {
    busy = value;
    panel.setBusy(value);
    buttons.forEach((button) => { button.disabled = value; });
    for (const { input } of controls.values()) input.disabled = value;
    if (!value) idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  function connectionChanged() {
    validation.textContent = '';
    connectionRevision++;
    current.clear();
    dirty.clear();
    for (const [id, control] of controls) {
      control.value.textContent = 'Unknown';
      control.result.textContent = '—';
      control.input.value = '';
    }
    status('MIDI connection changed; device values and pending edits were cleared.');
    panel.connectionChanged(midi.hasDeviceOutput());
    panel.status('Device values assumed until read; ? indicates an unconfirmed value.');
  }

  async function read() {
    if (busy) return;
    validation.textContent = '';
    const revision = connectionRevision;
    let pitchRead = false;
    let missing = 0;
    let succeeded = false;
    setBusy(true);
    status('Reading device settings…');
    try {
      await midi.readDeviceSettings(deviceParameters.map((item) => item.id), (id, value, state) => {
        if (revision !== connectionRevision) return;
        if (id === 'pitch-range') pitchRead = true;
        if (value === null) missing++;
        result(id, value, state);
      });
      succeeded = true;
      status('Read complete. No response means the value is unknown.');
      panel.status(missing
        ? `Device settings read: ${missing} no response; ? indicates an assumed or unconfirmed value.`
        : 'Device settings read complete.', missing ? 'warning' : 'normal');
    } catch (error) {
      if (revision === connectionRevision) {
        status(`Could not read all settings: ${error.message || error}`, 'error');
      }
    } finally {
      setBusy(false);
    }
    if (revision === connectionRevision && !pitchRead) onPitchUnconfirmed();
    return succeeded;
  }

  async function applyPanel(id, value) {
    if (busy || !midi.hasDeviceOutput()) return;
    const revision = connectionRevision;
    setBusy(true);
    panel.status(`Sending ${controls.get(id).field.label}…`);
    try {
      await midi.applyDeviceSettings({ [id]: value }, (key, readValue, state) => {
        if (revision !== connectionRevision) return;
        if (state === 'unconfirmed' && readValue === null) readValue = value;
        result(key, readValue, state);
        if (state !== 'sent') panel.status(state === 'confirmed'
          ? `${controls.get(id).field.label} confirmed.`
          : `${controls.get(id).field.label} ${state}; check the device settings.`,
        state === 'confirmed' ? 'normal' : state === 'failed' ? 'error' : 'warning');
      });
    } catch (error) {
      if (revision === connectionRevision) panel.status(`Could not change ${controls.get(id).field.label}: ${error.message || error}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    validation.textContent = '';
    const unknownDefaults = [];
    for (const [id, control] of controls) {
      if (control.field.defaultValue === undefined) {
        unknownDefaults.push(control.field.label);
        continue;
      }
      control.input.value = String(control.field.defaultValue);
      control.input.dispatchEvent(new Event('input'));
    }
    status(`Defaults prepared; Apply sends changes. Defaults not verified, left unchanged: ${unknownDefaults.join(', ')}.`);
  }

  function discard() {
    validation.textContent = '';
    dirty.clear();
    for (const [id, control] of controls) {
      control.input.value = current.has(id) ? String(current.get(id)) : '';
      control.result.textContent = '—';
    }
    status('Changes discarded.');
  }

  async function apply() {
    validation.textContent = '';
    const changes = {};
    for (const id of dirty) {
      const { input, field } = controls.get(id);
      if (!input.checkValidity() || input.value === '') {
        validation.textContent = `Enter a valid value for ${field.label}.`;
        input.focus();
        return;
      }
      if (!id.startsWith('pitch-')) changes[id] = Number(input.value);
    }
    if (dirty.has('pitch-direction') || dirty.has('pitch-magnitude')) {
      const direction = controls.get('pitch-direction').input.value;
      const magnitude = controls.get('pitch-magnitude').input.value;
      if (!direction || magnitude === '') {
        validation.textContent = 'Choose a pitch-bend direction and range before applying.';
        return;
      }
      if (Number(magnitude) === 0 && dirty.has('pitch-direction')) {
        validation.textContent = 'A zero pitch-bend range has no direction; choose a nonzero range to set inversion.';
        return;
      }
      changes['pitch-range'] = Number(direction) * Number(magnitude);
    }
    if (!Object.keys(changes).length) {
      status('No changes to apply.');
      return;
    }
    setBusy(true);
    status('Applying changes and requesting read-back…');
    let hasFailures = false;
    try {
      await midi.applyDeviceSettings(changes, (id, value, state) => {
        if (state === 'sent') {
          result(id, value, state);
          return;
        }
        if (state === 'unconfirmed' && value === null && id !== 'pitch-range') value = changes[id];
        result(id, value, state);
        const ids = id === 'pitch-range' ? ['pitch-direction', 'pitch-magnitude'] : [id];
        if (state === 'confirmed') {
          ids.forEach((key) => {
            dirty.delete(key);
            updateField(key, current.get(key) ?? null,
              key === 'pitch-direction' && value === 0 ? 'No direction at zero' : 'Confirmed', false);
          });
        } else {
          hasFailures = true;
        }
      });
      status(hasFailures
        ? 'Some settings failed or could not be confirmed; review their status before retrying.'
        : 'Changes confirmed by the synth.', hasFailures ? 'warning' : 'normal');
    } catch (error) {
      status(`Could not apply all settings: ${error.message || error}. Review the individual results.`, 'error');
    } finally {
      setBusy(false);
    }
  }

  document.querySelector('#device-settings-open').addEventListener('click', () => dialog.showModal());
  document.querySelector('#device-settings-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  document.querySelector('#device-settings-read').addEventListener('click', () => { void read(); });
  document.querySelector('#device-settings-reset').addEventListener('click', reset);
  document.querySelector('#device-settings-discard').addEventListener('click', discard);
  document.querySelector('#device-settings-apply').addEventListener('click', () => { void apply(); });
  return {
    connectionChanged,
    read,
    whenIdle() {
      return busy ? new Promise((resolve) => idleWaiters.push(resolve)) : Promise.resolve();
    },
    observePitch(value) {
      updateField('pitch-magnitude', Math.abs(value), 'read');
      updateField('pitch-direction', value === 0 ? null : Math.sign(value), 'read');
    },
    pitchSent() {
      updateField('pitch-magnitude', null, 'Requested; unconfirmed');
      updateField('pitch-direction', null, 'Requested; unconfirmed');
    },
  };
}
