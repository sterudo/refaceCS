import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { readMidi, writeMidi } from '../src/midi-file.js';

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (value) => [...value].map((character) => character.charCodeAt(0));
const end = [0, 0xff, 0x2f, 0];

function midi(tracks, { format = tracks.length === 1 ? 0 : 1, division = 96 } = {}) {
  return new Uint8Array([
    ...text('MThd'), ...u32(6), 0, format, 0, tracks.length, division >> 8, division & 255,
    ...tracks.flatMap((track) => [...text('MTrk'), ...u32(track.length), ...track]),
  ]);
}

const oneNote = [0, 0x90, 60, 90, 96, 0x80, 60, 0, ...end];

test('round-trips the exact loop length, trailing silence and a note across the boundary', () => {
  const saved = writeMidi([
    { start: 0.5, playDuration: 0.25, channel: 2, pitch: 60, velocity: 37 },
    { start: 3.75, playDuration: 0.75, channel: 7, pitch: 65, velocity: 110 },
  ], 4, 137, 3);
  const result = readMidi(saved, 4);
  expect(result).toMatchObject({ length: 4, meter: 3, tempo: 137, warnings: [] });
  expect(result.notes.map(({ start, duration, channel, pitch, velocity }) =>
    ({ start, duration, channel, pitch, velocity }))).toEqual([
    { start: 0.5, duration: 0.25, channel: 2, pitch: 60, velocity: 37 },
    { start: 3.75, duration: 0.75, channel: 7, pitch: 65, velocity: 110 },
  ]);
  expect(readMidi(writeMidi([{ start: 0, playDuration: 0.5, channel: 0, pitch: 60, velocity: 90 }],
    8, 120, 4), 4).length).toBe(8);
  const exactLength = 21 / 9600 + 0.000001;
  expect(readMidi(writeMidi([{ start: 0, playDuration: exactLength, channel: 0, pitch: 60, velocity: 90 }],
    exactLength, 120, 4), 4).length).toBe(exactLength);
});

test('imports synchronized tracks, running status and velocity-zero note-offs', () => {
  const bytes = midi([
    [0, 0xff, 0x51, 3, 0x06, 0x1a, 0x80, 0, 0xff, 0x58, 4, 3, 2, 24, 8,
      0, 0xb0, 64, 127, 0, 0xf0, 2, 0x7e, 0xf7,
      96, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, ...end],
    [0, 0x92, 60, 95, 96, 60, 0, 48, 62, 70, 48, 62, 0, ...end],
    [0, 0x95, 67, 55, 96, 0x85, 67, 0, ...end],
  ]);
  const result = readMidi(bytes, 4);
  expect(result).toMatchObject({ length: 3, meter: 3, tempo: 150 });
  expect(result.notes.map(({ start, duration, channel, pitch, velocity }) =>
    ({ start, duration, channel, pitch, velocity }))).toEqual([
    { start: 0, duration: 1, channel: 2, pitch: 60, velocity: 95 },
    { start: 0, duration: 1, channel: 5, pitch: 67, velocity: 55 },
    { start: 1.5, duration: 0.5, channel: 2, pitch: 62, velocity: 70 },
  ]);
  expect(result.warnings.join(' ')).toContain('Later tempo changes ignored');
  expect(result.warnings.join(' ')).toContain('Ignored 2 non-note');
});

test('retains the current tempo and meter when initial file values are unsupported', () => {
  const bytes = midi([[0, 0xff, 0x51, 3, 0x1e, 0x84, 0x80,
    0, 0xff, 0x58, 4, 6, 3, 24, 8, ...oneNote]]);
  const result = readMidi(bytes, 3);
  expect(result).toMatchObject({ tempo: undefined, meter: 3, length: 3 });
  expect(result.warnings.join(' ')).toContain('outside 40–240 BPM');
  expect(result.warnings.join(' ')).toContain('Unsupported time signature');
});

test('rejects unsupported, malformed, unpaired and oversized files', () => {
  expect(() => readMidi(midi([oneNote], { format: 2 }), 4)).toThrow('type 2');
  expect(() => readMidi(midi([oneNote], { division: 0xe728 }), 4)).toThrow('SMPTE');
  expect(() => readMidi(midi([oneNote]).slice(0, -1), 4)).toThrow('truncated');
  expect(() => readMidi(midi([[0, 0x80, 60, 0, ...end]]), 4)).toThrow('without a matching note-on');
  expect(() => readMidi(midi([[0, 0x90, 60, 90, ...end]]), 4)).toThrow('without matching note-offs');
  expect(() => readMidi(midi([[0, 60, 90, ...end]]), 4)).toThrow('running status');
  const excessiveNotes = [];
  for (let i = 0; i < 2001; i++) excessiveNotes.push(0, 0x90, 60, 90, 1, 0x80, 60, 0);
  expect(() => readMidi(midi([[...excessiveNotes, ...end]]), 4)).toThrow('2,000-note limit');
  const longNote = [0, 0x90, 60, 90, 0x87, 0x84, 0x01, 0x80, 60, 0, ...end];
  expect(() => readMidi(midi([longNote]), 4)).toThrow('1,200-beat');
});

test('loads and saves without MIDI access, preserving a phrase on invalid input or cancellation', async ({ page }) => {
  await page.goto('/static/reface/');
  const phrase = writeMidi([{ start: 1, playDuration: 0.5, channel: 3, pitch: 64, velocity: 75 }],
    6, 150, 3);
  const input = page.locator('#looper-file');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Load MIDI loop' }).press('Enter'),
  ]);
  await chooser.setFiles({ name: 'phrase.mid', mimeType: 'audio/midi', buffer: Buffer.from(phrase) });
  await expect(page.locator('#looper-status')).toContainText('Loaded phrase.mid');
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#looper-meter text')).toHaveText('3/4');
  await expect(page.locator('#tempo')).toHaveAttribute('aria-valuenow', '150');
  await input.setInputFiles({ name: 'bad.mid', mimeType: 'audio/midi', buffer: Buffer.from([1, 2, 3]) });
  await expect(page.locator('#looper-status')).toContainText('MIDI load failed');
  page.once('dialog', (dialog) => dialog.dismiss());
  await input.setInputFiles({ name: 'new.mid', mimeType: 'audio/midi', buffer: Buffer.from(midi([oneNote])) });
  await expect(page.locator('#looper-status')).toContainText('load cancelled');
  page.once('dialog', (dialog) => dialog.accept('my loop'));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save MIDI loop' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('my loop.mid');
  await expect(page.locator('#looper-status')).toHaveText('Saved loop as my loop.mid.');
  const result = readMidi(new Uint8Array(await readFile(await download.path())), 4);
  expect(result).toMatchObject({ length: 6, meter: 3, tempo: 150 });
  expect(result.notes[0]).toMatchObject({ start: 1, duration: 0.5, channel: 3, pitch: 64, velocity: 75 });
  page.once('dialog', (dialog) => dialog.accept());
  await input.setInputFiles({ name: 'phrase.mid', mimeType: 'audio/midi', buffer: Buffer.from(phrase) });
  await expect(page.locator('#looper-status')).toContainText('Loaded phrase.mid');
});

test('reports ignored events and retains unsupported tempo and meter on import', async ({ page }) => {
  await page.goto('/static/reface/');
  await page.locator('#looper-meter').click();
  const bytes = midi([[0, 0xff, 0x51, 3, 0x1e, 0x84, 0x80,
    0, 0xff, 0x58, 4, 6, 3, 24, 8, 0, 0xb0, 64, 127, ...oneNote]]);
  await page.locator('#looper-file').setInputFiles({
    name: 'external.mid', mimeType: 'audio/midi', buffer: Buffer.from(bytes),
  });
  await expect(page.locator('#looper-meter text')).toHaveText('3/4');
  await expect(page.locator('#tempo')).toHaveAttribute('aria-valuenow', '120');
  await expect(page.locator('#looper-status')).toContainText('outside 40–240 BPM');
  await expect(page.locator('#looper-status')).toContainText('Unsupported time signature');
  await expect(page.locator('#looper-status')).toContainText('Ignored 1 non-note');
});
