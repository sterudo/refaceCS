const triads = {
  0: [0, 4, 7], 2: [0, 3, 7], 4: [0, 3, 7], 5: [0, 4, 7],
  7: [0, 4, 7], 9: [0, 3, 7], 11: [0, 3, 6],
};
const sevenths = {
  1: [0, 4, 7, 11], 3: [0, 3, 7, 10], 6: [0, 4, 7, 11],
  8: [0, 4, 7, 10], 10: [0, 3, 7, 10],
};

export function createArpeggiator(send, changeRouting, isMuted = () => false, transpose = () => 0) {
  const enabledButton = document.querySelector('#arp-enabled');
  const latchButton = document.querySelector('#arp-latch');
  const chordButton = document.querySelector('#arp-chord');
  const tempoInput = document.querySelector('#arp-tempo');
  const rateInput = document.querySelector('#arp-rate');
  const modeInput = document.querySelector('#arp-mode');
  const status = document.querySelector('#arp-status');
  const held = new Map();
  const latched = new Map();
  let enabled = false;
  let latch = true;
  let chord = false;
  let tempo = 120;
  let rate = 16;
  let mode = 'up';
  let step = 0;
  let timer;
  let gateTimer;
  let sounding;
  let lastRandom;
  let randomCount = 0;

  function stop() {
    clearTimeout(timer);
    clearTimeout(gateTimer);
    timer = undefined;
    gateTimer = undefined;
    if (sounding !== undefined) send([0x80, sounding, 0]);
    sounding = undefined;
    step = 0;
    lastRandom = undefined;
    randomCount = 0;
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
    if (outsideRange) status.textContent = 'Some arpeggiator notes are outside the MIDI range and were skipped.';
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
    if (!enabled || values.length === 0) return;
    const interval = 60000 / tempo * 4 / rate;
    const next = nextNote(values);
    if (!next) {
      timer = setTimeout(tick, interval);
      return;
    }
    const [note, velocity] = next;
    if (isMuted()) {
      timer = setTimeout(tick, interval);
      return;
    }
    if (!send([0x90, note, velocity])) {
      status.textContent = 'Arpeggiator stopped: MIDI output is unavailable or sending failed.';
      return;
    }
    sounding = note;
    gateTimer = setTimeout(() => {
      if (sounding !== undefined && !send([0x80, sounding, 0])) {
        clearTimeout(timer);
        timer = undefined;
        status.textContent = 'Arpeggiator stopped: MIDI note-off failed. Use MIDI Reset.';
      }
      sounding = undefined;
      gateTimer = undefined;
    }, interval / 2);
    timer = setTimeout(tick, interval);
  }

  function restart() {
    stop();
    if (enabled && notes().length) tick();
  }

  enabledButton.addEventListener('click', () => {
    if (enabled) {
      stop();
      enabled = false;
      latched.clear();
      changeRouting(false);
    } else {
      changeRouting(true);
      enabled = true;
      if (latch) {
        latched.clear();
        for (const [key, value] of held) latched.set(key, { ...value });
      }
    }
    enabledButton.setAttribute('aria-pressed', String(enabled));
    status.textContent = `Arpeggiator ${enabled ? 'on' : 'off'}.`;
    if (enabled) restart();
  });

  latchButton.addEventListener('click', () => {
    latch = !latch;
    latched.clear();
    if (latch) for (const [key, value] of held) latched.set(key, { ...value });
    latchButton.setAttribute('aria-pressed', String(latch));
    restart();
  });

  chordButton.addEventListener('click', () => {
    chord = !chord;
    chordButton.setAttribute('aria-pressed', String(chord));
    restart();
  });

  tempoInput.addEventListener('change', () => {
    if (!tempoInput.validity.valid || !Number.isInteger(tempoInput.valueAsNumber)) {
      status.textContent = 'Enter a whole-number tempo from 30 to 300 BPM.';
      return;
    }
    tempo = tempoInput.valueAsNumber;
    status.textContent = `Tempo: ${tempo} BPM.`;
    restart();
  });
  rateInput.addEventListener('change', () => {
    rate = Number(rateInput.value);
    restart();
  });
  modeInput.addEventListener('change', () => {
    mode = modeInput.value;
    restart();
  });

  return {
    get enabled() { return enabled; },
    getHeld() { return [...held.entries()]; },
    transposeChanged() {
      if (enabled && timer === undefined && sounding === undefined && notes().length) tick();
    },
    silence() {
      clearTimeout(gateTimer);
      gateTimer = undefined;
      if (sounding !== undefined) send([0x80, sounding, 0]);
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
