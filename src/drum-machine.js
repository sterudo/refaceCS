import { createDrumAudio, defaultDrumLane, DRUM_VOICES } from './drum-audio.js';

const storageKey = 'refaceCS.drumPatterns.v1';
const maxOffset = 600;
const velocityFor = (level) => Math.round(level * 127 / 5);
const copy = (value) => structuredClone(value);
const initialLanes = () => DRUM_VOICES.slice(0, 4).map(defaultDrumLane);
const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6H21M9 6V3H15V6M5 6L6 21H18L19 6M10 10V17M14 10V17"/></svg>';

function validLane(lane) {
  return lane && DRUM_VOICES.some((voice) => voice.id === lane.voice)
    && Array.isArray(lane.steps) && lane.steps.length === 16
    && lane.steps.every((level) => Number.isInteger(level) && level >= 0 && level <= 5)
    && ['muted', 'solo'].every((key) => lane[key] === undefined || typeof lane[key] === 'boolean')
    && [['level', 0, 100], ['tuning', -24, 24], ['decay', 0.02, 2], ['tone', 0, 100]]
      .every(([key, min, max]) => Number.isFinite(lane[key]) && lane[key] >= min && lane[key] <= max);
}

function validStore(store) {
  return store?.version === 1 && Array.isArray(store.patterns) && store.patterns.length > 0
    && store.patterns.every((pattern) => typeof pattern.id === 'string'
      && typeof pattern.name === 'string' && pattern.name.trim().length > 0
      && Array.isArray(pattern.lanes) && pattern.lanes.every(validLane)
      && new Set(pattern.lanes.map((lane) => lane.voice)).size === pattern.lanes.length)
    && new Set(store.patterns.map((pattern) => pattern.id)).size === store.patterns.length
    && store.patterns.some((pattern) => pattern.id === store.selected)
    && Number.isFinite(store.volume) && store.volume >= 0 && store.volume <= 100
    && Number.isInteger(store.offset) && Math.abs(store.offset) <= maxOffset
    && typeof store.linked === 'boolean';
}

export function createDrumMachine(clock, { onTempo, onStartLooper, onStopLooper, getRefaceInput }) {
  const element = (id) => document.querySelector(`#drum-${id}`);
  const status = element('status');
  const storageStatus = element('storage-status');
  const outputStatus = element('output-status');
  const lanesElement = element('lanes');
  const patternSelect = element('pattern');
  const instrumentSelect = element('instrument');
  const playButton = element('play');
  const outputSelect = element('output');
  const outputChoose = element('output-choose');
  const outputRefresh = element('output-refresh');
  const calibrationDialog = element('calibration');
  const calibrationStatus = element('calibration-status');
  const calibrationDelay = element('calibration-delay');
  const calibrationDone = element('calibration-done');
  const audio = createDrumAudio(clock, fail);
  const directions = new Map();
  let playing = false;
  let starting = false;
  let showToneControls = false;
  let timer;
  let nextBeat = 0;
  let firstBeat = 0;
  let startRevision = 0;
  let enabling;
  let devicesRevision = 0;
  let calibration;
  let calibrationTimer;
  let calibrationRevision = 0;
  let store = {
    version: 1,
    patterns: [{ id: crypto.randomUUID(), name: 'Pattern 1', lanes: initialLanes() }],
    selected: '',
    volume: 80,
    offset: 0,
    linked: false,
  };
  store.selected = store.patterns[0].id;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (!validStore(parsed)) throw new Error('Saved drum patterns have an invalid format');
      store = parsed;
      for (const pattern of store.patterns) {
        for (const lane of pattern.lanes) {
          lane.solo ??= false;
          lane.muted ??= false;
        }
      }
    }
  } catch (error) {
    storageStatus.textContent = `Could not restore drum patterns: ${error.message || error}. `
      + 'Starting a temporary pattern; the stored data will not change until you edit or save.';
  }
  const pattern = () => store.patterns.find((item) => item.id === store.selected);
  element('volume').value = String(store.volume);
  element('offset').value = String(store.offset);
  element('linked').checked = store.linked;
  clock.setOffset(store.offset);

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(store));
      storageStatus.textContent = 'Drum patterns saved in this browser.';
    } catch (error) {
      storageStatus.textContent = `Could not save drum patterns: ${error.message || error}. `
        + 'Changes are only available until this page is closed.';
    }
  }

  function fail(message) {
    stop();
    if (!clock.enabled) element('enable').textContent = 'Enable audio';
    status.textContent = message;
  }

  async function enable() {
    if (enabling) return enabling;
    enabling = (async () => {
      await audio.enable();
      audio.setVolume(store.volume);
      element('enable').textContent = 'Audio enabled';
      const supported = typeof audio.context.setSinkId === 'function';
      outputSelect.disabled = !supported;
      outputChoose.disabled = !supported || !navigator.mediaDevices?.selectAudioOutput;
      outputRefresh.disabled = !supported || !navigator.mediaDevices?.enumerateDevices;
      if (!supported) outputStatus.textContent = 'Output selection is unavailable in this browser; using the system default. No direct ASIO.';
      else await refreshOutputs();
    })();
    try {
      await enabling;
    } finally {
      enabling = undefined;
    }
  }

  function stop() {
    if (calibration) closeCalibration('MIDI offset test cancelled; the offset is unchanged.');
    startRevision++;
    starting = false;
    playing = false;
    clearTimeout(timer);
    clock.stop('drums');
    audio.stop();
    playButton.setAttribute('aria-pressed', 'false');
    for (const step of lanesElement.querySelectorAll('.is-current')) step.classList.remove('is-current');
  }

  function stopTogether() {
    stop();
    onStopLooper();
    status.textContent = 'Drums and looper stopped. MIDI reset requested.';
  }

  function audible(lane) {
    return !lane.muted && (!pattern().lanes.some((item) => item.solo) || lane.solo);
  }

  function updateLaneStates() {
    for (const row of lanesElement.children) {
      const lane = pattern().lanes.find((item) => item.voice === row.dataset.voice);
      row.classList.toggle('is-muted', !audible(lane));
      for (const key of ['solo', 'muted']) {
        row.querySelector(`[data-toggle="${key}"]`).setAttribute('aria-pressed', String(lane[key]));
      }
    }
  }

  function renderPlayhead() {
    const beat = clock.beatAt();
    const step = playing && beat >= firstBeat ? Math.floor((beat + 1e-8) * 4) % (clock.meter * 4) : -1;
    for (const button of lanesElement.querySelectorAll('.drum-step')) {
      button.classList.toggle('is-current', Number(button.dataset.step) === step);
    }
  }

  function tick() {
    clearTimeout(timer);
    if (!playing) return;
    if (!clock.enabled) {
      fail('Drum audio is not running. Enable audio to resume.');
      return;
    }
    try {
      const now = performance.now();
      const currentBeat = clock.beatAt(now);
      if (nextBeat < currentBeat - 0.25) nextBeat = Math.ceil(currentBeat * 4) / 4;
      const horizon = clock.beatAt(now + clock.lead);
      for (; nextBeat <= horizon + 1e-8; nextBeat += 0.25) {
        const step = Math.round(nextBeat * 4) % (clock.meter * 4);
        for (const lane of pattern().lanes) {
          if (audible(lane) && lane.steps[step]) audio.trigger(lane, velocityFor(lane.steps[step]), clock.timeAt(nextBeat), true);
        }
      }
      renderPlayhead();
      timer = setTimeout(tick, 20);
    } catch (error) {
      fail(`Drum playback failed: ${error.message || error}`);
    }
  }

  function invalidate() {
    if (!playing) return;
    audio.cancelFuture();
    // Audio already handed to the device cannot be recalled.
    const committed = clock.beatAt(performance.now() + Math.max(0,
      (audio.context.baseLatency || 0) + (audio.context.outputLatency || 0)) * 1000 + 5);
    nextBeat = Math.max(firstBeat, Math.ceil((committed + 1e-8) * 4) / 4);
    tick();
  }

  async function start(looperMode = 2) {
    if (playing || starting) return;
    if (calibration) closeCalibration('MIDI offset test cancelled; the offset is unchanged.');
    starting = true;
    const revision = ++startRevision;
    try {
      await enable();
      if (revision !== startRevision) return;
      const at = clock.start('drums');
      firstBeat = clock.beatAt(at);
      nextBeat = firstBeat;
      playing = true;
      playButton.setAttribute('aria-pressed', 'true');
      status.textContent = 'Drums playing. Looper playback follows the shared tempo and bar grid.';
      if (store.linked) onStartLooper(at, looperMode);
      tick();
    } catch (error) {
      fail(`Could not start drums: ${error.message || error}`);
    } finally {
      if (revision === startRevision) starting = false;
    }
  }

  function renderStep(button, lane, index) {
    const level = lane.steps[index];
    button.dataset.level = String(level);
    button.setAttribute('aria-pressed', String(level > 0));
    const voice = DRUM_VOICES.find((item) => item.id === lane.voice);
    const label = `${voice.name}, step ${index + 1}: ${level ? `level ${level}/5, MIDI velocity ${velocityFor(level)}` : 'off'}`;
    button.title = `${label}. Click to change; right-click or Delete to clear.`;
    button.setAttribute('aria-label', label);
    button.textContent = level || '';
    button.hidden = index >= clock.meter * 4;
  }

  function edited() {
    persist();
    for (const voice of DRUM_VOICES) {
      const lane = pattern().lanes.find((item) => item.voice === voice.id) || defaultDrumLane(voice);
      if (!audible(lane)) audio.silenceVoice(voice.id);
    }
    invalidate();
  }

  function render() {
    patternSelect.replaceChildren(...store.patterns.map((item) => new Option(item.name, item.id)));
    patternSelect.value = store.selected;
    lanesElement.replaceChildren();
    for (const lane of pattern().lanes) {
      const voice = DRUM_VOICES.find((item) => item.id === lane.voice);
      const row = document.createElement('section');
      row.className = 'drum-lane';
      row.dataset.voice = lane.voice;
      row.setAttribute('aria-label', `${voice.name} lane`);
      const header = document.createElement('div');
      header.className = 'drum-lane-header';
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.textContent = voice.name;
      preview.title = `Preview ${voice.name} (MIDI ${voice.note})`;
      preview.addEventListener('click', async () => {
        try {
          await enable();
          if (audible(lane)) audio.trigger(lane, 127);
        } catch (error) {
          fail(`Drum preview failed: ${error.message || error}`);
        }
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.innerHTML = trashIcon;
      remove.className = 'drum-lane-icon';
      remove.setAttribute('aria-label', `Remove ${voice.name} lane`);
      remove.title = `Remove ${voice.name} lane`;
      remove.addEventListener('click', () => {
        pattern().lanes.splice(pattern().lanes.indexOf(lane), 1);
        render();
        edited();
      });
      header.append(preview);
      for (const [key, text, label] of [['solo', 'S', 'Solo'], ['muted', 'M', 'Mute']]) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'drum-lane-icon';
        toggle.dataset.toggle = key;
        toggle.textContent = text;
        toggle.setAttribute('aria-label', `${label} ${voice.name}`);
        toggle.title = `${label} ${voice.name}`;
        toggle.addEventListener('click', () => {
          lane[key] = !lane[key];
          updateLaneStates();
          edited();
        });
        header.append(toggle);
      }
      header.append(remove);
      const steps = document.createElement('div');
      steps.className = 'drum-steps';
      for (let index = 0; index < 16; index++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'drum-step';
        button.dataset.step = String(index);
        const clear = () => {
          lane.steps[index] = 0;
          directions.delete(`${lane.voice}:${index}`);
          renderStep(button, lane, index);
          edited();
        };
        button.addEventListener('click', () => {
          const key = `${lane.voice}:${index}`;
          const level = lane.steps[index];
          const direction = level === 5 || !level ? -1 : level === 1 ? 1 : directions.get(key) || -1;
          lane.steps[index] = level ? level + direction : 5;
          directions.set(key, direction);
          renderStep(button, lane, index);
          edited();
        });
        button.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          clear();
        });
        button.addEventListener('keydown', (event) => {
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            clear();
          }
        });
        renderStep(button, lane, index);
        steps.append(button);
      }
      const controls = document.createElement('div');
      controls.className = 'drum-voice-controls';
      controls.hidden = !showToneControls;
      for (const [key, name, min, max, step] of [
        ['level', 'Level', 0, 100, 1], ['tuning', 'Tune', -24, 24, 1],
        ['decay', 'Decay', 0.02, 2, 0.005], ['tone', 'Tone', 0, 100, 1],
      ]) {
        const label = document.createElement('label');
        label.append(`${name} `);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(lane[key]);
        input.setAttribute('aria-label', `${voice.name} ${name.toLowerCase()}`);
        const readout = document.createElement('output');
        const update = () => {
          readout.textContent = key === 'decay' ? `${Math.round(lane[key] * 1000)} ms`
            : key === 'tuning' ? `${lane[key]} st` : `${lane[key]}%`;
          input.title = `${voice.name} ${name}: ${readout.textContent}`;
        };
        input.addEventListener('input', () => {
          lane[key] = Number(input.value);
          update();
          edited();
        });
        update();
        label.append(input, readout);
        controls.append(label);
      }
      row.append(header, steps, controls);
      lanesElement.append(row);
    }
    const missing = DRUM_VOICES.filter((voice) => !pattern().lanes.some((lane) => lane.voice === voice.id));
    instrumentSelect.replaceChildren(...missing.map((voice) => new Option(voice.name, voice.id)));
    instrumentSelect.disabled = !missing.length;
    element('add').disabled = !missing.length;
    element('meter').value = String(clock.meter);
    element('tempo').value = String(clock.tempo);
    renderPlayhead();
    updateLaneStates();
  }

  function patternName(defaultName) {
    const entered = window.prompt('Drum pattern name:', defaultName);
    if (entered === null) return null;
    const name = entered.trim();
    if (!name) {
      status.textContent = 'Enter a drum pattern name.';
      return null;
    }
    if (store.patterns.some((item) => item.name.toLowerCase() === name.toLowerCase() && item.id !== store.selected)) {
      status.textContent = 'A drum pattern with that name already exists.';
      return null;
    }
    return name;
  }

  patternSelect.addEventListener('change', () => {
    store.selected = patternSelect.value;
    directions.clear();
    render();
    edited();
  });
  for (const [id, duplicate] of [['new', false], ['copy', true]]) {
    element(id).addEventListener('click', () => {
      const name = patternName(duplicate ? `${pattern().name} copy` : `Pattern ${store.patterns.length + 1}`);
      if (!name) return;
      if (store.patterns.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
        status.textContent = 'A drum pattern with that name already exists.';
        return;
      }
      const next = { id: crypto.randomUUID(), name,
        lanes: duplicate ? copy(pattern().lanes) : initialLanes() };
      store.patterns.push(next);
      store.selected = next.id;
      directions.clear();
      render();
      edited();
    });
  }
  element('rename').addEventListener('click', () => {
    const name = patternName(pattern().name);
    if (!name) return;
    pattern().name = name;
    render();
    persist();
  });
  element('delete').addEventListener('click', () => {
    if (!window.confirm(`Delete drum pattern "${pattern().name}"?`)) return;
    store.patterns.splice(store.patterns.indexOf(pattern()), 1);
    if (!store.patterns.length) {
      store.patterns.push({ id: crypto.randomUUID(), name: 'Pattern 1', lanes: initialLanes() });
    }
    store.selected = store.patterns[0].id;
    directions.clear();
    render();
    edited();
  });
  element('add').addEventListener('click', () => {
    const voice = DRUM_VOICES.find((item) => item.id === instrumentSelect.value);
    if (!voice) return;
    pattern().lanes.push(defaultDrumLane(voice));
    render();
    edited();
  });
  element('enable').addEventListener('click', async () => {
    try {
      await enable();
      status.textContent = 'Drum audio ready. Channel-10 MIDI and instrument previews are available.';
    } catch (error) {
      fail(`Could not enable drum audio: ${error.message || error}`);
    }
  });
  playButton.addEventListener('click', () => { void start(); });
  element('stop').addEventListener('click', stopTogether);
  element('linked').addEventListener('change', () => { store.linked = element('linked').checked; persist(); });
  function changeTempo() {
    const value = Number(element('tempo').value);
    if (!Number.isInteger(value) || value < 40 || value > 240) {
      element('tempo').value = String(clock.tempo);
      status.textContent = 'Tempo must be a whole number from 40 to 240 BPM.';
      return;
    }
    onTempo(value);
  }
  function changeVolume() {
    store.volume = Number(element('volume').value);
    audio.setVolume(store.volume);
    persist();
  }
  function bindWheel(input, update) {
    input.addEventListener('wheel', (event) => {
      if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      input.stepUp(-Math.sign(event.deltaY) * (event.altKey ? 10 : 1));
      update();
    }, { passive: false });
  }
  element('tempo').addEventListener('change', changeTempo);
  element('volume').addEventListener('input', changeVolume);
  bindWheel(element('tempo'), changeTempo);
  bindWheel(element('volume'), changeVolume);
  element('meter').addEventListener('change', () => {
    const meter = Number(element('meter').value);
    if (meter !== 3 && meter !== 4) {
      element('meter').value = String(clock.meter);
      status.textContent = 'Choose a 3/4 or 4/4 time signature.';
      return;
    }
    clock.setMeter(meter);
  });
  element('tone-toggle').addEventListener('click', () => {
    showToneControls = !showToneControls;
    element('tone-toggle').setAttribute('aria-pressed', String(showToneControls));
    element('tone-toggle').textContent = showToneControls ? 'Hide tone controls' : 'Show tone controls';
    for (const controls of lanesElement.querySelectorAll('.drum-voice-controls')) controls.hidden = !showToneControls;
  });
  document.addEventListener('keydown', (event) => {
    if ((event.code !== 'Space' && event.key !== ' ') || event.defaultPrevented
      || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey
      || !(event.target instanceof Element) || event.target.isContentEditable
      || document.querySelector('dialog[open]')
      || event.target.closest('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"]')) return;
    if (event.target.closest('button, summary, a[href], [role="button"]') && !event.target.closest('#groove-panel')) return;
    event.preventDefault();
    if (playing || starting) stopTogether();
    else void start();
  });
  element('offset').addEventListener('change', () => {
    const value = Number(element('offset').value);
    if (!Number.isInteger(value) || Math.abs(value) > maxOffset) {
      element('offset').value = String(store.offset);
      status.textContent = `Looper MIDI offset must be a whole number from -${maxOffset} to ${maxOffset} ms.`;
      return;
    }
    applyOffset(value);
  });

  function applyOffset(value) {
    store.offset = value;
    element('offset').value = String(value);
    clock.setOffset(value);
    persist();
  }

  function closeCalibration(message, keepOpen = false) {
    const wasCalibrating = Boolean(calibration);
    calibrationRevision++;
    clearTimeout(calibrationTimer);
    calibration = undefined;
    calibrationDone.disabled = true;
    if (calibrationDialog.open && !keepOpen) calibrationDialog.close();
    if (wasCalibrating) audio.stop();
    if (message) status.textContent = message;
  }

  function calibrationError(message) {
    closeCalibration(message, true);
    calibrationStatus.textContent = message;
    calibrationDelay.textContent = 'Unavailable';
    if (!calibrationDialog.open) calibrationDialog.showModal();
  }

  function calibrationTick() {
    if (!calibration) return;
    if (!clock.enabled || getRefaceInput() !== calibration.input) {
      calibrationError('MIDI offset calibration stopped: audio or the selected reface MIDI input is unavailable. Reconnect and try again; the offset is unchanged.');
      return;
    }
    try {
      const now = performance.now();
      const earliest = now + ((audio.context.baseLatency || 0) + (audio.context.outputLatency || 0)) * 1000 + 5;
      if (calibration.next < earliest) {
        calibration.next = calibration.origin + Math.ceil((earliest - calibration.origin) / 600) * 600;
      }
      while (calibration.next <= now + clock.lead + 1e-8) {
        audio.trigger(defaultDrumLane(DRUM_VOICES[0]), 100, calibration.next, true);
        calibration.kicks.push(calibration.next);
        calibration.next += 600;
      }
      calibration.kicks = calibration.kicks.filter((at) => at >= now - 1200);
      calibrationTimer = setTimeout(calibrationTick, 20);
    } catch (error) {
      calibrationError(`MIDI offset calibration failed: ${error.message || error}. The offset is unchanged.`);
    }
  }

  async function startCalibration() {
    if (calibrationDialog.open) return;
    const input = getRefaceInput();
    if (!input) {
      calibrationError('Close this dialog, click Connect MIDI, select an available reface input, then retry calibration. The offset is unchanged.');
      return;
    }
    stop();
    onStopLooper();
    const revision = ++calibrationRevision;
    calibration = { input, kicks: [], latest: null, origin: 0, next: 0 };
    calibrationStatus.textContent = 'Starting the 100 BPM kick...';
    calibrationDelay.textContent = 'No note received';
    calibrationDone.disabled = true;
    calibrationDialog.showModal();
    try {
      await enable();
      if (revision !== calibrationRevision) return;
      calibration.origin = performance.now() + clock.lead;
      calibration.next = calibration.origin;
      calibrationStatus.textContent = 'Play notes on the reface in time with the kick. Each Note On replaces the previous delay.';
      status.textContent = '100 BPM MIDI offset test running. Normal drum and looper playback are stopped.';
      calibrationTick();
    } catch (error) {
      if (revision === calibrationRevision) {
        calibrationError(`Could not start MIDI offset calibration: ${error.message || error}. The offset is unchanged.`);
      }
    }
  }

  function captureCalibrationNote(at, input) {
    if (!calibration) return false;
    if (input !== calibration.input) return true;
    const kick = calibration.kicks.findLast((time) => time <= at);
    const delay = Math.round(at - kick);
    if (kick === undefined || !Number.isFinite(delay) || delay < 0 || delay > maxOffset) {
      calibration.latest = null;
      calibrationDone.disabled = true;
      calibrationDelay.textContent = 'No recent kick';
      calibrationStatus.textContent = 'Wait for the next kick, then play a note to measure its delay.';
      return true;
    }
    calibration.latest = delay;
    calibrationDelay.textContent = `${delay} ms`;
    calibrationDone.disabled = false;
    calibrationStatus.textContent = `Latest delay: ${delay} ms. Done will set the looper MIDI offset to +${delay} ms.`;
    return true;
  }

  element('calibrate').addEventListener('click', () => { void startCalibration(); });
  calibrationDone.addEventListener('click', () => {
    if (calibration?.latest === null || !calibration) {
      calibrationStatus.textContent = 'Play a note after a test kick before applying an offset.';
      return;
    }
    const delay = calibration.latest;
    closeCalibration();
    applyOffset(delay);
    status.textContent = `Looper MIDI offset set to +${delay} ms from the latest received Note On.`;
  });
  const cancelCalibration = () => closeCalibration('MIDI offset test cancelled; the offset is unchanged.');
  element('calibration-cancel').addEventListener('click', cancelCalibration);
  calibrationDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancelCalibration();
  });
  calibrationDialog.addEventListener('close', () => {
    if (calibration) cancelCalibration();
  });

  async function refreshOutputs() {
    const revision = ++devicesRevision;
    if (!navigator.mediaDevices?.enumerateDevices) {
      outputStatus.textContent = 'Audio-device discovery is unavailable; using the system output.';
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (revision !== devicesRevision) return;
      const selected = audio.context?.sinkId || '';
      outputSelect.replaceChildren(new Option('System default', ''));
      for (const device of devices.filter((item) => item.kind === 'audiooutput' && item.deviceId !== 'default' && item.deviceId)) {
        outputSelect.add(new Option(device.label || `Audio output ${outputSelect.options.length}`, device.deviceId));
      }
      if (selected && ![...outputSelect.options].some((option) => option.value === selected)) {
        outputSelect.add(new Option('Selected audio output (not listed)', selected));
        outputStatus.textContent = 'The selected output is not listed. Check its connection or select another output.';
      }
      outputSelect.value = selected;
    } catch (error) {
      outputStatus.textContent = `Could not list audio outputs: ${error.message || error}`;
    }
  }

  async function selectOutput(deviceId) {
    try {
      await enable();
      await audio.setOutput(deviceId);
      await refreshOutputs();
      outputStatus.textContent = `Drum audio output: ${outputSelect.selectedOptions[0]?.textContent || deviceId || 'System default'}. No direct ASIO.`;
    } catch (error) {
      outputSelect.value = audio.context?.sinkId || '';
      outputStatus.textContent = `Could not select audio output: ${error.message || error}`;
    }
  }
  outputSelect.disabled = true;
  outputChoose.disabled = !navigator.mediaDevices?.selectAudioOutput;
  outputRefresh.disabled = !navigator.mediaDevices?.enumerateDevices;
  outputSelect.addEventListener('change', () => { void selectOutput(outputSelect.value); });
  outputRefresh.addEventListener('click', () => { void refreshOutputs(); });
  outputChoose.addEventListener('click', async () => {
    try {
      const device = await navigator.mediaDevices.selectAudioOutput();
      await selectOutput(device.deviceId);
    } catch (error) {
      outputStatus.textContent = `Audio output selection was not completed: ${error.message || error}`;
    }
  });
  navigator.mediaDevices?.addEventListener('devicechange', () => { void refreshOutputs(); });
  clock.subscribe((reason) => {
    if (reason === 'suspended') {
      if (calibration) calibrationError('MIDI offset calibration stopped: audio was suspended. Enable audio and try again; the offset is unchanged.');
      else stop();
      return;
    }
    if (reason === 'meter') render();
    if (reason === 'tempo') element('tempo').value = String(clock.tempo);
    if (reason === 'tempo' || reason === 'meter' || reason === 'output') invalidate();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (playing || starting || calibration)) { stop(); status.textContent = 'Drums stopped because the page was hidden.'; }
  });
  window.addEventListener('pagehide', stop);
  render();

  return {
    startFromLooper(mode) {
      if (mode !== 2 && mode !== 3) return false;
      if (calibration) return true;
      if (!store.linked || playing) return false;
      void start(mode);
      return true;
    },
    cancelPendingStart() {
      if (store.linked && !playing) {
        startRevision++;
        starting = false;
      }
    },
    captureCalibrationNote,
    stopFromLooper() {
      if (store.linked) {
        stop();
        status.textContent = 'Drums stopped with looper.';
      }
    },
    stop,
    triggerMidi(note, velocity) {
      if (calibration) return;
      const alias = { 35: 36, 40: 38, 44: 42, 41: 45, 43: 45, 48: 50, 69: 70 };
      const voice = DRUM_VOICES.find((item) => item.note === (alias[note] ?? note));
      if (!voice) { status.textContent = `No internal drum is mapped to MIDI note ${note}.`; return; }
      const lane = pattern().lanes.find((item) => item.voice === voice.id) || defaultDrumLane(voice);
      if (!audible(lane)) return;
      try {
        audio.trigger(lane, velocity);
      } catch (error) {
        status.textContent = `MIDI drum could not play: ${error.message || error}`;
      }
    },
  };
}
