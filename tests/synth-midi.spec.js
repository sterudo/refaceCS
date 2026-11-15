import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const input = Object.assign(new EventTarget(), { id: 'ri', name: 'reface CS', state: 'connected' });
    const controller = Object.assign(new EventTarget(), { id: 'ci', name: 'Controller', state: 'connected' });
    const sent = [];
    const requests = [];
    const values = {
      '0,0,0': [0], '0,0,1': [16], '0,0,2': [0, 4, 0, 0], '0,0,6': [1],
      '0,0,11': [0], '0,0,12': [1], '0,0,13': [1], '0,0,14': [1],
      '0,0,20': [1], '48,0,0': [100], '0,0,7': [64], '0,0,8': [0, 120], '0,0,15': [76],
    };
    for (let address = 2; address <= 18; address++) {
      values[`48,0,${address}`] = [[9, 13, 14].includes(address) ? 127 : address === 16 ? 4 : 0];
    }
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
    window.testSynth = { sent, requests, values, input, plain, denySysex: sessionStorage.getItem('test-deny-sysex') === 'true',
      emit: (id, data) => emit(id === 'ri' ? input : controller, data) };
  });
  await page.goto('/static/reface/');
  await page.locator('#midi-connect').click();
  await expect(page.locator('#device-settings-status')).toContainText('Read complete');
  await expect(page.locator('#capture-status')).toContainText('Captured');
  await page.evaluate(() => { window.testSynth.sent.length = 0; });
});

async function reconnectSynth(page) {
  await page.evaluate(() => {
    window.testSynth.input.state = 'disconnected';
    window.testSynth.plain.dispatchEvent(new Event('statechange'));
    window.testSynth.input.state = 'connected';
    window.testSynth.plain.dispatchEvent(new Event('statechange'));
  });
}

test('automatically captures the connected synth without a capture button or writes', async ({ page }) => {
  await page.reload();
  await page.evaluate(() => { window.testSynth.values['48,0,9'] = [37]; });
  await page.locator('#midi-connect').click();
  await expect(page.locator('#capture-status')).toContainText('Captured');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '37');
  await expect(page.locator('#capture-synth')).toHaveCount(0);
  expect(await page.evaluate(() => window.testSynth.sent.some((message) =>
    message[0] === 0xf0 && message[2] === 0x10))).toBe(false);
  await expect(page.locator('#midi-badge')).toHaveAttribute('title', /Captured/);
});

test('asks before capture replaces unsaved edits and respects cancellation', async ({ page }) => {
  await page.reload();
  await page.locator('#filter-cutoff').press('End');
  await page.locator('#midi-connect').click();
  const prompt = page.getByRole('dialog', { name: 'Unsaved sound' });
  await expect(prompt).toBeVisible();
  expect(await page.evaluate(() => window.testSynth.sent.some((message) =>
    message[0] === 0xf0 && message[2] === 0x30 && message[6] === 48 && message[8] === 9))).toBe(false);
  await prompt.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#capture-status')).toContainText('current sound was kept');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');

  await reconnectSynth(page);
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Discard and capture' }).click();
  await expect(page.locator('#capture-status')).toContainText('Captured');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
});

test('automatically captures after manually selecting the reface ports', async ({ page }) => {
  await page.reload();
  await page.evaluate(() => {
    window.testSynth.input.name = 'MIDI input';
    window.testSynth.plain.outputs.get('ro').name = 'MIDI output';
    window.testSynth.values['48,0,9'] = [41];
  });
  await page.locator('#midi-connect').click();
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports unavailable');
  await page.locator('#midi-reface-input').selectOption('ri');
  await page.locator('#midi-reface-output').selectOption('ro');
  await expect(page.locator('#capture-status')).toContainText('Captured');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '41');
});

test('a connection change while confirmation is open requires a fresh confirmation', async ({ page }) => {
  await page.reload();
  await page.locator('#filter-cutoff').press('End');
  await page.locator('#midi-connect').click();
  const prompt = page.getByRole('dialog', { name: 'Unsaved sound' });
  await expect(prompt).toBeVisible();
  await reconnectSynth(page);
  await prompt.getByRole('button', { name: 'Discard and capture' }).click();
  await expect(prompt).toBeVisible();
  expect(await page.evaluate(() => window.testSynth.sent.some((message) =>
    message[0] === 0xf0 && message[2] === 0x30 && message[6] === 48 && message[8] === 9))).toBe(false);
  await prompt.getByRole('button', { name: 'Discard and capture' }).click();
  await expect(page.locator('#capture-status')).toContainText('Captured');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
});

test('a device settings action interrupts an in-progress automatic capture', async ({ page }) => {
  await page.evaluate(() => { delete window.testSynth.values['48,0,2']; });
  await reconnectSynth(page);
  await expect(page.locator('#capture-status')).toContainText('requesting lfo-assign');
  await page.locator('#device-speaker-output').click();
  await expect(page.locator('#device-speaker-output')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#capture-status')).toContainText('stopped for another device settings operation');
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
  expect(await page.evaluate(() => window.testSynth.requests)).toEqual(['ordinary', 'sysex']);
});

test('patch change indicator follows received sound controls but not performance controls', async ({ page }) => {
  await page.locator('#patch-save').click();
  await page.locator('#patch-name').fill('Hardware feedback');
  await page.locator('#patch-editor-form button[type="submit"]').click();
  await expect(page.locator('#patch-editor')).not.toBeVisible();
  await page.evaluate(() => window.testSynth.emit('ri', [0xb0, 11, 37]));
  await expect(page.locator('#patch-changed-indicator')).toHaveAttribute('visibility', 'hidden');
  await page.evaluate(() => window.testSynth.emit('ri', [0xb0, 74, 42]));
  await expect(page.locator('#patch-changed-indicator')).toHaveAttribute('visibility', 'visible');
  await page.evaluate(() => window.testSynth.emit('ri', [0xb0, 74, 127]));
  await expect(page.locator('#patch-changed-indicator')).toHaveAttribute('visibility', 'hidden');
});

test('INIT sends sound defaults without resetting performance or tempo', async ({ page }) => {
  await page.locator('#filter-cutoff').press('End');
  await page.locator('#tempo').press('Home');
  await page.evaluate(() => { window.testSynth.sent.length = 0; });
  await page.locator('#patch-new').click();
  await page.getByRole('dialog', { name: 'Unsaved sound' }).getByRole('button', { name: 'Discard and initialize' }).click();
  await expect(page.locator('#patch-display-screen')).toHaveAttribute('aria-label', 'INIT');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
  await expect(page.locator('#tempo')).toHaveAttribute('aria-valuenow', '240');
  const messages = await page.evaluate(() => window.testSynth.sent);
  expect(messages).toHaveLength(17);
  expect(messages).toContainEqual([0xb0, 74, 127]);
  expect(messages.every((message) => message[0] === 0xb0)).toBe(true);
});

test('MIDI changes received while saving are not discarded by a pending patch load', async ({ page }) => {
  await page.locator('#footer-panel').first().locator('summary').click();
  await page.locator('#patch-save').click();
  await page.locator('#patch-name').fill('MIDI changes');
  await page.locator('#patch-editor-form button[type="submit"]').click();
  await expect(page.locator('#patch-editor')).not.toBeVisible();
  const card = page.locator('.patch-card').filter({ has: page.getByRole('heading', { name: 'MIDI changes' }) });
  await card.getByRole('button', { name: 'Add MP3' }).click();
  await page.locator('#patch-audio-file').setInputFiles({
    name: 'take.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('audio bytes'),
  });
  await expect(card.locator('.patch-audio-item')).toHaveCount(1);
  await page.evaluate(() => window.testSynth.emit('ri', [0xb0, 74, 42]));
  await card.getByRole('button', { name: 'Load', exact: true }).click();
  const unsaved = page.getByRole('dialog', { name: 'Unsaved sound' });
  await unsaved.getByRole('button', { name: 'Overwrite and load' }).click();
  const audio = page.getByRole('dialog', { name: 'Patch audio' });
  await expect(audio).toBeVisible();
  await page.evaluate(() => window.testSynth.emit('ri', [0xb0, 74, 64]));
  await audio.getByRole('button', { name: 'Keep audio' }).click();
  await expect(unsaved).toBeVisible();
  await unsaved.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '64');
  await expect(page.locator('#patch-display-screen')).toHaveAttribute('aria-label', 'MIDI changes (unsaved changes)');
});

test('SysEx settings use permission and app-routed notes are transposed', async ({ page }) => {
  await page.locator('#transpose').press('ArrowUp');
  await expect.poll(() => page.evaluate(() => window.testSynth.sent.length)).toBe(1);
  await page.locator('#pitch-range-up').click();
  await expect.poll(() => page.evaluate(() => window.testSynth.sent.some((message) =>
    message[0] === 0xf0 && message[2] === 0x10 && message[8] === 15))).toBe(true);
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

test('capture replaces a locally changed range with the synth readout without writing', async ({ page }) => {
  await page.locator('#pitch-range-up').click();
  await expect.poll(() => page.evaluate(() => window.testSynth.sent.some((message) =>
    message[0] === 0xf0 && message[2] === 0x10 && message[8] === 15))).toBe(true);
  await expect(page.locator('#pitch-range-value')).toHaveText('13');
  await page.evaluate(() => {
    window.testSynth.sent.length = 0;
    window.testSynth.values['0,0,15'] = [70];
  });
  await reconnectSynth(page);
  await expect(page.locator('#capture-status')).toContainText('Not captured', { timeout: 5000 });
  await expect(page.locator('#pitch-range-value')).toHaveText('6');
  expect(await page.evaluate(() => window.testSynth.sent.some((message) =>
    message[0] === 0xf0 && message[2] === 0x10 && message[8] === 15))).toBe(false);
  await expect(page.getByRole('dialog', { name: 'Restore pitch-bend range' })).toHaveCount(0);
});

test('capture applies valid replies, reports missing values, and preserves newer edits', async ({ page }) => {
  await page.evaluate(() => {
    window.testSynth.values['0,0,7'] = [66];
    window.testSynth.values['0,0,8'] = [1, 0];
    window.testSynth.values['48,0,9'] = [42];
    window.testSynth.values['48,0,16'] = [2];
    delete window.testSynth.values['48,0,18'];
  });
  await reconnectSynth(page);
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
  await reconnectSynth(page);
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
  await page.setViewportSize({ width: 800, height: 900 });
  await reconnectSynth(page);
  await expect(page.locator('#capture-status')).toContainText('tempo (255 BPM outside 40–240 BPM)', { timeout: 5000 });
  await expect(page.locator('#capture-status')).toBeVisible();
  await expect(page.locator('#tempo')).toHaveAttribute('aria-valuenow', '120');
  await expect(page.locator('#arp-tempo')).toHaveAttribute('data-value', '120');
  expect(await page.evaluate(() => window.testSynth.sent.some((message) =>
    message[0] === 0xf0 && message[2] === 0x10 && message[8] === 8))).toBe(false);
});

test('denied tempo SysEx reports failure while linked controls still update', async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem('test-deny-sysex', 'true'));
  await page.reload();
  await page.locator('#midi-connect').click();
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
  await page.evaluate(() => sessionStorage.setItem('test-deny-sysex', 'true'));
  await page.reload();
  await page.locator('#midi-connect').click();
  await expect(page.locator('#capture-status')).toContainText('Automatic capture skipped');
  await expect(page.locator('#midi-status')).toContainText('permission denied');
  await page.keyboard.press('a');
  expect(await page.evaluate(() => window.testSynth.sent)).toEqual([[0x90, 60, 100], [0x80, 60, 0]]);
});
