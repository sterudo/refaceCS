import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const access = new EventTarget();
    const input = (id, name) => Object.assign(new EventTarget(), { id, name, state: 'connected' });
    const sent = [];
    const output = (id, name) => ({
      id, name, state: 'connected',
      send(data) { sent.push({ port: id, data: [...data] }); },
    });
    const reface = input('ri', 'reface CS');
    const controller = input('ci', 'External controller');
    access.inputs = new Map([[reface.id, reface], [controller.id, controller]]);
    access.outputs = new Map([
      ['ro', output('ro', 'reface CS')], ['other', output('other', 'Other output')],
    ]);
    window.testNotes = {
      access, sent,
      emit(id, data) {
        const event = new Event('midimessage');
        event.data = new Uint8Array(data);
        access.inputs.get(id).dispatchEvent(event);
      },
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
  });
  await page.goto('/static/reface/');
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
});

test('local notes use channel one, honor pitch controls, and release on blur', async ({ page }) => {
  await page.keyboard.down('a');
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('a');
  await page.locator('#transpose').press('ArrowUp');
  await page.keyboard.down('a');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0x90, 60, 100] }, { port: 'ro', data: [0x80, 60, 0] },
    { port: 'ro', data: [0x90, 61, 100] }, { port: 'ro', data: [0x80, 61, 0] },
  ]);
});

test('transposed held notes retain their original note-off pitches', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#transpose').press('ArrowUp');
  await page.keyboard.down('a');
  await page.evaluate(() => window.testNotes.emit('ci', [0x92, 60, 88]));
  await page.locator('#transpose').press('ArrowUp');
  await page.evaluate(() => window.testNotes.emit('ci', [0x92, 60, 99]));
  await page.keyboard.up('a');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0x82, 60, 17]);
    window.testNotes.emit('ci', [0x92, 60, 0]);
  });
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0x90, 61, 100] }, { port: 'ro', data: [0x92, 61, 88] },
    { port: 'ro', data: [0x92, 62, 99] }, { port: 'ro', data: [0x80, 61, 0] },
    { port: 'ro', data: [0x82, 61, 17] }, { port: 'ro', data: [0x92, 62, 0] },
  ]);
});

test('notes shifted outside the MIDI range are reported and not sent', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#transpose').press('ArrowDown');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0x90, 0, 100]);
    window.testNotes.emit('ci', [0x80, 0, 0]);
  });
  await expect(page.locator('#midi-status')).toContainText('outside the MIDI range');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
});

test('receives both inputs, forwards only controller notes, and ignores CC', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    window.testNotes.emit('ri', [0x90, 60, 90]);
    window.testNotes.emit('ci', [0x92, 60, 88]);
    window.testNotes.emit('ci', [0xb2, 74, 100]);
    window.testNotes.emit('ri', [0x80, 60, 0]);
  });
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.testNotes.emit('ci', [0x92, 60, 0]));
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0x92, 60, 88] }, { port: 'ro', data: [0x92, 60, 0] },
  ]);
});

test('keeps incoming highlights independent of local keys and pitch changes', async ({ page }) => {
  await page.evaluate(() => window.testNotes.emit('ri', [0x90, 60, 90]));
  await page.keyboard.down('a');
  await page.keyboard.up('a');
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#transpose').press('ArrowUp');
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.testNotes.emit('ri', [0x80, 60, 0]));
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'false');
});

test('releases forwarded notes when changing controller or output and clears disconnected inputs', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0x94, 64, 80]));
  await page.locator('#midi-controller-input').selectOption('ri');
  await expect(page.locator('#key-e-2')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0x94, 65, 81]));
  await page.locator('#midi-reface-output').selectOption('other');
  await page.evaluate(() => {
    window.testNotes.access.inputs.get('ci').state = 'disconnected';
    window.testNotes.access.dispatchEvent(new Event('statechange'));
  });
  await expect(page.locator('#key-f-2')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0x94, 64, 80] }, { port: 'ro', data: [0x84, 64, 0] },
    { port: 'ro', data: [0x94, 65, 81] }, { port: 'ro', data: [0x84, 65, 0] },
  ]);
});

test('surfaces output send errors', async ({ page }) => {
  await page.evaluate(() => {
    window.testNotes.access.outputs.get('ro').send = () => { throw new Error('device busy'); };
  });
  await page.keyboard.down('a');
  await expect(page.locator('#midi-status')).toContainText('MIDI send failed: device busy');
  await page.keyboard.up('a');
});

test('MIDI Reset sends both messages on every channel and clears held notes', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.down('a');
  await page.evaluate(() => {
    window.testNotes.emit('ri', [0x90, 62, 90]);
    window.testNotes.emit('ci', [0x92, 64, 88]);
    document.querySelector('#midi-reset').click();
  });
  for (const id of ['#key-c-2', '#key-d-2', '#key-e-2']) {
    await expect(page.locator(id)).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(page.locator('#midi-status')).toContainText('MIDI reset messages sent');
  await page.keyboard.up('a');
  await page.evaluate(() => {
    window.testNotes.emit('ri', [0x80, 62, 0]);
    window.testNotes.emit('ci', [0x82, 64, 0]);
  });
  const expectedReset = Array.from({ length: 16 }, (_, channel) => [
    { port: 'ro', data: [0xb0 | channel, 123, 0] },
    { port: 'ro', data: [0xb0 | channel, 120, 0] },
  ]).flat();
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0x90, 60, 100] },
    { port: 'ro', data: [0x92, 64, 88] },
    ...expectedReset,
  ]);
  await page.keyboard.down('a');
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('a');
});

test('MIDI Reset reports partial send failures and still tries every message', async ({ page }) => {
  await page.evaluate(() => {
    const port = window.testNotes.access.outputs.get('ro');
    let attempts = 0;
    port.send = () => {
      attempts++;
      window.testNotes.attempts = attempts;
      if (attempts === 3) throw new Error('device busy');
    };
  });
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  await expect(page.locator('#midi-status')).toContainText('1 of 32 messages');
  await expect(page.locator('#midi-status')).toContainText('device busy');
  expect(await page.evaluate(() => window.testNotes.attempts)).toBe(32);
  await page.evaluate(() => {
    window.testNotes.access.outputs.get('ro').send = () => {};
  });
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  await expect(page.locator('#midi-status')).toContainText('MIDI reset messages sent');
});

test('MIDI Reset reports an unavailable output', async ({ page }) => {
  await page.locator('#midi-reface-output').selectOption('');
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  await expect(page.locator('#midi-status')).toContainText('MIDI output unavailable');
});
