import './style.css';
import panelMarkup from './synth.svg?raw';
import { createVisualizations } from './visualizations.js';
import { setupMidiDiscovery } from './midi.js';
import { controlNumber } from './synth-midi.js';
import { detectChord, noteNames } from './chord-detection.js';

const svgNS = 'http://www.w3.org/2000/svg';
const container = document.querySelector('#synth');
container.innerHTML = panelMarkup;

const panel = container.querySelector('svg');
const displays = document.querySelector('#visualizations');
const status = document.querySelector('#app-status');
const sizeButton = document.querySelector('#fader-size');
const faders = [...panel.querySelectorAll('.fader')];
const readouts = new Map();
const startingValues = new Map(faders.map((fader) => [fader, Number(fader.dataset.value)]));
const keyboardKeys = panel.querySelector('#keyboard-keys');
const standardKeys = panel.querySelector('#standard-keys');
const transposeFader = panel.querySelector('#transpose');
const transposeValue = panel.querySelector('#transpose-value');
const octaveFader = panel.querySelector('#octave');
const octaveButtons = [...panel.querySelectorAll('.octave-step')];
const volumeFader = panel.querySelector('#volume');
const muteButton = panel.querySelector('#volume-mute');
const muteLabel = panel.querySelector('#mute-label');
const pitchRangeControl = panel.querySelector('#pitch-range');
const pitchRangeValue = panel.querySelector('#pitch-range-value');
const pitchRangeButtons = [...pitchRangeControl.querySelectorAll('[data-step]')];
const defaultPitchRange = Number(pitchRangeValue.textContent);
const baseTravel = 80;
const panelTopTrim = 27 * 0.75;
const activePointers = new Map();
const pressedKeys = new Set();
const computerKeys = new Map();
let travel = baseTravel;
let volumeMuted = false;
let pitchRange = defaultPitchRange;

const selections = {
  octave: ['-2', '-1', '0', '+1', '+2'],
  looper: ['Stop', 'Pause', 'Play', 'Record', 'Clear'],
  'lfo-assign': ['Off', 'Amp', 'Filter', 'Pitch', 'OSC'],
  'osc-type': ['Multi-saw', 'Pulse', 'Sync', 'Ring modulation', 'FM'],
  'effect-type': ['Off', 'Delay', 'Phaser', 'Chorus / flanger', 'Distortion'],
};
const updateVisualizations = createVisualizations(displays, panel, selections, resetSection);

function appendExtraKey(note, octave, x, black = false) {
  const key = document.createElementNS(svgNS, 'g');
  key.id = `key-${note}-${octave}`;
  key.setAttribute('class', 'key extra-key');
  const name = note[0].toUpperCase() + (black ? ' sharp' : '');
  key.setAttribute('aria-label', `${name}, octave ${octave}`);
  const shape = document.createElementNS(svgNS, 'use');
  shape.setAttribute('href', black ? '#black-key' : '#white-key');
  shape.setAttribute('x', x);
  key.append(shape);
  keyboardKeys.append(key);
}

for (const octave of [0, 4]) {
  for (const [index, note] of ['c', 'd', 'e', 'f', 'g', 'a', 'b'].entries()) {
    if (octave === 4 && index === 0) continue;
    appendExtraKey(note, octave, (octave * 7 + index) * 62);
  }
  for (const [note, offset] of [['cs', 45], ['ds', 107], ['fs', 231], ['gs', 293], ['as', 355]]) {
    appendExtraKey(note, octave, octave * 7 * 62 + offset, true);
  }
}
appendExtraKey('c', 5, 35 * 62);
const keys = [...panel.querySelectorAll('.key')];
const locallyHeldKeys = new Set();
const midi = setupMidiDiscovery(() => {
  keys.forEach(updateKey);
  updateHeldDisplay();
}, (id, value) => {
  if (id === 'pitch-range') {
    updatePitchRange(value, false);
  } else {
    const fader = panel.querySelector(`#${id}`);
    if (fader) updateFader(fader, value, false);
  }
});
const computerKeyBindings = new Map([
  ['KeyA', 'c-2'], ['KeyW', 'cs-2'], ['KeyS', 'd-2'], ['KeyE', 'ds-2'],
  ['KeyD', 'e-2'], ['KeyF', 'f-2'], ['KeyT', 'fs-2'], ['KeyG', 'g-2'],
  ['KeyY', 'gs-2'], ['KeyH', 'a-2'], ['KeyU', 'as-2'], ['KeyJ', 'b-2'], ['KeyK', 'c-3'],
].map(([code, id]) => [code, panel.querySelector(`#key-${id}`)]));

function readValue(fader) {
  return Number(fader.dataset.value);
}

function valueText(fader) {
  const value = readValue(fader);
  if (fader === transposeFader) return `${signedValue(value)} semitones`;
  return selections[fader.id]?.[value] ?? String(value);
}

function signedValue(value) {
  return value > 0 ? `+${value}` : String(value);
}

function updateFaderTooltip(fader) {
  const cc = controlNumber(fader.id);
  const suffix = panel.classList.contains('focus-mode') && cc !== undefined ? ` (CC ${cc})` : '';
  fader.querySelector('title').textContent = `${fader.dataset.label}: ${valueText(fader)}${suffix}`;
}

function updatePitchRange(value, announce = true) {
  pitchRange = Math.max(0, Math.min(24, Math.round(value)));
  pitchRangeValue.textContent = String(pitchRange);
  const description = `Pitch bend range: ${pitchRange} semitones`;
  pitchRangeControl.setAttribute('aria-label', description);
  for (const button of pitchRangeButtons) {
    const next = pitchRange + Number(button.dataset.step);
    button.setAttribute('aria-disabled', String(next < 0 || next > 24));
  }
  if (announce) {
    midi.setControl('pitch-range', pitchRange);
    status.textContent = description;
  }
}

function updateKeyNotes() {
  const transpose = readValue(transposeFader);
  const octaveShift = (readValue(octaveFader) - 2) * 12;
  midi.setTranspose(transpose);
  panel.classList.toggle('transpose-active', transpose !== 0);
  for (const key of keys) {
    const midiNote = Number(key.dataset.baseNote) + octaveShift;
    const note = midiNote + transpose;
    const name = noteNames[note % 12];
    const octave = Math.floor(note / 12) - 1;
    key.dataset.note = String(note);
    key.dataset.midiNote = String(midiNote);
    key.querySelector('.key-note').textContent = `${name}${octave}`;
    const label = `${name.replace('#', ' sharp')}, octave ${octave}`;
    key.setAttribute('aria-label', label);
    key.querySelector('title').textContent = label;
  }
  keys.forEach(updateKey);
}

function updateFader(fader, value, announce = true) {
  const min = Number(fader.dataset.min ?? 0);
  const max = Number(fader.dataset.max);
  value = Math.max(min, Math.min(max, Math.round(value)));
  const changed = value !== readValue(fader);
  fader.dataset.value = String(value);
  fader.setAttribute('aria-valuenow', value);
  fader.setAttribute('aria-valuetext', valueText(fader));
  fader.querySelector('.cap').setAttribute('y', travel * (1 - (value - min) / (max - min)));
  updateFaderTooltip(fader);
  readouts.get(fader).textContent = fader === transposeFader ? signedValue(value) : String(value);
  if (fader === transposeFader) transposeValue.textContent = signedValue(value);

  if (fader === octaveFader) {
    for (const button of octaveButtons) {
      const next = value + Number(button.dataset.step);
      button.setAttribute('aria-disabled', String(next < 0 || next > max));
    }
  }

  if (changed && (fader === octaveFader || fader === transposeFader)) {
    if (fader === octaveFader) releaseNotes();
    updateKeyNotes();
    updateHeldDisplay();
  }

  fader.querySelectorAll('.selection-led').forEach((led) => {
    led.classList.toggle('is-on', Number(led.dataset.value) === value);
  });

  updateVisualizations(fader.id);
  if (announce) {
    status.textContent = `${fader.dataset.label}: ${valueText(fader)}`;
  }
}

function updateFaderFromInput(fader, value) {
  updateFader(fader, value);
  midi.setControl(fader.id, readValue(fader));
}

function resetFader(fader) {
  for (const [pointerId, item] of activePointers) {
    if (item.element === fader) releasePointer({ pointerId });
  }
  updateFaderFromInput(fader, startingValues.get(fader));
}

function layoutPanel() {
  const extra = travel - baseTravel;
  const compact = panel.classList.contains('speakers-hidden');
  const leftTrim = compact ? 96 : 0;
  const rightTrim = compact ? 100 : 0;
  const width = 1760 - leftTrim - rightTrim;
  panel.setAttribute('viewBox', `${leftTrim} ${panelTopTrim} ${width} ${600 + extra - panelTopTrim}`);
  container.style.width = `${width / 1760 * 100}%`;
  container.style.minWidth = `${1000 * width / 1760}px`;
  panel.querySelector('#body').setAttribute('x', 25 + leftTrim);
  panel.querySelector('#body').setAttribute('width', 1710 - leftTrim - rightTrim);
  panel.querySelector('#body-edge').setAttribute('x', 27 + leftTrim);
  panel.querySelector('#body-edge').setAttribute('width', 1706 - leftTrim - rightTrim);
  panel.querySelector('#body-highlight').setAttribute('d',
    `M${36 + leftTrim} 28H${1724 - rightTrim}L${1734 - rightTrim} 44H${26 + leftTrim}Z`);
  panel.querySelector('#body-vents').setAttribute('transform', `translate(${leftTrim} 0)`);
  panel.querySelector('#body').setAttribute('height', 550 + extra);
  panel.querySelector('#body-edge').setAttribute('height', 550 + extra);
  panel.querySelector('#control-strip').setAttribute('x', compact ? 190 : 72);
  panel.querySelector('#control-strip').setAttribute('width', compact ? 1412 : 1620);
  panel.querySelector('#control-strip').setAttribute('height', 108 + extra);
  for (const button of octaveButtons) {
    const left = button.dataset.step === '-1';
    const x = left ? 25 + leftTrim : 1602;
    const endWidth = left ? 160 - leftTrim : 133 - rightTrim;
    const hitArea = button.querySelector('.end-hit-area');
    hitArea.setAttribute('x', x);
    hitArea.setAttribute('width', endWidth);
    hitArea.setAttribute('height', 550 + extra);
    button.querySelector('.end-arrow').setAttribute('transform',
      `translate(${x + endWidth / 2} ${430 + extra})`);
  }
  panel.querySelectorAll('.speaker').forEach((speaker) => {
    speaker.setAttribute('height', 92 + extra);
  });
  panel.querySelector('#lower-panel').setAttribute('transform', `translate(0 ${extra})`);
  panel.querySelectorAll('.focus-section').forEach((section) => {
    section.setAttribute('height', 178 + extra);
  });
  panel.querySelector('#looper-panel-wash').setAttribute('height', 106 + extra);

  for (const fader of faders) {
    fader.querySelector('.track').setAttribute('transform', `scale(1 ${travel / baseTravel})`);
    fader.querySelector('.hit-area').setAttribute('height', travel + 30);
    fader.querySelectorAll('.scale-label').forEach((label) => {
      label.setAttribute('y', travel * (1 - Number(label.dataset.step) / 4) + 3);
    });
    fader.querySelectorAll('.selection-led').forEach((led) => {
      led.setAttribute('cy', travel * (1 - Number(led.dataset.value) / 4));
    });
    updateFader(fader, readValue(fader), false);
  }
}

function pointerValue(fader, event) {
  const point = new DOMPoint(event.clientX, event.clientY);
  const local = point.matrixTransform(fader.getScreenCTM().inverse());
  const min = Number(fader.dataset.min ?? 0);
  return min + (1 - local.y / travel) * (Number(fader.dataset.max) - min);
}

for (const fader of faders) {
  const readout = document.createElementNS(svgNS, 'text');
  readout.id = `fader-value-${fader.id}`;
  readout.setAttribute('x', fader.transform.baseVal.consolidate().matrix.e);
  readout.setAttribute('y', '242');
  if (fader.id === 'looper' || fader.id === 'tempo') {
    readout.classList.add('focus-looper');
  }
  panel.querySelector('#fader-values').append(readout);
  readouts.set(fader, readout);
  fader.prepend(fader.querySelector('.hit-area'));
  const title = document.createElementNS(svgNS, 'title');
  fader.prepend(title);
  fader.setAttribute('role', 'slider');
  fader.setAttribute('tabindex', '0');
  fader.setAttribute('aria-label', fader.dataset.label);
  fader.setAttribute('aria-orientation', 'vertical');
  fader.setAttribute('aria-valuemin', fader.dataset.min ?? '0');
  fader.setAttribute('aria-valuemax', fader.dataset.max);
  if (fader.dataset.max === '4') {
    fader.querySelectorAll('.scale-label').forEach((label) => {
      label.classList.add('position-label', 'clickable-label');
    });
  }

  const min = Number(fader.dataset.min ?? 0);
  const max = Number(fader.dataset.max);
  const largeStep = max > 4 && fader !== transposeFader ? 10 : 1;

  fader.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    const step = event.altKey ? largeStep : 1;
    updateFaderFromInput(fader, readValue(fader) - Math.sign(event.deltaY) * step);
  }, { passive: false });

  fader.addEventListener('keydown', (event) => {
    if (event.key === 'Delete') {
      event.preventDefault();
      resetFader(fader);
      return;
    }
    const step = event.shiftKey ? largeStep : 1;
    const value = readValue(fader);
    const next = {
      ArrowUp: value + step,
      ArrowRight: value + step,
      ArrowDown: value - step,
      ArrowLeft: value - step,
      PageUp: value + largeStep,
      PageDown: value - largeStep,
      Home: max,
      End: min,
    }[event.key];

    if (next !== undefined) {
      event.preventDefault();
      updateFaderFromInput(fader, next);
    }
  });

  fader.addEventListener('dblclick', (event) => {
    if (event.target.closest('.position-label')) return;
    event.preventDefault();
    resetFader(fader);
  });

  fader.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || [...activePointers.values()].some((item) => item.element === fader)) {
      return;
    }
    event.preventDefault();
    fader.focus({ preventScroll: true });
    const label = event.target.closest('.position-label');
    if (label) {
      updateFaderFromInput(fader, Number(label.dataset.step));
      return;
    }
    fader.setPointerCapture(event.pointerId);
    const grabbedHandle = event.target.closest('.cap') !== null;
    const offset = grabbedHandle ? readValue(fader) - pointerValue(fader, event) : 0;
    activePointers.set(event.pointerId, { element: fader, offset });
    fader.classList.add('is-dragging');
    updateFaderFromInput(fader, pointerValue(fader, event) + offset);
  });

  fader.addEventListener('pointermove', (event) => {
    const drag = activePointers.get(event.pointerId);
    if (drag?.element === fader) {
      updateFaderFromInput(fader, pointerValue(fader, event) + drag.offset);
    }
  });
}

function updateKey(key) {
  const localDown = pressedKeys.has(key)
    || [...computerKeys.values()].includes(key)
    || [...activePointers.values()].some((item) => item.element === key);
  if (localDown && !locallyHeldKeys.has(key)) {
    locallyHeldKeys.add(key);
    const pointer = [...activePointers.values()].find((item) => item.element === key);
    midi.startNote(key, Number(key.dataset.midiNote), pointer?.velocity ?? readValue(volumeFader));
    updateHeldDisplay();
  } else if (!localDown && locallyHeldKeys.delete(key)) {
    midi.endNote(key);
    updateHeldDisplay();
  }
  const down = localDown || midi.isNoteHeld(Number(key.dataset.midiNote));
  key.classList.toggle('is-pressed', down);
  key.setAttribute('aria-pressed', String(down));
}

function updateHeldDisplay() {
  const notes = [...new Set([
    ...[...locallyHeldKeys].map((key) => Number(key.dataset.note)),
    ...midi.getHeldNotes().map((note) => note + readValue(transposeFader)).filter((note) => note >= 0 && note <= 127),
  ])].sort((a, b) => a - b);
  document.querySelector('#arp-held-notes').textContent = notes.length
    ? notes.map((note) => `${noteNames[note % 12]}${Math.floor(note / 12) - 1}`).join(' ')
    : 'None';
  document.querySelector('#arp-detected-chord').textContent = detectChord(notes) || 'None';
}

for (const key of keys) {
  key.setAttribute('role', 'button');
  key.setAttribute('tabindex', '0');
  key.setAttribute('aria-pressed', 'false');
  const title = document.createElementNS(svgNS, 'title');
  title.textContent = key.getAttribute('aria-label');
  key.prepend(title);
  const [, note, relativeOctave] = key.id.split('-');
  // Keep relative key IDs while naming the middle C as C4 (note 60).
  key.dataset.baseNote = String(60 + (Number(relativeOctave) - 2) * 12
    + noteNames.indexOf(note.replace('s', '#').toUpperCase()));
  const shape = key.querySelector('use');
  const black = shape.getAttribute('href') === '#black-key';
  key.classList.toggle('key-black', black);
  const labels = document.createElementNS(svgNS, 'g');
  labels.setAttribute('class', 'key-labels');
  labels.setAttribute('aria-hidden', 'true');
  const noteLabel = document.createElementNS(svgNS, 'text');
  noteLabel.setAttribute('class', 'key-note');
  noteLabel.setAttribute('x', Number(shape.getAttribute('x')) + (black ? 17 : 31));
  noteLabel.setAttribute('y', '16');
  labels.append(noteLabel);
  const binding = [...computerKeyBindings].find(([, mappedKey]) => mappedKey === key);
  if (binding) {
    const letter = binding[0].slice(3);
    key.setAttribute('aria-keyshortcuts', letter);
    const letterLabel = document.createElementNS(svgNS, 'text');
    letterLabel.setAttribute('class', 'key-letter');
    letterLabel.setAttribute('x', noteLabel.getAttribute('x'));
    letterLabel.setAttribute('y', black ? '155' : '248');
    letterLabel.textContent = letter.toLowerCase();
    labels.append(letterLabel);
  }
  key.append(labels);

  key.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    key.focus({ preventScroll: true });
    key.setPointerCapture(event.pointerId);
    let velocity = readValue(volumeFader);
    if (document.querySelector('#position-velocity').checked) {
      const bounds = key.getBoundingClientRect();
      const position = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      velocity = Math.min(127, Math.max(1, Math.round(1 + position / 0.8 * 126)));
    }
    activePointers.set(event.pointerId, { element: key, velocity });
    updateKey(key);
    status.textContent = `${key.getAttribute('aria-label')} pressed`;
  });

  key.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    pressedKeys.add(key);
    updateKey(key);
  });
  key.addEventListener('keyup', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    pressedKeys.delete(key);
    updateKey(key);
  });
  key.addEventListener('blur', () => {
    pressedKeys.delete(key);
    updateKey(key);
  });
}

document.addEventListener('keydown', (event) => {
  const key = computerKeyBindings.get(event.code);
  if (!key || event.defaultPrevented || event.repeat || event.isComposing
    || event.ctrlKey || event.altKey || event.metaKey
    || !(event.target instanceof Element)
    || event.target.isContentEditable
    || event.target.closest('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"]')) return;
  event.preventDefault();
  computerKeys.set(event.code, key);
  updateKey(key);
  status.textContent = `${key.getAttribute('aria-label')} pressed`;
});

document.addEventListener('keyup', (event) => {
  const key = computerKeys.get(event.code);
  if (!key) return;
  event.preventDefault();
  computerKeys.delete(event.code);
  updateKey(key);
});

function releasePointer(event) {
  const item = activePointers.get(event.pointerId);
  if (!item) return;
  activePointers.delete(event.pointerId);
  if (item.element.classList.contains('key')) {
    updateKey(item.element);
  } else {
    item.element.classList.remove('is-dragging');
    if (item.element.id === 'pitch-bend') updateFaderFromInput(item.element, 64);
  }
  if (item.element.hasPointerCapture(event.pointerId)) {
    item.element.releasePointerCapture(event.pointerId);
  }
}

panel.addEventListener('pointerup', releasePointer);
panel.addEventListener('pointercancel', releasePointer);
panel.addEventListener('lostpointercapture', releasePointer);

function releaseNotes() {
  pressedKeys.clear();
  computerKeys.clear();
  for (const [pointerId, item] of activePointers) {
    if (item.element.classList.contains('key')) releasePointer({ pointerId });
  }
  keys.forEach(updateKey);
}

function releaseAll() {
  releaseNotes();
  for (const pointerId of [...activePointers.keys()]) releasePointer({ pointerId });
}

document.querySelector('#midi-reset').addEventListener('click', () => midi.resetNotes(releaseNotes));

window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    releaseAll();
    midi.stopForVisibility();
  }
});

function bindButton(button, activate) {
  button.addEventListener('click', activate);
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!event.repeat) activate();
  });
}

for (const button of pitchRangeButtons) {
  bindButton(button, () => {
    button.focus({ preventScroll: true });
    updatePitchRange(pitchRange + Number(button.dataset.step));
  });
}

for (const button of octaveButtons) {
  bindButton(button, () => {
    updateFader(octaveFader, readValue(octaveFader) + Number(button.dataset.step));
  });
}

sizeButton.addEventListener('click', () => {
  releaseAll();
  const doubled = sizeButton.getAttribute('aria-pressed') !== 'true';
  sizeButton.setAttribute('aria-pressed', String(doubled));
  travel = baseTravel * (doubled ? 2 : 1);
  layoutPanel();
  status.textContent = `${doubled ? 'Double' : 'Normal'} fader travel. Control values preserved.`;
});

function resetSection(section) {
  const sectionFaders = faders.filter((fader) => fader.id.startsWith(`${section}-`));
  for (const [pointerId, item] of activePointers) {
    if (sectionFaders.includes(item.element)) releasePointer({ pointerId });
  }
  for (const fader of sectionFaders) {
    updateFader(fader, startingValues.get(fader), false);
    midi.setControl(fader.id, readValue(fader));
  }
  status.textContent = `${section.toUpperCase()} faders reset to starting positions.`;
}

document.querySelector('#reset-faders').addEventListener('click', () => {
  releaseAll();
  volumeMuted = false;
  midi.setMuted(false);
  muteLabel.textContent = 'MUTE';
  muteButton.setAttribute('aria-label', 'Mute notes');
  muteButton.setAttribute('aria-pressed', 'false');
  muteButton.querySelector('title').textContent = 'Mute notes';
  for (const [fader, value] of startingValues) {
    updateFader(fader, value, false);
    midi.setControl(fader.id, readValue(fader));
  }
  updatePitchRange(defaultPitchRange, false);
  midi.setControl('pitch-range', defaultPitchRange);
  status.textContent = 'Faders reset to starting positions.';
});

function toggleMute() {
  muteButton.focus({ preventScroll: true });
  volumeMuted = !volumeMuted;
  midi.setMuted(volumeMuted);
  muteLabel.textContent = volumeMuted ? 'UNMUTE' : 'MUTE';
  muteButton.setAttribute('aria-label', volumeMuted ? 'Unmute notes' : 'Mute notes');
  muteButton.setAttribute('aria-pressed', String(volumeMuted));
  muteButton.setAttribute('aria-disabled', 'false');
  muteButton.querySelector('title').textContent = volumeMuted ? 'Unmute notes' : 'Mute notes';
  status.textContent = volumeMuted ? 'Notes muted.' : 'Notes unmuted.';
}

bindButton(muteButton, toggleMute);

document.querySelector('#focus-mode').addEventListener('click', (event) => {
  const enabled = panel.classList.toggle('focus-mode');
  displays.classList.toggle('focus-mode', enabled);
  faders.forEach(updateFaderTooltip);
  event.currentTarget.setAttribute('aria-pressed', String(enabled));
  status.textContent = `Focus Mode ${enabled ? 'on' : 'off'}. Control values preserved.`;
});

document.querySelector('#hide-displays').addEventListener('click', (event) => {
  displays.hidden = !displays.hidden;
  event.currentTarget.setAttribute('aria-pressed', String(displays.hidden));
  status.textContent = `Displays ${displays.hidden ? 'hidden' : 'shown'}. Control values preserved.`;
});

document.querySelector('#hide-speakers').addEventListener('click', (event) => {
  releaseAll();
  const hidden = panel.classList.toggle('speakers-hidden');
  event.currentTarget.setAttribute('aria-pressed', String(hidden));
  layoutPanel();
  status.textContent = `Speakers ${hidden ? 'hidden' : 'shown'}. Control values preserved.`;
});

document.querySelector('#five-octaves').addEventListener('click', (event) => {
  releaseAll();
  const expanded = panel.classList.toggle('five-octaves');
  event.currentTarget.setAttribute('aria-pressed', String(expanded));
  keyboardKeys.setAttribute('transform', `scale(${expanded ? 22 / 36 : 1} 1)`);
  standardKeys.setAttribute('transform', `translate(${expanded ? 7 * 62 : 0} 0)`);
  panel.querySelector('#panel-description').textContent =
    `${expanded ? 61 : 37} keys, pitch bend, transpose, faders, and selection LEDs.`;
  status.textContent = `${expanded ? 'Five' : 'Three'} octaves. Held keys released; control values preserved.`;
});

updatePitchRange(defaultPitchRange, false);
updateKeyNotes();
layoutPanel();
status.textContent = 'Panel ready. Connect MIDI to send notes and supported controls.';
