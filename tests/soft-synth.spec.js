import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createSoftSynth } from '../src/soft-synth.js';

class FakeAudioParam {
  value = 0;
  setValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}

class FakeAudioNode {
  connect(destination) {
    this.connections ??= [];
    this.connections.push(destination);
    return this;
  }
  disconnect() {}
}

class FakeAudioContext {
  static instances = [];
  currentTime = 0;
  state = 'running';
  destination = new FakeAudioNode();
  oscillators = [];
  gains = [];
  periodicWaves = [];
  constructor() { FakeAudioContext.instances.push(this); }
  createGain() {
    const node = Object.assign(new FakeAudioNode(), { gain: new FakeAudioParam() });
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const node = Object.assign(new FakeAudioNode(), {
      frequency: new FakeAudioParam(),
      detune: new FakeAudioParam(),
      setPeriodicWave(wave) { this.periodicWave = wave; },
      start(at) { this.startedAt = at; },
      stop(at) { this.stoppedAt = at; },
    });
    this.oscillators.push(node);
    return node;
  }
  createBiquadFilter() {
    return Object.assign(new FakeAudioNode(), {
      frequency: new FakeAudioParam(),
      Q: new FakeAudioParam(),
    });
  }
  createPeriodicWave(real, imag) {
    const wave = { real, imag };
    this.periodicWaves.push(wave);
    return wave;
  }
}

test('soft synth voices respond to note-off and channel all-notes-off', async () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalInstances = FakeAudioContext.instances;
  FakeAudioContext.instances = [];
  globalThis.AudioContext = FakeAudioContext;
  try {
    const errors = [];
    const synth = createSoftSynth((error) => errors.push(error));
    synth.setControl('eg-release', 0);
    synth.handleMessage([0x90, 60, 100]);
    synth.handleMessage([0x90, 64, 100]);
    const afterNoteOn = synth.activeVoiceCount;
    synth.handleMessage([0x80, 60, 0]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const afterNoteOff = synth.activeVoiceCount;
    synth.handleMessage([0xb0, 123, 0]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(afterNoteOn).toBe(2);
    expect(afterNoteOff).toBe(1);
    expect(synth.activeVoiceCount).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    if (originalAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = originalAudioContext;
    FakeAudioContext.instances = originalInstances;
  }
});

test('saw texture sets sub-oscillator volume and AMP LFO depth', async () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalInstances = FakeAudioContext.instances;
  FakeAudioContext.instances = [];
  globalThis.AudioContext = FakeAudioContext;
  try {
    const synth = createSoftSynth();
    synth.setControls({ 'osc-texture': 64, 'lfo-depth': 127 });
    synth.handleMessage([0xb0, 78, 32]);
    synth.handleMessage([0x90, 69, 100]);

    const audio = FakeAudioContext.instances.at(-1);
    expect(audio.oscillators[0].frequency.value).toBe(440);
    expect(audio.oscillators[1].frequency.value).toBe(220);
    expect(audio.gains[4].gain.value).toBeCloseTo(64 / 127);
    expect(audio.gains[3].gain.value).toBe(1);
    expect(audio.gains[5].gain.value).toBeCloseTo(0.9);

    synth.handleMessage([0xb0, 78, 0]);
    expect(audio.gains[5].gain.value).toBe(0);
    synth.allNotesOff();
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    if (originalAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = originalAudioContext;
    FakeAudioContext.instances = originalInstances;
  }
});

test('voice stealing stays bounded and cancellation stops scheduled release tails', () => {
  const originalAudioContext = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
  try {
    const synth = createSoftSynth();
    synth.setControl('eg-release', 127);
    for (let note = 40; note < 70; note++) {
      synth.handleMessage([0x90, note, 100], performance.now() + 100, 'arpeggiator');
      synth.handleMessage([0x80, note, 0], performance.now() + 200);
    }
    expect(synth.activeVoiceCount).toBe(24);
    const audio = FakeAudioContext.instances.at(-1);
    synth.cancelNotes('arpeggiator');
    expect(synth.activeVoiceCount).toBe(0);
    expect(audio.oscillators.every((oscillator) => oscillator.stoppedAt === 0)).toBe(true);

    synth.handleMessage([0x90, 60, 100]);
    synth.handleMessage([0x80, 60, 0]);
    synth.allNotesOff();
    expect(synth.activeVoiceCount).toBe(0);
  } finally {
    if (originalAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = originalAudioContext;
  }
});

async function setupSoftSynthPage(page) {
  await page.addInitScript(() => {
    const oscillators = [];
    class Param {
      value = 0;
      setValueAtTime(value) { this.value = value; }
      setTargetAtTime(value) { this.value = value; }
      linearRampToValueAtTime(value) { this.value = value; }
      cancelScheduledValues() {}
      cancelAndHoldAtTime() {}
    }
    class Node {
      connect() {}
      disconnect() {}
    }
    window.AudioContext = class {
      get currentTime() { return performance.now() / 1000; }
      state = 'running';
      destination = new Node();
      createGain() { return Object.assign(new Node(), { gain: new Param() }); }
      createBiquadFilter() {
        return Object.assign(new Node(), { frequency: new Param(), Q: new Param() });
      }
      createPeriodicWave() { return {}; }
      createOscillator() {
        const oscillator = Object.assign(new Node(), {
          frequency: new Param(), detune: new Param(),
          setPeriodicWave() {},
          start(at) { this.startedAt = at; this.scheduledAt = performance.now() / 1000; },
          stop(at) { this.stoppedAt = at; },
        });
        oscillators.push(oscillator);
        return oscillator;
      }
    };
    const controller = Object.assign(new EventTarget(), {
      id: 'controller', name: 'Test controller', state: 'connected',
    });
    const sent = [];
    const access = Object.assign(new EventTarget(), {
      inputs: new Map([[controller.id, controller]]),
      outputs: new Map([['output', {
        id: 'output', name: 'reface CS', state: 'connected',
        send(data) { sent.push([...data]); },
      }]]),
    });
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
    window.softAudioTest = {
      oscillators, sent,
      emit(data) {
        const event = new Event('midimessage');
        event.data = new Uint8Array(data);
        controller.dispatchEvent(event);
      },
    };
  });
  await page.goto('/static/reface/');
}

test('SOFT button background and glow match the SSS logo across synth themes', async ({ page }) => {
  await setupSoftSynthPage(page);
  await page.locator('#soft-synth-mode').click();
  await expect(page.locator('#soft-synth-mode')).toHaveAttribute('aria-pressed', 'true');
  for (const mode of ['off', 'case', 'keys']) {
    await expect(page.locator('#dark-synth-mode')).toHaveAttribute('data-mode', mode);
    const color = await page.locator('#soft-synth-logo').evaluate((logo) => getComputedStyle(logo).stroke);
    const background = page.locator('#soft-synth-mode .arp-lens');
    await expect(background).toHaveCSS('fill', color);
    await expect(background).toHaveCSS('stroke', color);
    expect(await background.evaluate((lens) => getComputedStyle(lens).filter)).toContain(color);
    await page.locator('#dark-synth-mode').click();
  }
  await page.locator('#soft-synth-mode').click();
  await expect(page.locator('#soft-synth-mode')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#soft-synth-mode .arp-lens')).not.toHaveCSS('fill', 'rgb(39, 132, 179)');
});

test('pitch range reaches browser audio and controller playback is exclusive to SSS mode', async ({ page }) => {
  await setupSoftSynthPage(page);
  await page.locator('#midi-connect').click();
  await page.locator('#midi-controller-input').selectOption('controller');
  await page.evaluate(() => {
    window.softAudioTest.emit([0x90, 69, 100]);
    window.softAudioTest.emit([0x80, 69, 0]);
  });
  expect(await page.evaluate(() => window.softAudioTest.oscillators.length)).toBe(0);
  expect(await page.evaluate(() => window.softAudioTest.sent)).toContainEqual([0x90, 69, 100]);

  await page.locator('#soft-synth-mode').click();
  await expect(page.locator('#soft-synth-mode')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    window.softAudioTest.sent.length = 0;
    for (let index = 0; index < 10; index++) {
      document.querySelector('#pitch-range-down').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    window.softAudioTest.emit([0x90, 69, 100]);
    window.softAudioTest.emit([0xe0, 127, 127]);
  });
  await expect(page.locator('#pitch-range-value')).toHaveText('2');
  expect(await page.evaluate(() => window.softAudioTest.oscillators[0].detune.value)).toBeCloseTo(200, 0);
  await page.locator('#pitch-range-down').click();
  expect(await page.evaluate(() => window.softAudioTest.oscillators[0].detune.value)).toBeCloseTo(100, 0);
  expect(await page.evaluate(() => window.softAudioTest.sent)).toEqual([]);
  await page.evaluate(() => {
    window.softAudioTest.emit([0xb0, 72, 127]);
    window.softAudioTest.emit([0x80, 69, 0]);
  });
  await page.locator('#soft-synth-mode').click();
  expect(await page.evaluate(() => window.softAudioTest.oscillators.every(
    (oscillator) => oscillator.stoppedAt <= performance.now() / 1000,
  ))).toBe(true);
  const voiceNodes = await page.evaluate(() => window.softAudioTest.oscillators.length);
  await page.evaluate(() => window.softAudioTest.emit([0x90, 72, 100]));
  expect(await page.evaluate(() => window.softAudioTest.oscillators.length)).toBe(voiceNodes);
  expect(await page.evaluate(() => window.softAudioTest.sent)).toContainEqual([0x90, 72, 100]);
});

test('SSS arpeggio timestamps stay evenly spaced through a delayed timer and cancel on mode exit', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await setupSoftSynthPage(page);
  await page.locator('#midi-connect').click();
  await page.locator('#midi-controller-input').selectOption('controller');
  await page.locator('#soft-synth-mode').click();
  await expect(page.locator('#soft-synth-mode')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#arp-enabled').click();
  await page.evaluate(() => window.softAudioTest.emit([0x90, 60, 100]));
  await page.clock.runFor(950);
  await page.clock.fastForward(80);
  await page.clock.runFor(1000);
  const starts = await page.evaluate(() => window.softAudioTest.oscillators
    .filter((_, index) => index % 3 === 0)
    .map(({ startedAt, scheduledAt }) => ({ startedAt, scheduledAt })));
  expect(starts.length).toBeGreaterThan(12);
  for (let index = 1; index < starts.length; index++) {
    expect(starts[index].startedAt - starts[index - 1].startedAt).toBeCloseTo(0.125, 5);
  }
  expect(starts.every(({ startedAt, scheduledAt }) => startedAt > scheduledAt)).toBe(true);
  await page.locator('#soft-synth-mode').click();
  expect(await page.evaluate(() => window.softAudioTest.oscillators.every(
    (oscillator) => oscillator.stoppedAt <= performance.now() / 1000,
  ))).toBe(true);
  const count = await page.evaluate(() => window.softAudioTest.oscillators.length);
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => window.softAudioTest.oscillators.length)).toBe(count);
});

test('scheduled SSS arpeggios retain their note lengths when recorded in the looper', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await setupSoftSynthPage(page);
  await page.locator('#midi-connect').click();
  await page.locator('#midi-controller-input').selectOption('controller');
  await page.locator('#soft-synth-mode').click();
  await expect(page.locator('#soft-synth-mode')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#arp-latch').click();
  await page.locator('#arp-enabled').click();
  for (const step of [4, 2, 3]) {
    await page.locator(`#looper .position-label[data-step="${step}"]`).click();
  }
  await page.evaluate(() => window.softAudioTest.emit([0x90, 60, 100]));
  await page.clock.runFor(450);
  await page.evaluate(() => window.softAudioTest.emit([0x80, 60, 0]));
  await page.getByRole('button', { name: 'Save loop', exact: true }).click();
  const save = page.getByRole('dialog', { name: 'Save loop', exact: true });
  await save.getByLabel('Name').fill('Scheduled arp');
  await save.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.message-entry[data-source="looper-status"] .message-text').last())
    .toContainText('Saved loop "Scheduled arp"');
  const notes = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('refaceCS-loops', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const records = database.transaction('loops').objectStore('loops').getAll();
      records.onerror = () => { database.close(); reject(records.error); };
      records.onsuccess = () => {
        database.close();
        resolve(records.result.find((record) => record.name === 'Scheduled arp').loop.notes);
      };
    };
  }));
  expect(notes).toHaveLength(3);
  for (const [index, note] of notes.entries()) {
    expect(note.pitch).toBe(60);
    expect(note.start).toBeCloseTo(index * 0.25, 2);
    expect(note.duration).toBeCloseTo(0.125, 2);
  }
});

test('AMP selection via MIDI produces audible modulation in rendered Web Audio', async ({ page }) => {
  await page.goto('/static/reface/');
  await page.route('**/test-soft-synth.js', (route) => route.fulfill({
    path: fileURLToPath(new URL('../src/soft-synth.js', import.meta.url)),
    contentType: 'text/javascript',
  }));
  const levels = await page.evaluate(async () => {
    const { createSoftSynth } = await import('./test-soft-synth.js');
    const original = window.AudioContext;
    const result = [];
    try {
      for (const assignment of [0, 32]) {
        const audio = new OfflineAudioContext(1, 96000, 48000);
        Object.defineProperty(audio, 'state', { value: 'running' });
        window.AudioContext = function () { return audio; };
        const synth = createSoftSynth();
        synth.setControls({
          'osc-type': 1, 'osc-texture': 0, 'lfo-depth': 127, 'lfo-speed': 100,
          'eg-attack': 0, 'eg-decay': 0, 'eg-sustain': 127,
        });
        synth.handleMessage([0xb0, 78, assignment]);
        synth.handleMessage([0x90, 69, 100]);
        const samples = (await audio.startRendering()).getChannelData(0);
        const rms = [];
        for (let start = 24000; start < 90000; start += 480) {
          let sum = 0;
          for (let offset = 0; offset < 480; offset++) sum += samples[start + offset] ** 2;
          rms.push(Math.sqrt(sum / 480));
        }
        result.push(Math.max(...rms) / Math.min(...rms));
        synth.allNotesOff();
      }
    } finally {
      window.AudioContext = original;
    }
    return result;
  });
  expect(levels[0]).toBeLessThan(1.15);
  expect(levels[1]).toBeGreaterThan(5);
});

test('pulse texture moves from a square wave to a narrow pulse', async () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalInstances = FakeAudioContext.instances;
  FakeAudioContext.instances = [];
  globalThis.AudioContext = FakeAudioContext;
  try {
    const synth = createSoftSynth();
    synth.setControls({ 'osc-type': 1, 'osc-texture': 0 });
    synth.handleMessage([0x90, 69, 100]);

    const audio = FakeAudioContext.instances.at(-1);
    const oscillator = audio.oscillators[0];
    expect(oscillator.periodicWave.imag[1]).toBeCloseTo(4 / Math.PI);
    synth.setControl('osc-texture', 127);
    expect(oscillator.periodicWave.real[1]).toBeLessThan(0);

    synth.allNotesOff();
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    if (originalAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = originalAudioContext;
    FakeAudioContext.instances = originalInstances;
  }
});
