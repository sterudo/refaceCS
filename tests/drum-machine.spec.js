import { test, expect } from '@playwright/test';
import { DRUM_VOICES, createDrumAudio, defaultDrumLane } from '../src/drum-audio.js';
import { writeMidi } from '../src/midi-file.js';

const storageKey = 'refaceCS.drumPatterns.v1';

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const audio = { sources: [], nodes: [], contexts: [], failOutput: false };
    const param = () => ({
      value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
      cancelScheduledValues() {}, cancelAndHoldAtTime() {}, setTargetAtTime(value) { this.value = value; },
    });
    class FakeAudioContext extends EventTarget {
      constructor() {
        super();
        this.started = performance.now();
        this.state = 'suspended';
        this.sampleRate = 48000;
        this.baseLatency = 0.01;
        this.outputLatency = 0.02;
        this.sinkId = '';
        this.destination = {};
        audio.contexts.push(this);
      }
      get currentTime() { return (performance.now() - this.started) / 1000; }
      async resume() { this.state = 'running'; }
      getOutputTimestamp() {
        return { contextTime: Math.max(0, this.currentTime - 0.03), performanceTime: performance.now() };
      }
      createNode(kind) {
        const node = Object.assign(new EventTarget(), {
          kind, gain: param(), frequency: param(), Q: param(), threshold: param(), knee: param(),
          ratio: param(), attack: param(), release: param(),
          connect(target) { return target; }, disconnect() {},
          start: (at) => {
            node.at = at;
            node.audibleAt = this.started + (at + 0.03) * 1000;
            audio.sources.push(node);
          },
          stop(at) { this.stopAt = at; },
        });
        audio.nodes.push(node);
        return node;
      }
      createGain() { return this.createNode('gain'); }
      createDynamicsCompressor() { return this.createNode('compressor'); }
      createBiquadFilter() { return this.createNode('filter'); }
      createOscillator() { return this.createNode('oscillator'); }
      createBufferSource() { return this.createNode('noise'); }
      createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
      async setSinkId(id) {
        if (audio.failOutput) throw new Error('device unavailable');
        this.sinkId = id;
      }
    }
    window.AudioContext = FakeAudioContext;
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [
      { kind: 'audiooutput', deviceId: 'speakers', label: 'Studio speakers' },
      { kind: 'audiooutput', deviceId: 'headphones', label: 'Headphones' },
    ] });
    Object.defineProperty(navigator.mediaDevices, 'selectAudioOutput', {
      configurable: true, value: async () => ({ deviceId: 'headphones', label: 'Headphones' }),
    });
    const sent = [];
    const delivered = [];
    const pending = new Map();
    const output = {
      id: 'ro', name: 'reface CS', state: 'connected',
      send(data, at) {
        const event = { data: [...data], at: at ?? performance.now(), submitted: performance.now(), cancelled: false };
        sent.push(event);
        if ((at === undefined || at <= performance.now()) && !window.drumTest.bufferImmediate) delivered.push(event);
        else {
          const timer = setTimeout(() => { pending.delete(timer); delivered.push(event); }, Math.max(0, event.at - performance.now()));
          pending.set(timer, event);
        }
      },
      clear() {
        for (const [timer, event] of pending) { clearTimeout(timer); event.cancelled = true; }
        pending.clear();
      },
    };
    const access = new EventTarget();
    access.sysexEnabled = true;
    const input = (id, name) => Object.assign(new EventTarget(), { id, name, state: 'connected' });
    access.inputs = new Map([['ri', input('ri', 'reface CS')], ['ci', input('ci', 'Drum controller')]]);
    access.outputs = new Map([['ro', output]]);
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
    window.drumTest = {
      audio, access, sent, delivered, bufferImmediate: false,
      emit(data, id = 'ci', at = performance.now()) {
        const event = new Event('midimessage');
        event.data = new Uint8Array(data);
        Object.defineProperty(event, 'timeStamp', { value: at });
        access.inputs.get(id).dispatchEvent(event);
      },
    };
  });
  await page.goto('/static/reface/');
  await page.locator('#midi-connect').click();
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
});

const lane = (page, voice) => page.locator(`.drum-lane[data-voice="${voice}"]`);
const step = (page, voice, index) => lane(page, voice).locator('.drum-step').nth(index);
const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
async function loadLoop(page, notes = [{ start: 0, playDuration: 0.25, channel: 0, pitch: 60, velocity: 90 }]) {
  const phrase = writeMidi(notes, 4, 120, 4);
  await page.locator('#looper-file').setInputFiles({
    name: 'sync.mid', mimeType: 'audio/midi', buffer: Buffer.from(phrase),
  });
}
async function mode(page, value) {
  await page.locator(`#looper .position-label[data-step="${value}"]`).click();
}
async function delayAudioEnable(page) {
  await page.evaluate(() => {
    AudioContext.prototype.resume = function () {
      return new Promise((resolve) => {
        window.drumTest.resumeAudio = () => { this.state = 'running'; resolve(); };
      });
    };
  });
}

test('panel placement, velocity direction, accessible clearing, and preserved 3/4 steps', async ({ page }) => {
  expect(await page.locator('#groove-panel').evaluate((panel) =>
    panel.previousElementSibling.classList.contains('instrument-scroll') && panel.nextElementSibling.id === 'patch-library')).toBe(true);
  await expect(page.locator('.drum-lane')).toHaveCount(4);
  for (const value of [5, 4, 3, 2, 1, 2, 3, 4, 5, 4]) {
    await step(page, 'kick', 0).click();
    await expect(step(page, 'kick', 0)).toHaveAttribute('data-level', String(value));
    await expect(step(page, 'kick', 0)).toHaveAttribute('title', new RegExp(`level ${value}/5, MIDI velocity ${Math.round(value * 127 / 5)}`));
  }
  await step(page, 'kick', 0).click({ button: 'right' });
  await expect(step(page, 'kick', 0)).toHaveAttribute('data-level', '0');
  await step(page, 'kick', 15).click();
  await page.locator('#looper-meter').click();
  await expect(lane(page, 'kick').locator('.drum-step:visible')).toHaveCount(12);
  await expect(step(page, 'kick', 15)).toBeHidden();
  await page.locator('#looper-meter').click();
  await expect(step(page, 'kick', 15)).toHaveAttribute('data-level', '5');
  await step(page, 'kick', 15).focus();
  await page.keyboard.press('Delete');
  await expect(step(page, 'kick', 15)).toHaveAttribute('data-level', '0');
  await page.locator('#groove-panel > summary').click();
  await expect(page.locator('#drum-play')).toBeHidden();
  await expect(page.locator('#patch-library')).toBeVisible();
});

test('named patterns persist independent lanes, velocities, and sound settings across reloads', async ({ page }) => {
  await step(page, 'kick', 0).click();
  await page.locator('#drum-tone-toggle').click();
  await lane(page, 'kick').getByRole('slider', { name: 'Kick tune', exact: true }).fill('7');
  await page.locator('#drum-instrument').selectOption('low-tom');
  await page.locator('#drum-add').click();
  page.once('dialog', (dialog) => dialog.accept('Breakbeat'));
  await page.locator('#drum-copy').click();
  await step(page, 'snare', 4).click();
  await lane(page, 'low-tom').getByRole('button', { name: 'Remove Low tom lane' }).click();
  await page.locator('#drum-instrument').selectOption('clap');
  await page.locator('#drum-add').click();
  await step(page, 'clap', 12).click();
  await page.reload();
  await expect(page.locator('#drum-pattern option:checked')).toHaveText('Breakbeat');
  await expect(step(page, 'kick', 0)).toHaveAttribute('data-level', '5');
  await page.locator('#drum-tone-toggle').click();
  await expect(lane(page, 'kick').getByRole('slider', { name: 'Kick tune', exact: true })).toHaveValue('7');
  await expect(lane(page, 'low-tom')).toHaveCount(0);
  await expect(step(page, 'clap', 12)).toHaveAttribute('data-level', '5');
  await page.locator('#drum-pattern').selectOption({ label: 'Pattern 1' });
  await expect(step(page, 'snare', 4)).toHaveAttribute('data-level', '0');
  await expect(lane(page, 'low-tom')).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept('Original'));
  await page.locator('#drum-rename').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#drum-delete').click();
  await expect(page.locator('#drum-pattern option')).toHaveCount(1);
  expect((await stored(page)).patterns[0].name).toBe('Breakbeat');
});

test('invalid saved patterns and storage failures are reported without blocking the synth', async ({ page }) => {
  await page.evaluate((key) => localStorage.setItem(key, '{"version":1,"patterns":[]}'), storageKey);
  await page.reload();
  await expect(page.locator('#drum-storage-status')).toContainText('invalid format');
  await page.evaluate(() => {
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'refaceCS.drumPatterns.v1') throw new Error('storage is full');
      return save.call(this, key, value);
    };
  });
  await step(page, 'kick', 0).click();
  await expect(page.locator('#drum-storage-status')).toContainText('storage is full');
  await expect(page.locator('#app-status')).not.toHaveText('Loading panel...');
});

test('channel-10 drums stay internal, preserve velocity, and do not enter the melodic looper', async ({ page }) => {
  await page.evaluate(() => window.drumTest.emit([0x99, 36, 90]));
  await expect(page.locator('#drum-status')).toContainText('Enable drum audio');
  await page.locator('#drum-enable').click();
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await page.evaluate(() => {
    window.drumTest.emit([0x99, 36, 90]);
    window.drumTest.emit([0x89, 36, 0]);
    window.drumTest.emit([0x99, 38, 0]);
    window.drumTest.emit([0xb9, 74, 100]);
  });
  expect(await page.evaluate(() => window.drumTest.audio.sources.map((source) => source.kind))).toEqual(['oscillator', 'noise']);
  expect(await page.evaluate(() => window.drumTest.sent)).toEqual([]);
  await expect(page.locator('#looper-status')).toContainText('armed');
  await page.evaluate(() => window.drumTest.emit([0x90, 60, 85]));
  expect(await page.evaluate(() => window.drumTest.delivered.map((event) => event.data))).toEqual([[0x90, 60, 85]]);
});

test('drums schedule ahead, omit hidden steps in 3/4, and cancel queued hits on stop', async ({ page }) => {
  await step(page, 'kick', 0).click();
  await step(page, 'snare', 12).click();
  await page.locator('#looper-meter').click();
  await page.locator('#drum-play').click();
  const first = await page.evaluate(() => ({
    now: performance.now(), sources: window.drumTest.audio.sources.map((source) => ({ kind: source.kind, audibleAt: source.audibleAt })),
  }));
  expect(first.sources[0].audibleAt - first.now).toBeCloseTo(150, 0);
  await page.clock.runFor(4500);
  expect(await page.evaluate(() => window.drumTest.audio.sources.filter((source) => source.kind === 'oscillator').length)).toBe(4);
  await page.locator('#drum-stop').click();
  const count = await page.evaluate(() => window.drumTest.audio.sources.length);
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(count);
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
});

for (const offset of [-600, -250, -40, 60, 250, 600]) test(`linked start schedules MIDI with a ${offset} ms offset and cancels future MIDI`, async ({ page }) => {
  await loadLoop(page);
  await step(page, 'kick', 0).click();
  await page.locator('#drum-offset').fill(String(offset));
  await page.locator('#drum-offset').dispatchEvent('change');
  await page.locator('#drum-linked').check();
  await page.locator('#drum-play').click();
  const start = await page.evaluate(() => ({
    now: performance.now(),
    kick: window.drumTest.audio.sources.find((source) => source.kind === 'oscillator').audibleAt,
    midi: window.drumTest.sent.find((event) => event.data[0] === 0x90),
  }));
  expect(start.midi.at - start.kick).toBeCloseTo(offset, 0);
  expect(start.midi.at).toBeGreaterThan(start.now);
  expect(await page.evaluate(() => window.drumTest.delivered.filter((event) => event.data[0] === 0x90))).toEqual([]);
  await mode(page, 0);
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.drumTest.delivered.filter((event) => event.data[0] === 0x90))).toEqual([]);
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
});

test('starting the looper can start both, while unlinked drums remain independent', async ({ page }) => {
  await loadLoop(page);
  await mode(page, 2);
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
  await mode(page, 0);
  const deliveredBefore = await page.evaluate(() => window.drumTest.delivered.length);
  await page.locator('#drum-linked').check();
  await mode(page, 2);
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#looper-status')).toContainText('playing');
  const note = await page.evaluate(() => window.drumTest.sent.filter((event) => event.data[0] === 0x90).at(-1));
  expect(note.at).toBeGreaterThan(note.submitted);
  await page.clock.runFor(200);
  await page.locator('#drum-stop').click();
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
  const count = await page.evaluate(() => window.drumTest.audio.sources.length);
  await page.clock.runFor(2500);
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(count);
  const delivered = await page.evaluate((before) => window.drumTest.delivered.slice(before)
    .filter((event) => [0x80, 0x90].includes(event.data[0])), deliveredBefore);
  expect(delivered.filter((event) => event.data[0] === 0x90).map((event) => event.data)).toEqual([[0x90, 60, 90]]);
  expect(delivered.at(-1).data).toEqual([0x80, 60, 0]);
});

for (const stoppedMode of [0, 1]) test(`linked drums stop when the looper is already at ${stoppedMode === 0 ? 'Stop' : 'Pause'}`, async ({ page }) => {
  await mode(page, stoppedMode);
  await step(page, 'kick', 0).click();
  await page.locator('#drum-play').click();
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', String(stoppedMode));
  await page.locator('#drum-linked').check();
  await mode(page, stoppedMode);
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
  const count = await page.evaluate(() => window.drumTest.audio.sources.length);
  await page.clock.runFor(2500);
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(count);
});

test('late looper starts align to the running drum bar and shared tempo changes preserve phase', async ({ page }) => {
  await loadLoop(page);
  await step(page, 'kick', 0).click();
  await page.locator('#drum-play').click();
  const kickAt = await page.evaluate(() => window.drumTest.audio.sources[0].audibleAt);
  await page.clock.runFor(500);
  await mode(page, 2);
  const note = await page.evaluate(() => window.drumTest.sent.find((event) => event.data[0] === 0x90));
  expect(note.at - kickAt).toBeCloseTo(2000, 0);
  await page.clock.runFor(1800);
  await page.locator('#drum-tempo').fill('60');
  await page.locator('#drum-tempo').dispatchEvent('change');
  await expect(page.locator('#tempo')).toHaveAttribute('aria-valuenow', '60');
  await page.clock.runFor(4500);
  const times = await page.evaluate(() => ({
    kicks: window.drumTest.audio.sources.filter((source) => source.kind === 'oscillator' && source.stopAt > source.at).map((source) => source.audibleAt),
    midi: window.drumTest.sent.filter((event) => event.data[0] === 0x90 && !event.cancelled).map((event) => event.at),
  }));
  for (const at of times.midi.slice(1)) {
    expect(Math.min(...times.kicks.map((kick) => Math.abs(at - kick)))).toBeLessThan(2);
  }
});

test('live notes cancel and refill scheduled MIDI without stale note-offs cutting newer notes', async ({ page }) => {
  await loadLoop(page, [{ start: 0, playDuration: 1, channel: 0, pitch: 60, velocity: 90 }]);
  await page.locator('#drum-enable').click();
  await mode(page, 2);
  await page.clock.runFor(200);
  await page.evaluate(() => window.drumTest.emit([0x90, 60, 80]));
  await page.clock.runFor(40);
  await page.evaluate(() => window.drumTest.emit([0x80, 60, 0]));
  await page.clock.runFor(600);
  const notes = await page.evaluate(() => window.drumTest.delivered
    .filter((event) => [0x80, 0x90].includes(event.data[0])).map((event) => event.data));
  expect(notes).toEqual([[0x90, 60, 90], [0x80, 60, 0], [0x90, 60, 80], [0x80, 60, 0]]);
  await mode(page, 0);
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => window.drumTest.delivered.filter((event) => event.data[0] === 0x90).length)).toBe(2);
});

const playbackCombinations = [
  { name: 'manual', manual: true },
  { name: 'arpeggiator', arp: true },
  { name: 'latched arpeggiator', arp: true, latch: true },
  { name: 'looper', loop: true },
  { name: 'manual + looper without audio scheduling', manual: true, loop: true, immediate: true },
  { name: 'arpeggiator + looper', arp: true, loop: true },
  { name: 'latched arpeggiator + looper', arp: true, latch: true, loop: true },
  { name: 'manual + arpeggiator + looper', manual: true, arp: true, loop: true },
  { name: 'manual + latched arpeggiator + looper', manual: true, arp: true, latch: true, loop: true },
];

for (const combination of playbackCombinations) {
  for (const stop of ['drum button', 'looper fader']) {
    test(`Stop resets ${combination.name} using the ${stop}`, async ({ page }) => {
      if (combination.loop) {
        await loadLoop(page, [{ start: 0, playDuration: 3, channel: 0, pitch: 60, velocity: 90 }]);
      }
      if (combination.arp) {
        if (!combination.latch) await page.locator('#arp-latch').click();
        await page.locator('#arp-enabled').click();
        await page.evaluate(() => window.drumTest.emit([0x90, 60, 85]));
        if (combination.latch) await page.evaluate(() => window.drumTest.emit([0x80, 60, 0]));
      }
      if (!combination.immediate) await page.locator('#drum-enable').click();
      if (combination.loop) await mode(page, 2);
      if (!combination.immediate) {
        await step(page, 'kick', 0).click();
        await page.locator('#drum-play').click();
      }
      await page.clock.runFor(170);
      if (combination.manual) {
        await page.evaluate(() => document.activeElement.blur());
        await page.keyboard.down('a');
        await page.evaluate(() => {
          window.drumTest.emit([0x90, 60, 95], 'ri');
          window.drumTest.emit([0xb3, 64, 127], 'ri');
          window.drumTest.emit([0xb2, 64, 127]);
        });
      }
      await page.clock.runFor(2300);
      const stacked = await page.evaluate(() => {
        const active = new Map();
        const stacked = [];
        for (const { data } of window.drumTest.delivered) {
          const type = data[0] & 0xf0;
          if (type !== 0x80 && type !== 0x90) continue;
          const key = `${data[0] & 0x0f}:${data[1]}`;
          const count = active.get(key) || 0;
          if (type === 0x90 && data[2]) {
            if (count) stacked.push(data);
            active.set(key, count + 1);
          } else active.set(key, Math.max(0, count - 1));
        }
        return stacked;
      });
      expect(stacked).toEqual([]);
      const before = await page.evaluate(() => window.drumTest.delivered.length);
      if (stop === 'drum button') await page.locator('#drum-stop').click();
      else await mode(page, 0);
      await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
      await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('#midi-status')).toContainText('MIDI reset messages sent');
      await expect(page.locator('#arp-held-notes')).toHaveText('None');
      const reset = await page.evaluate((before) => window.drumTest.delivered.slice(before)
        .map((event) => event.data), before);
      for (let channel = 0; channel < 16; channel++) {
        for (const cc of [64, 123, 120]) expect(reset).toContainEqual([0xb0 | channel, cc, 0]);
      }
      const counts = await page.evaluate(() => ({
        midi: window.drumTest.delivered.length, audio: window.drumTest.audio.sources.length,
      }));
      await page.keyboard.up('a');
      await page.evaluate(() => {
        window.drumTest.emit([0x80, 60, 0], 'ri');
        window.drumTest.emit([0x80, 60, 0]);
      });
      await page.clock.runFor(3000);
      expect(await page.evaluate(() => ({
        midi: window.drumTest.delivered.length, audio: window.drumTest.audio.sources.length,
      }))).toEqual(counts);
      if (combination.arp) await page.locator('#arp-enabled').click();
      const start = await page.evaluate(() => window.drumTest.delivered.length);
      await page.keyboard.down('a');
      await page.keyboard.up('a');
      expect(await page.evaluate((start) => window.drumTest.delivered.slice(start)
        .map((event) => event.data), start)).toEqual([[0x90, 60, 100], [0x80, 60, 0]]);
    });
  }
}

test('Stop resends tracked note-offs after flushing buffered MIDI messages', async ({ page }) => {
  await loadLoop(page, [{ start: 0, playDuration: 3, channel: 0, pitch: 60, velocity: 90 }]);
  await page.locator('#drum-enable').click();
  await mode(page, 2);
  await page.clock.runFor(200);
  const before = await page.evaluate(() => {
    window.drumTest.bufferImmediate = true;
    return window.drumTest.delivered.length;
  });
  await mode(page, 0);
  await page.clock.runFor(1);
  const reset = await page.evaluate((before) => window.drumTest.delivered.slice(before)
    .map((event) => event.data), before);
  expect(reset).toContainEqual([0x80, 60, 0]);
  expect(reset).toContainEqual([0xb0, 64, 0]);
  expect(reset).toContainEqual([0xb0, 120, 0]);
  const count = await page.evaluate(() => window.drumTest.delivered.length);
  await page.clock.runFor(2500);
  expect(await page.evaluate(() => window.drumTest.delivered.length)).toBe(count);
});

test('Stop reports a failed driver-queue flush instead of claiming reset succeeded', async ({ page }) => {
  await loadLoop(page);
  await page.locator('#drum-enable').click();
  await mode(page, 2);
  await page.evaluate(() => {
    window.drumTest.access.outputs.get('ro').clear = () => { throw new Error('queue busy'); };
  });
  await mode(page, 0);
  await expect(page.locator('#midi-status')).toContainText('MIDI reset failed');
  await expect(page.locator('#midi-status')).toContainText('queue busy');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
});

for (const fixedRecording of [false, true]) {
  for (const stop of ['#drum-stop', '#looper .position-label[data-step="0"]']) {
    test(`one Stop does not generate notes while finalizing ${fixedRecording ? 'a fixed recording' : 'overdue playback'} via ${stop}`, async ({ page }) => {
      await page.evaluate(() => {
        window.drumTest.bufferImmediate = true;
        const port = window.drumTest.access.outputs.get('ro');
        const send = port.send.bind(port);
        port.send = (data, at) => {
          if ((data[0] & 0xf0) !== 0x90 || !data[2]) return send(data, at);
          const event = { data: [...data], at: at ?? performance.now(), submitted: performance.now(), cancelled: false };
          window.drumTest.sent.push(event);
          // Model Note Ons already handed to a driver, beyond clear()'s queue.
          setTimeout(() => window.drumTest.delivered.push(event), Math.max(0, event.at - performance.now()) + 10);
        };
      });
      if (fixedRecording) {
        await page.locator('#drum-enable').click();
        await page.locator('#looper-bars-up').click();
        await mode(page, 4);
        await mode(page, 2);
        await mode(page, 3);
        await page.evaluate(() => window.drumTest.emit([0x90, 60, 90]));
        await page.clock.runFor(100);
        await page.evaluate(() => window.drumTest.emit([0x80, 60, 0]));
        await page.clock.runFor(1890);
      } else {
        await loadLoop(page, [
          { start: 0, playDuration: 0.5, channel: 0, pitch: 60, velocity: 90 },
          { start: 1, playDuration: 1, channel: 0, pitch: 64, velocity: 90 },
        ]);
        await mode(page, 2);
        await page.clock.runFor(200);
      }
      const duringStop = await page.evaluate(({ stop, jump }) => {
        const descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
        const now = performance.now.bind(performance);
        const before = window.drumTest.sent.length;
        Object.defineProperty(performance, 'now', { configurable: true, value: () => now() + jump });
        try {
          const button = document.querySelector(stop);
          if (stop === '#drum-stop') button.click();
          else button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
          return window.drumTest.sent.slice(before).map((event) => event.data);
        } finally {
          if (descriptor) Object.defineProperty(performance, 'now', descriptor);
          else delete performance.now;
        }
      }, { stop, jump: fixedRecording ? 20 : 400 });
      await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
      await expect(page.locator('#midi-status')).toContainText('MIDI reset messages sent');
      await page.clock.runFor(20);
      const sounding = await page.evaluate(() => {
        const active = new Set();
        for (const { data } of window.drumTest.delivered) {
          const type = data[0] & 0xf0;
          const channel = data[0] & 0x0f;
          const key = `${channel}:${data[1]}`;
          if (type === 0x90 && data[2]) active.add(key);
          else if (type === 0x80 || type === 0x90) active.delete(key);
          else if (type === 0xb0 && [120, 123].includes(data[1])) {
            for (const note of active) if (note.startsWith(`${channel}:`)) active.delete(note);
          }
        }
        return [...active];
      });
      expect(sounding).toEqual([]);
      expect(duringStop.filter((data) => (data[0] & 0xf0) === 0x90 && data[2])).toEqual([]);
      const count = await page.evaluate(() => window.drumTest.delivered.length);
      await page.clock.runFor(2500);
      expect(await page.evaluate(() => window.drumTest.delivered.length)).toBe(count);
    });
  }
}

test('changing compensation and muting cancel stale events without hanging notes', async ({ page }) => {
  await loadLoop(page, [{ start: 0, playDuration: 2, channel: 0, pitch: 60, velocity: 90 }]);
  await page.locator('#drum-enable').click();
  await mode(page, 2);
  await page.clock.runFor(250);
  await page.locator('#drum-offset').fill('250');
  await page.locator('#drum-offset').dispatchEvent('change');
  await page.clock.runFor(250);
  await page.locator('#volume-mute').click();
  const mutedCount = await page.evaluate(() => window.drumTest.delivered.filter((event) => event.data[0] === 0x90).length);
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => window.drumTest.delivered.filter((event) => event.data[0] === 0x90).length)).toBe(mutedCount);
  await page.locator('#volume-mute').click();
  await page.clock.runFor(200);
  await mode(page, 0);
  const held = await page.evaluate(() => {
    const active = new Set();
    for (const { data } of window.drumTest.delivered) {
      if (data[0] === 0x90 && data[2]) active.add(data[1]);
      if (data[0] === 0x80 || (data[0] === 0x90 && !data[2])) active.delete(data[1]);
    }
    return [...active];
  });
  expect(held).toEqual([]);
  const stoppedCount = await page.evaluate(() => window.drumTest.delivered.length);
  await page.clock.runFor(3000);
  expect(await page.evaluate(() => window.drumTest.delivered.length)).toBe(stoppedCount);
});

test('a scheduler stall skips missed notes rather than bursting stale loops', async ({ page }) => {
  await loadLoop(page);
  await page.locator('#drum-enable').click();
  await mode(page, 2);
  await page.clock.runFor(500);
  const before = await page.evaluate(() => window.drumTest.sent.length);
  await page.clock.fastForward(30000);
  const after = await page.evaluate(() => window.drumTest.sent.slice(-3));
  expect(await page.evaluate(() => window.drumTest.sent.length)).toBeLessThan(before + 4);
  expect(after.filter((event) => event.data[0] === 0x90).length).toBeLessThan(3);
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '2');
});

test('fixed-bar recording and quantized overdubbing continue over a running groove', async ({ page }) => {
  await step(page, 'kick', 0).click();
  await page.locator('#drum-play').click();
  await page.locator('#looper-bars-up').click();
  await page.locator('#looper-quantize').click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: '1/16', exact: true }).click();
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await page.clock.runFor(150);
  await page.evaluate(() => window.drumTest.emit([0x90, 60, 85]));
  await page.clock.runFor(125);
  await page.evaluate(() => window.drumTest.emit([0x80, 60, 0]));
  await page.clock.runFor(2000);
  await page.evaluate(() => window.drumTest.emit([0x90, 67, 75]));
  await page.clock.runFor(125);
  await page.evaluate(() => window.drumTest.emit([0x80, 67, 0]));
  await page.clock.runFor(4000);
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '3');
  const notes = await page.evaluate(() => window.drumTest.delivered.filter((event) => event.data[0] === 0x90));
  expect(notes.filter((event) => event.data[1] === 60).length).toBeGreaterThanOrEqual(3);
  expect(notes.filter((event) => event.data[1] === 67).length).toBeGreaterThanOrEqual(2);
  await page.locator('#midi-reset').click();
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
});

test('output selection, device failure, and suspension are surfaced explicitly', async ({ page }) => {
  await page.locator('#drum-enable').click();
  await page.locator('#drum-output').selectOption('speakers');
  await expect(page.locator('#drum-output-status')).toContainText('Studio speakers');
  await page.locator('#drum-output-choose').click();
  await expect(page.locator('#drum-output')).toHaveValue('headphones');
  await page.evaluate(() => { window.drumTest.audio.failOutput = true; });
  await page.locator('#drum-output').selectOption('speakers');
  await expect(page.locator('#drum-output-status')).toContainText('device unavailable');
  await expect(page.locator('#drum-output')).toHaveValue('headphones');
  await page.locator('#drum-play').click();
  await page.evaluate(() => {
    const context = window.drumTest.audio.contexts[0];
    context.state = 'suspended';
    context.dispatchEvent(new Event('statechange'));
  });
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#drum-status')).toContainText('suspended');
});

test('compact square geometry, larger velocity text, accessible icons, and initially hidden sound controls', async ({ page }) => {
  await expect(lane(page, 'kick').locator('.drum-voice-controls')).toBeHidden();
  await expect(page.locator('#drum-tone-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#drum-tone-toggle').click();
  await expect(lane(page, 'kick').getByRole('slider')).toHaveCount(4);
  await page.locator('#drum-tone-toggle').click();
  await expect(lane(page, 'kick').locator('.drum-voice-controls')).toBeHidden();
  await expect(lane(page, 'kick').getByRole('button', { name: 'Remove Kick lane' }).locator('svg')).toBeVisible();
  for (const meter of ['4', '3']) {
    await page.locator('#drum-meter').selectOption(meter);
    await step(page, 'kick', 0).click();
    const sizes = await step(page, 'kick', 0).evaluate((button, meter) => {
      const grid = button.parentElement;
      const current = button.getBoundingClientRect();
      const font = parseFloat(getComputedStyle(button).fontSize);
      const before = [grid.style.cssText, button.style.cssText];
      grid.style.width = '100%';
      grid.style.gap = '0.3rem';
      grid.style.gridTemplateColumns = `repeat(${Number(meter) * 4}, minmax(1.7rem, 1fr))`;
      button.style.fontSize = '0.65rem';
      const original = button.getBoundingClientRect();
      const originalFont = parseFloat(getComputedStyle(button).fontSize);
      [grid.style.cssText, button.style.cssText] = before;
      return { width: current.width, height: current.height, font,
        originalWidth: original.width, originalHeight: original.height, originalFont };
    }, meter);
    expect(sizes.width / sizes.originalWidth).toBeCloseTo(0.5, 2);
    expect(sizes.height / sizes.originalHeight).toBeCloseTo(0.5, 2);
    expect(sizes.width).toBeCloseTo(sizes.height, 1);
    expect(sizes.font / sizes.originalFont).toBeCloseTo(1.5, 2);
  }
  const icons = await page.evaluate(() => ({
    play: getComputedStyle(document.querySelector('#drum-play')).color,
    stop: getComputedStyle(document.querySelector('#drum-stop')).color,
    playText: document.querySelector('#drum-play').textContent.trim(),
    stopText: document.querySelector('#drum-stop').textContent.trim(),
  }));
  const [red, green, blue] = icons.play.match(/\d+/g).map(Number);
  expect(green).toBeGreaterThan(red);
  expect(green).toBeGreaterThan(blue);
  expect(icons.stop).toBe('rgb(255, 255, 255)');
  expect(icons.playText).toBe('');
  expect(icons.stopText).toBe('');
});

test('tempo and volume wheels update their actual targets and meter selection syncs both directions', async ({ page }) => {
  await page.locator('#drum-enable').click();
  const wheel = async (id, properties) => page.locator(id).evaluate((input, properties) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...properties });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  }, properties);
  expect(await wheel('#drum-tempo', { deltaY: -10 })).toBe(true);
  await expect(page.locator('#drum-tempo')).toHaveValue('121');
  await expect(page.locator('#tempo')).toHaveAttribute('aria-valuenow', '121');
  await expect(page.locator('#arp-tempo')).toHaveAttribute('data-value', '121');
  await wheel('#drum-tempo', { deltaY: -10, altKey: true });
  await expect(page.locator('#arp-tempo')).toHaveAttribute('data-value', '131');
  expect(await wheel('#drum-tempo', { deltaY: 10, ctrlKey: true })).toBe(false);
  expect(await wheel('#drum-tempo', { deltaX: 20, deltaY: 1 })).toBe(false);
  await expect(page.locator('#drum-tempo')).toHaveValue('131');
  await wheel('#drum-volume', { deltaY: -10 });
  await expect(page.locator('#drum-volume')).toHaveValue('81');
  expect((await stored(page)).volume).toBe(81);
  expect(await page.evaluate(() => window.drumTest.audio.nodes.find((node) => node.kind === 'gain').gain.value)).toBeCloseTo(0.486);
  await page.locator('#drum-volume').fill('100');
  await wheel('#drum-volume', { deltaY: -10 });
  await expect(page.locator('#drum-volume')).toHaveValue('100');
  await page.locator('#drum-meter').selectOption('3');
  await expect(page.locator('#looper-meter text')).toHaveText('3/4');
  await expect(lane(page, 'kick').locator('.drum-step:visible')).toHaveCount(12);
  await page.locator('#looper-meter').click();
  await expect(page.locator('#drum-meter')).toHaveValue('4');
});

test('Space toggles linked transport without activating a focused step or editing field', async ({ page }) => {
  await loadLoop(page);
  await page.locator('#drum-linked').check();
  await step(page, 'kick', 0).click();
  await step(page, 'kick', 0).press('Space');
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '2');
  await expect(step(page, 'kick', 0)).toHaveAttribute('data-level', '5');
  await step(page, 'kick', 0).press('Space');
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
  await page.locator('#drum-tempo').press('Space');
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#drum-play').press('Space');
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#drum-play').dispatchEvent('keydown', { key: ' ', code: 'Space', repeat: true });
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'true');
  await mode(page, 1);
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#drum-linked').uncheck();
  await page.locator('#drum-play').click();
  await mode(page, 1);
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'true');
  await mode(page, 0);
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
});

for (const linked of [true, false]) test(`looper pause ${linked ? 'cancels linked' : 'preserves independent'} pending audio startup`, async ({ page }) => {
  await delayAudioEnable(page);
  await page.locator('#drum-linked').setChecked(linked);
  await step(page, 'kick', 0).click();
  await page.locator('#drum-play').click();
  await mode(page, 1);
  await page.evaluate(() => window.drumTest.resumeAudio());
  await page.clock.runFor(1000);
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', String(!linked));
  expect(await page.evaluate(() => window.drumTest.audio.sources.length > 0)).toBe(!linked);
});

test('solo and mute gate scheduled and MIDI hits, silence active voices, and save with a pattern', async ({ page }) => {
  await step(page, 'kick', 0).click();
  await step(page, 'snare', 0).click();
  await lane(page, 'kick').getByRole('button', { name: 'Solo Kick', exact: true }).click();
  await page.locator('#drum-play').click();
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(2);
  await page.evaluate(() => window.drumTest.emit([0x99, 38, 100]));
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(2);
  await lane(page, 'kick').getByRole('button', { name: 'Mute Kick', exact: true }).click();
  expect(await page.evaluate(() => window.drumTest.audio.sources.every((source) => source.stopAt <= source.at))).toBe(true);
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(2);
  await lane(page, 'snare').getByRole('button', { name: 'Solo Snare', exact: true }).click();
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(4);
  await page.evaluate(() => {
    window.drumTest.emit([0x99, 36, 100]);
    window.drumTest.emit([0x99, 42, 100]);
  });
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(4);
  await page.evaluate(() => window.drumTest.emit([0x99, 38, 100]));
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(6);
  await page.reload();
  await expect(lane(page, 'kick').getByRole('button', { name: 'Solo Kick', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(lane(page, 'kick').getByRole('button', { name: 'Mute Kick', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(lane(page, 'snare').getByRole('button', { name: 'Solo Snare', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(step(page, 'kick', 0)).toHaveAttribute('data-level', '5');
});

test('older eight-lane patterns are preserved while new patterns start with four lanes', async ({ page }) => {
  const lanes = DRUM_VOICES.slice(0, 8).map((voice) => {
    const { solo, muted, ...lane } = defaultDrumLane(voice);
    return lane;
  });
  lanes[0].steps[0] = 4;
  await page.evaluate(({ key, lanes }) => localStorage.setItem(key, JSON.stringify({
    version: 1, patterns: [{ id: 'existing', name: 'Existing groove', lanes }],
    selected: 'existing', volume: 70, offset: -80, linked: true,
  })), { key: storageKey, lanes });
  await page.reload();
  await expect(page.locator('.drum-lane')).toHaveCount(8);
  await expect(step(page, 'kick', 0)).toHaveAttribute('data-level', '4');
  await expect(lane(page, 'kick').getByRole('button', { name: 'Mute Kick', exact: true })).toHaveAttribute('aria-pressed', 'false');
  page.once('dialog', (dialog) => dialog.accept('New groove'));
  await page.locator('#drum-new').click();
  await expect(page.locator('.drum-lane')).toHaveCount(4);
  await expect(step(page, 'kick', 0)).toHaveAttribute('data-level', '0');
  await page.locator('#drum-pattern').selectOption('existing');
  await expect(page.locator('.drum-lane')).toHaveCount(8);
  await expect(step(page, 'kick', 0)).toHaveAttribute('data-level', '4');
});

test('100 BPM calibration retains the latest reface Note On delay and applies it positively on Done', async ({ page }) => {
  await loadLoop(page);
  await step(page, 'kick', 0).click();
  await page.locator('#drum-tempo').fill('143');
  await page.locator('#drum-tempo').dispatchEvent('change');
  const patterns = (await stored(page)).patterns;
  await page.locator('#drum-play').click();
  await mode(page, 2);
  const before = await page.evaluate(() => window.drumTest.audio.sources.length);
  await page.getByRole('button', { name: 'Calibrate MIDI offset', exact: true }).click();
  await expect(page.locator('#drum-calibration')).toBeVisible();
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
  await page.evaluate(() => window.drumTest.emit([0x90, 60, 90], 'ri'));
  await expect(page.locator('#drum-calibration-done')).toBeDisabled();
  await page.clock.runFor(230);
  await page.evaluate(() => {
    window.drumTest.emit([0x90, 60, 90], 'ci');
    window.drumTest.emit([0x90, 60, 0], 'ri');
  });
  await expect(page.locator('#drum-calibration-done')).toBeDisabled();
  await page.evaluate(() => window.drumTest.emit([0x90, 60, 90], 'ri'));
  await expect(page.locator('#drum-calibration-delay')).toHaveText('80 ms');
  await page.clock.runFor(3040);
  await page.evaluate(() => window.drumTest.emit([0x90, 62, 90], 'ri'));
  await expect(page.locator('#drum-calibration-delay')).toHaveText('120 ms');
  const kicks = await page.evaluate((before) => window.drumTest.audio.sources.slice(before)
    .filter((source) => source.kind === 'oscillator').map((source) => source.audibleAt), before);
  for (let index = 1; index < kicks.length; index++) expect(kicks[index] - kicks[index - 1]).toBeCloseTo(600, 4);
  await expect(page.locator('#drum-tempo')).toHaveValue('143');
  await page.locator('#drum-calibration-done').click();
  await expect(page.locator('#drum-calibration')).toBeHidden();
  await expect(page.locator('#drum-offset')).toHaveValue('120');
  expect((await stored(page)).offset).toBe(120);
  expect((await stored(page)).patterns).toEqual(patterns);
  const count = await page.evaluate(() => window.drumTest.audio.sources.length);
  await page.clock.runFor(3000);
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(count);
  await mode(page, 2);
  await expect(page.locator('#looper-status')).toContainText('playing');
});

test('calibration handles missing input, Cancel, Escape, and disconnection without changing the saved offset', async ({ page }) => {
  await page.locator('#drum-offset').fill('75');
  await page.locator('#drum-offset').dispatchEvent('change');
  await page.locator('#midi-reface-input').selectOption('');
  await page.locator('#drum-calibrate').click();
  await expect(page.locator('#drum-calibration')).toBeVisible();
  await expect(page.locator('#drum-calibration-status')).toContainText('available reface input');
  await expect(page.locator('#drum-calibration-done')).toBeDisabled();
  await page.locator('#drum-calibration-cancel').click();
  await page.locator('#midi-reface-input').selectOption('ri');
  await page.locator('#drum-calibrate').click();
  await page.clock.runFor(230);
  await page.evaluate(() => window.drumTest.emit([0x90, 60, 90], 'ri'));
  await expect(page.locator('#drum-calibration-delay')).toHaveText('80 ms');
  await page.locator('#drum-calibration-cancel').click();
  await expect(page.locator('#drum-offset')).toHaveValue('75');
  await page.locator('#drum-calibrate').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#drum-calibration')).toBeHidden();
  await page.locator('#drum-calibrate').click();
  await page.evaluate(() => { window.drumTest.access.inputs.get('ri').state = 'disconnected'; });
  await page.clock.runFor(20);
  await expect(page.locator('#drum-calibration')).toBeVisible();
  await expect(page.locator('#drum-calibration-status')).toContainText('unavailable');
  await expect(page.locator('#drum-calibration-done')).toBeDisabled();
  expect((await stored(page)).offset).toBe(75);
  const count = await page.evaluate(() => window.drumTest.audio.sources.length);
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(count);
});

test('calibration shows audio startup failure inside the dialog instead of silently closing it', async ({ page }) => {
  await page.evaluate(() => {
    AudioContext.prototype.resume = async () => { throw new Error('audio blocked'); };
  });
  await page.locator('#drum-calibrate').click();
  await expect(page.locator('#drum-calibration')).toBeVisible();
  await expect(page.locator('#drum-calibration-status')).toContainText('audio blocked');
  await expect(page.locator('#drum-calibration-done')).toBeDisabled();
  await page.locator('#drum-calibration-cancel').click();
  await expect(page.locator('#drum-calibration')).toBeHidden();
  await expect(page.locator('#drum-offset')).toHaveValue('0');
});

test('dismissing calibration prerequisites does not interrupt an independent running pattern', async ({ page }) => {
  await step(page, 'kick', 0).click();
  await page.locator('#drum-play').click();
  await page.locator('#midi-reface-input').selectOption('');
  const stops = await page.evaluate(() => window.drumTest.audio.sources.map((source) => source.stopAt));
  await page.locator('#drum-calibrate').click();
  await expect(page.locator('#drum-calibration-status')).toContainText('available reface input');
  await page.locator('#drum-calibration-cancel').click();
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.drumTest.audio.sources.map((source) => source.stopAt))).toEqual(stops);
});

test('cancelling calibration during audio startup prevents delayed test kicks', async ({ page }) => {
  await delayAudioEnable(page);
  await page.locator('#drum-calibrate').click();
  await expect(page.locator('#drum-calibration')).toBeVisible();
  await page.locator('#drum-calibration-cancel').click();
  await page.evaluate(() => window.drumTest.resumeAudio());
  await page.clock.runFor(3000);
  await expect(page.locator('#drum-calibration')).toBeHidden();
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#drum-offset')).toHaveValue('0');
  expect(await page.evaluate(() => window.drumTest.audio.sources.length)).toBe(0);
});

test('real Web Audio renders all voices, scales velocity, and chokes open hats', async ({ page }) => {
  const result = await page.evaluate(async ({ factory, voices, lanes }) => {
    const createAudio = new Function('DRUM_VOICES', `return (${factory});`)(voices);
    window.AudioContext = class extends OfflineAudioContext {
      constructor() { super(2, 48000 * 3, 48000); }
      get state() { return 'running'; }
      async resume() {}
    };
    async function render(lane, velocity = 127, closedHat) {
      const clock = { enabled: true, attachAudio() {}, notify() {}, audioTime: (time) => time };
      const audio = createAudio(clock, (message) => { throw new Error(message); });
      await audio.enable();
      audio.trigger(lane, velocity, 0);
      if (closedHat) audio.trigger(closedHat, 127, 0.1);
      const buffer = await audio.context.startRendering();
      const samples = buffer.getChannelData(0);
      const rms = (start, end) => Math.sqrt(samples.slice(start * 48000, end * 48000)
        .reduce((sum, value) => sum + value * value, 0) / ((end - start) * 48000));
      return { energy: rms(0, 0.4), tail: rms(2, 2.5), hatTail: rms(0.2, 0.4),
        finite: samples.every(Number.isFinite) };
    }
    const rendered = [];
    for (const lane of lanes) rendered.push(await render(lane));
    const kick = { ...lanes[0], tone: 0, level: 20 };
    const loud = await render(kick);
    const quiet = await render(kick, 25);
    const open = await render(lanes[3]);
    const choked = await render(lanes[3], 127, lanes[2]);
    return { rendered, ratio: loud.energy / quiet.energy, hatRatio: choked.hatTail / open.hatTail };
  }, { factory: createDrumAudio.toString(), voices: DRUM_VOICES, lanes: DRUM_VOICES.map(defaultDrumLane) });
  for (const voice of result.rendered) {
    expect(voice.finite).toBe(true);
    expect(voice.energy).toBeGreaterThan(0.001);
    expect(voice.tail).toBeLessThan(0.0001);
  }
  expect(result.ratio).toBeGreaterThan(3);
  expect(result.hatRatio).toBeLessThan(0.05);
});
