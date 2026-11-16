import { createSuperKnobAudition, createSuperKnobEngine, defaultSuperKnob, drawMapping, isDefaultSuperKnob,
  SUPERKNOB_TARGETS, validateSuperKnob } from './superknob.js';
import { askName, confirmAction } from './dialogs.js';
import { clampPosition, setupHelpTrigger, trackPointer } from './help.js';
import { createReporter } from './notifications.js';
import { getPreference, setPreference } from './preferences.js';
import './superknob.css';

const colors = ['#ffb347', '#5bc9bb', '#a69aff', '#79b9f4', '#ed95ba'];

export function setupSuperKnob({ panel, clock, apply, getValue, midiLearn, startPreviewNote, endPreviewNote, onChange }) {
  const report = createReporter('app', 'superknob-status');
  const knob = panel.querySelector('#super-knob');
  const cycleButton = panel.querySelector('#super-knob-cycle');
  const configureButton = panel.querySelector('#super-knob-configure');
  const dialog = document.createElement('dialog');
  dialog.id = 'superknob-editor';
  dialog.className = 'superknob-editor';
  dialog.setAttribute('aria-labelledby', 'superknob-title');
  dialog.innerHTML = `
    <header class="superknob-header">
      <h2 id="superknob-title">SuperKnob configuration</h2>
      <button id="superknob-help" type="button" data-help-target="superknob" title="Open SuperKnob help">Help</button>
      <button id="superknob-close" type="button" aria-label="Close SuperKnob configuration">X</button>
    </header>
    <div class="superknob-content">
      <div class="superknob-presets">
        <label>Macro preset <select id="superknob-presets" aria-label="Macro preset"></select></label>
        <button id="superknob-save" type="button">Save</button>
        <button id="superknob-save-as" type="button">Save as</button>
        <button id="superknob-rename" type="button">Rename</button>
        <button id="superknob-delete" type="button">Delete</button>
        <label class="superknob-include"><input id="superknob-include" type="checkbox"> Include with synth patch</label>
      </div>
      <div class="superknob-workspace">
        <aside>
          <h3>Assigned parameters</h3>
          <label>Parameter <select id="superknob-target" aria-label="Parameter to assign"></select></label>
          <button id="superknob-add" type="button">+ Assign parameter</button>
          <div id="superknob-mappings"></div>
          <p class="superknob-hint">Enabled mappings run together.</p>
        </aside>
        <section class="superknob-mapping">
          <div class="superknob-tools">
            <h3 id="superknob-mapping-title">Cutoff mapping</h3>
            <label>Tool <select id="superknob-tool"><option value="draw">Draw</option><option value="line">Straight line</option></select></label>
            <button id="superknob-reset-curve" type="button">Reset curve</button>
          </div>
          <svg id="superknob-graph" viewBox="0 0 640 295" role="img"
            aria-label="Parameter value against SuperKnob position. Draw with a pointer, or use the point controls below.">
            <defs><pattern id="superknob-grid" width="71.25" height="57.5" patternUnits="userSpaceOnUse" x="50" y="20"><path d="M71.25 0H0V57.5" fill="none" stroke="#30414b" stroke-dasharray="2 4"/></pattern></defs>
            <rect x="50" y="20" width="570" height="230" fill="url(#superknob-grid)" stroke="#52616b"/>
            <g id="superknob-curves" fill="none" stroke-width="2.5"></g>
            <path id="superknob-playhead" d="M620 20V250" stroke="#d4dfe5" opacity=".65"/>
            <circle id="superknob-point" r="4" fill="#ffb347" stroke="#fff"/>
            <g class="superknob-axis">
              <text x="50" y="270">0</text><text x="193" y="270">32</text><text x="337" y="270">64</text><text x="480" y="270">96</text><text x="620" y="270">127</text>
              <text id="superknob-y-max" x="40" y="25" text-anchor="end">127</text><text id="superknob-y-mid" x="40" y="140" text-anchor="end">64</text><text x="40" y="250" text-anchor="end">0</text>
              <text x="335" y="290">SuperKnob position</text><text transform="translate(14 137) rotate(-90)">Parameter value</text>
            </g>
          </svg>
          <div class="superknob-point-tools">
            <label>Position <input id="superknob-point-x" type="number" min="0" max="127" step="1" value="0"></label>
            <label>Value <input id="superknob-point-y" type="number" min="0" max="127" step="1" value="0"></label>
            <button id="superknob-set-point" type="button">Set point</button>
          </div>
          <label class="superknob-preview">Preview position <input id="superknob-preview" type="range" min="0" max="127" value="127"><output id="superknob-position">127</output></label>
        </section>
      </div>
      <section class="superknob-record">
        <h3>Record selected fader</h3>
        <div class="superknob-timing">
          <label>Recording seconds <input id="superknob-record-seconds" type="number" min="0.1" max="120" step="0.1" value="5"></label>
          <label><input id="superknob-audition" type="checkbox"> Audition C major (C-E-G, eighth notes at shared tempo)</label>
        </div>
        <p id="superknob-controller-hint" class="superknob-hint"></p>
        <div class="superknob-record-controls">
          <label><span id="superknob-record-label">Cutoff</span><input id="superknob-record-fader" type="range" min="0" max="127" value="127" aria-label="Selected parameter fader"></label>
          <div><strong id="superknob-record-state">READY</strong><p id="superknob-record-instruction">Press Record, then move the selected fader.</p><small id="superknob-record-description"></small></div>
          <button id="superknob-record" type="button">Record</button>
        </div>
      </section>
      <section class="superknob-cycle-settings">
        <h3>Playback cycle timing</h3>
        <div class="superknob-timing">
          <label>Timing <select id="superknob-playback-mode"><option value="seconds">Duration</option><option value="sync">Tempo sync</option></select></label>
          <label id="superknob-playback-seconds-label">Seconds per sweep <input id="superknob-playback-seconds" type="number" min="0.1" max="120" step="0.1" value="5"></label>
          <label id="superknob-playback-beats-label" hidden>Length per sweep <select id="superknob-playback-beats"></select></label>
        </div>
        <p class="superknob-hint">One-way playback duration, independent of recording length. Close configuration to start cycling.</p>
      </section>
      <p class="superknob-hint">Changes apply live. Automatic cycling is stopped while editing. Presets are saved in this browser.</p>
    </div>`;
  document.body.append(dialog);
  const find = (id) => dialog.querySelector(`#superknob-${id}`);
  setupHelpTrigger(find('help'));

  const playback = document.createElement('div');
  playback.className = 'superknob-playback';
  playback.innerHTML = `
    <strong>SuperKnob cycle</strong>
    <label>Timing <select id="superknob-cycle-mode"><option value="seconds">Duration</option><option value="sync">Tempo sync</option></select></label>
    <label id="superknob-seconds-label">Seconds per sweep <input id="superknob-seconds" type="number" min="0.1" max="120" step="0.1" value="5"></label>
    <label id="superknob-beats-label" hidden>Length per sweep <select id="superknob-beats"></select></label>
    <button id="superknob-cycle-toggle" type="button" aria-pressed="false">Start cycle</button>
    <button id="superknob-open" type="button">Configure</button>`;
  document.querySelector('#synth').after(playback);
  const timing = playback.querySelector('#superknob-cycle-mode');
  const seconds = playback.querySelector('#superknob-seconds');
  const beats = playback.querySelector('#superknob-beats');
  const toggleCycle = playback.querySelector('#superknob-cycle-toggle');
  const timingControls = [
    { mode: timing, seconds, beats, root: playback, prefix: '' },
    { mode: find('playback-mode'), seconds: find('playback-seconds'), beats: find('playback-beats'), root: dialog, prefix: 'playback-' },
  ];
  for (const controls of timingControls) for (const [value, label] of [[0.125, '1/32 note'], [0.25, '1/16 note'], [0.5, '1/8 note'],
    [1, '1/4 note'], [2, '1/2 note'], [4, 'Whole note'], [8, '2 whole notes'],
    [16, '4 whole notes'], [32, '8 whole notes']]) controls.beats.add(new Option(label, value));

  let presets = [];
  let presetId = '';
  let selected = 'filter-cutoff';
  let include = false;
  let restoring = true;
  let gesture = null;
  const audition = createSuperKnobAudition({
    clock, startNote: startPreviewNote, endNote: endPreviewNote,
    onStop: () => { find('audition').checked = false; },
  });
  const engine = createSuperKnobEngine({
    apply,
    getValue,
    clock,
    onChange(reason) {
      if (restoring) return;
      saveState();
      onChange();
      render();
      if (reason === 'recorded') report(`SuperKnob: recorded the selected fader over one ${engine.definition.recordSeconds}-second sweep.`);
    },
    onFrame: renderFrame,
  });

  function saveState() {
    setPreference('superKnobState', {
      definition: engine.definition, position: Math.round(engine.position), include, presetId,
    });
  }

  function stop() {
    audition.stop();
    const active = engine.cycling || engine.recording;
    engine.stop();
    if (active) saveState();
  }

  try {
    const saved = getPreference('superKnobPresets', () => true, undefined);
    if (saved !== undefined) {
      if (!Array.isArray(saved)) throw new Error('Invalid macro preset list.');
      const ids = new Set();
      const names = new Set();
      presets = saved.map((preset) => {
        if (!preset || typeof preset.id !== 'string' || !preset.id
          || typeof preset.name !== 'string' || !preset.name.trim()
          || ids.has(preset.id) || names.has(preset.name.trim().toLocaleLowerCase())) {
          throw new Error('Invalid or duplicate macro preset.');
        }
        ids.add(preset.id);
        names.add(preset.name.trim().toLocaleLowerCase());
        return { id: preset.id, name: preset.name.trim(), definition: validateSuperKnob(preset.definition) };
      });
    }
  } catch (error) {
    report(`Could not restore SuperKnob presets: ${error.message}`, 'error');
  }
  try {
    const saved = getPreference('superKnobState', () => true, undefined);
    if (saved !== undefined) {
      if (!saved || typeof saved.include !== 'boolean'
        || !Number.isInteger(saved.position) || saved.position < 0 || saved.position > 127) {
        throw new Error('Invalid saved macro state.');
      }
      engine.load(saved.definition, saved.position);
      include = saved.include;
      presetId = presets.some(({ id }) => id === saved.presetId) ? saved.presetId : '';
    }
  } catch (error) {
    report(`Could not restore SuperKnob configuration: ${error.message}`, 'error');
  }
  restoring = false;
  selected = engine.definition.mappings[0]?.target ?? '';

  function selectedMapping() {
    return engine.definition.mappings.find(({ target }) => target === selected);
  }

  function editMapping(change) {
    const definition = engine.definition;
    const mapping = definition.mappings.find(({ target }) => target === selected);
    if (!mapping) return;
    change(mapping, definition);
    engine.edit(definition);
  }

  function pathFor(values) {
    return values.map((value, x) => `${x ? 'L' : 'M'}${50 + x * 570 / 127},${250 - value * 230 / 127}`).join(' ');
  }

  function renderGraph() {
    const curves = find('curves');
    curves.replaceChildren();
    const mappings = engine.definition.mappings;
    for (const mapping of [...mappings.filter(({ target }) => target !== selected),
      ...mappings.filter(({ target }) => target === selected)]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const values = mapping.target === selected
        ? gesture?.values ?? engine.previewValues ?? mapping.values : mapping.values;
      path.setAttribute('d', pathFor(values));
      path.setAttribute('stroke', colors[mappings.indexOf(mapping) % colors.length]);
      path.setAttribute('opacity', mapping.target === selected ? '1' : mapping.enabled ? '.25' : '.1');
      if (!mapping.enabled) path.setAttribute('stroke-dasharray', '4 4');
      path.dataset.target = mapping.target;
      curves.append(path);
    }
  }

  function renderFrame() {
    if (!dialog.open && Number(knob.dataset.value) !== Math.round(engine.position)) midiLearn.valueChanged('super-knob');
    knob.dataset.value = String(Math.round(engine.position));
    knob.setAttribute('aria-valuenow', String(Math.round(engine.position)));
    knob.setAttribute('aria-valuetext', `${Math.round(engine.position)} of 127`);
    knob.querySelector('.super-knob-indicator').setAttribute('transform', `rotate(${-135 + engine.position / 127 * 270})`);
    knob.querySelector('title').textContent = `SuperKnob: ${Math.round(engine.position)}. Right-click to configure.`;
    knob.classList.toggle('is-custom', !isDefaultSuperKnob(engine.definition));
    const pressed = String(engine.cycling);
    cycleButton.setAttribute('aria-pressed', pressed);
    toggleCycle.setAttribute('aria-pressed', pressed);
    toggleCycle.textContent = engine.cycling ? 'Stop cycle' : 'Start cycle';
    toggleCycle.disabled = dialog.open;
    cycleButton.setAttribute('aria-disabled', String(dialog.open));
    if (!dialog.open) return;
    find('preview').value = String(Math.round(engine.position));
    find('position').value = String(Math.round(engine.position));
    const x = 50 + engine.position * 570 / 127;
    find('playhead').setAttribute('d', `M${x} 20V250`);
    const mapping = selectedMapping();
    find('point').style.display = mapping ? '' : 'none';
    if (mapping) {
      const values = gesture?.values ?? engine.previewValues ?? mapping.values;
      find('point').setAttribute('cx', x);
      find('point').setAttribute('cy', 250 - values[Math.round(engine.position)] * 230 / 127);
      find('record-fader').value = String(getValue(selected));
    }
    const recording = engine.recording;
    find('record-seconds').disabled = Boolean(recording);
    for (const controls of timingControls) {
      for (const control of [controls.mode, controls.seconds, controls.beats]) control.disabled = Boolean(recording);
    }
    find('record-state').textContent = recording
      ? recording.started === null ? 'ARMED' : 'RECORDING' : 'READY';
    find('record-state').classList.toggle('is-armed', Boolean(recording));
    const label = SUPERKNOB_TARGETS.find(({ id }) => id === selected)?.label ?? 'a parameter';
    find('record-instruction').textContent = recording
      ? recording.started === null ? `Move ${label} to start recording.` : 'Recording one min-to-max sweep...'
      : 'Press Record, then move the selected fader.';
    find('record').textContent = recording ? 'Cancel' : 'Record';
    for (const id of ['target', 'add', 'tool', 'reset-curve', 'point-x', 'point-y', 'set-point', 'preview',
      'presets', 'save', 'save-as', 'rename', 'delete']) {
      find(id).disabled = Boolean(recording) || (['reset-curve', 'set-point', 'preview', 'record'].includes(id) && !mapping)
        || (['rename', 'delete'].includes(id) && !presetId)
        || (['add', 'target'].includes(id) && !find('target').options.length);
    }
    find('record').disabled = !mapping;
    for (const control of find('mappings').querySelectorAll('button, input')) control.disabled = Boolean(recording);
    if (recording && recording.started !== null) renderGraph();
  }

  function renderControllerHint() {
    const label = SUPERKNOB_TARGETS.find(({ id }) => id === selected)?.label;
    find('controller-hint').textContent = midiLearn.hasAssignment('super-knob')
      ? label ? `Your SuperKnob MIDI controller temporarily controls ${label} while configuration is open. Move through the fader value for pickup.`
        : 'Assign and select a parameter to control it with your SuperKnob MIDI controller.'
      : 'A learned SuperKnob MIDI controller will temporarily control the selected fader here.';
  }
  midiLearn.subscribe(renderControllerHint);

  function render() {
    const definition = engine.definition;
    if (!definition.mappings.some(({ target }) => target === selected)) selected = definition.mappings[0]?.target ?? '';
    const preset = presets.find(({ id }) => id === presetId);
    const dirty = preset && JSON.stringify(preset.definition) !== JSON.stringify(definition);
    const custom = !presetId && JSON.stringify(definition) !== JSON.stringify(defaultSuperKnob());
    find('presets').replaceChildren(new Option('Default - cutoff', ''));
    if (custom) find('presets').add(new Option(include ? 'Embedded / custom macro' : 'Custom (unsaved)', '__current__'));
    for (const item of presets) find('presets').add(new Option(`${item.name}${item === preset && dirty ? ' *' : ''}`, item.id));
    find('presets').value = presetId || (custom ? '__current__' : '');
    find('include').checked = include;
    find('target').replaceChildren();
    for (const target of SUPERKNOB_TARGETS.filter(({ id }) => !definition.mappings.some(({ target }) => target === id))) {
      find('target').add(new Option(target.label, target.id));
    }
    find('mappings').replaceChildren();
    definition.mappings.forEach((mapping, index) => {
      const target = SUPERKNOB_TARGETS.find(({ id }) => id === mapping.target);
      const row = document.createElement('div');
      row.className = 'superknob-target-row';
      row.classList.toggle('is-selected', selected === target.id);
      row.style.setProperty('--mapping-color', colors[index % colors.length]);
      const enable = document.createElement('input');
      enable.type = 'checkbox';
      enable.checked = mapping.enabled;
      enable.setAttribute('aria-label', `Enable ${target.label} mapping`);
      enable.addEventListener('change', () => {
        const next = engine.definition;
        next.mappings.find(({ target: id }) => id === target.id).enabled = enable.checked;
        engine.edit(next);
      });
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = target.label;
      button.setAttribute('aria-pressed', String(selected === target.id));
      button.addEventListener('click', () => { selected = target.id; render(); });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'X';
      remove.setAttribute('aria-label', `Remove ${target.label} mapping`);
      remove.addEventListener('click', () => {
        const next = engine.definition;
        next.mappings = next.mappings.filter(({ target: id }) => id !== target.id);
        engine.edit(next);
      });
      row.append(enable, button, remove);
      find('mappings').append(row);
    });
    const target = SUPERKNOB_TARGETS.find(({ id }) => id === selected);
    find('mapping-title').textContent = target ? `${target.label} mapping` : 'Assign a parameter';
    find('record-label').textContent = target?.label ?? 'No parameter selected';
    find('record-fader').max = String(target?.max ?? 127);
    find('record-fader').disabled = !target;
    find('point-y').max = String(target?.max ?? 127);
    find('point-y').value = String(Math.round((selectedMapping()?.values[Number(find('point-x').value)] ?? 0) * (target?.max ?? 127) / 127));
    find('y-max').textContent = String(target?.max ?? 127);
    find('y-mid').textContent = String(Math.round((target?.max ?? 127) / 2));
    find('record-seconds').value = String(definition.recordSeconds);
    find('record-description').textContent = `First movement starts a single ${definition.recordSeconds}-second min-to-max sweep. No countdown.`;
    for (const controls of timingControls) {
      controls.mode.value = definition.cycle.mode;
      controls.seconds.value = String(definition.cycle.seconds);
      controls.beats.value = String(definition.cycle.beats);
      controls.root.querySelector(`#superknob-${controls.prefix}seconds-label`).hidden = definition.cycle.mode !== 'seconds';
      controls.root.querySelector(`#superknob-${controls.prefix}beats-label`).hidden = definition.cycle.mode !== 'sync';
    }
    if (dialog.open) midiLearn.redirectTarget('super-knob', selected ? panel.querySelector(`#${selected}`) : null);
    renderControllerHint();
    renderGraph();
    renderFrame();
  }

  function closeEditor() {
    audition.stop();
    engine.cancelRecording();
    gesture = null;
    dialog.close();
    midiLearn.redirectTarget('super-knob', null);
    saveState();
    renderFrame();
    knob.focus({ preventScroll: true });
  }

  function openEditor() {
    engine.stop();
    if (!dialog.open) {
      dialog.show();
      const position = clampPosition(dialog, (innerWidth - dialog.offsetWidth) / 2, 150);
      dialog.style.left = `${position.left}px`;
      dialog.style.top = `${position.top}px`;
    }
    render();
    find('close').focus({ preventScroll: true });
  }

  function manualPosition(value, channel = 0, learn = true) {
    if (learn) midiLearn.selectTarget('super-knob');
    midiLearn.valueChanged('super-knob');
    engine.setPosition(value, channel);
    saveState();
  }

  function cycle() {
    if (dialog.open) return;
    if (engine.cycling) {
      engine.stopCycle();
      saveState();
    } else engine.startCycle();
  }

  knob.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    knob.focus({ preventScroll: true });
    midiLearn.selectTarget('super-knob');
    const drag = { y: event.clientY, value: engine.position };
    engine.stop();
    trackPointer(knob, event, (move) => manualPosition(drag.value + (drag.y - move.clientY) * 0.75));
  });
  knob.addEventListener('wheel', (event) => {
    if (event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    manualPosition(engine.position - Math.sign(event.deltaY) * (event.altKey ? 10 : 1));
  }, { passive: false });
  knob.addEventListener('keydown', (event) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault(); openEditor(); return;
    }
    const values = { ArrowUp: engine.position + 1, ArrowRight: engine.position + 1,
      ArrowDown: engine.position - 1, ArrowLeft: engine.position - 1,
      PageUp: engine.position + 10, PageDown: engine.position - 10, Home: 127, End: 0 };
    if (values[event.key] !== undefined) {
      event.preventDefault();
      manualPosition(values[event.key]);
    }
  });
  knob.addEventListener('contextmenu', (event) => { event.preventDefault(); openEditor(); });
  knob.addEventListener('dblclick', openEditor);
  for (const [button, action] of [[cycleButton, cycle], [configureButton, openEditor]]) {
    button.addEventListener('click', action);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
    });
  }
  toggleCycle.addEventListener('click', cycle);
  playback.querySelector('#superknob-open').addEventListener('click', openEditor);
  find('close').addEventListener('click', closeEditor);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeEditor(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dialog.open && !event.defaultPrevented
      && !document.querySelector('dialog:modal, .help-window[open], :popover-open')) {
      event.preventDefault();
      closeEditor();
    }
  }, true);
  dialog.querySelector('header').addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    const bounds = dialog.getBoundingClientRect();
    trackPointer(event.currentTarget, event, (move) => {
      const position = clampPosition(dialog, bounds.left + move.clientX - event.clientX, bounds.top + move.clientY - event.clientY);
      dialog.style.left = `${position.left}px`;
      dialog.style.top = `${position.top}px`;
    });
  });
  window.addEventListener('resize', () => {
    if (!dialog.open) return;
    const bounds = dialog.getBoundingClientRect();
    const position = clampPosition(dialog, bounds.left, bounds.top);
    dialog.style.left = `${position.left}px`;
    dialog.style.top = `${position.top}px`;
  });
  find('include').addEventListener('change', () => {
    include = find('include').checked;
    saveState();
    onChange();
  });
  find('add').addEventListener('click', () => {
    const id = find('target').value;
    const target = SUPERKNOB_TARGETS.find((item) => item.id === id);
    if (!target) return;
    const definition = engine.definition;
    definition.mappings.push({
      target: id, enabled: true, values: Array(128).fill(Math.round(getValue(id) * 127 / target.max)),
    });
    selected = id;
    engine.edit(definition);
  });
  find('reset-curve').addEventListener('click', () => editMapping((mapping) => {
    mapping.values = Array.from({ length: 128 }, (_, i) => i);
  }));
  find('preview').addEventListener('input', () => manualPosition(Number(find('preview').value), 0, false));
  find('record').addEventListener('click', () => {
    if (engine.recording) { engine.cancelRecording(); renderGraph(); }
    else engine.armRecording(selected);
  });
  find('record-fader').addEventListener('input', () => {
    const value = Number(find('record-fader').value);
    if (value !== getValue(selected)) {
      engine.observeFader(selected, value);
      apply(selected, value);
    }
    renderFrame();
  });
  find('record-seconds').addEventListener('change', () => {
    if (!find('record-seconds').reportValidity()) {
      find('record-seconds').value = String(engine.definition.recordSeconds);
      return;
    }
    const definition = engine.definition;
    definition.recordSeconds = Number(find('record-seconds').value);
    engine.edit(definition);
  });
  find('audition').addEventListener('change', () => {
    if (find('audition').checked) find('audition').checked = audition.start();
    else audition.stop();
  });
  find('point-x').addEventListener('input', () => {
    const x = Number(find('point-x').value);
    const mapping = selectedMapping();
    if (!mapping || !Number.isInteger(x) || x < 0 || x > 127) return;
    const target = SUPERKNOB_TARGETS.find(({ id }) => id === selected);
    find('point-y').value = String(Math.round(mapping.values[x] * target.max / 127));
  });
  find('set-point').addEventListener('click', () => {
    const x = Number(find('point-x').value);
    const y = Number(find('point-y').value);
    if (!find('point-x').reportValidity() || !find('point-y').reportValidity()) return;
    const target = SUPERKNOB_TARGETS.find(({ id }) => id === selected);
    editMapping((mapping) => { mapping.values[x] = Math.round(y * 127 / target.max); });
  });

  const graph = find('graph');
  function graphPoint(event) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(graph.getScreenCTM().inverse());
    return { x: Math.max(0, Math.min(127, Math.round((point.x - 50) * 127 / 570))),
      y: Math.max(0, Math.min(127, Math.round((250 - point.y) * 127 / 230))) };
  }
  graph.addEventListener('pointerdown', (event) => {
    const mapping = selectedMapping();
    if (event.button !== 0 || !mapping || engine.recording) return;
    event.preventDefault();
    const start = graphPoint(event);
    gesture = { start, previous: start, original: mapping.values, values: [...mapping.values] };
    drawMapping(gesture.values, start, start);
    renderGraph();
    graph.setPointerCapture(event.pointerId);
  });
  graph.addEventListener('pointermove', (event) => {
    if (!gesture || !graph.hasPointerCapture(event.pointerId)) return;
    const point = graphPoint(event);
    if (find('tool').value === 'line') {
      gesture.values = [...gesture.original];
      drawMapping(gesture.values, gesture.start, point);
    } else drawMapping(gesture.values, gesture.previous, point);
    gesture.previous = point;
    renderGraph();
  });
  graph.addEventListener('pointerup', (event) => {
    if (!gesture) return;
    const values = gesture.values;
    gesture = null;
    if (graph.hasPointerCapture(event.pointerId)) graph.releasePointerCapture(event.pointerId);
    editMapping((mapping) => { mapping.values = values; });
  });
  for (const name of ['pointercancel', 'lostpointercapture']) graph.addEventListener(name, () => {
    if (!gesture) return;
    gesture = null;
    renderGraph();
  });

  for (const controls of timingControls) for (const control of [controls.mode, controls.seconds, controls.beats]) control.addEventListener('change', () => {
    if (!controls.seconds.reportValidity()) { controls.seconds.value = String(engine.definition.cycle.seconds); return; }
    engine.stopCycle();
    const definition = engine.definition;
    definition.cycle = { mode: controls.mode.value, seconds: Number(controls.seconds.value), beats: Number(controls.beats.value) };
    engine.edit(definition);
  });

  function persistPresets() { setPreference('superKnobPresets', presets); }
  function validateName(name) {
    return presets.some((preset) => preset.id !== presetId && preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())
      ? 'A macro preset with that name already exists.' : '';
  }
  async function savePreset(asNew) {
    const existing = presets.find(({ id }) => id === presetId);
    let name = existing?.name;
    if (asNew || !existing) {
      name = await askName('Save SuperKnob preset', 'Save this macro independently of synth patches.', '', (value) =>
        presets.some((preset) => preset.name.toLocaleLowerCase() === value.toLocaleLowerCase()) ? 'That name already exists.' : '');
      if (!name) return;
    }
    const record = { id: asNew || !existing ? crypto.randomUUID() : existing.id, name, definition: engine.definition };
    presets = presets.filter(({ id }) => id !== record.id);
    presets.push(record);
    presetId = record.id;
    persistPresets();
    saveState();
    render();
    report(`SuperKnob preset "${name}" saved.`);
  }
  find('save').addEventListener('click', () => { void savePreset(false); });
  find('save-as').addEventListener('click', () => { void savePreset(true); });
  find('rename').addEventListener('click', async () => {
    const preset = presets.find(({ id }) => id === presetId);
    if (!preset) return;
    const name = await askName('Rename SuperKnob preset', 'Choose a name for this macro.', preset.name, validateName);
    if (!name) return;
    preset.name = name;
    persistPresets();
    render();
  });
  find('delete').addEventListener('click', async () => {
    const preset = presets.find(({ id }) => id === presetId);
    if (!preset || !await confirmAction('Delete SuperKnob preset', `Delete "${preset.name}"? Embedded patch copies are unaffected.`, 'Delete')) return;
    presets = presets.filter(({ id }) => id !== presetId);
    presetId = '';
    persistPresets();
    saveState();
    render();
    report('SuperKnob preset deleted. The current mappings were kept.');
  });
  find('presets').addEventListener('change', async () => {
    const nextId = find('presets').value;
    if (nextId === '__current__') return;
    const current = presets.find(({ id }) => id === presetId)?.definition ?? defaultSuperKnob();
    if (JSON.stringify(current) !== JSON.stringify(engine.definition)
      && !await confirmAction('Load SuperKnob preset', 'Replace the current edited macro mappings?', 'Load')) {
      render();
      return;
    }
    presetId = nextId;
    engine.load(presets.find(({ id }) => id === nextId)?.definition ?? defaultSuperKnob());
    midiLearn.valueChanged('super-knob');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
  render();

  return {
    setPosition(value, channel) {
      if (!dialog.open) { manualPosition(value, channel, false); return; }
      if (selected && value !== getValue(selected)) {
        engine.observeFader(selected, value);
        apply(selected, value, channel);
        renderFrame();
      }
    },
    stopAudition: audition.stop,
    observeFader(id, value) { engine.observeFader(id, value); if (selected === id) renderFrame(); },
    getPatchDefinition: () => include ? engine.definition : undefined,
    getDefinition: () => engine.definition,
    setInclude(value) {
      include = value;
      saveState();
      find('include').checked = include;
    },
    loadPatchDefinition(definition) {
      audition.stop();
      include = definition !== undefined;
      presetId = '';
      engine.load(definition ?? defaultSuperKnob());
      midiLearn.valueChanged('super-knob');
      render();
    },
    stop,
    suspendForPatch() {
      audition.stop();
      engine.stop();
      if (dialog.open) render();
    },
  };
}
