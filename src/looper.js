import { createReporter } from './notifications.js';
import { tempoRange } from './synth-midi.js';
import { readMidi, writeMidi } from './midi-file.js';
import { askName, choose, confirmAction, exportDialog } from './dialogs.js';
import { equalValue, resolveImport } from './import-conflicts.js';

const maxNotes = 2000;
const maxBeats = 1200;
const minimumLength = 0.25;
const epsilon = 1e-7;

function openLoopStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('refaceCS-loops', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('loops', { keyPath: 'id' });
    request.onerror = () => reject(request.error || new Error('Could not open loop storage'));
    request.onblocked = () => reject(new Error('Loop storage is blocked by another tab'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function loopStoreRequest(mode, operation) {
  const db = await openLoopStore();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('loops', mode);
      const request = operation(transaction.objectStore('loops'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error || request.error || new Error('Loop storage failed'));
    });
  } finally {
    db.close();
  }
}

export function validateSavedLoops(records) {
  if (!Array.isArray(records)) throw new Error('Invalid loop list');
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || !record.id
      || typeof record.name !== 'string' || !record.name.trim() || ids.has(record.id)) {
      throw new Error('Invalid saved loop metadata');
    }
    ids.add(record.id);
    validateSavedLoop(record.loop);
  }
}

function validateSavedLoop(loop) {
  if (!loop || !Number.isFinite(loop.length) || loop.length <= 0 || loop.length > maxBeats
    || ![3, 4].includes(loop.meter) || !Number.isInteger(loop.tempo)
    || loop.tempo < tempoRange.min || loop.tempo > tempoRange.max
    || !Array.isArray(loop.notes) || !loop.notes.length || loop.notes.length > maxNotes
    || !loop.notes.every((note) => Number.isFinite(note.start) && note.start >= 0 && note.start < loop.length
      && Number.isFinite(note.duration) && note.duration > 0 && note.duration <= loop.length
      && Number.isInteger(note.channel) && note.channel >= 0 && note.channel <= 15
      && Number.isInteger(note.pitch) && note.pitch >= 0 && note.pitch <= 127
      && Number.isInteger(note.velocity) && note.velocity >= 1 && note.velocity <= 127)) {
    throw new Error('Saved loop data is invalid');
  }
  return loop;
}

function comparableLoop(loop) {
  return {
    length: loop.length, meter: loop.meter, tempo: loop.tempo,
    notes: loop.notes.map(({ start, duration, channel, pitch, velocity }) =>
      ({ start, duration, channel, pitch, velocity }))
      .sort((a, b) => a.start - b.start || a.channel - b.channel || a.pitch - b.pitch),
  };
}

async function equalLoopRecords(a, b) {
  return equalValue({ ...a, loop: comparableLoop(a.loop) }, { ...b, loop: comparableLoop(b.loop) });
}

export function createLooper(sendNote, onModeChange, onFileTempo, playback = {}) {
  const clock = playback.clock;
  const status = createReporter('looper', 'looper-status');
  const recordLed = document.querySelector('#looper .selection-led[data-value="3"]');
  const playLed = document.querySelector('#looper .selection-led[data-value="2"]');
  const meterButton = document.querySelector('#looper-meter');
  const barsValue = document.querySelector('#looper-bars-value');
  const barsDown = document.querySelector('#looper-bars-down');
  const barsUp = document.querySelector('#looper-bars-up');
  const quantizeButton = document.querySelector('#looper-quantize');
  const singleDigitWidth = barsValue.getComputedTextLength();
  const menuLayer = document.querySelector('#looper-menu-layer');
  const fileInput = document.querySelector('#looper-file');
  const transfer = document.querySelector('#looper-transfer');
  const library = document.querySelector('#looper-library');
  const librarySelect = document.querySelector('#looper-library-select');
  const libraryStatus = createReporter('looper', 'looper-library-status');
  const notes = [];
  const scheduledNotes = [];
  const pending = new Map();
  const sounding = new Map();
  const settings = { meter: 4, bars: 0, quantize: 0 };
  let activeSettings;
  let mode = 0;
  let tempo = tempoRange.default;
  let length = 0;
  let beat = 0;
  let guideBeat = 0;
  let lastTime = performance.now();
  let nextId = 0;
  let firstRecording = false;
  let guideEnabled = true;
  let guideSounding = false;
  let guideOffTimer;
  let timer;
  let muted = false;
  let loadRevision = 0;
  let savedLoop = null;
  let savedLoopName = 'reface-loop';
  let syncActive = false;
  let syncOrigin = 0;
  let syncStart = 0;
  let syncFirstBeat = 0;
  let syncClockBeat = 0;
  let scheduledBeat = 0;
  let restoreScheduled = false;
  let scheduleInvalidated = false;
  let refreshPending = false;

  function updateControls() {
    meterButton.querySelector('text').textContent = `${settings.meter}/4`;
    meterButton.setAttribute('aria-label', `Time signature: ${settings.meter}/4`);
    const target = activeSettings?.bars * activeSettings?.meter;
    const remaining = mode === 3 && target
      ? Math.ceil((target - (beat % target) - epsilon) / activeSettings.meter) : null;
    const displayedBars = String(remaining ?? settings.bars);
    if (barsValue.textContent !== displayedBars) {
      barsValue.textContent = displayedBars;
      const expansion = Math.max(0, (barsValue.getComputedTextLength() - singleDigitWidth) / 2);
      for (const element of [meterButton, barsDown]) element.setAttribute('transform', `translate(${-expansion} 0)`);
      for (const element of [barsUp, quantizeButton]) element.setAttribute('transform', `translate(${expansion} 0)`);
    }
    barsValue.setAttribute('aria-label', remaining === null
      ? `Loop length: ${settings.bars} bars` : `${remaining} bars remaining; next loop length: ${settings.bars} bars`);
    barsDown.setAttribute('aria-disabled', String(settings.bars === 0));
    barsUp.setAttribute('aria-disabled', String(settings.bars >= maxBeats / settings.meter));
    quantizeButton.querySelector('text').textContent = String(settings.quantize);
    quantizeButton.setAttribute('aria-label', `Note quantization: ${settings.quantize || 'off'}`);
  }

  function settingsChanged() {
    clock?.setMeter(settings.meter);
    updateControls();
    status(activeSettings
      ? 'Looper settings will apply to the next new recording.' : 'Looper recording settings updated.');
  }

  function bindButton(button, action) {
    button.addEventListener('click', action);
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (!event.repeat) action();
    });
  }

  function setMeter(value) {
    if (settings.meter === value) return;
    settings.meter = value;
    settings.bars = Math.min(settings.bars, maxBeats / settings.meter);
    settingsChanged();
  }
  bindButton(meterButton, () => setMeter(settings.meter === 4 ? 3 : 4));
  for (const [button, step] of [[barsDown, -1], [barsUp, 1]]) {
    bindButton(button, () => {
      settings.bars = Math.max(0, Math.min(maxBeats / settings.meter, settings.bars + step));
      settingsChanged();
    });
  }

  const divisions = [0, 1, 2, 4, 8, 16, 32];
  function closeMenu(focus = false) {
    if (!menuLayer.hasChildNodes()) return;
    menuLayer.replaceChildren();
    quantizeButton.setAttribute('aria-expanded', 'false');
    if (focus) quantizeButton.focus();
  }
  function selectDivision(value) {
    settings.quantize = value;
    settingsChanged();
  }
  bindButton(quantizeButton, () => {
    closeMenu();
    selectDivision(divisions[(divisions.indexOf(settings.quantize) + 1) % divisions.length]);
  });
  function openMenu() {
    closeMenu();
    quantizeButton.setAttribute('aria-expanded', 'true');
    const ns = 'http://www.w3.org/2000/svg';
    const menu = document.createElementNS(ns, 'g');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Note quantization');
    menu.setAttribute('transform', 'translate(505 232)');
    const background = document.createElementNS(ns, 'rect');
    background.setAttribute('class', 'arp-menu-background');
    background.setAttribute('width', '72');
    background.setAttribute('height', String(divisions.length * 22 + 6));
    background.setAttribute('rx', '4');
    menu.append(background);
    const items = divisions.map((value, index) => {
      const item = document.createElementNS(ns, 'g');
      item.setAttribute('class', 'arp-menu-item');
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(value === settings.quantize));
      item.setAttribute('tabindex', '-1');
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', '3');
      rect.setAttribute('y', String(3 + index * 22));
      rect.setAttribute('width', '66');
      rect.setAttribute('height', '22');
      rect.setAttribute('rx', '2');
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', '10');
      label.setAttribute('y', String(19 + index * 22));
      label.textContent = value ? `1/${value}` : 'Off';
      item.append(rect, label);
      bindButton(item, () => {
        selectDivision(value);
        closeMenu(true);
      });
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMenu(true);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        }
      });
      menu.append(item);
      return item;
    });
    menuLayer.append(menu);
    items[divisions.indexOf(settings.quantize)].focus();
  }
  quantizeButton.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openMenu();
  });
  quantizeButton.addEventListener('keydown', (event) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10') || event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menuLayer.contains(event.target) && !quantizeButton.contains(event.target)) closeMenu();
  });
  window.addEventListener('blur', () => closeMenu());
  updateControls();

  function setLeds() {
    const activeBeat = mode === 3 && !firstRecording && !length ? guideBeat : beat;
    const flash = activeBeat - Math.floor(activeBeat) < 0.2;
    recordLed.classList.toggle('is-on', mode === 3 && (firstRecording || length > 0 || flash));
    playLed.classList.toggle('is-on', (firstRecording || (length > 0 && (mode === 2 || mode === 3))) && flash);
    updateControls();
  }

  function stopGuide() {
    clearTimeout(guideOffTimer);
    guideOffTimer = undefined;
    if (guideSounding) sendNote([0x80, 96, 0], 'looper-guide');
    guideSounding = false;
  }

  function guideTick() {
    if (!guideEnabled || muted) return;
    stopGuide();
    if (!sendNote([0x90, 96, 60], 'looper-guide')) {
      guideEnabled = false;
      status('Looper armed; guide sound unavailable. Check the MIDI output.');
      return;
    }
    guideSounding = true;
    guideOffTimer = setTimeout(stopGuide, 50);
  }

  function releasePlayback() {
    invalidateSchedule();
    for (const [id, note] of sounding) sendNote([0x80 | note.channel, note.pitch, 0], `looper:${id}`);
    sounding.clear();
  }

  function midiTime(atBeat) {
    return Math.max(performance.now(), syncOrigin + atBeat * 60000 / tempo + clock.offset);
  }

  function emitPlayback(message, owner, at) {
    return at === undefined ? sendNote(message, owner) : playback.sendScheduled(message, owner, at);
  }

  function playOn(note, at) {
    if (muted || sounding.has(note.id)) return true;
    if (!emitPlayback([0x90 | note.channel, note.pitch, note.velocity], `looper:${note.id}`, at)) return false;
    sounding.set(note.id, note);
    return true;
  }

  function playOff(note, at) {
    if (!sounding.has(note.id)) return true;
    if (!emitPlayback([0x80 | note.channel, note.pitch, 0], `looper:${note.id}`, at)) return false;
    sounding.delete(note.id);
    return true;
  }

  function restorePlayback(atBeat = beat, at = syncActive ? midiTime(atBeat) : undefined) {
    if (!length || muted) return true;
    const position = ((atBeat % length) + length) % length;
    for (const note of notes) {
      const age = (position - note.start + length) % length;
      if (age < note.playDuration - epsilon && !playOn(note, at)) return false;
    }
    return true;
  }

  function processPlayback(from, to, scheduled = false) {
    if (syncActive && !scheduled) return true;
    if (!length || muted || to <= from) return true;
    if (!scheduled && to - from > length * 4) {
      releasePlayback();
      return restorePlayback();
    }
    const events = [];
    for (const note of notes) {
      for (const [offset, on] of [[note.start, true], [note.start + note.playDuration, false]]) {
        let cycle = Math.floor((from - offset) / length) + 1;
        let at = offset + cycle * length;
        while (at <= to + epsilon) {
          if (at > from + epsilon) events.push({ at, on, note });
          at = offset + ++cycle * length;
        }
      }
    }
    events.sort((a, b) => a.at - b.at || Number(a.on) - Number(b.on));
    for (const event of events) {
      if (event.on) {
        if (!playOn(event.note, scheduled ? midiTime(event.at) : undefined)) return false;
      } else {
        if (!playOff(event.note, scheduled ? midiTime(event.at) : undefined)) return false;
      }
    }
    return true;
  }

  function startSync(requestedTime) {
    if (!clock?.enabled || syncActive || !length) return;
    syncStart = clock.start('looper', requestedTime, beat);
    syncClockBeat = clock.beatAt(syncStart);
    syncFirstBeat = beat;
    syncOrigin = syncStart - beat * 60000 / tempo;
    scheduledBeat = beat;
    syncActive = true;
    restoreScheduled = false;
  }

  function invalidateSchedule() {
    if (!syncActive) return;
    const active = playback.cancelScheduled();
    sounding.clear();
    const now = performance.now();
    const effectiveBeat = (now - clock.offset - syncOrigin) * tempo / 60000;
    scheduledBeat = Math.max(syncFirstBeat, effectiveBeat);
    scheduleInvalidated = true;
    restoreScheduled = now < syncStart + clock.offset;
    for (const note of active) {
      sounding.set(note.id, notes.find((item) => item.id === note.id) || note);
    }
    if (!refreshPending) {
      refreshPending = true;
      queueMicrotask(() => {
        refreshPending = false;
        if (syncActive) schedule();
      });
    }
  }

  function fillSchedule() {
    if (!syncActive || muted) return true;
    const now = performance.now();
    const currentBeat = (now - clock.offset - syncOrigin) * tempo / 60000;
    if (!scheduleInvalidated && scheduledBeat < currentBeat - epsilon) {
      invalidateSchedule();
      reconcileSounding(scheduledBeat);
      if (!restorePlayback(scheduledBeat)) return false;
    }
    if (restoreScheduled) {
      restoreScheduled = false;
      if (!restorePlayback(syncFirstBeat)) return false;
    }
    const horizon = (now + clock.lead - clock.offset - syncOrigin) * tempo / 60000;
    if (!processPlayback(scheduledBeat, horizon, true)) return false;
    scheduledBeat = Math.max(scheduledBeat, horizon);
    scheduleInvalidated = false;
    return true;
  }

  function quantizedStart(at, loopLength) {
    const division = activeSettings?.quantize || 0;
    const position = loopLength ? at % loopLength : at;
    if (!division) return position;
    const grid = 4 / division;
    const before = Math.floor(position / grid) * grid;
    const after = loopLength ? Math.min(before + grid, loopLength) : before + grid;
    const nearest = position - before < after - position ? before : after;
    return loopLength ? nearest % loopLength : nearest;
  }

  function addNote(note) {
    const duration = Math.max(epsilon * 10, beat - note.at);
    const division = activeSettings?.quantize || 0;
    const target = length || (activeSettings?.bars * activeSettings?.meter);
    const recorded = {
      id: note.id, firstId: note.id, lastId: note.id, rawStart: note.at, start: quantizedStart(note.at, target),
      duration: length ? Math.min(duration, length) : duration,
      channel: note.channel, pitch: note.pitch, velocity: note.velocity,
      availableAt: division && length && !note.first ? (Math.floor(note.at / length) + 1) * length : 0,
    };
    if (length && recorded.availableAt > beat + epsilon) scheduledNotes.push(recorded);
    else if (length) insertNote(recorded);
    else notes.push(recorded);
  }

  function recomputeDurations(collection = notes, phraseLength = length) {
    const groups = new Map();
    for (const note of collection) {
      const key = `${note.channel}:${note.pitch}`;
      const group = groups.get(key) || [];
      group.push(note);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.start - b.start);
      for (let index = 0; index < group.length; index++) {
        const note = group[index];
        const next = group[(index + 1) % group.length];
        const distance = group.length === 1 ? phraseLength
          : (next.start - note.start + phraseLength) % phraseLength;
        note.playDuration = Math.min(note.duration, distance);
      }
    }
  }

  function mergeNote(recorded, collection = notes) {
    const existing = collection.find((note) => note.channel === recorded.channel && note.pitch === recorded.pitch
      && Math.abs(note.start - recorded.start) < epsilon);
    if (!existing) {
      collection.push(recorded);
      return recorded;
    }
    if (recorded.firstId < existing.firstId) {
      existing.firstId = recorded.firstId;
      existing.velocity = recorded.velocity;
    }
    if (recorded.lastId > existing.lastId) {
      existing.lastId = recorded.lastId;
      existing.rawStart = recorded.rawStart;
      existing.duration = recorded.duration;
    }
    return existing;
  }

  function reconcileSounding(atBeat = beat) {
    const position = ((atBeat % length) + length) % length;
    for (const note of sounding.values()) {
      const age = (position - note.start + length) % length;
      if (age >= note.playDuration - epsilon) playOff(note);
    }
  }

  function insertNote(recorded) {
    invalidateSchedule();
    const merged = mergeNote(recorded);
    recomputeDurations();
    reconcileSounding(syncActive ? scheduledBeat : beat);
    return merged;
  }

  function normalizeNotes() {
    const recorded = notes.splice(0);
    for (const note of recorded) {
      note.start = quantizedStart(note.rawStart, length);
      note.duration = Math.min(note.duration, length);
      mergeNote(note);
    }
    recomputeDurations();
  }

  function advancePlayback(from, to) {
    while (true) {
      const due = scheduledNotes.reduce((next, note) => Math.min(next, note.availableAt), Infinity);
      if (due > to + epsilon) break;
      const finalBeat = beat;
      beat = due;
      if (!processPlayback(from, due)) {
        beat = finalBeat;
        return false;
      }
      const ready = scheduledNotes.filter((note) => note.availableAt <= due + epsilon);
      for (const note of ready) scheduledNotes.splice(scheduledNotes.indexOf(note), 1);
      for (const note of ready) {
        const merged = insertNote(note);
        if (merged.start < epsilon && !playOn(merged, syncActive ? midiTime(due) : undefined)) {
          beat = finalBeat;
          return false;
        }
      }
      beat = finalBeat;
      from = due;
    }
    return processPlayback(from, to);
  }

  function closePending() {
    for (const entries of pending.values()) {
      for (const note of entries) addNote(note);
    }
    pending.clear();
  }

  function advance(now = performance.now(), playNotes = true) {
    const elapsed = syncActive ? Math.max(0, (now - syncOrigin) * tempo / 60000 - beat)
      : Math.max(0, now - lastTime) * tempo / 60000;
    lastTime = now;
    if (mode === 3 && !firstRecording && !length) {
      const oldGuideBeat = guideBeat;
      guideBeat += elapsed;
      if (playNotes && Math.floor(guideBeat) > Math.floor(oldGuideBeat)) guideTick();
    } else if (firstRecording || (length && (mode === 2 || mode === 3))) {
      const previous = beat;
      beat += elapsed;
      if (activeSettings?.bars) {
        const boundary = Math.round(beat / activeSettings.meter) * activeSettings.meter;
        if (Math.abs(beat - boundary) < epsilon) beat = boundary;
      }
      if (playNotes && !advancePlayback(previous, beat)) {
        stopTransport('Looper stopped: MIDI output is unavailable or sending failed.');
        return;
      }
      const target = activeSettings?.bars * activeSettings?.meter;
      if (firstRecording && target && beat >= target) {
        length = target;
        firstRecording = false;
        normalizeNotes();
        if (playNotes) startSync(now);
        if (playNotes && !restorePlayback()) {
          stopTransport('Looper stopped: MIDI output is unavailable or sending failed.');
          return;
        }
        status('Looper overdubbing.');
      } else if (firstRecording && beat >= maxBeats) {
        beat = maxBeats;
        closePending();
        length = maxBeats;
        firstRecording = false;
        normalizeNotes();
        mode = 2;
        beat = 0;
        if (playNotes && !restorePlayback()) {
          stopTransport('Looper stopped: MIDI output is unavailable or sending failed.');
          return;
        }
        if (playNotes) onModeChange(2);
        status('Looper reached its maximum length and started playback.');
        setLeds();
        return;
      }
    }
    setLeds();
  }

  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    if (mode !== 2 && mode !== 3) return;
    if (mode === 2 && !length) return;
    if (!fillSchedule()) {
      stopTransport('Looper stopped: scheduled MIDI output is unavailable or sending failed.');
      return;
    }
    let wait = syncActive ? 20 : 50;
    if (mode === 3 && activeSettings?.bars) {
      const distance = activeSettings.meter - (beat % activeSettings.meter);
      wait = Math.min(wait, distance * 60000 / tempo);
    }
    if (length && !muted) {
      const position = beat % length;
      for (const note of notes) {
        for (const offset of [note.start, (note.start + note.playDuration) % length]) {
          let distance = (offset - position + length) % length;
          if (distance < epsilon) distance = length;
          wait = Math.min(wait, distance * 60000 / tempo);
        }
        for (const note of scheduledNotes) {
          wait = Math.min(wait, Math.max(0, note.availableAt - beat) * 60000 / tempo);
        }
      }
    }
    timer = setTimeout(() => {
      advance();
      schedule();
    }, Math.max(1, Math.ceil(wait - 1e-6)));
  }

  function stopTransport(message) {
    const wasRecording = mode === 3;
    mode = 0;
    clearTimeout(timer);
    timer = undefined;
    stopGuide();
    releasePlayback();
    syncActive = false;
    clock?.stop('looper');
    if (wasRecording) closePending();
    if (firstRecording) {
      length = activeSettings.bars ? activeSettings.bars * activeSettings.meter : Math.max(minimumLength, beat);
      firstRecording = false;
      normalizeNotes();
    }
    for (const note of scheduledNotes.splice(0)) insertNote(note);
    beat = 0;
    setLeds();
    onModeChange(mode);
    if (message) status(message, 'error');
    playback.onStop?.();
  }

  function setMode(next, startAt) {
    if (next === mode) {
      if (next !== 2 && next !== 3) playback.onStop?.();
      return;
    }
    advance(performance.now(), next === 2 || next === 3);
    invalidateSchedule();
    const alreadySynced = syncActive;
    const previous = mode;
    const endingFirstRecording = previous === 3 && firstRecording;
    clearTimeout(timer);
    timer = undefined;
    stopGuide();
    if (previous === 3) {
      closePending();
      if (firstRecording) {
        length = activeSettings.bars ? activeSettings.bars * activeSettings.meter : Math.max(minimumLength, beat);
        firstRecording = false;
        normalizeNotes();
      }
    }
    if (!((previous === 2 && next === 3) ||
      (previous === 3 && next === 2 && !endingFirstRecording))) {
      releasePlayback();
      syncActive = false;
      clock?.stop('looper');
    }
    mode = next;
    lastTime = performance.now();
    if (next === 4) {
      notes.length = 0;
      scheduledNotes.length = 0;
      pending.clear();
      length = 0;
      beat = 0;
      activeSettings = undefined;
      guideBeat = 0;
      guideEnabled = true;
      status('Looper cleared.');
    } else if (next === 0) {
      beat = 0;
      for (const note of scheduledNotes.splice(0)) insertNote(note);
      status('Looper stopped.');
    } else if (next === 1) {
      status('Looper paused.');
    } else if (next === 2) {
      if (!length) {
        if (previous === 4) guideEnabled = false;
        status('Looper is empty.');
      } else {
        if (previous !== 1 && (previous !== 3 || endingFirstRecording)) beat = 0;
        status('Looper playing.');
        startSync(startAt);
        if (!restorePlayback(alreadySynced && syncActive ? scheduledBeat : beat)) {
          stopTransport('Looper stopped: MIDI output is unavailable or sending failed.');
          return;
        }
      }
    } else if (next === 3) {
      if (length) {
        if (previous !== 1 && previous !== 2) beat = 0;
        status('Looper overdubbing.');
        startSync(startAt);
        if (!restorePlayback(alreadySynced && syncActive ? scheduledBeat : beat)) {
          stopTransport('Looper stopped: MIDI output is unavailable or sending failed.');
          return;
        }
      } else {
        beat = 0;
        guideBeat = 0;
        status('Looper armed; recording starts with the first note.');
        guideTick();
      }
    }
    setLeds();
    schedule();
    if (next !== 2 && next !== 3) playback.onStop?.();
  }

  function applyImportedLoop(imported) {
    advance(performance.now(), false);
    stopTransport();
    notes.length = 0;
    scheduledNotes.length = 0;
    pending.clear();
    length = imported.length;
    settings.meter = imported.meter;
    clock?.setMeter(settings.meter);
    settings.bars = Math.min(settings.bars, maxBeats / settings.meter);
    const bars = length / imported.meter;
    activeSettings = { ...settings, bars: Number.isInteger(bars) ? bars : 0 };
    for (const note of imported.notes) {
      const id = nextId++;
      mergeNote({ id, firstId: id, lastId: id, rawStart: note.start, start: note.start,
        duration: Math.min(note.duration, length), channel: note.channel, pitch: note.pitch,
        velocity: note.velocity, availableAt: 0 });
    }
    recomputeDurations();
    setLeds();
    if (imported.tempo !== undefined) onFileTempo(imported.tempo);
  }

  function snapshotLoop() {
    if (!notes.length && !scheduledNotes.length && !pending.size) {
      throw new Error('There is no valid loop to save.');
    }
    if (mode === 3) {
      advance(performance.now(), false);
      stopTransport();
    }
    const snapshot = notes.map((note) => ({ ...note }));
    for (const note of scheduledNotes) mergeNote({ ...note }, snapshot);
    recomputeDurations(snapshot);
    const meter = activeSettings?.meter ?? settings.meter;
    writeMidi(snapshot, length, tempo, meter);
    return {
      length, meter, tempo,
      notes: snapshot.map(({ start, duration, channel, pitch, velocity }) =>
        ({ start, duration, channel, pitch, velocity })),
    };
  }

  async function renderLibrary() {
    const loops = await loopStoreRequest('readonly', (store) => store.getAll());
    loops.sort((a, b) => a.name.localeCompare(b.name));
    librarySelect.replaceChildren(...loops.map((loop) => new Option(loop.name, loop.id)));
    libraryStatus(loops.length ? '' : 'No loops saved in this browser.');
    document.querySelector('#looper-library-load').disabled = !loops.length;
    document.querySelector('#looper-library-delete').disabled = !loops.length;
  }

  async function activateImportedLoop(record) {
    const hasCurrent = length || notes.length || scheduledNotes.length || pending.size;
    const same = mode !== 3 && (notes.length || scheduledNotes.length)
      && await equalValue(comparableLoop(snapshotLoop()), comparableLoop(record.loop));
    if (hasCurrent && !same
      && !await confirmAction('Import loop', 'Replace the current looper phrase with this imported loop?', 'Replace')) return;
    ++loadRevision;
    applyImportedLoop(record.loop);
    savedLoop = structuredClone(record.loop);
    savedLoopName = record.name;
    status(`Loaded imported loop "${record.name}".`);
  }

  bindButton(document.querySelector('#looper-load'), async () => {
    try {
      await renderLibrary();
      library.showModal();
    } catch (error) {
      status(`Could not open saved loops: ${error.message || error}.`, 'error');
    }
  });
  bindButton(document.querySelector('#looper-save'), async () => {
    try {
      const name = await askName('Save loop', 'Save the loop in this browser as:', savedLoopName);
      if (name === null) return;
      const loops = await loopStoreRequest('readonly', (store) => store.getAll());
      const existing = loops.find((loop) => loop.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (existing && !await confirmAction('Replace loop', `Replace saved loop "${existing.name}"?`, 'Replace')) return;
      const loop = snapshotLoop();
      await loopStoreRequest('readwrite', (store) => store.put({
        id: existing?.id ?? crypto.randomUUID(), name, loop, updatedAt: new Date().toISOString(),
      }));
      savedLoop = structuredClone(loop);
      savedLoopName = name;
      status(`Saved loop "${name}" in this browser.`);
    } catch (error) {
      status(`Could not save loop: ${error.message || error}.`, 'error');
    }
  });
  document.querySelector('#looper-library-close').addEventListener('click', () => library.close());
  document.querySelector('#looper-library-load').addEventListener('click', async () => {
    try {
      const loop = await loopStoreRequest('readonly', (store) => store.get(librarySelect.value));
      if (!loop) throw new Error('The saved loop no longer exists');
      const imported = validateSavedLoop(loop.loop);
      if ((length || notes.length || scheduledNotes.length || pending.size)
        && !await confirmAction('Load loop', 'Replace the current looper phrase with this saved loop?', 'Replace')) return;
      ++loadRevision;
      applyImportedLoop(imported);
      savedLoop = structuredClone(imported);
      savedLoopName = loop.name;
      library.close();
      status(`Loaded saved loop "${loop.name}".`);
    } catch (error) {
      libraryStatus(`Could not load loop: ${error.message || error}.`, 'error');
    }
  });
  document.querySelector('#looper-library-delete').addEventListener('click', async () => {
    try {
      const loop = await loopStoreRequest('readonly', (store) => store.get(librarySelect.value));
      if (!loop || !await confirmAction('Delete loop', `Delete saved loop "${loop.name}"?`, 'Delete')) return;
      await loopStoreRequest('readwrite', (store) => store.delete(loop.id));
      await renderLibrary();
      libraryStatus(`Deleted "${loop.name}".`);
    } catch (error) {
      libraryStatus(`Could not delete loop: ${error.message || error}.`, 'error');
    }
  });
  bindButton(document.querySelector('#looper-transfer-open'), () => {
    transfer.showModal();
  });
  document.querySelector('#looper-transfer-close').addEventListener('click', () => transfer.close());
  document.querySelector('#looper-midi-import').addEventListener('click', () => {
    fileInput.click();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const revision = ++loadRevision;
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('The MIDI file exceeds the 16 MB size limit.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (revision !== loadRevision) return;
      let imported;
      if (file.name.toLowerCase().endsWith('.json')) {
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (data?.format !== 'refaceCS-loop' || data.version !== 1) throw new Error('Unsupported loop format or version');
        imported = validateSavedLoop(data.loop);
      } else {
        imported = readMidi(bytes, settings.meter);
      }
      if ((length || notes.length || scheduledNotes.length || pending.size) &&
        !await confirmAction('Import loop', 'Replace the current looper phrase with this file?', 'Replace')) {
        status('MIDI load cancelled; the current loop is unchanged.');
        return;
      }
      applyImportedLoop(imported);
      savedLoop = null;
      savedLoopName = file.name.replace(/\.(midi?|json)$/i, '');
      status(`Loaded ${file.name} (${imported.notes.length} notes). ${(imported.warnings ?? []).join(' ')}`.trim());
      if (transfer.open) transfer.close();
    } catch (error) {
      if (revision === loadRevision) {
        status(`MIDI load failed: ${error.message || error}.`, 'error');
      }
    }
  });

  document.querySelector('#looper-midi-export').addEventListener('click', async () => {
    try {
      if (!notes.length && !scheduledNotes.length && !pending.size) {
        status('MIDI save failed: There is no valid loop to save.', 'error');
        return;
      }
      const current = mode === 3 ? null : snapshotLoop();
      const dirty = !savedLoop || !current || JSON.stringify(current) !== JSON.stringify(savedLoop);
      let selected = 'current';
      if (dirty) {
        selected = await choose('Unsaved loop changes', 'Choose which loop to export.', [
          ['Cancel Export', 'cancel'], ['Export current unsaved state', 'current'],
          ['Export last saved state', 'saved', !savedLoop],
        ]);
        if (!selected || selected === 'cancel') return;
      }
      const result = await exportDialog(savedLoopName, [
        { id: 'loop', label: 'Loop (JSON)', extension: '.json' },
        { id: 'midi', label: 'Pure MIDI', extension: '.mid', extensions: ['.mid', '.midi'],
          warning: 'Pure MIDI omits the app-specific exact loop length; note timing is rounded to MIDI resolution and trailing silence may not be restored on reimport.' },
      ]);
      if (!result) return;
      const loop = selected === 'saved' ? savedLoop : (current ?? snapshotLoop());
      let blob;
      if (result.format === 'midi') {
        const snapshot = loop.notes.map((note) => ({ ...note }));
        recomputeDurations(snapshot, loop.length);
        blob = new Blob([writeMidi(snapshot, loop.length, loop.tempo, loop.meter, { includeLoopMetadata: false })],
          { type: 'audio/midi' });
      } else {
        blob = new Blob([JSON.stringify({ format: 'refaceCS-loop', version: 1, loop })], { type: 'application/json' });
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      status(`Exported loop as ${result.filename}.`);
      if (transfer.open) transfer.close();
    } catch (error) {
      status(`MIDI save failed: ${error.message || error}.`, 'error');
    }
  });

  function setTempo(value) {
    if (tempo === value) return;
    advance();
    invalidateSchedule();
    tempo = value;
    if (syncActive) {
      if (performance.now() < syncStart) syncStart = clock.timeAt(syncClockBeat);
      syncOrigin = (performance.now() < syncStart ? syncStart : performance.now()) - beat * 60000 / tempo;
      scheduledBeat = Math.max(syncFirstBeat, (performance.now() - clock.offset - syncOrigin) * tempo / 60000);
      reconcileSounding(scheduledBeat);
      if (!restorePlayback(scheduledBeat)) {
        stopTransport('Looper stopped: MIDI output is unavailable or sending failed.');
        return;
      }
    }
    schedule();
  }

  clock?.subscribe((reason) => {
    if (reason === 'meter') { setMeter(clock.meter); return; }
    if (reason === 'tempo') { setTempo(clock.tempo); return; }
    if (reason === 'suspended' && syncActive) {
      stopTransport('Looper stopped because drum audio was suspended.');
      return;
    }
    if (reason === 'audio' && !syncActive && length && (mode === 2 || mode === 3)) {
      advance();
      releasePlayback();
      startSync(performance.now());
      if (!restorePlayback()) {
        stopTransport('Looper stopped: MIDI output is unavailable or sending failed.');
        return;
      }
    } else if ((reason === 'offset' || reason === 'output') && syncActive) {
      releasePlayback();
      if (!restorePlayback(scheduledBeat)) {
        stopTransport('Looper stopped: MIDI output is unavailable or sending failed.');
        return;
      }
    }
    schedule();
  });

  return {
    setMode,
    setTempo,
    invalidateSchedule,
    listSavedLoops() {
      return loopStoreRequest('readonly', (store) => store.getAll());
    },
    async replaceSavedLoops(records) {
      validateSavedLoops(records);
      await loopStoreRequest('readwrite', (store) => {
        let request = store.clear();
        for (const record of records) request = store.put(record);
        return request;
      });
      savedLoop = null;
    },
    async importSavedLoops(records, { activateSingle = true } = {}) {
      validateSavedLoops(records);
      const existing = await loopStoreRequest('readonly', (store) => store.getAll());
      const pendingWrites = [];
      for (const record of records) {
        const resolution = await resolveImport(record, existing, 'loop', equalLoopRecords);
        if (resolution.action === 'ignore') continue;
        if (resolution.action === 'identical') {
          if (records.length === 1 && activateSingle) await activateImportedLoop(resolution.item);
          continue;
        }
        const next = resolution.item;
        if (resolution.match) existing.splice(existing.indexOf(resolution.match), 1);
        existing.push(next);
        pendingWrites.push(next);
      }
      if (pendingWrites.length) {
        await loopStoreRequest('readwrite', (store) => {
          let request;
          for (const record of pendingWrites) request = store.put(record);
          return request;
        });
      }
      if (activateSingle && records.length === 1 && pendingWrites.length === 1) {
        await activateImportedLoop(pendingWrites[0]);
      }
      return pendingWrites.length;
    },
    setMuted(value) {
      advance();
      invalidateSchedule();
      muted = value;
      stopGuide();
      if (muted) releasePlayback();
      else if ((mode === 2 || mode === 3) && length && !restorePlayback(syncActive ? scheduledBeat : beat)) {
        stopTransport('Looper stopped: MIDI output is unavailable or sending failed.');
      }
      schedule();
    },
    noteOn(owner, channel, pitch, velocity) {
      if (mode !== 3) return;
      advance();
      if (mode !== 3) return;
      if (notes.length + scheduledNotes.length + [...pending.values()].reduce((count, items) => count + items.length, 0) >= maxNotes) {
        status('Looper is full (2,000 notes); additional notes are not recorded.');
        return;
      }
      if (!length && !firstRecording) {
        activeSettings = { ...settings };
        firstRecording = true;
        beat = 0;
        lastTime = performance.now();
        stopGuide();
        status('Looper recording.');
      }
      const entries = pending.get(owner) || [];
      entries.push({ id: nextId++, at: beat, channel, pitch, velocity, first: firstRecording });
      pending.set(owner, entries);
      setLeds();
      schedule();
    },
    noteOff(owner) {
      if (mode !== 3) return;
      advance();
      if (mode !== 3) return;
      const entries = pending.get(owner);
      if (!entries?.length) return;
      const note = entries.shift();
      if (!entries.length) pending.delete(owner);
      addNote(note);
      schedule();
    },
    stop() {
      advance(performance.now(), false);
      stopTransport('Looper stopped.');
    },
  };
}
