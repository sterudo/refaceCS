import { confirmAction } from './dialogs.js';
import { getPreference, setPreference, setPreferences } from './preferences.js';

const defaults = {
  darkSynthMode: 'off',
  sectionOrder: ['groove-panel', 'footer-panel'],
  startupMessages: 'last',
  startupDisplays: 'last',
  startupSpeakers: 'last',
  startupFiveOctaves: 'last',
  startupFocusMode: 'last',
  startupFaderTravel: 'last',
  ignoreUnsavedSynthOnLoad: false,
  hidePatchAudio: false,
  midiEnableAudio: true,
  midiConnectAction: 'capture',
  midiSpecificPatchId: '',
  midiOverridePitchRange: true,
  midiCaptureWarning: true,
  grooveLinkedStartup: 'last',
  grooveStartOnKeypressStartup: 'last',
  grooveTempoMode: 'last',
  grooveTempoValue: 120,
  grooveMeterMode: 'last',
};

const validators = {
  darkSynthMode: (value) => ['off', 'case', 'keys'].includes(value),
  sectionOrder: (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
    && new Set(value).size === value.length,
  startupMessages: (value) => ['last', 'hide', 'show'].includes(value),
  startupDisplays: (value) => ['last', 'hide', 'show'].includes(value),
  startupSpeakers: (value) => ['last', 'hide', 'show'].includes(value),
  startupFiveOctaves: (value) => ['last', 'hide', 'show'].includes(value),
  startupFocusMode: (value) => ['last', 'hide', 'show'].includes(value),
  startupFaderTravel: (value) => ['last', 'hide', 'show'].includes(value),
  ignoreUnsavedSynthOnLoad: (value) => typeof value === 'boolean',
  hidePatchAudio: (value) => typeof value === 'boolean',
  midiEnableAudio: (value) => typeof value === 'boolean',
  midiConnectAction: (value) => ['capture', 'init', 'last-patch', 'specific-patch'].includes(value),
  midiSpecificPatchId: (value) => typeof value === 'string',
  midiOverridePitchRange: (value) => typeof value === 'boolean',
  midiCaptureWarning: (value) => typeof value === 'boolean',
  grooveLinkedStartup: (value) => ['last', 'off', 'on'].includes(value),
  grooveStartOnKeypressStartup: (value) => ['last', 'off', 'on'].includes(value),
  grooveTempoMode: (value) => ['last', 'default', 'specific'].includes(value),
  grooveTempoValue: (value) => Number.isInteger(value) && value >= 40 && value <= 240,
  grooveMeterMode: (value) => ['last', '3', '4'].includes(value),
};

const viewSettings = [
  { setting: 'startupMessages', actual: 'messagesVisible', initial: true, hidden: false },
  { setting: 'startupDisplays', actual: 'hideDisplays', initial: false, hidden: true },
  { setting: 'startupSpeakers', actual: 'hideSpeakers', initial: false, hidden: true },
  { setting: 'startupFiveOctaves', actual: 'fiveOctaves', initial: false, hidden: false },
  { setting: 'startupFocusMode', actual: 'focusMode', initial: false, hidden: false },
  { setting: 'startupFaderTravel', actual: 'faderTravel', initial: false, hidden: false },
];

export function getAppSetting(name) {
  if (name.startsWith('startupSection:')) {
    return getPreference(name, (value) => ['last', 'closed', 'open'].includes(value), 'last');
  }
  const valid = validators[name];
  if (!valid) throw new Error(`Unknown app setting: ${name}`);
  return getPreference(name, valid, defaults[name]);
}

function setAppSetting(name, value) {
  const valid = name.startsWith('startupSection:')
    ? ['last', 'closed', 'open'].includes(value) : validators[name]?.(value);
  if (!valid) throw new Error(`Invalid value for app setting "${name}".`);
  setPreference(name, value);
}

function option(value, label) {
  return new Option(label, value);
}

function activate(element, callback) {
  element.addEventListener('click', callback);
  element.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
      event.preventDefault();
      callback(event);
    }
  });
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

export function setupAppSettings({ panel, sections, drums, clock, patchLibrary, applyViewState, applyTempo }) {
  const dialog = document.querySelector('#app-settings');
  const status = document.querySelector('#app-settings-status');
  const sectionOrderList = document.querySelector('#settings-section-order');
  const openButton = document.querySelector('#app-settings-open');
  const darkModeSelect = document.querySelector('#settings-dark-synth');
  const specificPatchRow = document.querySelector('#settings-specific-patch-row');
  const specificPatchSelect = document.querySelector('#settings-specific-patch');
  const tempoValue = document.querySelector('#settings-tempo-value');
  const tempoValueRow = document.querySelector('#settings-tempo-value-row');
  const darkModeButton = panel.querySelector('#dark-synth-mode');
  const darkMenuLayer = panel.querySelector('#app-menu-layer');
  const sectionElements = [...sections.querySelectorAll('[data-settings-section]')];
  const defaultSectionOrder = sectionElements.map((section) => section.id);
  const sectionById = new Map(sectionElements.map((section) => [section.id, section]));
  const menuOptions = [
    { value: 'off', label: 'Off' },
    { value: 'case', label: 'Dark case only' },
    { value: 'keys', label: 'Dark case and keys' },
  ];
  let darkMenuOpen = false;
  let suppressClockSave = false;

  function applyDarkMode(value) {
    darkModeSelect.value = value;
    panel.classList.toggle('dark-synth-case', value !== 'off');
    panel.classList.toggle('dark-synth-keys', value === 'keys');
    darkModeButton.dataset.mode = value;
    darkModeButton.setAttribute('aria-pressed', String(value !== 'off'));
    darkModeButton.setAttribute('aria-label', `Dark synth mode: ${menuOptions.find((item) => item.value === value).label}`);
    darkModeButton.querySelector('title').textContent =
      `Dark synth mode: ${menuOptions.find((item) => item.value === value).label}. Click to cycle; right-click for options.`;
  }

  function currentSections() {
    return [...sections.querySelectorAll('[data-settings-section]')];
  }

  function readSectionOrder() {
    const current = currentSections();
    const ids = current.map((section) => section.id);
    const saved = getAppSetting('sectionOrder').filter((id) => ids.includes(id));
    return [...saved, ...ids.filter((id) => !saved.includes(id))];
  }

  function applySectionOrder(order = readSectionOrder()) {
    sections.append(...order.map((id) => sectionById.get(id)).filter(Boolean));
  }

  function renderSectionOrder() {
    const order = readSectionOrder();
    sectionOrderList.replaceChildren();
    order.forEach((id, index) => {
      const section = sectionById.get(id);
      if (!section) return;
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = section.dataset.settingsLabel || id;
      const select = document.createElement('select');
      select.dataset.setting = sectionStartupName(id);
      select.setAttribute('aria-label', `${label.textContent} open state`);
      select.append(option('last', 'Last state'), option('closed', 'Closed'), option('open', 'Open'));
      select.value = getAppSetting(select.dataset.setting);
      const controls = document.createElement('span');
      controls.className = 'settings-order-controls';
      for (const [direction, text] of [[-1, 'Move up'], [1, 'Move down']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = direction < 0 ? '↑' : '↓';
        button.setAttribute('aria-label', `${text} ${label.textContent}`);
        button.disabled = index + direction < 0 || index + direction >= order.length;
        button.addEventListener('click', () => {
          const next = [...readSectionOrder()];
          [next[index], next[index + direction]] = [next[index + direction], next[index]];
          setAppSetting('sectionOrder', next);
          applySectionOrder(next);
          renderSectionOrder();
          [...sectionOrderList.querySelectorAll('button')]
            .find((item) => item.getAttribute('aria-label') === `${direction < 0 ? 'Move down' : 'Move up'} ${label.textContent}`)?.focus();
        });
        controls.append(button);
      }
      row.append(label, select, controls);
      sectionOrderList.append(row);
    });
  }

  function sectionStartupName(id) {
    return `startupSection:${id}`;
  }

  function setSectionOpen(section, value, persist = true) {
    section.open = value;
    if (persist) setPreference(`sectionLastOpen:${section.id}`, value);
  }

  function applySectionStartup(section, mode, persist = true) {
    const value = mode === 'last'
      ? getPreference(`sectionLastOpen:${section.id}`, (saved) => typeof saved === 'boolean', false)
      : mode === 'open';
    setSectionOpen(section, value, persist && mode !== 'last');
  }

  function actualViewValue(item) {
    return getPreference(item.actual, (value) => typeof value === 'boolean', item.initial);
  }

  function applyViewMode(item, mode, persist = true) {
    const value = mode === 'last' ? actualViewValue(item)
      : item.hidden ? mode === 'hide' : mode === 'show';
    applyViewState(item.actual, value, persist && mode !== 'last');
  }

  function applyLinkedMode(mode) {
    if (mode !== 'last') drums.setLinked(mode === 'on');
  }

  function applyKeypressMode(mode) {
    if (mode !== 'last') drums.setStartOnKeypress(mode === 'on');
  }

  function applyTempoMode(mode = getAppSetting('grooveTempoMode')) {
    const value = mode === 'default' ? 120
      : mode === 'specific' ? getAppSetting('grooveTempoValue')
        : getPreference('lastTempo', validators.grooveTempoValue, 120);
    suppressClockSave = true;
    try {
      applyTempo(value);
    } finally {
      suppressClockSave = false;
    }
  }

  function applyMeterMode(mode = getAppSetting('grooveMeterMode')) {
    const value = mode === 'last' ? getPreference('lastMeter', (saved) => [3, 4].includes(saved), 4)
      : Number(mode);
    suppressClockSave = true;
    try {
      clock.setMeter(value);
    } finally {
      suppressClockSave = false;
    }
  }

  function syncConditionalFields() {
    specificPatchRow.hidden = getAppSetting('midiConnectAction') !== 'specific-patch';
    tempoValueRow.hidden = getAppSetting('grooveTempoMode') !== 'specific';
  }

  function initializeControls() {
    for (const control of dialog.querySelectorAll('[data-setting]')) {
      const name = control.dataset.setting;
      const value = getAppSetting(name);
      if (control.type === 'checkbox') control.checked = value;
      else control.value = String(value);
    }
    applyDarkMode(getAppSetting('darkSynthMode'));
    applySectionOrder();
    renderSectionOrder();
    for (const section of currentSections()) {
      applySectionStartup(section, getAppSetting(sectionStartupName(section.id)), false);
    }
    for (const item of viewSettings) applyViewMode(item, getAppSetting(item.setting), false);
    applyLinkedMode(getAppSetting('grooveLinkedStartup'));
    applyKeypressMode(getAppSetting('grooveStartOnKeypressStartup'));
    applyTempoMode();
    applyMeterMode();
    syncConditionalFields();
  }

  async function refreshPatchOptions() {
    try {
      const selected = getAppSetting('midiSpecificPatchId');
      const patches = await patchLibrary.list();
      specificPatchSelect.replaceChildren(option('', 'Select a saved patch'));
      patches.sort((a, b) => a.name.localeCompare(b.name)).forEach((patch) => {
        specificPatchSelect.add(option(patch.id, patch.name));
      });
      if (selected && !patches.some((patch) => patch.id === selected)) {
        specificPatchSelect.add(option(selected, 'Previously selected patch is unavailable'));
      }
      specificPatchSelect.value = selected;
    } catch (error) {
      status.textContent = `Could not list saved patches: ${error.message || error}.`;
    }
  }

  function openDarkMenu() {
    closeDarkMenu();
    darkModeButton.setAttribute('aria-expanded', 'true');
    darkMenuOpen = true;
    const current = getAppSetting('darkSynthMode');
    const origin = new DOMPoint(-5, 46).matrixTransform(darkModeButton.getScreenCTM())
      .matrixTransform(darkMenuLayer.getScreenCTM().inverse());
    const menu = createSvgElement('g', {
      role: 'menu', 'aria-label': 'Dark synth mode choices', transform: `translate(${origin.x} ${origin.y})`,
    });
    const background = createSvgElement('rect', {
      class: 'arp-menu-background', width: '166', height: '72', rx: '4',
    });
    menu.append(background);
    const items = menuOptions.map((item, index) => {
      const optionGroup = createSvgElement('g', {
        class: 'arp-menu-item', role: 'menuitemradio',
        'aria-checked': String(item.value === current), tabindex: '-1',
      });
      const rect = createSvgElement('rect', {
        x: '3', y: String(3 + index * 22), width: '160', height: '22', rx: '2',
      });
      const text = createSvgElement('text', { x: '10', y: String(18 + index * 22) });
      text.textContent = item.label;
      optionGroup.append(rect, text);
      activate(optionGroup, (event) => {
        setAppSetting('darkSynthMode', item.value);
        applyDarkMode(item.value);
        closeDarkMenu(event.type === 'keydown');
      });
      optionGroup.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeDarkMenu(true);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        }
      });
      menu.append(optionGroup);
      return optionGroup;
    });
    darkMenuLayer.append(menu);
    (items.find((item) => item.getAttribute('aria-checked') === 'true') || items[0]).focus();
  }

  function closeDarkMenu(focus = false) {
    if (!darkMenuOpen) return;
    darkMenuOpen = false;
    darkMenuLayer.replaceChildren();
    darkModeButton.setAttribute('aria-expanded', 'false');
    if (focus) darkModeButton.focus();
  }

  darkModeButton.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openDarkMenu();
  });
  darkModeButton.addEventListener('keydown', (event) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10') || event.key === 'ArrowDown') {
      event.preventDefault();
      openDarkMenu();
    }
  });
  activate(darkModeButton, () => {
    const current = getAppSetting('darkSynthMode');
    const next = menuOptions[(menuOptions.findIndex((item) => item.value === current) + 1) % menuOptions.length].value;
    setAppSetting('darkSynthMode', next);
    applyDarkMode(next);
  });
  document.addEventListener('pointerdown', (event) => {
    if (darkMenuOpen && !darkMenuLayer.contains(event.target) && !darkModeButton.contains(event.target)) closeDarkMenu();
  });
  window.addEventListener('blur', () => closeDarkMenu());

  sectionOrderList.addEventListener('change', (event) => {
    const select = event.target.closest('select[data-setting]');
    if (!select) return;
    setAppSetting(select.dataset.setting, select.value);
    const section = sectionById.get(select.dataset.setting.slice('startupSection:'.length));
    if (section) applySectionStartup(section, select.value);
  });

  dialog.addEventListener('change', (event) => {
    const control = event.target.closest('[data-setting]');
    if (!control || sectionOrderList.contains(control)) return;
    const name = control.dataset.setting;
    let value = control.type === 'checkbox' ? control.checked : control.value;
    if (name === 'grooveTempoValue') {
      value = Number(control.value);
      if (!validators.grooveTempoValue(value)) {
        status.textContent = 'Specific tempo must be a whole number from 40 to 240 BPM.';
        control.focus();
        return;
      }
    }
    setAppSetting(name, value);
    status.textContent = '';
    if (name === 'darkSynthMode') applyDarkMode(value);
    else if (name === 'hidePatchAudio') patchLibrary.refreshAudioVisibility();
    else if (name === 'midiConnectAction') syncConditionalFields();
    else if (name === 'grooveLinkedStartup') applyLinkedMode(value);
    else if (name === 'grooveStartOnKeypressStartup') applyKeypressMode(value);
    else if (name === 'grooveTempoMode') {
      syncConditionalFields();
      applyTempoMode(value);
    } else if (name === 'grooveTempoValue') {
      if (getAppSetting('grooveTempoMode') === 'specific') applyTempoMode('specific');
    } else if (name === 'grooveMeterMode') applyMeterMode(value);
    else {
      const item = viewSettings.find((entry) => entry.setting === name);
      if (item) applyViewMode(item, value);
    }
  });

  dialog.addEventListener('input', (event) => {
    if (event.target !== tempoValue || getAppSetting('grooveTempoMode') !== 'specific') return;
    const value = Number(tempoValue.value);
    if (!validators.grooveTempoValue(value)) return;
    setAppSetting('grooveTempoValue', value);
    applyTempoMode('specific');
  });

  openButton.addEventListener('click', () => {
    status.textContent = '';
    dialog.showModal();
    void refreshPatchOptions();
  });
  document.querySelector('#settings-close').addEventListener('click', () => dialog.close());
  document.querySelector('#settings-reset').addEventListener('click', async () => {
    if (!await confirmAction('Reset settings', 'Restore refaceCS settings to their defaults? Saved patches, loops, and Groove Studio patterns will not be deleted.', 'Reset settings')) return;
    const resetValues = {
      ...defaults,
      sectionOrder: defaultSectionOrder,
      messagesVisible: true,
      hideDisplays: false,
      hideSpeakers: false,
      fiveOctaves: false,
      focusMode: false,
      faderTravel: false,
      grooveStartOnKeypress: false,
      lastTempo: 120,
      lastMeter: 4,
    };
    for (const section of currentSections()) {
      resetValues[`sectionLastOpen:${section.id}`] = false;
      resetValues[sectionStartupName(section.id)] = 'last';
    }
    setPreferences(resetValues);
    patchLibrary.refreshAudioVisibility();
    drums.setLinked(false);
    drums.setStartOnKeypress(false);
    applyViewState('messagesVisible', true, true);
    applyViewState('hideDisplays', false, true);
    applyViewState('hideSpeakers', false, true);
    applyViewState('fiveOctaves', false, true);
    applyViewState('focusMode', false, true);
    applyViewState('faderTravel', false, true);
    for (const section of currentSections()) setSectionOpen(section, false, false);
    applyTempoMode('default');
    applyMeterMode('4');
    initializeControls();
    status.textContent = 'Settings restored to defaults. Saved patches, loops, and Groove Studio patterns were kept.';
    void refreshPatchOptions();
  });

  clock.subscribe((reason) => {
    if (suppressClockSave) return;
    if (reason === 'tempo') setPreference('lastTempo', clock.tempo);
    if (reason === 'meter') setPreference('lastMeter', clock.meter);
  });

  for (const section of sectionElements) {
    section.querySelector('summary').addEventListener('click', (event) => {
      if (event.target.closest('button, a, input, select')) return;
      setTimeout(() => setPreference(`sectionLastOpen:${section.id}`, section.open), 0);
    });
  }
  initializeControls();

  return {
    get: getAppSetting,
    refreshPatchOptions,
  };
}
