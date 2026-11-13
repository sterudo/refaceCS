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
    window.testSynth = { sent, requests, values, emit: (id, data) => emit(id === 'ri' ? input : controller, data) };
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
  expect(sent).toContainEqual([0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 8, 1, 112, 0xf7]);
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
  await expect(page.locator('#tempo')).toHaveAttribute('aria-valuenow', '128');
  await expect(page.locator('#arp-tempo')).toHaveAttribute('data-value', '128');
  await expect(page.locator('#effect-type')).toHaveAttribute('aria-valuenow', '2');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
});

test('capture synchronizes the modulation slider for the selected CC without sending it', async ({ page }) => {
  await page.evaluate(() => { window.testSynth.values['48,0,9'] = [9]; });
  await page.locator('#capture-synth').click();
  await expect(page.locator('#midi-modwheel-value')).toHaveValue('9', { timeout: 5000 });
  expect(await page.evaluate(() => window.testSynth.sent.some((message) =>
    message[0] === 0xb0 && message[1] === 74))).toBe(false);
});

test('shared tempo sends exact BPM from both controls and on activation', async ({ page }) => {
  const fader = page.locator('#tempo');
  const display = page.locator('#arp-tempo');
  const tempoMessages = () => page.evaluate(() => window.testSynth.sent.filter((message) =>
    message[0] === 0xf0 && message[2] === 0x10 && message[8] === 8));
  const expectMessage = async (count, bpm) => {
    await expect.poll(async () => (await tempoMessages()).length).toBe(count);
    expect((await tempoMessages()).at(-1)).toEqual([
      0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 8, bpm >> 7, bpm & 0x7f, 0xf7,
    ]);
  };
  await expect(fader).toHaveAttribute('aria-valuenow', '120');
  expect(await tempoMessages()).toEqual([]);
  await fader.press('ArrowUp');
  await expect(display).toHaveAttribute('data-value', '121');
  await expectMessage(1, 121);
  await page.locator('#arp-tempo-up').click();
  await expect(fader).toHaveAttribute('aria-valuenow', '122');
  await expectMessage(2, 122);
  await fader.press('Home');
  await expect(display).toHaveAttribute('data-value', '240');
  await expectMessage(3, 240);
  await fader.press('End');
  await expect(display).toHaveAttribute('data-value', '40');
  await expectMessage(4, 40);
  await page.locator('#arp-tempo-display').dblclick();
  await expect(fader).toHaveAttribute('aria-valuenow', '120');
  await expectMessage(5, 120);
  await page.locator('#arp-tempo-display').dblclick();
  await expectMessage(6, 120);
  await page.locator('#arp-enabled').click();
  await expectMessage(7, 120);
  await expect(fader).toHaveAttribute('aria-valuenow', '120');
  expect(await page.evaluate(() => window.testSynth.requests)).toEqual(['ordinary', 'sysex']);
});

test('capture reports synth tempo outside the shared range without changing it', async ({ page }) => {
  await page.evaluate(() => { window.testSynth.values['0,0,8'] = [1, 127]; });
  await page.locator('#capture-synth').click();
  await expect(page.locator('#capture-status')).toContainText('tempo (255 BPM outside 40–240 BPM)', { timeout: 5000 });
  await expect(page.locator('#tempo')).toHaveAttribute('aria-valuenow', '120');
  await expect(page.locator('#arp-tempo')).toHaveAttribute('data-value', '120');
  expect(await page.evaluate(() => window.testSynth.sent.some((message) =>
    message[0] === 0xf0 && message[2] === 0x10 && message[8] === 8))).toBe(false);
});

test('denied tempo SysEx reports failure while linked controls still update', async ({ page }) => {
  await page.evaluate(() => { window.testSynth.denySysex = true; });
  await page.locator('#arp-tempo-up').click();
  await expect(page.locator('#tempo')).toHaveAttribute('aria-valuenow', '121');
  await expect(page.locator('#midi-status')).toContainText('permission denied');
  expect(await page.evaluate(() => window.testSynth.sent)).toEqual([]);
});

test('expression sends CC 11 while mute remains app-only and local velocity stays fixed', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#expression').press('End');
  await page.keyboard.press('a');
  await page.locator('#volume-mute').click();
  await page.keyboard.press('a');
  await page.evaluate(() => {
    window.testSynth.emit('ci', [0x92, 64, 87]);
    window.testSynth.emit('ci', [0x82, 64, 0]);
  });
  await expect(page.locator('#expression')).toHaveAttribute('aria-valuenow', '0');
  await page.locator('#volume-mute').click();
  await page.evaluate(() => {
    window.testSynth.emit('ci', [0x92, 64, 87]);
    window.testSynth.emit('ci', [0x82, 64, 0]);
  });
  expect(await page.evaluate(() => window.testSynth.sent)).toEqual([
    [0xb0, 11, 0], [0x90, 60, 100], [0x80, 60, 0], [0x92, 64, 87], [0x82, 64, 0],
  ]);
});

test('position-sensitive expression sends CC 11 before notes and updates the fader', async ({ page }) => {
  await page.locator('#midi-modwheel-target').selectOption('11');
  await page.locator('#position-expression').check();
  const bounds = await page.locator('#key-c-2 use').boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.2);
  const firstValue = await page.locator('#expression').getAttribute('aria-valuenow');
  await expect(page.locator('#midi-modwheel-value')).toHaveValue(firstValue);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.9);
  const sent = await page.evaluate(() => window.testSynth.sent);
  expect(sent).toEqual([
    [0xb0, 11, expect.any(Number)], [0x90, 60, 100], [0x80, 60, 0],
    [0xb0, 11, 127], [0x90, 60, 100], [0x80, 60, 0],
  ]);
  expect(sent[0][2]).toBeGreaterThanOrEqual(30);
  expect(sent[0][2]).toBeLessThanOrEqual(33);
  await expect(page.locator('#expression')).toHaveAttribute('aria-valuenow', '127');
});

test('a later position-sensitive key changes expression while another key is held', async ({ page }) => {
  await page.locator('#position-expression').check();
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.down('a');
  const bounds = await page.locator('#key-d-2 use').boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.4);
  await page.keyboard.up('a');
  const sent = await page.evaluate(() => window.testSynth.sent);
  expect(sent).toEqual([
    [0x90, 60, 100], [0xb0, 11, expect.any(Number)], [0x90, 62, 100], [0x80, 62, 0], [0x80, 60, 0],
  ]);
  expect(sent[1][2]).toBeGreaterThanOrEqual(62);
  expect(sent[1][2]).toBeLessThanOrEqual(65);
  await expect(page.locator('#expression')).toHaveAttribute('aria-valuenow', String(sent[1][2]));
});

test('expression mirrors synth and controller CC feedback without echoing synth input', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testSynth.emit('ri', [0xb0, 11, 37]));
  await expect(page.locator('#expression')).toHaveAttribute('aria-valuenow', '37');
  expect(await page.evaluate(() => window.testSynth.sent)).toEqual([]);
  await page.evaluate(() => window.testSynth.emit('ci', [0xb2, 11, 80]));
  await expect(page.locator('#expression')).toHaveAttribute('aria-valuenow', '80');
  expect(await page.evaluate(() => window.testSynth.sent)).toEqual([[0xb2, 11, 80]]);
  await page.locator('#expression').press('Delete');
  await expect(page.locator('#expression')).toHaveAttribute('aria-valuenow', '127');
  expect(await page.evaluate(() => window.testSynth.sent)).toEqual([[0xb2, 11, 80], [0xb0, 11, 127]]);
});

test('denied SysEx leaves ordinary MIDI working and reports capture failure', async ({ page }) => {
  await page.evaluate(() => { window.testSynth.denySysex = true; });
  await page.locator('#capture-synth').click();
  await expect(page.locator('#capture-status')).toContainText('Capture failed');
  await expect(page.locator('#midi-status')).toContainText('permission denied');
  await page.keyboard.press('a');
  expect(await page.evaluate(() => window.testSynth.sent)).toEqual([[0x90, 60, 100], [0x80, 60, 0]]);
});
