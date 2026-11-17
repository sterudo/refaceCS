import { createReporter } from './notifications.js';
import { tempoRange } from './synth-midi.js';
import { createSevenSegment } from './seven-segment.js';

const triads = {
  0: [0, 4, 7], 2: [0, 3, 7], 4: [0, 3, 7], 5: [0, 4, 7],
  7: [0, 4, 7], 9: [0, 3, 7], 11: [0, 3, 6],
};
const sevenths = {
  1: [0, 4, 7, 11], 3: [0, 3, 7, 10], 6: [0, 4, 7, 11],
  8: [0, 4, 7, 10], 10: [0, 3, 7, 10],
};

export function createArpeggiator(send, changeRouting, isMuted = () => false, transpose = () => 0, onTempoChange = () => {}, clock, scheduling = {}) {
  const enabledButton = document.querySelector('#arp-enabled');
  const latchButton = document.querySelector('#arp-latch');
  const chordButton = document.querySelector('#arp-chord');
  const tempoControl = document.querySelector('#arp-tempo');
  const tempoDigits = document.querySelector('#arp-tempo-digits');
  const rateButton = document.querySelector('#arp-rate');
  const modeButton = document.querySelector('#arp-mode');
  const menuLayer = document.querySelector('#arp-menu-layer');
  const status = createReporter('arp', 'arp-status');
  const svgNS = 'http://www.w3.org/2000/svg';
  const rates = [2, 4, 8, 16, 32].map((value) => ({ value, label: `1/${value}` }));
  const modes = [
    { value: 'up', label: 'Up' }, { value: 'down', label: 'Down' },
    { value: 'updown', label: 'Up/down' }, { value: 'downup', label: 'Down/up' },
    { value: 'firstlastmiddle', label: 'First/last/middle', display: 'FIRST/LAST/MID' },
    { value: 'random', label: 'Random' },
  ];
  const held = new Map();
  const latched = new Map();
  let enabled = false;
  let latch = true;
  let chord = false;
  let tempo = tempoRange.default;
  let rate = 16;
  let mode = 'up';
  let step = 0;
  let timer;
  let gateTimer;
  let sounding;
  let lastRandom;
  let randomCount = 0;
  let openButton;
  let nextBeat;

  function bindActivate(element, activate) {
    element.addEventListener('click', activate);
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (!event.repeat) activate(event);
    });
  }

  const renderTempo = createSevenSegment(tempoDigits);

  function updateTempoDisplay() {
    renderTempo(tempo);
    tempoControl.dataset.value = String(tempo);
    tempoControl.setAttribute('aria-label', `Arpeggiator tempo: ${tempo} BPM`);
    document.querySelector('#arp-tempo-down').setAttribute('aria-disabled', String(tempo === tempoRange.min));
    document.querySelector('#arp-tempo-up').setAttribute('aria-disabled', String(tempo === tempoRange.max));
  }

  function setTempo(value, notify = false, forceNotify = false) {
    const next = Math.max(tempoRange.min, Math.min(tempoRange.max, Math.round(value)));
    const changed = next !== tempo;
    if (changed) {
      tempo = next;
      clock?.setTempo(next);
      updateTempoDisplay();
      status(`Tempo: ${tempo} BPM.`);
      restart();
    }
    if (notify && (changed || forceNotify)) onTempoChange(next);
  }

  function closeMenu(focusButton = false) {
    if (!openButton) return;
    const button = openButton;
    openButton = undefined;
    button.setAttribute('aria-expanded', 'false');
    menuLayer.replaceChildren();
    if (focusButton) button.focus();
  }

  function setChoice(button, option) {
    if (button === rateButton) rate = option.value;
    else mode = option.value;
    const name = button === rateButton ? 'Rate' : 'Mode';
    const value = button.querySelector(button === rateButton ? '#arp-rate-value' : '#arp-mode-value');
    value.textContent = (option.display || option.label).toUpperCase();
    button.setAttribute('aria-label', `${name}: ${option.label}`);
    button.dataset.value = String(option.value);
    status(`${name}: ${option.label}.`);
    restart();
  }

  function showMenu(button, options) {
    closeMenu();
    openButton = button;
    button.setAttribute('aria-expanded', 'true');
    const menu = document.createElementNS(svgNS, 'g');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', button === rateButton ? 'Arpeggiator rates' : 'Arpeggiator modes');
    menu.setAttribute('transform', `translate(${button === rateButton ? 648 : 721} 279)`);
    const background = document.createElementNS(svgNS, 'rect');
    background.setAttribute('class', 'arp-menu-background');
    background.setAttribute('width', '150');
    background.setAttribute('height', String(options.length * 24 + 6));
    background.setAttribute('rx', '4');
    menu.append(background);
    const items = options.map((option, index) => {
      const item = document.createElementNS(svgNS, 'g');
      item.setAttribute('class', 'arp-menu-item');
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(String(option.value) === button.dataset.value));
      item.setAttribute('tabindex', '-1');
      item.dataset.value = String(option.value);
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', '3');
      rect.setAttribute('y', String(3 + index * 24));
      rect.setAttribute('width', '144');
      rect.setAttribute('height', '24');
      rect.setAttribute('rx', '2');
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', '10');
      label.setAttribute('y', String(19 + index * 24));
      label.textContent = option.label;
      item.append(rect, label);
      bindActivate(item, (event) => {
        setChoice(button, option);
        closeMenu(event.type === 'keydown');
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
    (items.find((item) => item.getAttribute('aria-checked') === 'true') || items[0]).focus();
  }

  function setupChoice(button, options) {
    button.dataset.value = String(button === rateButton ? rate : mode);
    bindActivate(button, () => {
      closeMenu();
      const index = options.findIndex((option) => String(option.value) === button.dataset.value);
      setChoice(button, options[(index + 1) % options.length]);
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showMenu(button, options);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10') || event.key === 'ArrowDown') {
        event.preventDefault();
        showMenu(button, options);
      }
    });
  }

  setupChoice(rateButton, rates);
  setupChoice(modeButton, modes);
  document.addEventListener('pointerdown', (event) => {
    if (openButton && !menuLayer.contains(event.target) && !openButton.contains(event.target)) closeMenu();
  });
  window.addEventListener('blur', () => closeMenu());
  for (const [id, direction] of [['#arp-tempo-down', -1], ['#arp-tempo-up', 1]]) {
    bindActivate(document.querySelector(id), (event) => setTempo(tempo + direction * (event.shiftKey ? 10 : 1), true));
  }
  document.querySelector('#arp-tempo-display').addEventListener('dblclick', () => setTempo(tempoRange.default, true, true));
  tempoControl.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    setTempo(tempo - Math.sign(event.deltaY) * (event.altKey ? 10 : 1), true);
  }, { passive: false });
  updateTempoDisplay();

  function stop() {
    clearTimeout(timer);
    clearTimeout(gateTimer);
    timer = undefined;
    gateTimer = undefined;
    if (sounding !== undefined) send([0x80, sounding, 0]);
    scheduling.cancel?.();
    sounding = undefined;
    step = 0;
    lastRandom = undefined;
    randomCount = 0;
    clock?.stop('arpeggiator');
    nextBeat = undefined;
  }

  function notes() {
    const sources = latch ? latched : held;
    const result = new Map();
    let outsideRange = false;
    for (const { note, velocity } of sources.values()) {
      const transposed = note + transpose();
      if (transposed < 0 || transposed > 127) {
        outsideRange = true;
        continue;
      }
      const pitchClass = (transposed + 1200) % 12;
      const intervals = chord ? (triads[pitchClass] || sevenths[pitchClass]) : [0];
      const root = chord && sevenths[pitchClass] ? transposed - 1 : transposed;
      for (const interval of intervals) {
        const pitch = root + interval;
        if (pitch < 0 || pitch > 127) outsideRange = true;
        else if (!result.has(pitch)) result.set(pitch, velocity);
      }
    }
    if (outsideRange) status('Some arpeggiator notes are outside the MIDI range and were skipped.', 'warning');
    return [...result].sort((a, b) => a[0] - b[0]);
  }

  function nextNote(values) {
    if (mode === 'random') {
      if (values.length === 1 && randomCount >= 3 && values[0][0] === lastRandom) {
        lastRandom = undefined;
        randomCount = 0;
        return undefined;
      }
      const choices = randomCount >= 3 && values.length > 1
        ? values.filter(([note]) => note !== lastRandom) : values;
      const chosen = choices[Math.floor(Math.random() * choices.length)];
      randomCount = chosen[0] === lastRandom ? randomCount + 1 : 1;
      lastRandom = chosen[0];
      return chosen;
    }
    let order = values;
    if (mode === 'down' || mode === 'downup') order = [...values].reverse();
    if (mode === 'updown' || mode === 'downup') {
      order = [...order, ...order.slice(1, -1).reverse()];
    } else if (mode === 'firstlastmiddle') {
      order = [];
      for (let left = 0, right = values.length - 1; left <= right; left++, right--) {
        order.push(values[left]);
        if (left !== right) order.push(values[right]);
      }
    }
    const chosen = order[step % order.length];
    step++;
    return chosen;
  }

  function tick() {
    timer = undefined;
    const values = notes();
    if (!enabled || values.length === 0) { stop(); return; }
    const interval = 60000 / tempo * 4 / rate;
    const lookahead = scheduling.lookahead?.() ?? 0;
    let at = performance.now();
    if (clock) {
      if (nextBeat === undefined) {
        const start = clock.running ? clock.nextTime(4 / rate, at + lookahead) : at + lookahead;
        clock.start('arpeggiator', start);
        nextBeat = clock.beatAt(start);
      }
      if (clock.timeAt(nextBeat) < at - interval) {
        nextBeat = clock.beatAt(clock.nextTime(4 / rate, at));
      }
      const target = clock.timeAt(nextBeat);
      if (target > at + lookahead + 0.1) {
        timer = setTimeout(tick, Math.max(1, Math.ceil(target - at - lookahead)));
        return;
      }
      at = target;
      nextBeat += 4 / rate;
    }
    const scheduleNext = () => {
      timer = setTimeout(tick, Math.max(1, Math.ceil(clock
        ? clock.timeAt(nextBeat) - performance.now() - lookahead : interval)));
    };
    const next = nextNote(values);
    if (!next) {
      scheduleNext();
      return;
    }
    const [note, velocity] = next;
    if (isMuted()) {
      scheduleNext();
      return;
    }
    if (!send([0x90, note, velocity], lookahead ? at : undefined)) {
      status('Arpeggiator stopped: MIDI output is unavailable or sending failed.', 'error');
      stop();
      return;
    }
    if (lookahead) {
      if (!send([0x80, note, 0], at + interval / 2)) {
        status('Arpeggiator stopped: scheduled note-off failed. Use MIDI Reset.', 'error');
        stop();
        return;
      }
      scheduleNext();
      return;
    }
    sounding = note;
    gateTimer = setTimeout(() => {
      if (sounding !== undefined && !send([0x80, sounding, 0])) {
        clearTimeout(timer);
        timer = undefined;
        clock?.stop('arpeggiator');
        nextBeat = undefined;
        status('Arpeggiator stopped: MIDI note-off failed. Use MIDI Reset.', 'error');
      }
      sounding = undefined;
      gateTimer = undefined;
    }, Math.max(0, at + interval / 2 - performance.now()));
    scheduleNext();
  }

  function restart() {
    stop();
    if (enabled && notes().length) tick();
  }

  clock?.subscribe((reason) => {
    if (reason === 'tempo') setTempo(clock.tempo);
    if (reason === 'suspended') stop();
  });

  bindActivate(enabledButton, () => {
    if (enabled) {
      stop();
      enabled = false;
      latched.clear();
      changeRouting(false);
    } else {
      setTempo(tempoRange.default, true, true);
      changeRouting(true);
      enabled = true;
      if (latch) {
        latched.clear();
        for (const [key, value] of held) latched.set(key, { ...value });
      }
    }
    enabledButton.setAttribute('aria-pressed', String(enabled));
    status(`Arpeggiator ${enabled ? 'on' : 'off'}.`);
    if (enabled) restart();
  });

  bindActivate(latchButton, () => {
    latch = !latch;
    latched.clear();
    if (latch) for (const [key, value] of held) latched.set(key, { ...value });
    latchButton.setAttribute('aria-pressed', String(latch));
    restart();
  });

  bindActivate(chordButton, () => {
    chord = !chord;
    chordButton.setAttribute('aria-pressed', String(chord));
    restart();
  });

  return {
    get enabled() { return enabled; },
    setTempo,
    getHeld() { return [...held.entries()]; },
    transposeChanged() {
      if (enabled && timer === undefined && sounding === undefined && notes().length) tick();
    },
    silence() {
      clearTimeout(gateTimer);
      gateTimer = undefined;
      if (sounding !== undefined) send([0x80, sounding, 0]);
      scheduling.cancel?.();
      sounding = undefined;
    },
    noteOn(owner, note, velocity, channel, source) {
      if (held.size === 0 && latch) latched.clear();
      const previous = held.get(owner);
      const value = { note, velocity, channel, source, count: (previous?.count || 0) + 1 };
      held.set(owner, value);
      if (latch) latched.set(owner, { ...value });
      if (enabled && timer === undefined && sounding === undefined) tick();
    },
    noteOff(owner) {
      const value = held.get(owner);
      if (!value) return;
      if (value.count > 1) value.count--;
      else held.delete(owner);
      if (enabled && notes().length === 0) stop();
    },
    removeSource(source) {
      for (const [owner, value] of held) if (value.source === source) held.delete(owner);
      for (const [owner, value] of latched) if (value.source === source) latched.delete(owner);
      if (enabled) restart();
    },
    clear() {
      stop();
      held.clear();
      latched.clear();
    },
  };
}
