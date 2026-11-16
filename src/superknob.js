export const SUPERKNOB_TARGETS = [
  ['expression', 'Expression', 127],
  ['pitch-bend', 'Pitch bend', 127],
  ['lfo-assign', 'LFO assign', 4],
  ['lfo-depth', 'LFO depth', 127],
  ['lfo-speed', 'LFO speed', 127],
  ['osc-texture', 'Texture', 127],
  ['osc-mod', 'Modulation', 127],
  ['filter-cutoff', 'Cutoff', 127],
  ['filter-resonance', 'Resonance', 127],
  ['eg-balance', 'EG balance', 127],
  ['eg-attack', 'EG attack', 127],
  ['eg-decay', 'EG decay', 127],
  ['eg-sustain', 'EG sustain', 127],
  ['eg-release', 'EG release', 127],
  ['effect-type', 'Effect type', 4],
  ['effect-depth', 'Effect depth', 127],
  ['effect-rate', 'Effect rate', 127],
].map(([id, label, max]) => ({ id, label, max }));

export function defaultSuperKnob() {
  return {
    mappings: [{ target: 'filter-cutoff', enabled: true, values: Array.from({ length: 128 }, (_, i) => i) }],
    recordSeconds: 5,
    cycle: { mode: 'seconds', seconds: 5, beats: 4 },
  };
}

export function validateSuperKnob(source) {
  const invalid = (message) => { throw new Error(`Invalid SuperKnob definition: ${message}.`); };
  if (!source || typeof source !== 'object' || !Array.isArray(source.mappings)
    || source.mappings.length > SUPERKNOB_TARGETS.length) invalid('mappings');
  const seen = new Set();
  const mappings = source.mappings.map((mapping) => {
    if (!mapping || !SUPERKNOB_TARGETS.some(({ id }) => id === mapping.target)
      || seen.has(mapping.target) || typeof mapping.enabled !== 'boolean'
      || !Array.isArray(mapping.values) || mapping.values.length !== 128
      || !mapping.values.every((value) => Number.isInteger(value) && value >= 0 && value <= 127)) {
      invalid('parameter mapping');
    }
    seen.add(mapping.target);
    return { target: mapping.target, enabled: mapping.enabled, values: [...mapping.values] };
  });
  const cycle = source.cycle;
  const recordSeconds = source.recordSeconds === undefined ? 5 : source.recordSeconds;
  if (!Number.isFinite(recordSeconds) || recordSeconds < 0.1 || recordSeconds > 120) invalid('recording duration');
  if (!cycle || !['seconds', 'sync'].includes(cycle.mode)
    || !Number.isFinite(cycle.seconds) || cycle.seconds < 0.1 || cycle.seconds > 120
    || ![0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32].includes(cycle.beats)) invalid('cycle timing');
  return { mappings, recordSeconds, cycle: { mode: cycle.mode, seconds: cycle.seconds, beats: cycle.beats } };
}

export function isDefaultSuperKnob(definition) {
  const [mapping] = definition.mappings;
  return definition.mappings.length === 1 && mapping.target === 'filter-cutoff'
    && mapping.enabled && mapping.values.every((value, i) => value === i);
}

export function mappingValue(mapping, position) {
  const x = Math.max(0, Math.min(127, position));
  const index = Math.floor(x);
  return mapping.values[index] + (mapping.values[Math.min(127, index + 1)] - mapping.values[index]) * (x - index);
}

export function drawMapping(values, from, to) {
  const start = Math.max(0, Math.min(127, Math.round(from.x)));
  const end = Math.max(0, Math.min(127, Math.round(to.x)));
  for (let x = Math.min(start, end); x <= Math.max(start, end); x++) {
    const fraction = start === end ? 1 : (x - start) / (end - start);
    values[x] = Math.max(0, Math.min(127, Math.round(from.y + (to.y - from.y) * fraction)));
  }
}

export function createSuperKnobEngine({ apply, getValue, clock, onChange = () => {}, onFrame = () => {} }) {
  let definition = defaultSuperKnob();
  let position = 127;
  let cycling = false;
  let cycleTime = 0;
  let cycleBeat = 0;
  let capture = null;
  let frame = null;
  let lastFrame = -Infinity;

  function applyMappings(channel = 0) {
    for (const mapping of definition.mappings) {
      if (!mapping.enabled || capture?.target === mapping.target) continue;
      const { max } = SUPERKNOB_TARGETS.find(({ id }) => id === mapping.target);
      const value = Math.round(mappingValue(mapping, position) * max / 127);
      if (value !== getValue(mapping.target)) apply(mapping.target, value, channel);
    }
  }

  function show() { onFrame(); }

  function cancelFrame() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function schedule() {
    if (frame === null && (cycling || (capture && capture.started !== null))) {
      frame = requestAnimationFrame(tick);
    }
  }

  function capturedValues(time) {
    const points = [...capture.points];
    points.push({ x: Math.min(127, (time - capture.started) * 127 / capture.duration), y: capture.value });
    const values = Array(128).fill(points[0].y);
    for (let i = 1; i < points.length; i++) drawMapping(values, points[i - 1], points[i]);
    values.fill(Math.round(capture.value), Math.round(points.at(-1).x));
    return values;
  }

  function tick(time) {
    frame = null;
    if (time - lastFrame < 1000 / 30) { schedule(); return; }
    lastFrame = time;
    if (capture && capture.started !== null) {
      position = Math.min(127, (time - capture.started) * 127 / capture.duration);
      applyMappings();
      if (time - capture.started >= capture.duration) {
        const mapping = definition.mappings.find(({ target }) => target === capture.target);
        mapping.values = capturedValues(capture.started + capture.duration);
        capture = null;
        onChange('recorded');
      }
    } else if (cycling) {
      const phase = definition.cycle.mode === 'sync'
        ? (clock.beatAt(time) - cycleBeat) / definition.cycle.beats
        : (time - cycleTime) / (definition.cycle.seconds * 1000);
      const leg = ((phase % 2) + 2) % 2;
      position = (leg <= 1 ? leg : 2 - leg) * 127;
      applyMappings();
    }
    show();
    schedule();
  }

  function stopCycle() {
    cycling = false;
    if (!capture) cancelFrame();
    show();
  }

  function cancelRecording() {
    capture = null;
    if (!cycling) cancelFrame();
    show();
  }

  return {
    get definition() { return validateSuperKnob(definition); },
    get position() { return position; },
    get cycling() { return cycling; },
    get recording() {
      return capture ? { target: capture.target, started: capture.started, value: capture.value } : null;
    },
    get previewValues() {
      return capture && capture.started !== null ? capturedValues(performance.now()) : null;
    },
    load(source, value = position) {
      const next = validateSuperKnob(source);
      cycling = false;
      capture = null;
      cancelFrame();
      definition = next;
      position = Math.max(0, Math.min(127, value));
      onChange('loaded');
      show();
    },
    edit(source) {
      const next = validateSuperKnob(source);
      const mappingsChanged = JSON.stringify(next.mappings) !== JSON.stringify(definition.mappings);
      definition = next;
      if (mappingsChanged) applyMappings();
      onChange('edited');
      show();
    },
    setPosition(value, channel = 0) {
      if (!Number.isFinite(value)) throw new Error('SuperKnob position must be a number.');
      stopCycle();
      cancelRecording();
      position = Math.max(0, Math.min(127, Math.round(value)));
      applyMappings(channel);
      show();
    },
    startCycle() {
      cancelRecording();
      cycling = true;
      cycleTime = performance.now() - position / 127 * definition.cycle.seconds * 1000;
      cycleBeat = clock.beatAt() - position / 127 * definition.cycle.beats;
      show();
      schedule();
    },
    stopCycle,
    armRecording(target) {
      if (!definition.mappings.some((mapping) => mapping.target === target)) {
        throw new Error('Assign the selected parameter before recording.');
      }
      stopCycle();
      cancelRecording();
      const { max } = SUPERKNOB_TARGETS.find(({ id }) => id === target);
      capture = { target, started: null, duration: definition.recordSeconds * 1000,
        value: getValue(target) * 127 / max, points: [] };
      show();
    },
    observeFader(target, value) {
      if (!capture || target !== capture.target) return;
      const now = performance.now();
      const { max } = SUPERKNOB_TARGETS.find(({ id }) => id === target);
      const normalized = value * 127 / max;
      if (capture.started === null) {
        if (normalized === capture.value) return;
        capture.started = now;
        capture.points = [{ x: 0, y: normalized }];
        position = 0;
      } else if (now - capture.started >= capture.duration) {
        cancelFrame();
        tick(now);
        return;
      }
      capture.value = normalized;
      capture.points.push({ x: (now - capture.started) * 127 / capture.duration, y: normalized });
      show();
      schedule();
    },
    cancelRecording,
    stop() {
      stopCycle();
      cancelRecording();
    },
  };
}

export function createSuperKnobAudition({ clock, startNote, endNote, onStop }) {
  let running = false;
  let sounding = false;
  let timer = null;
  let nextBeat = 0;
  let gateBeat = 0;
  let index = 0;
  let beat = 0;
  let lastTime = 0;
  let tempo = clock.tempo;
  const notes = [60, 64, 67];

  function stop() {
    running = false;
    clearTimeout(timer);
    timer = null;
    if (sounding) endNote();
    sounding = false;
    onStop();
  }

  function tick() {
    if (!running) return;
    const now = performance.now();
    // Keep audition phase independent of transport restarts on the shared clock.
    beat += (now - lastTime) * tempo / 60000;
    lastTime = now;
    tempo = clock.tempo;
    if (sounding && beat >= gateBeat) {
      sounding = false;
      if (!endNote()) { stop(); return; }
    }
    if (beat >= nextBeat) {
      if (!startNote(notes[index])) { stop(); return; }
      sounding = true;
      index = (index + 1) % notes.length;
      if (beat - nextBeat >= 0.5) nextBeat = beat;
      gateBeat = nextBeat + 0.25;
      nextBeat += 0.5;
    }
    const due = sounding ? Math.min(gateBeat, nextBeat) : nextBeat;
    timer = setTimeout(tick, Math.max(1, Math.min(25, (due - beat) * 60000 / tempo)));
  }

  clock.subscribe((reason) => {
    if (reason !== 'tempo' || !running) return;
    clearTimeout(timer);
    tick();
  });

  return {
    start() {
      stop();
      running = true;
      index = 0;
      nextBeat = beat = 0;
      lastTime = performance.now();
      tempo = clock.tempo;
      tick();
      return running;
    },
    stop,
  };
}
