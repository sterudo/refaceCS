import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readMidi, writeMidi } from '../src/midi-file.js';

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const access = new EventTarget();
    const input = (id, name) => Object.assign(new EventTarget(), { id, name, state: 'connected' });
    const sent = [];
    const output = {
      id: 'ro', name: 'reface CS', state: 'connected',
      send(data) { sent.push([...data]); },
    };
    const reface = input('ri', 'reface CS');
    const controller = input('ci', 'External controller');
    access.inputs = new Map([[reface.id, reface], [controller.id, controller]]);
    access.outputs = new Map([[output.id, output]]);
    window.looperTest = {
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
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
});

async function mode(page, value) {
  await page.locator(`#looper .position-label[data-step="${value}"]`).click();
}

async function sent(page) {
  return page.evaluate(() => window.looperTest.sent.splice(0));
}

async function emit(page, id, data) {
  await page.evaluate(({ id, data }) => window.looperTest.emit(id, data), { id, data });
}

async function quantize(page, value) {
  await page.locator('#looper-quantize').click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: value ? `1/${value}` : 'Off', exact: true }).click();
}

test('saving while recording finalizes held notes and stops the transport', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x93, 60, 85]);
  await page.clock.runFor(250);
  page.once('dialog', (dialog) => dialog.accept(dialog.defaultValue()));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save MIDI loop' }).click(),
  ]);
  const result = readMidi(new Uint8Array(await readFile(await download.path())), 4);
  expect(result).toMatchObject({ length: 4, meter: 4, tempo: 120 });
  expect(result.notes[0]).toMatchObject({ start: 0, duration: 0.5, channel: 3, pitch: 60, velocity: 85 });
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
});

test('cancelling or entering a blank filename leaves recording active', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(250);
  let defaultName;
  page.once('dialog', (dialog) => {
    defaultName = dialog.defaultValue();
    return dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Save MIDI loop' }).click();
  expect(defaultName).toBe('reface-loop.mid');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '3');
  page.once('dialog', (dialog) => dialog.accept('  '));
  await page.getByRole('button', { name: 'Save MIDI loop' }).click();
  await expect(page.locator('#looper-status')).toContainText('Enter a file name');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '3');
  await page.clock.runFor(250);
  await emit(page, 'ci', [0x80, 60, 0]);
  page.once('dialog', (dialog) => dialog.accept('take.MIDI'));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save MIDI loop' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('take.MIDI');
  const result = readMidi(new Uint8Array(await readFile(await download.path())), 4);
  expect(result.notes[0]).toMatchObject({ pitch: 60, duration: 1 });
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
});

for (const leaveRecording of [false, true]) test(`saving ${leaveRecording ? 'after' : 'during'} overdub includes quantized notes scheduled for the next pass`, async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await quantize(page, 4);
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(2200);
  await emit(page, 'ci', [0x91, 67, 80]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x81, 67, 0]);
  if (leaveRecording) await mode(page, 2);
  page.once('dialog', (dialog) => dialog.accept(dialog.defaultValue()));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save MIDI loop' }).click(),
  ]);
  const result = readMidi(new Uint8Array(await readFile(await download.path())), 4);
  expect(result.notes).toHaveLength(2);
  expect(result.notes[1]).toMatchObject({ start: 1, duration: 0.2, channel: 1, pitch: 67, velocity: 80 });
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', leaveRecording ? '2' : '0');
});

test('imported note timing is not quantized and plays on the original channel', async ({ page }) => {
  await quantize(page, 4);
  const phrase = writeMidi([{ start: 0.25, playDuration: 0.25, channel: 2, pitch: 65, velocity: 79 }],
    4, 120, 4);
  await page.locator('#looper-file').setInputFiles({
    name: 'timing.mid', mimeType: 'audio/midi', buffer: Buffer.from(phrase),
  });
  await expect(page.locator('#looper-status')).toContainText('Loaded timing.mid');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
  await sent(page);
  await mode(page, 2);
  await page.clock.runFor(125);
  expect(await sent(page)).toEqual([[0x92, 65, 79]]);
  await page.clock.runFor(125);
  expect(await sent(page)).toEqual([[0x82, 65, 0]]);
});

test('invalid or cancelled loads leave playback intact; replacement stops and releases it', async ({ page }) => {
  const phrase = writeMidi([{ start: 0, playDuration: 2, channel: 0, pitch: 60, velocity: 90 }],
    4, 120, 4);
  const replacement = writeMidi([{ start: 0, playDuration: 1, channel: 1, pitch: 67, velocity: 80 }],
    4, 120, 4);
  const input = page.locator('#looper-file');
  await input.setInputFiles({ name: 'first.mid', mimeType: 'audio/midi', buffer: Buffer.from(phrase) });
  await expect(page.locator('#looper-status')).toContainText('Loaded first.mid');
  await sent(page);
  await mode(page, 2);
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
  await input.setInputFiles({ name: 'bad.mid', mimeType: 'audio/midi', buffer: Buffer.from([1, 2]) });
  await expect(page.locator('#looper-status')).toContainText('MIDI load failed');
  page.once('dialog', (dialog) => dialog.dismiss());
  await input.setInputFiles({ name: 'second.mid', mimeType: 'audio/midi', buffer: Buffer.from(replacement) });
  await expect(page.locator('#looper-status')).toContainText('load cancelled');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '2');
  expect(await sent(page)).toEqual([]);
  page.once('dialog', (dialog) => dialog.accept());
  await input.setInputFiles({ name: 'second.mid', mimeType: 'audio/midi', buffer: Buffer.from(replacement) });
  await expect(page.locator('#looper-status')).toContainText('Loaded second.mid');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
  expect(await sent(page)).toContainEqual([0x80, 60, 0]);
});

test('recording controls toggle, cycle, and offer an accessible quantization menu', async ({ page }) => {
  await expect(page.locator('#looper-meter text')).toHaveText('4/4');
  await expect(page.locator('#looper-bars-value')).toHaveText('0');
  await expect(page.locator('#looper-quantize text')).toHaveText('0');
  await page.locator('#looper-meter').click();
  await expect(page.locator('#looper-meter text')).toHaveText('3/4');
  await page.locator('#looper-bars-up').click();
  await expect(page.locator('#looper-bars-value')).toHaveText('1');
  await page.locator('#looper-bars-down').click();
  await expect(page.locator('#looper-bars-value')).toHaveText('0');
  await page.locator('#looper-quantize').click();
  await expect(page.locator('#looper-quantize text')).toHaveText('1');
  await quantize(page, 16);
  await expect(page.locator('#looper-quantize text')).toHaveText('16');
  await page.locator('#looper-quantize').press('ArrowDown');
  await expect(page.getByRole('menu', { name: 'Note quantization' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#looper-quantize')).toBeFocused();
});

test('bar controls are closer while three-digit values remain readable and clickable', async ({ page }) => {
  const positions = await page.evaluate(() => {
    const x = (selector) => Number(document.querySelector(selector).getAttribute('x'));
    return {
      bars: x('#looper-bars-value'), down: x('#looper-bars-down text'), up: x('#looper-bars-up text'),
      meter: x('#looper-meter text'), quantize: x('#looper-quantize text'),
    };
  });
  expect(positions.bars - positions.down).toBe(6.5);
  expect(positions.up - positions.bars).toBe(7);
  expect(positions.meter).toBeGreaterThan(446);
  expect(positions.quantize).toBeLessThan(523.5);

  await page.evaluate(() => {
    for (let i = 0; i < 300; i++) document.querySelector('#looper-bars-up').dispatchEvent(new MouseEvent('click'));
  });
  const bounds = await page.evaluate(() =>
    ['#looper-meter rect', '#looper-bars-down rect', '#looper-bars-value', '#looper-bars-up rect', '#looper-quantize rect']
      .map((selector) => {
        const { left, right } = document.querySelector(selector).getBoundingClientRect();
        return { left, right };
      }));
  for (let i = 1; i < bounds.length; i++) expect(bounds[i - 1].right).toBeLessThanOrEqual(bounds[i].left + 0.1);
  await page.locator('#looper-bars-down').click();
  await expect(page.locator('#looper-bars-value')).toHaveText('299');
  await page.locator('#looper-bars-up').click();
  await expect(page.locator('#looper-bars-value')).toHaveText('300');
  await page.evaluate(() => {
    for (let i = 0; i < 300; i++) document.querySelector('#looper-bars-down').dispatchEvent(new MouseEvent('click'));
  });
  await expect(page.locator('#looper-bars-value')).toHaveText('0');
  await expect(page.locator('#looper-bars-down')).toHaveAttribute('transform', 'translate(0 0)');
  await expect(page.locator('#looper-bars-up')).toHaveAttribute('transform', 'translate(0 0)');
});

test('recording controls remain usable with compact, focus, and double-travel layouts', async ({ page }) => {
  await page.locator('#hide-speakers').click();
  await page.locator('#focus-mode').click();
  await page.locator('#fader-size').click();
  await page.locator('#looper-meter').click();
  await page.locator('#looper-bars-up').click();
  await quantize(page, 8);
  await expect(page.locator('#looper-meter text')).toHaveText('3/4');
  await expect(page.locator('#looper-bars-value')).toHaveText('1');
  await expect(page.locator('#looper-quantize text')).toHaveText('8');
});

test('fixed bars count down and wrap to overdubbing without moving the fader', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await page.locator('#looper-bars-up').click();
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(250);
  await emit(page, 'ci', [0x80, 60, 0]);
  await sent(page);
  await page.clock.runFor(1750);
  await expect(page.locator('#looper-bars-value')).toHaveText('1');
  await page.clock.runFor(2000);
  await expect(page.locator('#looper-bars-value')).toHaveText('2');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '3');
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
  await expect(page.locator('#looper-status')).toHaveText('Looper overdubbing.');
  await page.clock.runFor(250);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
});

test('early PLAY preserves the selected fixed length and leaves the rest empty', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(150);
  await sent(page);
  await mode(page, 2);
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
  await page.clock.runFor(1999);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
  await page.clock.runFor(1);
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
});

test('three-four bars and changes during recording apply to the next new loop', async ({ page }) => {
  await page.locator('#looper-meter').click();
  await page.locator('#looper-bars-up').click();
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.locator('#looper-meter').click();
  await page.locator('#looper-bars-up').click();
  await expect(page.locator('#looper-bars-value')).toHaveText('1');
  await expect(page.locator('#looper-status')).toContainText('next new recording');
  await sent(page);
  await page.clock.runFor(1400);
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
  await mode(page, 4);
  await expect(page.locator('#looper-bars-value')).toHaveText('2');
});

test('quantizes recorded starts to the nearest grid while live notes remain immediate', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await quantize(page, 16);
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(50);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(85);
  await emit(page, 'ci', [0x90, 62, 80]);
  expect((await sent(page)).at(-1)).toEqual([0x90, 62, 80]);
  await page.clock.runFor(60);
  await emit(page, 'ci', [0x80, 62, 0]);
  await page.clock.runFor(1805);
  await sent(page);
  await page.clock.runFor(124);
  expect(await sent(page)).toContainEqual([0x80, 60, 0]);
  await page.clock.runFor(1);
  expect(await sent(page)).toEqual([[0x90, 62, 80]]);
  await page.clock.runFor(60);
  expect(await sent(page)).toEqual([[0x80, 62, 0]]);
});

test('quantized overdubs wait until the next loop', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await quantize(page, 4);
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(2300);
  await sent(page);
  await emit(page, 'ci', [0x91, 67, 80]);
  await page.clock.runFor(50);
  await emit(page, 'ci', [0x81, 67, 0]);
  await sent(page);
  await page.clock.runFor(100);
  expect(await sent(page)).not.toContainEqual([0x91, 67, 80]);
  await page.clock.runFor(1950);
  expect(await sent(page)).toContainEqual([0x91, 67, 80]);
});

test('an overdub at the same quantized position replaces the duration without hanging', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await quantize(page, 4);
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(400);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(1610);
  await sent(page);
  await emit(page, 'ci', [0x90, 60, 80]);
  expect(await sent(page)).toEqual([[0x80, 60, 0], [0x90, 60, 80]]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x80, 60, 0]);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
  await page.clock.runFor(1890);
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
  await page.clock.runFor(100);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
  await page.clock.runFor(1900);
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
  await page.clock.runFor(100);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
});

test('a same-pitch overdub cuts the previous note before retriggering', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await quantize(page, 4);
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(1800);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(1190);
  await emit(page, 'ci', [0x90, 60, 80]);
  await page.clock.runFor(200);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(810);
  await sent(page);
  await page.clock.runFor(999);
  expect(await sent(page)).toEqual([]);
  await page.clock.runFor(1);
  expect(await sent(page)).toEqual([[0x80, 60, 0], [0x90, 60, 80]]);
  await page.clock.runFor(200);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
});

test('a same-pitch note crossing the loop boundary ends at the next note-on', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await quantize(page, 4);
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(300);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(3200);
  await emit(page, 'ci', [0x90, 60, 80]);
  await page.clock.runFor(1000);
  await emit(page, 'ci', [0x80, 60, 0]);
  await sent(page);
  await page.clock.runFor(1000);
  expect(await sent(page)).toEqual([[0x90, 60, 80]]);
  await page.clock.runFor(500);
  expect(await sent(page)).toEqual([[0x80, 60, 0], [0x90, 60, 90]]);
  await page.clock.runFor(300);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
});

test('same-position notes in the first take retain only the latest duration', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await quantize(page, 4);
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(10);
  await emit(page, 'ci', [0x90, 60, 80]);
  await page.clock.runFor(140);
  await emit(page, 'ci', [0x80, 60, 0]);
  await sent(page);
  await mode(page, 2);
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
  await page.clock.runFor(140);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
});

test('same-position replacement follows note-on order even when releases are reversed', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await quantize(page, 4);
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(50);
  await emit(page, 'ri', [0x90, 60, 80]);
  await page.clock.runFor(100);
  await emit(page, 'ri', [0x80, 60, 0]);
  await page.clock.runFor(200);
  await emit(page, 'ci', [0x80, 60, 0]);
  await sent(page);
  await mode(page, 2);
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
  await page.clock.runFor(100);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
});

test('a same-position overdub can extend the note without losing its note-off', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await quantize(page, 4);
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(1910);
  await emit(page, 'ci', [0x90, 60, 80]);
  await page.clock.runFor(400);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(1590);
  await sent(page);
  await page.clock.runFor(399);
  expect(await sent(page)).toEqual([]);
  await page.clock.runFor(1);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
  await page.clock.runFor(1600);
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
  await page.clock.runFor(400);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
});

test('same-pitch notes on different MIDI channels do not cut one another', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await quantize(page, 4);
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x91, 60, 80]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x81, 60, 0]);
  await page.clock.runFor(200);
  await emit(page, 'ci', [0x80, 60, 0]);
  await sent(page);
  await mode(page, 2);
  expect(await sent(page)).toEqual(expect.arrayContaining([[0x90, 60, 90], [0x91, 60, 80]]));
  await page.clock.runFor(100);
  expect(await sent(page)).toEqual([[0x81, 60, 0]]);
  await page.clock.runFor(300);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
});

test('a loop retrigger cuts a held live note without letting its release cut the loop note', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(300);
  await emit(page, 'ci', [0x80, 60, 0]);
  await mode(page, 0);
  await emit(page, 'ci', [0x90, 60, 80]);
  await sent(page);
  await mode(page, 2);
  expect(await sent(page)).toEqual([[0x80, 60, 0], [0x90, 60, 90]]);
  await emit(page, 'ci', [0x80, 60, 0]);
  expect(await sent(page)).toEqual([]);
  await page.clock.runFor(300);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
});

test('quantization rounds toward a 3/4 loop boundary and preserves a held note across it', async ({ page }) => {
  await page.locator('#looper-meter').click();
  await page.locator('#looper-bars-up').click();
  await quantize(page, 1);
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(50);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(1350);
  await emit(page, 'ci', [0x91, 67, 80]);
  await page.clock.runFor(200);
  await emit(page, 'ci', [0x81, 67, 0]);
  await sent(page);
  await page.clock.runFor(1400);
  expect(await sent(page)).toContainEqual([0x91, 67, 80]);
  await page.clock.runFor(200);
  expect(await sent(page)).toContainEqual([0x81, 67, 0]);
});

test('bar limits follow the selected meter', async ({ page }) => {
  await page.locator('#looper-meter').click();
  await page.evaluate(() => {
    for (let i = 0; i < 401; i++) document.querySelector('#looper-bars-up').dispatchEvent(new MouseEvent('click'));
  });
  await expect(page.locator('#looper-bars-value')).toHaveText('400');
  await expect(page.locator('#looper-bars-up')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('#looper-meter').click();
  await expect(page.locator('#looper-bars-value')).toHaveText('300');
  await expect(page.locator('#looper-bars-up')).toHaveAttribute('aria-disabled', 'true');
});

test('new quantization settings do not alter an existing phrase or its overdubs', async ({ page }) => {
  await page.locator('#looper-bars-up').click();
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(50);
  await emit(page, 'ci', [0x80, 60, 0]);
  await quantize(page, 4);
  await page.clock.runFor(85);
  await emit(page, 'ci', [0x91, 67, 80]);
  await page.clock.runFor(60);
  await emit(page, 'ci', [0x81, 67, 0]);
  await page.clock.runFor(1805);
  await sent(page);
  await page.clock.runFor(134);
  expect(await sent(page)).not.toContainEqual([0x91, 67, 80]);
  await page.clock.runFor(1);
  expect(await sent(page)).toContainEqual([0x91, 67, 80]);
});

test('arms with guide, records keyboard notes, and loops them', async ({ page }) => {
  await mode(page, 3);
  await expect(page.locator('#looper-status')).toContainText('armed');
  expect(await sent(page)).toEqual([[0x90, 96, 60]]);
  await page.clock.runFor(100);
  expect(await sent(page)).toEqual([[0x80, 96, 0]]);
  await page.keyboard.down('a');
  await expect(page.locator('#looper-status')).toHaveText('Looper recording.');
  await page.clock.runFor(250);
  await page.keyboard.up('a');
  await page.clock.runFor(250);
  expect(await sent(page)).toEqual([[0x90, 60, 100], [0x80, 60, 0]]);
  await mode(page, 2);
  expect(await sent(page)).toEqual([[0x90, 60, 100]]);
  await page.clock.runFor(250);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
  await page.clock.runFor(250);
  expect(await sent(page)).toEqual([[0x90, 60, 100]]);
});

test('clear-play-record bypasses the guide and captures controller and synth input', async ({ page }) => {
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await page.clock.runFor(600);
  expect(await sent(page)).toEqual([]);
  await emit(page, 'ri', [0x90, 64, 75]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x92, 67, 80]);
  await page.clock.runFor(100);
  await emit(page, 'ri', [0x80, 64, 0]);
  await emit(page, 'ci', [0x82, 67, 0]);
  await page.clock.runFor(100);
  expect(await sent(page)).toEqual([[0x92, 67, 80], [0x82, 67, 0]]);
  await mode(page, 2);
  expect(await sent(page)).toEqual([[0x90, 64, 75]]);
  await page.clock.runFor(100);
  expect(await sent(page)).toEqual([[0x92, 67, 80]]);
  await page.clock.runFor(100);
  expect(await sent(page)).toEqual([[0x80, 64, 0], [0x82, 67, 0]]);
});

test('pause preserves position, stop rewinds, and clear removes the phrase', async ({ page }) => {
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(300);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(200);
  await mode(page, 2);
  await sent(page);
  await page.clock.runFor(100);
  await mode(page, 1);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
  await page.clock.runFor(500);
  expect(await sent(page)).toEqual([]);
  await mode(page, 2);
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
  await page.clock.runFor(200);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
  await mode(page, 0);
  await mode(page, 2);
  expect(await sent(page)).toEqual([[0x90, 60, 90]]);
  await mode(page, 4);
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
  await mode(page, 2);
  await page.clock.runFor(1000);
  expect(await sent(page)).toEqual([]);
  await expect(page.locator('#looper-status')).toHaveText('Looper is empty.');
});

test('overdubs across the loop boundary and follows tempo changes', async ({ page }) => {
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(100);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(400);
  await mode(page, 2);
  await page.clock.runFor(400);
  await mode(page, 3);
  await emit(page, 'ci', [0x91, 67, 80]);
  await page.clock.runFor(200);
  await emit(page, 'ci', [0x81, 67, 0]);
  await mode(page, 2);
  await sent(page);
  await page.clock.runFor(400);
  expect(await sent(page)).toContainEqual([0x91, 67, 80]);
  await page.locator('#tempo').press('Home');
  await page.clock.runFor(100);
  expect(await sent(page)).toContainEqual([0x81, 67, 0]);
});

test('overlapping live and loop notes do not release one another', async ({ page }) => {
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(250);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(250);
  await mode(page, 2);
  await page.keyboard.down('a');
  await sent(page);
  await page.clock.runFor(250);
  expect(await sent(page)).toEqual([]);
  await page.keyboard.up('a');
  expect(await sent(page)).toEqual([[0x80, 60, 0]]);
});

test('reset and output loss stop playback and release sounding notes', async ({ page }) => {
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(300);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(200);
  await mode(page, 2);
  await sent(page);
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  expect((await sent(page))[0]).toEqual([0x80, 60, 0]);
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
  await mode(page, 2);
  await sent(page);
  await page.evaluate(() => {
    window.looperTest.access.outputs.get('ro').state = 'disconnected';
    window.looperTest.access.dispatchEvent(new Event('statechange'));
  });
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
  await page.clock.runFor(1000);
  expect(await sent(page)).toEqual([]);
});

test('records generated arpeggio notes instead of the held controller key', async ({ page }) => {
  await page.locator('#arp-chord').click();
  await page.locator('#arp-latch').click();
  await page.locator('#arp-enabled').click();
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await sent(page);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(350);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.locator('#arp-enabled').click();
  await sent(page);
  await mode(page, 2);
  await page.clock.runFor(300);
  const playback = await sent(page);
  expect(playback.filter((message) => message[0] === 0x90).map((message) => message[1]))
    .toEqual([60, 64, 67]);
});

test('stops cleanly and reports playback send failures', async ({ page }) => {
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await emit(page, 'ci', [0x90, 60, 90]);
  await page.clock.runFor(250);
  await emit(page, 'ci', [0x80, 60, 0]);
  await page.clock.runFor(250);
  await mode(page, 2);
  await page.evaluate(() => {
    window.looperTest.access.outputs.get('ro').send = () => { throw new Error('device busy'); };
  });
  await page.clock.runFor(500);
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#looper-status')).toContainText('sending failed');
  await expect(page.locator('#midi-status')).toContainText('device busy');
});

test('mute and page hiding release the guide and stop transport safely', async ({ page }) => {
  await mode(page, 3);
  expect(await sent(page)).toEqual([[0x90, 96, 60]]);
  await page.locator('#volume-mute').click();
  expect(await sent(page)).toEqual([[0x80, 96, 0]]);
  await page.clock.runFor(1000);
  expect(await sent(page)).toEqual([]);
  await page.locator('#volume-mute').click();
  await page.clock.runFor(500);
  expect(await sent(page)).toEqual([[0x90, 96, 60]]);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await sent(page)).toEqual([[0x80, 96, 0]]);
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
  await page.clock.runFor(1000);
  expect(await sent(page)).toEqual([]);
});

test('limits recording to 2,000 notes and stops a first take at 1,200 beats', async ({ page }) => {
  await mode(page, 4);
  await mode(page, 2);
  await mode(page, 3);
  await page.evaluate(() => {
    for (let index = 0; index < 2001; index++) {
      window.looperTest.emit('ri', [0x90, 60, 90]);
      window.looperTest.emit('ri', [0x80, 60, 0]);
    }
  });
  await expect(page.locator('#looper-status')).toContainText('2,000 notes');
  await page.clock.fastForward(600000);
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '2');
  await expect(page.locator('#looper-status')).toContainText('maximum length');
});
