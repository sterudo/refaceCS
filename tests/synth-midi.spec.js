import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const input = Object.assign(new EventTarget(), { id: 'ri', name: 'reface CS', state: 'connected' });
    const controller = Object.assign(new EventTarget(), { id: 'ci', name: 'Controller', state: 'connected' });
    const sent = [];
    const requests = [];
    const values = {
      '0,0,14': [1], '0,0,7': [66], '0,0,8': [1, 0], '0,0,15': [76],
    };
    for (let address = 2; address <= 18; address++) values[`48,0,${address}`] = [address === 16 ? 2 : 0];
    delete values['48,0,18'];
    const emit = (port, data) => {
      const event = new Event('midimessage');
      event.data = new Uint8Array(data);
      port.dispatchEvent(event);
    };
    const output = {
      id: 'ro', name: 'reface CS', state: 'connected',
      send(data) {
        sent.push([...data]);
        if (data[0] !== 0xf0 || data[2] !== 0x30) return;
        const address = [...data.slice(6, 9)];
        const value = values[address.join(',')];
        if (value) setTimeout(() => emit(input, [0xf0, 0x43, 0x10, 0x7f, 0x1c, 3,
          ...address, ...value, 0xf7]), address[2] === 9 && address[0] === 48 ? 100 : 0);
      },
    };
    const makeAccess = (sysexEnabled) => Object.assign(new EventTarget(), {
      sysexEnabled, inputs: new Map([['ri', input], ['ci', controller]]),
      outputs: new Map([['ro', output]]),
    });
    const plain = makeAccess(false);
    const sysex = makeAccess(true);
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async (options) => {
        requests.push(options?.sysex ? 'sysex' : 'ordinary');
        if (options?.sysex && window.testSynth.denySysex) throw new Error('permission denied');
        return options?.sysex ? sysex : plain;
      },
    });
    window.testSynth = { sent, requests, emit: (id, data) => emit(id === 'ri' ? input : controller, data) };
  });
  await page.goto('/static/reface/');
  await page.locator('#midi-connect').click();
});

test('CC and pitch bend send and receive without echo or connect synchronization', async ({ page }) => {
  expect(await page.evaluate(() => window.testSynth.sent)).toEqual([]);
  await page.locator('#focus-mode').click();
  await page.locator('#filter-cutoff').press('End');
  await page.locator('#effect-type').press('Home');
  await page.locator('#pitch-bend').press('Home');
  expect(await page.evaluate(() => window.testSynth.sent)).toEqual([
    [0xb0, 74, 0], [0xb0, 17, 0], [0xe0, 127, 127],
  ]);
  await page.evaluate(() => {
    window.testSynth.emit('ri', [0xb0, 74, 42]);
    window.testSynth.emit('ri', [0xb0, 17, 95]);
    window.testSynth.emit('ri', [0xe0, 0, 64]);
  });
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '42');
  await expect(page.locator('#filter-cutoff title')).toHaveText('Filter cutoff: 42 (CC 74)');
  await expect(page.locator('#effect-type')).toHaveAttribute('aria-valuenow', '1');
  await expect(page.locator('#pitch-bend')).toHaveAttribute('aria-valuenow', '64');
  expect(await page.evaluate(() => window.testSynth.sent.length)).toBe(3);
  expect(await page.evaluate(() => window.testSynth.requests)).toEqual(['ordinary']);
});

test('SysEx settings use explicit permission and app-routed notes are transposed', async ({ page }) => {
  await page.locator('#transpose').press('ArrowUp');
  await expect.poll(() => page.evaluate(() => window.testSynth.sent.length)).toBe(1);
  await page.locator('#pitch-range-up').click();
  await page.locator('#tempo').press('Home');
  await page.keyboard.press('a');
  await expect(page.locator('#key-c-2 .key-note')).toHaveText('C#4');
  expect(await page.evaluate(() => window.testSynth.requests)).toEqual(['ordinary', 'sysex']);
  const sent = await page.evaluate(() => window.testSynth.sent);
  expect(sent).toContainEqual([0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 7, 65, 0xf7]);
  expect(sent).toContainEqual([0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 15, 77, 0xf7]);
  expect(sent).toContainEqual([0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 8, 2, 44, 0xf7]);
  expect(sent).toContainEqual([0x90, 61, 100]);
});

test('capture applies valid replies, reports missing values, and preserves newer edits', async ({ page }) => {
  await page.locator('#capture-synth').click();
  await expect(page.locator('#capture-status')).toContainText('requesting filter-cutoff');
  await page.locator('#filter-cutoff').press('End');
  await expect(page.locator('#capture-status')).toContainText('Not captured', { timeout: 5000 });
  await expect(page.locator('#capture-status')).toContainText('filter-cutoff');
  await expect(page.locator('#capture-status')).toContainText('effect-rate');
  await expect(page.locator('#midi-status')).toContainText('MIDI Control: on');
  await expect(page.locator('#transpose')).toHaveAttribute('aria-valuenow', '2');
  await expect(page.locator('#effect-type')).toHaveAttribute('aria-valuenow', '2');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
});

test('velocity and mute affect local and external notes without changing the fader', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#volume').press('End');
  await page.keyboard.press('a');
  await page.locator('#volume-mute').click();
  await page.keyboard.press('a');
  await page.evaluate(() => {
    window.testSynth.emit('ci', [0x92, 64, 87]);
    window.testSynth.emit('ci', [0x82, 64, 0]);
  });
  await expect(page.locator('#volume')).toHaveAttribute('aria-valuenow', '1');
  await page.locator('#volume-mute').click();
  await page.evaluate(() => {
    window.testSynth.emit('ci', [0x92, 64, 87]);
    window.testSynth.emit('ci', [0x82, 64, 0]);
  });
  expect(await page.evaluate(() => window.testSynth.sent)).toEqual([
    [0x90, 60, 1], [0x80, 60, 0], [0x92, 64, 87], [0x82, 64, 0],
  ]);
});

test('position-sensitive mouse velocity is quiet near the top and maximal at the bottom', async ({ page }) => {
  await page.locator('#position-velocity').check();
  const bounds = await page.locator('#key-c-2 use').boundingBox();
  for (const fraction of [0.2, 0.9]) {
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height * fraction);
  }
  const ons = await page.evaluate(() => window.testSynth.sent.filter((data) => data[0] === 0x90));
  expect(ons).toHaveLength(2);
  expect(ons[0][2]).toBeLessThan(127);
  expect(ons[1][2]).toBe(127);
});

test('denied SysEx leaves ordinary MIDI working and reports capture failure', async ({ page }) => {
  await page.evaluate(() => { window.testSynth.denySysex = true; });
  await page.locator('#capture-synth').click();
  await expect(page.locator('#capture-status')).toContainText('Capture failed');
  await expect(page.locator('#midi-status')).toContainText('permission denied');
  await page.keyboard.press('a');
  expect(await page.evaluate(() => window.testSynth.sent)).toEqual([[0x90, 60, 100], [0x80, 60, 0]]);
});
