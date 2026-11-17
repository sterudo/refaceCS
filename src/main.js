import { createReporter, setupNotifications } from './notifications.js';
import './style.css';
import panelMarkup from './synth.svg?raw';
import { createVisualizations } from './visualizations.js';
import { setupMidiDiscovery } from './midi.js';
import { detectChord, noteNames } from './chord-detection.js';
import { createMidiLearn } from './midi-learn.js';
import { controlNumber } from './synth-midi.js';
import { createPatchLibrary } from './patch-library.js';
import { PATCH_CONTROL_IDS } from './patches.js';
import { createGrooveClock } from './groove-clock.js';
import { createDrumMachine } from './drum-machine.js';
import { getPreference, setPreference } from './preferences.js';
import { setupBackup } from './backup.js';
import { setupCloudBackup } from './cloud-ui.js';
import { setupDeviceSettings } from './device-settings.js';
import { choose } from './dialogs.js';
import { setupHelp } from './help.js';
import { getAppSetting, setupAppSettings } from './app-settings.js';
import { setupSuperKnob } from './superknob-ui.js';
import { createSoftSynth } from './soft-synth.js';

const notifications = setupNotifications();
const reportAudio = createReporter('groove', 'audio-connect-status');
const dataInfo = document.querySelector('#data-info');
const dataInfoOpen = document.querySelector('#data-info-open');
const dataInfoClose = document.querySelector('#data-info-close');
const dataInfoAnchor = document.createComment('Data information desktop position');
dataInfo.before(dataInfoAnchor);
let patchLibrary;
let superKnob;
function setDataInfoVisible(visible, save = true) {
  dataInfo.hidden = !visible;
  dataInfoOpen.hidden = visible;
  if (save) setPreference('dataInfoVisible', visible);
}
setDataInfoVisible(getPreference('dataInfoVisible', (value) => typeof value === 'boolean', true), false);
dataInfoClose.addEventListener('click', () => {
  setDataInfoVisible(false);
  dataInfoOpen.focus();
});
dataInfoOpen.addEventListener('click', () => {
  setDataInfoVisible(true);
  dataInfoClose.focus();
});

const svgNS = 'http://www.w3.org/2000/svg';
const container = document.querySelector('#synth');
container.innerHTML = panelMarkup;

const panel = container.querySelector('svg');
setupHelp(panel);
const appMenu = document.querySelector('#app-menu');
const menuOpen = document.querySelector('#mobile-menu-open');
const menuClose = document.querySelector('#mobile-menu-close');
const mobileMenuQuery = window.matchMedia('(max-width: 900px)');
const visualToggles = document.querySelector('#visual-toggles');
const visualTogglesAnchor = document.createComment('Desktop view actions');
const menuOpenAnchor = document.createComment('Mobile menu opener');
visualToggles.before(visualTogglesAnchor);
menuOpen.before(menuOpenAnchor);
const displays = document.querySelector('#visualizations');
const status = createReporter('app', 'app-status');
const softSynth = createSoftSynth((message) => reportAudio(message, 'error'));
const sizeButton = document.querySelector('#fader-size');
const glissandoButton = document.querySelector('#glissando');
const faders = [...panel.querySelectorAll('.fader')];
const readouts = new Map();
const startingValues = new Map(faders.map((fader) => [fader, Number(fader.dataset.value)]));
const keyboardKeys = panel.querySelector('#keyboard-keys');
const keyboardViewport = panel.querySelector('#keyboard-viewport');
const standardKeys = panel.querySelector('#standard-keys');
const faderViewport = panel.querySelector('#fader-viewport');
const faderPanel = panel.querySelector('#fader-panel');
const faderPanelLeft = 185;
const faderPanelWidth = 1417;
const transposeFader = panel.querySelector('#transpose');
const transposeValue = panel.querySelector('#transpose-value');
const octaveFader = panel.querySelector('#octave');
const tempoFader = panel.querySelector('#tempo');
const looperFader = panel.querySelector('#looper');
const octaveButtons = [...panel.querySelectorAll('.octave-step')];
const expressionFader = panel.querySelector('#expression');
const modeSwitch = panel.querySelector('#soft-synth-mode');
const modeLabel = panel.querySelector('#soft-synth-mode-label');
const muteButton = panel.querySelector('#volume-mute');
const muteLabel = panel.querySelector('#mute-label');
const pitchRangeControl = panel.querySelector('#pitch-range');
const pitchRangeValue = panel.querySelector('#pitch-range-value');
const pitchRangeButtons = [...pitchRangeControl.querySelectorAll('[data-step]')];
const defaultPitchRange = Number(pitchRangeValue.textContent);
const baseTravel = 80;
const panelTopTrim = 27 * 0.75;
const instrumentGap = 18;
const mobileLandscapeQuery = window.matchMedia('(orientation: landscape) and (max-width: 900px)');
const mobilePanelScale = 0.8;
const mobileFaderScale = 0.975;
const mobileHousingEdge = 16.5;
const keyboardOctaveWidth = 7 * 62;
const keyboardViewportWidth = 1370;
const keyboardBaseHeight = 288;
const fiveOctaveKeyboardWidth = 36 * 62;
const keyboardDragThreshold = 12;
const activePointers = new Map();
const pressedKeys = new Set();
const computerKeys = new Map();
let travel = baseTravel;
let mobileLandscape = mobileLandscapeQuery.matches;
let desktopFiveOctaves = false;
let desktopFaderTravel = false;
let keyboardOffset = mobileLandscape ? keyboardOctaveWidth : 0;
let faderPanelOffset = 0;
let keyboardVisibleWidth = keyboardViewportWidth;
let faderVisibleWidth = faderPanelWidth;
let faderViewportLeft = faderPanelLeft;
let glissandoEnabled = getPreference('glissando', (value) => typeof value === 'boolean', false);
let volumeMuted = false;
let pitchRange = defaultPitchRange;
let pitchDirection = null;
let deviceRevision = 0;
let processedDeviceRevision = 0;
let syncingDevice = false;
let pitchRangeChanging = false;
let deviceSettings;
let synthType = 'hardware';
let savedHardwareModeControls = null;
const compactControlAttributes = [
  ['#soft-synth-mode', { transform: 'translate(152 43)' }],
  ['#soft-synth-mode .device-label', { x: 0 }, 'SYN'],
  ['#soft-synth-mode > rect:first-of-type', { width: 86, height: 31 }],
  ['#soft-synth-mode .arp-bezel', { x: 24, width: 60 }],
  ['#soft-synth-mode .arp-lens', { x: 25, width: 58 }],
  ['#soft-synth-mode-label', { x: 54 }],
  ['#dark-synth-mode', { transform: 'translate(244 43)' }],
  ['#dark-synth-mode .device-label', { x: 0 }, 'DARK'],
  ['#dark-synth-mode > rect:first-of-type', { width: 72, height: 31 }],
  ['#dark-synth-mode .arp-bezel', { x: 32 }],
  ['#dark-synth-mode .arp-lens', { x: 33 }],
  ['#arp-enabled', { transform: 'translate(148 244)' }],
  ['#arp-latch', { transform: 'translate(192 244)' }],
  ['#arp-chord', { transform: 'translate(240 244)' }],
  ['#arp-tempo', { transform: 'translate(288 244)' }],
  ['#arp-rate', { transform: 'translate(400 244)' }],
  ['#arp-mode', { transform: 'translate(456 244)' }],
  ['#arp-controls', { transform: 'translate(0 0)' }],
  ['#arp-label', { x: 112.5 }, 'ARP'],
  ['#patch-display', { transform: 'translate(584 244)' }],
  ['#patch-display-screen', { role: 'button' }],
  ['#patch-display-screen > rect', { width: 100 }],
  ['#patch-name-clip rect', { width: 77 }],
  ['#patch-next', { transform: 'translate(132 0)' }],
  ['#patch-save-display', { transform: 'translate(160 0)' }],
];
for (const [id, x, label] of [['midi-transmit', 320, 'TX'], ['midi-receive', 398, 'RX']]) {
  compactControlAttributes.push(
    [`#device-${id}`, { transform: `translate(${x} 43)` }],
    [`#device-${id} .device-label`, { x: 0 }, label],
    [`#device-${id} > rect:first-of-type`, { width: 76, height: 31 }],
    [`#device-${id} > rect:nth-of-type(2)`, { x: 20 }],
    [`#device-${id} .device-digits`, { transform: 'translate(24 7)' }],
    [`#device-${id} .device-assumption`, { x: 69 }],
  );
}
for (const [id, x, label] of [['local-control', 476, 'LOC'], ['speaker-output', 544, 'SPK']]) {
  compactControlAttributes.push(
    [`#device-${id}`, { transform: `translate(${x} 43)` }],
    [`#device-${id} .device-label`, { x: 0 }, label],
    [`#device-${id} > rect:first-of-type`, { width: 62, height: 31 }],
    [`#device-${id} .arp-bezel`, { x: 24 }],
    [`#device-${id} .arp-lens`, { x: 25 }],
    [`#device-${id} .device-assumption`, { x: 53 }],
  );
}
for (const [id, width] of [['enabled', 40], ['latch', 44], ['chord', 44], ['rate', 52], ['mode', 94]]) {
  compactControlAttributes.push(
    [`#arp-${id} .arp-bezel`, { width }],
    [`#arp-${id} .arp-lens`, { width: width - 2 }],
    [`#arp-${id} > text`, { x: width / 2 }],
  );
  if (['enabled', 'latch', 'chord'].includes(id)) {
    compactControlAttributes.push([`#arp-${id} .arp-shine`, { d: `M5 5H${width - 5}` }]);
  }
}
const responsiveControls = compactControlAttributes.map(([selector, attributes, text]) => {
  const element = panel.querySelector(selector);
  return {
    element, attributes, text,
    desktopAttributes: Object.fromEntries(Object.keys(attributes).map((name) => [name, element.getAttribute(name)])),
    desktopText: text === undefined ? undefined : element.textContent,
  };
});
glissandoButton.setAttribute('aria-pressed', String(glissandoEnabled));
panel.classList.toggle('mobile-landscape', mobileLandscape);
if (mobileLandscape) displays.classList.add('mobile-landscape');

const selections = {
  octave: ['-2', '-1', '0', '+1', '+2'],
  looper: ['Stop', 'Pause', 'Play', 'Record', 'Clear'],
  'lfo-assign': ['Off', 'Amp', 'Filter', 'Pitch', 'OSC'],
  'osc-type': ['Multi-saw', 'Pulse', 'Sync', 'Ring modulation', 'FM'],
  'effect-type': ['Off', 'Delay', 'Phaser', 'Chorus / flanger', 'Distortion'],
};
const updateVisualizations = createVisualizations(
  displays, panel, selections, resetSection, () => synthType === 'soft-synth',
);

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
const midiLearn = createMidiLearn([...faders, panel.querySelector('#super-knob')], (id, value, channel) => {
  if (id === 'super-knob') superKnob.setPosition(value, channel);
  else updateFaderFromInput(panel.querySelector(`#${id}`), value, true, channel);
});
const grooveClock = createGrooveClock();
const midi = setupMidiDiscovery(() => {
  keys.forEach(updateKey);
  updateHeldDisplay();
}, (id, value) => {
  if (id === 'pitch-range') {
    observePitchRange(value);
    deviceSettings?.observePitch(value);
  } else {
    const fader = panel.querySelector(`#${id}`);
    if (fader) {
      const previous = readValue(fader);
      updateFader(fader, value, false);
      if (previous !== readValue(fader)) superKnob?.observeFader(id, readValue(fader));
    }
  }
}, (bpm) => {
  updateFader(tempoFader, bpm, false);
  midi.setControl('tempo', bpm);
}, (mode) => {
  updateFader(looperFader, mode, false);
}, {
  clock: grooveClock,
  onConnect: () => {
    if (getAppSetting('midiEnableAudio')) void drums.enableAudio();
  },
  onMidiAccess: (access) => drums.setMidiAccess(access),
  onControllerChanged: (port) => midiLearn.setController(port),
  onControllerCC: (port, data) => midiLearn.handleMessage(port, data),
  onOutputAvailable: () => midiLearn.resetPickup(),
  onDrumNote: (note, velocity) => drums.triggerMidi(note, velocity),
  onDrumStop: () => drums.stop(),
  onPreviewStop: () => superKnob?.stopAudition(),
  onMelodicNote: () => drums.startOnKeypress(),
  onRefaceNote: (at, portId) => drums.captureCalibrationNote(at, portId),
  onLooperStartRequest: (mode) => drums.startFromLooper(mode),
  onLooperStartCancelled: () => drums.cancelPendingStart(),
  onLooperStopped: () => drums.stopFromLooper(),
  clearLocalNotes: releaseNotes,
  onDeviceConnectionChanged: () => {
    superKnob?.stop();
    deviceRevision++;
    pitchDirection = null;
    deviceSettings?.connectionChanged();
    midi.setCaptureStatus(midi.hasDeviceConnection() ? 'Waiting for the MIDI connection action.' : '');
    queueMicrotask(() => { void syncDeviceConnection(); });
  },
}, softSynth);
const drums = createDrumMachine(grooveClock, {
  onAudioStatus(message) {
    reportAudio(message, 'error');
  },
  onTempo(bpm) {
    midi.setTempo(bpm);
  },
  onStartLooper(at, mode) {
    midi.setLooperMode(mode, at);
    updateFader(looperFader, mode, false);
  },
  onStopLooper() {
    midi.setLooperMode(0);
    updateFader(looperFader, 0, false);
  },
  getRefaceInput: () => midi.getRefaceInput(),
});
deviceSettings = setupDeviceSettings(midi, {
  onPitchRead: observePitchRange,
  onPitchUnconfirmed: () => { pitchDirection = null; },
});

function updateSynthModePresentation() {
  const soft = synthType === 'soft-synth';
  panel.classList.toggle('soft-synth-mode', soft);
  modeSwitch.setAttribute('aria-pressed', String(soft));
  modeSwitch.setAttribute('aria-label', `Device mode: ${soft ? 'Simple Soft Synth' : 'Reface CS'}`);
  modeLabel.textContent = soft ? 'SOFT' : 'CS';
}

async function applySynthMode(type, { fromPatch = false } = {}) {
  if (!['hardware', 'soft-synth'].includes(type)) throw new Error(`Unknown instrument type: ${type}`);
  if (type === synthType) return true;
  const controls = Object.fromEntries(PATCH_CONTROL_IDS.map((id) => [id, readValue(panel.querySelector(`#${id}`))]));
  const enteringSoftSynth = type === 'soft-synth';
  const leavingSoftSynth = synthType === 'soft-synth';
  if (!await midi.setSoftSynthMode(type === 'soft-synth', controls, pitchRange)) {
    status('Could not enable the Simple Soft Synth. Check browser audio support and permissions.', 'error');
    return false;
  }
  if (enteringSoftSynth) {
    savedHardwareModeControls = Object.fromEntries([
      'lfo-assign', 'effect-type', 'effect-depth', 'effect-rate',
    ].map((id) => [id, readValue(panel.querySelector(`#${id}`))]));
    if (savedHardwareModeControls['lfo-assign'] > 1) {
      updateFaderFromInput(panel.querySelector('#lfo-assign'), 0, false);
    }
  } else if (leavingSoftSynth && savedHardwareModeControls) {
    for (const [id, value] of Object.entries(savedHardwareModeControls)) {
      const fader = panel.querySelector(`#${id}`);
      if (midi.hasDeviceConnection()) updateFaderFromInput(fader, value, false);
      else updateFader(fader, value, false);
    }
    savedHardwareModeControls = null;
  }
  synthType = type;
  updateSynthModePresentation();
  updateVisualizations('effect-type');
  if (!fromPatch) patchLibrary?.modeChanged(type);
  else patchLibrary?.setModeFilter(type);
  status(`Device mode: ${type === 'soft-synth' ? 'Simple Soft Synth' : 'Reface CS'}.`);
  return true;
}

updateSynthModePresentation();

async function syncDeviceConnection() {
  if (syncingDevice) return;
  syncingDevice = true;
  try {
    while (processedDeviceRevision !== deviceRevision) {
      const revision = deviceRevision;
      processedDeviceRevision = revision;
      if (!midi.hasDeviceConnection()) continue;
      await deviceSettings.whenIdle();
      await midi.whenSettingsIdle();
      if (revision !== deviceRevision) continue;
      const read = await deviceSettings.read();
      if (revision !== deviceRevision) continue;
      if (!read) {
        midi.setCaptureStatus('Could not read all device settings after connecting.', 'warning');
      }
      if (getAppSetting('midiOverridePitchRange')) {
        await midi.whenSettingsIdle();
        if (revision !== deviceRevision) continue;
        let confirmed = false;
        try {
          await midi.applyDeviceSettings({ 'pitch-range': 2 }, (id, value, state) => {
            if (id !== 'pitch-range' || revision !== deviceRevision) return;
            if (state === 'sent') deviceSettings.pitchSent();
            if (state === 'confirmed' && value !== null) {
              observePitchRange(value);
              deviceSettings.observePitch(value);
              confirmed = true;
            }
          });
          if (!confirmed && revision === deviceRevision) {
            midi.setCaptureStatus('Pitch-bend range override was sent but could not be confirmed.', 'warning');
          }
        } catch (error) {
          midi.setCaptureStatus(`Could not override pitch-bend range: ${error.message || error}.`, 'error');
        }
      }
      await midi.whenSettingsIdle();
      if (revision !== deviceRevision || !midi.hasDeviceConnection()) continue;
      const action = getAppSetting('midiConnectAction');
      if (action === 'capture') {
        if (!read) {
          midi.setCaptureStatus('Capture skipped because device settings could not be read.', 'warning');
          continue;
        }
        const captured = await patchLibrary.captureWithProtection(() => {
          if (revision === deviceRevision && midi.hasDeviceConnection()) return midi.captureSynth();
        });
        if (revision === deviceRevision && !captured) midi.setCaptureStatus('Capture skipped; the current sound was kept.');
        else if (revision === deviceRevision) showCaptureWarning();
      } else if (action === 'init') {
        const initialized = await patchLibrary.initializePatch(() => revision === deviceRevision && midi.hasDeviceConnection());
        if (!initialized && revision === deviceRevision) midi.setCaptureStatus('INIT could not be completed.', 'warning');
      } else if (action === 'last-patch') {
        const loaded = await patchLibrary.loadLastSelectedPatch(() => revision === deviceRevision && midi.hasDeviceConnection());
        if (!loaded && revision === deviceRevision) midi.setCaptureStatus('The last selected patch could not be loaded.', 'warning');
      } else if (action === 'specific-patch') {
        const id = getAppSetting('midiSpecificPatchId');
        const patches = await patchLibrary.list();
        if (revision !== deviceRevision || !midi.hasDeviceConnection()) continue;
        const patch = patches.find((item) => item.id === id);
        if (!patch) {
          midi.setCaptureStatus('The selected patch is unavailable. Choose a saved patch in Settings.', 'error');
        } else {
          const loaded = await patchLibrary.loadPatch(patch, () => revision === deviceRevision && midi.hasDeviceConnection());
          if (!loaded && revision === deviceRevision) midi.setCaptureStatus('The selected patch could not be loaded.', 'warning');
        }
      }
    }
  } catch (error) {
    midi.setCaptureStatus(`Automatic MIDI connection handling failed: ${error.message || error}.`, 'error');
  } finally {
    syncingDevice = false;
    if (processedDeviceRevision !== deviceRevision) queueMicrotask(() => { void syncDeviceConnection(); });
  }
}
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
  if (fader === tempoFader) return `${value} BPM`;
  return selections[fader.id]?.[value] ?? String(value);
}

function showCaptureWarning() {
  if (!getAppSetting('midiCaptureWarning')) return;
  const issues = [];
  const cutoff = panel.querySelector('#filter-cutoff');
  const expression = panel.querySelector('#expression');
  const decay = panel.querySelector('#eg-decay');
  const attack = panel.querySelector('#eg-attack');
  if (readValue(cutoff) < 10) issues.push(`Filter Cutoff is ${readValue(cutoff)} (below 10)`);
  if (readValue(expression) < 10) issues.push(`Expression is ${readValue(expression)} (below 10)`);
  const decayMin = Number(decay.dataset.min ?? 0);
  const decayMax = Number(decay.dataset.max);
  if (readValue(decay) <= decayMin + (decayMax - decayMin) * 0.1) {
    issues.push(`EG Decay is near its minimum (${readValue(decay)})`);
  }
  const attackMin = Number(attack.dataset.min ?? 0);
  const attackMax = Number(attack.dataset.max);
  if (readValue(attack) >= attackMax - (attackMax - attackMin) * 0.1) {
    issues.push(`EG Attack is near its maximum (${readValue(attack)})`);
  }
  if (!issues.length) return;
  document.querySelector('#capture-warning-message').textContent =
    `${issues.join('; ')}. These settings may make the sound silent or difficult to hear. Check the synth faders.`;
  const warning = document.querySelector('#capture-warning');
  if (!warning.open) warning.showModal();
}

function signedValue(value) {
  return value > 0 ? `+${value}` : String(value);
}

function updateFaderTooltip(fader) {
  const cc = controlNumber(fader.id);
  const suffix = panel.classList.contains('focus-mode') && cc !== undefined ? ` (CC ${cc})` : '';
  fader.querySelector('title').textContent = `${fader.dataset.label}: ${valueText(fader)}${suffix}`;
}

function updatePitchRange(value) {
  pitchRange = Math.max(0, Math.min(24, Math.round(value)));
  pitchRangeValue.textContent = String(pitchRange);
  const description = `Pitch bend range: ${pitchRange} semitones`;
  pitchRangeControl.setAttribute('aria-label', description);
  for (const button of pitchRangeButtons) {
    const next = pitchRange + Number(button.dataset.step);
    button.setAttribute('aria-disabled', String(next < 0 || next > 24));
  }
}

function observePitchRange(value) {
  pitchDirection = value === 0 ? null : Math.sign(value);
  updatePitchRange(Math.abs(value));
}

async function changePitchRange(value, force = false, prefix = '') {
  if (pitchRangeChanging) return;
  const step = value - pitchRange;
  let magnitude = Math.max(0, Math.min(24, Math.round(value)));
  if (!force && magnitude === pitchRange) return;
  const revision = deviceRevision;
  pitchRangeChanging = true;
  try {
    if (synthType === 'soft-synth') {
      updatePitchRange(magnitude);
      midi.setControl('pitch-range', magnitude);
      status(`${prefix}Pitch bend range: ${magnitude} semitones in Simple Soft Synth.`);
      return;
    }
    if (!midi.hasDeviceConnection()) {
      updatePitchRange(magnitude);
      status(`${prefix}Pitch bend range: ${magnitude} semitones shown locally; no device setting was sent.`);
      return;
    }
    if (pitchDirection === null) {
      const read = await choose('Pitch-bend direction unknown',
        'Read the synth before changing the range so its direction is not accidentally reset.',
        [['Cancel', false], ['Read direction', true]]);
      if (!read) return;
      if (revision !== deviceRevision) return;
      try {
        await midi.readDeviceSettings(['pitch-range'], (id, result) => {
          if (revision === deviceRevision && result !== null) {
            observePitchRange(result);
            if (!force) magnitude = Math.max(0, Math.min(24, pitchRange + step));
            deviceSettings?.observePitch(result);
          }
        });
      } catch (error) {
        status(`Could not read pitch-bend direction: ${error.message || error}`, 'error');
      }
      if (revision !== deviceRevision) return;
      if (pitchDirection === null) {
        const direction = await choose('Choose pitch-bend direction',
          'The direction could not be determined. Choose the direction to send, or cancel.',
          [['Cancel', null], ['Normal', 1], ['Inverted', -1]]);
        if (direction === null) return;
        if (revision !== deviceRevision) return;
        pitchDirection = direction;
      }
    }
    updatePitchRange(magnitude);
    midi.setControl('pitch-range', pitchDirection * magnitude);
    deviceSettings?.pitchSent();
    if (magnitude === 0) pitchDirection = null;
    status(`${prefix}Pitch bend range: ${magnitude} semitones; MIDI send is not confirmed.`);
  } finally {
    pitchRangeChanging = false;
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
  if (changed) midiLearn.valueChanged(fader.id);
  fader.dataset.value = String(value);
  fader.setAttribute('aria-valuenow', value);
  fader.setAttribute('aria-valuetext', valueText(fader));
  fader.querySelector('.cap').setAttribute('y', travel * (1 - (value - min) / (max - min)));
  updateFaderTooltip(fader);
  readouts.get(fader).textContent = fader === transposeFader ? signedValue(value) : String(value);
  if (fader === transposeFader) transposeValue.textContent = signedValue(value);
  if (fader === tempoFader) midi.setArpeggiatorTempo(value);

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

  if (fader !== looperFader) {
    fader.querySelectorAll('.selection-led').forEach((led) => {
      led.classList.toggle('is-on', Number(led.dataset.value) === value);
    });
  }

  updateVisualizations(fader.id);
  if (changed && PATCH_CONTROL_IDS.includes(fader.id)) patchLibrary?.controlsChanged();
  if (announce) {
    status(`${fader.dataset.label}: ${valueText(fader)}`);
  }
}

function updateFaderFromInput(fader, value, announce = true, channel = 0) {
  const previous = readValue(fader);
  updateFader(fader, value, announce);
  if (previous !== readValue(fader)) superKnob?.observeFader(fader.id, readValue(fader));
  if (fader === looperFader) midi.setLooperMode(readValue(fader));
  midi.setControl(fader.id, readValue(fader), channel);
}

function keyboardExpanded() {
  return mobileLandscape || desktopFiveOctaves;
}

function updateKeyboardOffset(value) {
  const maxOffset = keyboardExpanded() ? fiveOctaveKeyboardWidth - keyboardVisibleWidth : 0;
  keyboardOffset = Math.max(0, Math.min(maxOffset, value));
  keyboardKeys.setAttribute('transform', `translate(${-keyboardOffset} 0)`);
}

function updateKeyboardLayout() {
  const expanded = keyboardExpanded();
  panel.classList.toggle('five-octaves', expanded);
  standardKeys.setAttribute('transform', `translate(${expanded ? keyboardOctaveWidth : 0} 0)`);
  if (!expanded) keyboardOffset = 0;
  updateKeyboardOffset(keyboardOffset);
  document.querySelector('#five-octaves').setAttribute('aria-pressed', String(expanded));
  panel.querySelector('#panel-description').textContent =
    `${expanded ? 61 : 37} keys, pitch bend, transpose, faders, and selection LEDs.`;
}

function updateFaderPanelOffset(value) {
  const scale = mobileLandscape ? mobileFaderScale : 1;
  const maxOffset = Math.max(0, faderPanelWidth * scale - faderVisibleWidth);
  faderPanelOffset = Math.max(0, Math.min(maxOffset, value));
  faderPanel.setAttribute('transform',
    `translate(${faderViewportLeft - faderPanelLeft * scale - faderPanelOffset} ${65 * (1 - scale)}) scale(${scale})`);
  panel.querySelector('#fader-pan-area').setAttribute('aria-valuenow', String(Math.round(faderPanelOffset)));
  panel.querySelector('#fader-pan-area').setAttribute('aria-valuemax', String(Math.round(maxOffset)));
}

function resetFader(fader) {
  for (const [pointerId, item] of activePointers) {
    if (item.element === fader) releasePointer({ pointerId });
  }
  updateFaderFromInput(fader, startingValues.get(fader));
}

function layoutPanel() {
  const compact = mobileLandscape || panel.classList.contains('speakers-hidden');
  const leftTrim = compact ? 96 : 0;
  const desktopWidth = 1760 - leftTrim - (compact ? 100 : 0);
  container.style.width = mobileLandscape ? '100%' : `${desktopWidth / 1760 * 100}%`;
  container.style.minWidth = mobileLandscape ? '0' : `min(100%, ${1000 * desktopWidth / 1760}px)`;
  const width = mobileLandscape ? container.clientWidth / mobilePanelScale : desktopWidth;
  const rightTrim = 1760 - leftTrim - width;
  const bodyLeft = mobileLandscape ? leftTrim : 25 + leftTrim;
  const bodyWidth = mobileLandscape ? width : 1710 - leftTrim - rightTrim;
  const bodyRight = bodyLeft + bodyWidth;
  faderViewportLeft = mobileLandscape ? bodyLeft + mobileHousingEdge : faderPanelLeft;
  faderVisibleWidth = mobileLandscape ? bodyWidth - mobileHousingEdge * 2 : faderPanelWidth;
  keyboardVisibleWidth = mobileLandscape ? faderVisibleWidth : keyboardViewportWidth;
  const wrapMacro = mobileLandscape && bodyRight - mobileHousingEdge < 900;
  const rowExtra = wrapMacro ? 44 : 0;
  travel = baseTravel * (!mobileLandscape && desktopFaderTravel ? 2 : 1);
  const extra = travel - baseTravel;
  const scale = mobileLandscape ? mobileFaderScale : 1;
  const faderPanelExtra = (185 + extra) * (scale - 1);
  const lowerOffset = extra + faderPanelExtra;
  const fullHeight = 600 + instrumentGap + lowerOffset + rowExtra - panelTopTrim;
  let keyboardHeight = keyboardBaseHeight;
  if (mobileLandscape) {
    const availableHeight = window.innerHeight - (container.getBoundingClientRect().top + window.scrollY) - 8;
    // Keep an 80px-tall keyboard on short screens rather than shrinking the controls.
    keyboardHeight = Math.max(100, Math.min(180, availableHeight / mobilePanelScale - (fullHeight - keyboardBaseHeight)));
  }
  const keyHeightReduction = keyboardBaseHeight - keyboardHeight;
  panel.setAttribute('viewBox', `${leftTrim} ${panelTopTrim} ${width} ${fullHeight - keyHeightReduction}`);
  panel.querySelector('#keyboard').setAttribute('transform',
    `translate(${mobileLandscape ? faderViewportLeft + 3 : 196} ${296 + rowExtra})`);
  const keyboardFrame = panel.querySelector('#keyboard > rect');
  const keyboardClip = panel.querySelector('#keyboard-clip rect');
  for (const rect of [keyboardFrame, keyboardClip]) {
    rect.setAttribute('width', keyboardVisibleWidth);
    rect.setAttribute('height', keyboardHeight);
  }
  const keyScale = keyboardHeight / keyboardBaseHeight;
  for (const key of keys) {
    const black = key.classList.contains('key-black');
    const shapeScale = keyScale * (mobileLandscape && black ? 0.8 : 1);
    key.querySelector('.key-shape').setAttribute('transform', `scale(1 ${shapeScale})`);
    key.querySelector('.key-letter')?.setAttribute('y', (black ? 155 : 248) * shapeScale);
  }
  updateKeyboardOffset(keyboardOffset);
  panel.querySelector('#body').setAttribute('x', bodyLeft);
  panel.querySelector('#body').setAttribute('width', bodyWidth);
  panel.querySelector('#body-edge').setAttribute('x', bodyLeft + 2);
  panel.querySelector('#body-edge').setAttribute('width', bodyWidth - 4);
  panel.querySelector('#body-highlight').setAttribute('d',
    `M${bodyLeft + 11} 28H${bodyRight - 11}L${bodyRight - 1} 44H${bodyLeft + 1}Z`);
  panel.querySelector('#body').setAttribute('height', 550 + instrumentGap + lowerOffset + rowExtra - keyHeightReduction);
  panel.querySelector('#body-edge').setAttribute('height', 550 + instrumentGap + lowerOffset + rowExtra - keyHeightReduction);
  panel.querySelector('#control-strip').setAttribute('x', mobileLandscape ? faderViewportLeft : compact ? 190 : 72);
  panel.querySelector('#control-strip').setAttribute('y', 65 + (96 - 65) * scale);
  panel.querySelector('#control-strip').setAttribute('width', mobileLandscape ? faderVisibleWidth : compact ? 1412 : 1620);
  panel.querySelector('#control-strip').setAttribute('height', (108 + extra) * scale);
  for (const button of octaveButtons) {
    const left = button.dataset.step === '-1';
    const x = left ? 25 + leftTrim : 1602;
    const endWidth = left ? 160 - leftTrim : 133 - rightTrim;
    const hitArea = button.querySelector('.end-hit-area');
    hitArea.setAttribute('x', x);
    hitArea.setAttribute('width', endWidth);
    hitArea.setAttribute('height', 550 + instrumentGap + extra);
    button.querySelector('.end-arrow').setAttribute('transform',
      `translate(${x + endWidth / 2} ${430 + instrumentGap + extra})`);
  }
  panel.querySelectorAll('.speaker').forEach((speaker) => {
    speaker.setAttribute('height', 92 + extra);
  });
  panel.querySelector('#lower-panel').setAttribute('transform', `translate(0 ${extra})`);
  panel.querySelector('#lower-housing').setAttribute('transform', `translate(0 ${lowerOffset})`);
  for (const { element, attributes, desktopAttributes, text, desktopText } of responsiveControls) {
    for (const [name, value] of Object.entries(mobileLandscape ? attributes : desktopAttributes)) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    if (text !== undefined) element.textContent = mobileLandscape ? text : desktopText;
  }
  for (const [id, desktop, mobile] of [
    ['super-knob', '920 52', wrapMacro ? '134.5 304' : '800 260'],
    ['super-knob-cycle', '820 42', wrapMacro ? '158.5 288' : '824 244'],
    ['super-knob-configure', '858 42', wrapMacro ? '196.5 288' : '862 244'],
  ]) {
    const control = panel.querySelector(`#${id}`);
    const parent = mobileLandscape ? panel.querySelector('#lower-instrument') : panel;
    if (control.parentElement !== parent) {
      if (mobileLandscape) parent.append(control);
      else parent.insertBefore(control, panel.querySelector('#device-panel'));
    }
    control.setAttribute('transform', `translate(${mobileLandscape ? mobile : desktop})`);
  }
  faderViewport.setAttribute('clip-path', mobileLandscape ? 'url(#fader-clip)' : 'none');
  for (const id of ['fader-clip-area', 'fader-pan-area']) {
    panel.querySelector(`#${id}`).setAttribute('x', faderViewportLeft);
    panel.querySelector(`#${id}`).setAttribute('width', faderVisibleWidth);
    panel.querySelector(`#${id}`).setAttribute('height', 185 + lowerOffset);
  }
  panel.querySelector('#fader-pan-area').setAttribute('display', mobileLandscape ? 'inline' : 'none');
  updateFaderPanelOffset(faderPanelOffset);
  panel.querySelectorAll('.focus-section').forEach((section) => {
    section.setAttribute('height', 178 + extra);
  });

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
    midiLearn.selectTarget(fader.id);
    const step = event.altKey ? largeStep : 1;
    updateFaderFromInput(fader, readValue(fader) - Math.sign(event.deltaY) * step);
  }, { passive: false });

  fader.addEventListener('keydown', (event) => {
    if (event.key === 'Delete') {
      event.preventDefault();
      midiLearn.selectTarget(fader.id);
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
      midiLearn.selectTarget(fader.id);
      updateFaderFromInput(fader, next);
    }
  });

  fader.addEventListener('dblclick', (event) => {
    if (event.target.closest('.position-label')) return;
    event.preventDefault();
    midiLearn.selectTarget(fader.id);
    resetFader(fader);
  });

  fader.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || [...activePointers.values()].some((item) => item.element === fader)) {
      return;
    }
    event.preventDefault();
    midiLearn.selectTarget(fader.id);
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
    midi.startNote(key, Number(key.dataset.midiNote), 100);
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
  const chord = detectChord(notes);
  const chordReadout = panel.querySelector('#arp-detected-chord');
  chordReadout.classList.toggle('chord-major', chord?.quality === 'major');
  chordReadout.classList.toggle('chord-minor', chord?.quality === 'minor');
  const values = [
    ['#arp-held-notes', notes.length
      ? notes.map((note) => `${noteNames[note % 12]}${Math.floor(note / 12) - 1}`).join(' ') : 'None', 135],
    ['#arp-detected-chord', chord?.name || 'None', 72],
  ];
  for (const [selector, value, width] of values) {
    const readout = panel.querySelector(selector);
    readout.textContent = value;
    readout.removeAttribute('textLength');
    if (readout.getComputedTextLength() > width) {
      readout.setAttribute('textLength', width);
      readout.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
  }
}

function activeKeyboardPointers() {
  return [...activePointers.values()].filter((item) => item.kind === 'key');
}

function setPointerKey(item, key) {
  if (item.element === key) return;
  const previous = item.element;
  item.element = key;
  if (previous) updateKey(previous);
  if (key) updateKey(key);
}

function keyAtPoint(x, y) {
  return document.elementFromPoint(x, y)?.closest('.key') ?? null;
}

function moveKeyboardPointer(event) {
  const item = activePointers.get(event.pointerId);
  if (item?.kind !== 'key') return;

  if (item.mode === 'glissando') {
    setPointerKey(item, keyAtPoint(event.clientX, event.clientY));
    return;
  }

  if (item.mode === 'pan') {
    if (activeKeyboardPointers().length > 1) return;
    const scale = keyboardViewport.getScreenCTM()?.a || 1;
    updateKeyboardOffset(item.startOffset + (item.startX - event.clientX) / scale);
    return;
  }

  const dx = item.startX - event.clientX;
  const dy = item.startY - event.clientY;
  if (activeKeyboardPointers().length !== 1
    || !keyboardExpanded()
    || Math.abs(dx) < keyboardDragThreshold
    || Math.abs(dx) <= Math.abs(dy) * 1.25) return;

  item.mode = 'pan';
  setPointerKey(item, null);
  const scale = keyboardViewport.getScreenCTM()?.a || 1;
  updateKeyboardOffset(item.startOffset + dx / scale);
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
  const keyShape = document.createElementNS(svgNS, 'g');
  keyShape.setAttribute('class', 'key-shape');
  shape.before(keyShape);
  keyShape.append(shape);
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
    if (document.querySelector('#position-expression').checked) {
      const bounds = key.getBoundingClientRect();
      const position = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      updateFaderFromInput(expressionFader, Math.min(127, Math.round(position / 0.8 * 127)));
    }
    activePointers.set(event.pointerId, {
      kind: 'key',
      element: key,
      captureElement: key,
      mode: glissandoEnabled ? 'glissando' : 'pending',
      startX: event.clientX,
      startY: event.clientY,
      startOffset: keyboardOffset,
    });
    updateKey(key);
    status(`${key.getAttribute('aria-label')} pressed`);
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

panel.addEventListener('pointermove', moveKeyboardPointer);

faderViewport.addEventListener('pointerdown', (event) => {
  if (!mobileLandscape || event.button !== 0
    || event.target.closest('.fader, [role="button"], [data-help-target], a')
    || [...activePointers.values()].some((item) => item.kind === 'fader-pan')) return;
  event.preventDefault();
  faderViewport.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, {
    kind: 'fader-pan',
    element: faderViewport,
    startX: event.clientX,
    startY: event.clientY,
    startOffset: faderPanelOffset,
    panning: false,
  });
});

faderViewport.addEventListener('pointermove', (event) => {
  const item = activePointers.get(event.pointerId);
  if (item?.kind !== 'fader-pan') return;
  const dx = item.startX - event.clientX;
  if (!item.panning) {
    if (Math.abs(dx) < keyboardDragThreshold
      || Math.abs(dx) <= Math.abs(item.startY - event.clientY) * 1.25) return;
    item.panning = true;
    faderViewport.classList.add('is-dragging');
  }
  updateFaderPanelOffset(item.startOffset + dx / faderViewport.getScreenCTM().a);
});

faderViewport.addEventListener('focusin', (event) => {
  if (!mobileLandscape) return;
  const bounds = event.target.getBoundingClientRect();
  const viewport = panel.querySelector('#fader-pan-area').getBoundingClientRect();
  const dx = bounds.left < viewport.left ? bounds.left - viewport.left
    : bounds.right > viewport.right ? bounds.right - viewport.right : 0;
  if (dx) updateFaderPanelOffset(faderPanelOffset + dx / faderViewport.getScreenCTM().a);
});

panel.querySelector('#fader-pan-area').addEventListener('keydown', (event) => {
  const offset = {
    ArrowLeft: faderPanelOffset - 80,
    ArrowRight: faderPanelOffset + 80,
    Home: 0,
    End: faderPanelWidth * (mobileLandscape ? mobileFaderScale : 1),
  }[event.key];
  if (offset === undefined) return;
  event.preventDefault();
  updateFaderPanelOffset(offset);
});

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
  status(`${key.getAttribute('aria-label')} pressed`);
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
  if (item.kind === 'key') {
    if (item.element) updateKey(item.element);
  } else {
    item.element.classList.remove('is-dragging');
    if (item.element.id === 'pitch-bend') updateFaderFromInput(item.element, 64);
  }
  const captureElement = item.captureElement ?? item.element;
  if (captureElement?.hasPointerCapture(event.pointerId)) {
    captureElement.releasePointerCapture(event.pointerId);
  }
}

panel.addEventListener('pointerup', releasePointer);
panel.addEventListener('pointercancel', releasePointer);
panel.addEventListener('lostpointercapture', releasePointer);

function releaseNotes() {
  pressedKeys.clear();
  computerKeys.clear();
  for (const [pointerId, item] of activePointers) {
    if (item.kind === 'key') releasePointer({ pointerId });
  }
  keys.forEach(updateKey);
}

function releaseAll() {
  releaseNotes();
  for (const pointerId of [...activePointers.keys()]) releasePointer({ pointerId });
}

document.querySelector('#midi-reset').addEventListener('click', () => {
  superKnob?.stop();
  midi.resetNotes(releaseNotes);
});

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

bindButton(modeSwitch, () => {
  void applySynthMode(synthType === 'hardware' ? 'soft-synth' : 'hardware');
});

for (const button of pitchRangeButtons) {
  bindButton(button, () => {
    button.focus({ preventScroll: true });
    void changePitchRange(pitchRange + Number(button.dataset.step));
  });
}

for (const button of octaveButtons) {
  bindButton(button, () => {
    updateFader(octaveFader, readValue(octaveFader) + Number(button.dataset.step));
  });
}

function applyViewState(name, value, persist = true) {
  if (name === 'messagesVisible') notifications.setVisible(value, false);
  else if (name === 'focusMode') {
    panel.classList.toggle('focus-mode', value);
    displays.classList.toggle('focus-mode', value);
    faders.forEach(updateFaderTooltip);
    document.querySelector('#focus-mode').setAttribute('aria-pressed', String(value));
  } else if (name === 'hideDisplays') {
    displays.hidden = value;
    document.querySelector('#hide-displays').setAttribute('aria-pressed', String(!value && !mobileLandscape));
  } else if (name === 'hideSpeakers') {
    releaseAll();
    panel.classList.toggle('speakers-hidden', value);
    document.querySelector('#hide-speakers').setAttribute('aria-pressed', String(!value && !mobileLandscape));
    layoutPanel();
  } else if (name === 'fiveOctaves') {
    releaseAll();
    const wasExpanded = keyboardExpanded();
    desktopFiveOctaves = value;
    if (value && !wasExpanded) keyboardOffset = keyboardOctaveWidth;
    if (!value && !mobileLandscape) keyboardOffset = 0;
    updateKeyboardLayout();
  } else if (name === 'faderTravel') {
    releaseAll();
    desktopFaderTravel = value;
    sizeButton.setAttribute('aria-pressed', String(!mobileLandscape && value));
    travel = baseTravel * (value ? 2 : 1);
    layoutPanel();
  }
  if (persist) setPreference(name, value);
}

function syncResponsiveLayout() {
  const wasMobile = mobileLandscape;
  mobileLandscape = mobileLandscapeQuery.matches;
  if (wasMobile !== mobileLandscape) releaseAll();
  panel.classList.toggle('mobile-landscape', mobileLandscape);
  displays.classList.toggle('mobile-landscape', mobileLandscape);
  document.querySelector('#hide-displays').setAttribute('aria-pressed', String(!mobileLandscape && !displays.hidden));
  document.querySelector('#hide-speakers').setAttribute('aria-pressed',
    String(!mobileLandscape && !panel.classList.contains('speakers-hidden')));

  if (mobileLandscape && !wasMobile && !desktopFiveOctaves) keyboardOffset = keyboardOctaveWidth;
  if (!mobileLandscape && wasMobile && !desktopFiveOctaves) keyboardOffset = 0;

  const narrow = mobileLandscape && window.innerWidth <= 900;
  panel.classList.toggle('mobile-hide-yamaha', narrow);
  panel.classList.toggle('mobile-hide-cs-logo', narrow);
  if (mobileLandscape) {
    if (visualToggles.parentElement !== appMenu) menuClose.after(visualToggles);
    if (menuOpen.parentElement !== container) container.append(menuOpen);
  } else {
    if (visualToggles.parentElement === appMenu) visualTogglesAnchor.after(visualToggles);
    if (menuOpen.parentElement === container) menuOpenAnchor.after(menuOpen);
  }

  sizeButton.setAttribute('aria-pressed', String(!mobileLandscape && desktopFaderTravel));
  travel = baseTravel * (desktopFaderTravel ? 2 : 1);
  updateKeyboardLayout();
  layoutPanel();
  updateHeldDisplay();
}

function closeAppMenu() {
  if (appMenu.matches(':popover-open')) appMenu.hidePopover();
}

function syncAppMenu() {
  closeAppMenu();
  if (mobileMenuQuery.matches) {
    appMenu.append(dataInfo);
    appMenu.setAttribute('popover', 'auto');
    appMenu.setAttribute('role', 'dialog');
    appMenu.setAttribute('aria-label', 'App menu');
  } else {
    dataInfoAnchor.after(dataInfo);
    appMenu.removeAttribute('popover');
    appMenu.removeAttribute('role');
    appMenu.removeAttribute('aria-label');
  }
}

menuOpen.addEventListener('click', () => appMenu.showPopover({ source: menuOpen }));
menuClose.addEventListener('click', () => {
  closeAppMenu();
  menuOpen.focus({ preventScroll: true });
});
appMenu.addEventListener('toggle', () => {
  menuOpen.setAttribute('aria-expanded', String(appMenu.matches(':popover-open')));
});
appMenu.addEventListener('click', (event) => {
  if (event.target.closest('#app-settings-open, #device-settings-open, #backup-open, #help-open, #version-open, #glissando, #reset-faders')) {
    closeAppMenu();
  }
});
mobileMenuQuery.addEventListener('change', syncAppMenu);
syncAppMenu();

mobileLandscapeQuery.addEventListener('change', syncResponsiveLayout);
window.addEventListener('resize', syncResponsiveLayout);

sizeButton.addEventListener('click', () => {
  const doubled = sizeButton.getAttribute('aria-pressed') !== 'true';
  applyViewState('faderTravel', doubled);
  status(`${doubled ? 'Double' : 'Normal'} fader travel. Control values preserved.`);
});

glissandoButton.addEventListener('click', () => {
  releaseNotes();
  glissandoEnabled = glissandoButton.getAttribute('aria-pressed') !== 'true';
  glissandoButton.setAttribute('aria-pressed', String(glissandoEnabled));
  setPreference('glissando', glissandoEnabled);
  status(`Glissando ${glissandoEnabled ? 'on' : 'off'}.`);
});

function resetSection(section) {
  const sectionFaders = faders.filter((fader) => fader.id.startsWith(`${section}-`));
  for (const [pointerId, item] of activePointers) {
    if (sectionFaders.includes(item.element)) releasePointer({ pointerId });
  }
  for (const fader of sectionFaders) {
    updateFaderFromInput(fader, startingValues.get(fader), false);
  }
  status(`${section.toUpperCase()} faders reset to starting positions.`);
}

document.querySelector('#reset-faders').addEventListener('click', () => {
  superKnob?.stop();
  releaseAll();
  volumeMuted = false;
  midi.setMuted(false);
  muteLabel.textContent = 'MUTE';
  muteButton.setAttribute('aria-label', 'Mute notes');
  muteButton.setAttribute('aria-pressed', 'false');
  muteButton.querySelector('title').textContent = 'Mute notes';
  for (const [fader, value] of startingValues) {
    updateFaderFromInput(fader, value, false);
  }
  status('Faders reset to starting positions.');
  void changePitchRange(defaultPitchRange, true, 'Faders reset to starting positions. ');
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
  status(volumeMuted ? 'Notes muted.' : 'Notes unmuted.');
}

bindButton(muteButton, toggleMute);

document.querySelector('#focus-mode').addEventListener('click', (event) => {
  const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  applyViewState('focusMode', enabled);
  status(`Focus Mode ${enabled ? 'on' : 'off'}. Control values preserved.`);
});

document.querySelector('#hide-displays').addEventListener('click', (event) => {
  const hidden = event.currentTarget.getAttribute('aria-pressed') === 'true';
  applyViewState('hideDisplays', hidden);
  status(`Displays ${hidden ? 'hidden' : 'shown'}. Control values preserved.`);
});

document.querySelector('#hide-speakers').addEventListener('click', (event) => {
  const hidden = event.currentTarget.getAttribute('aria-pressed') === 'true';
  applyViewState('hideSpeakers', hidden);
  status(`Speakers ${hidden ? 'hidden' : 'shown'}. Control values preserved.`);
});

document.querySelector('#five-octaves').addEventListener('click', (event) => {
  const expanded = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  applyViewState('fiveOctaves', expanded);
  status(`${expanded ? 'Five' : 'Three'} octaves. Held keys released; control values preserved.`);
});

updatePitchRange(defaultPitchRange);
updateKeyNotes();
layoutPanel();
const positionExpression = document.querySelector('#position-expression');
positionExpression.checked = getPreference('positionExpression', (value) => typeof value === 'boolean', false);
positionExpression.addEventListener('change', () => setPreference('positionExpression', positionExpression.checked));
superKnob = setupSuperKnob({
  panel,
  clock: grooveClock,
  midiLearn,
  startPreviewNote: (note) => midi.startPreviewNote(note),
  endPreviewNote: () => midi.endPreviewNote(),
  getValue: (id) => readValue(panel.querySelector(`#${id}`)),
  apply: (id, value, channel = 0) => {
    const fader = panel.querySelector(`#${id}`);
    updateFader(fader, value, false);
    midi.setControl(id, value, channel);
  },
  onChange: () => patchLibrary?.controlsChanged(),
});
patchLibrary = createPatchLibrary({
  root: document.querySelector('#patch-library'),
  panel,
  getAppSetting,
  getType: () => synthType,
  changeType: (type) => applySynthMode(type, { fromPatch: true }),
  superKnob,
  initialControls: Object.fromEntries(PATCH_CONTROL_IDS.map((id) => {
    const fader = panel.querySelector(`#${id}`);
    return [id, startingValues.get(fader)];
  })),
  getControls: () => Object.fromEntries(PATCH_CONTROL_IDS.map((id) => [
    id,
    readValue(panel.querySelector(`#${id}`)),
  ])),
  applyControls: async (controls) => {
    superKnob.suspendForPatch();
    for (const id of PATCH_CONTROL_IDS) {
      updateFader(panel.querySelector(`#${id}`), controls[id], false);
    }
    return midi.sendPatchControls(controls);
  },
});
setupAppSettings({
  panel,
  sections: document.querySelector('#settings-sections'),
  drums,
  clock: grooveClock,
  patchLibrary,
  applyViewState,
  applyTempo: (bpm) => updateFader(tempoFader, bpm, false),
});
syncResponsiveLayout();
document.querySelector('#capture-warning-close').addEventListener('click', () => {
  document.querySelector('#capture-warning').close();
});
setupBackup({ patches: patchLibrary, drums, looper: midi, superKnob });
setupCloudBackup({ patches: patchLibrary, drums, looper: midi, superKnob });
status('Panel ready. Connect MIDI for hardware control, or switch to the browser-based Simple Soft Synth.');
