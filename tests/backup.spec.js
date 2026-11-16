import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { writeMidi } from '../src/midi-file.js';
import { createPatchBackup, PATCH_CONTROL_IDS } from '../src/patches.js';

test('saving information can be closed and reopened across reloads', async ({ page }) => {
  await page.goto('/static/reface/');
  const info = page.locator('#data-info');
  const open = page.getByRole('button', { name: 'Show information about saving and backups' });
  const close = page.getByRole('button', { name: 'Close information about saving and backups' });
  await expect(info).toBeVisible();
  await expect(open).toBeHidden();
  const header = await page.locator('header.toolbar').boundingBox();
  const box = await info.boundingBox();
  const synth = await page.locator('.instrument-scroll').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
  expect(synth.y).toBeGreaterThanOrEqual(box.y + box.height);
  await close.click();
  await expect(info).toBeHidden();
  await expect(open).toBeFocused();
  await page.reload();
  await expect(info).toBeHidden();
  await open.click();
  await expect(info).toBeVisible();
  await expect(close).toBeFocused();
  await page.reload();
  await expect(info).toBeVisible();
});

test('exports and imports all sections without browser preferences or recalling a patch', async ({ page, browser }) => {
  await page.goto('/static/reface/');
  await expect(page.locator('.message-entry[data-source="patch-status"] .message-text').last()).toHaveText('Patch Manager ready.');
  await page.locator('#data-info-close').click();
  await page.locator('#focus-mode').click();
  await page.locator('#lfo-depth').press('Home');
  await page.locator('#footer-panel').first().locator('summary').click();
  await page.locator('#patch-save').click();
  await page.locator('#patch-name').fill('Backup sound');
  await page.locator('#patch-editor-form button[type="submit"]').click();
  await expect(page.locator('#patch-editor')).not.toBeVisible();
  const card = page.locator('.patch-card').filter({ has: page.getByRole('heading', { name: 'Backup sound' }) });
  await card.getByRole('button', { name: 'Add MP3' }).click();
  await page.locator('#patch-audio-file').setInputFiles({
    name: 'backup.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('audio bytes'),
  });
  await expect(card.locator('.patch-audio-item')).toHaveCount(1);
  await page.locator('#groove-panel > summary').click();
  await page.locator('.drum-lane[data-voice="kick"] .drum-step').first().click();
  await page.getByRole('button', { name: 'Kick lane options' }).click();
  await page.getByRole('slider', { name: 'Kick tune' }).fill('4');
  await page.getByRole('button', { name: 'Save tone for Kick' }).click();
  await page.getByRole('dialog', { name: 'Save drum tone' }).getByLabel('Name').fill('Backup kick');
  await page.getByRole('dialog', { name: 'Save drum tone' }).getByRole('button', { name: 'Save' }).click();
  const phrase = writeMidi([{ start: 0, playDuration: 0.5, channel: 0, pitch: 60, velocity: 90 }], 4, 120, 4);
  await page.locator('#looper-file').setInputFiles({ name: 'loop.mid', mimeType: 'audio/midi', buffer: Buffer.from(phrase) });
  await expect(page.locator('.message-entry[data-source="looper-status"] .message-text').last()).toContainText('Loaded loop.mid');
  await page.getByRole('button', { name: 'Save loop', exact: true }).click();
  await page.getByRole('dialog', { name: 'Save loop' }).getByLabel('Name').fill('Backup loop');
  await page.getByRole('dialog', { name: 'Save loop' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.message-entry[data-source="looper-status"] .message-text').last()).toContainText('Saved loop');
  await page.locator('#backup-open').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#backup-export').click(),
  ]);
  const bytes = await readFile(await download.path());
  await expect(page.locator('#backup-dialog')).not.toBeVisible();
  expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
    'drum-tones.json', 'loops.json', 'manifest.json', 'patch-categories.json', 'patches.zip', 'patterns.json',
  ]);

  const context = await browser.newContext();
  const target = await context.newPage();
  await target.goto('http://localhost:5174/static/reface/');
  await expect(target.locator('.message-entry[data-source="patch-status"] .message-text').last()).toHaveText('Patch Manager ready.');
  await target.locator('#backup-open').click();
  await target.locator('#backup-file').setInputFiles({ name: 'all.zip', mimeType: 'application/zip', buffer: bytes });
  await target.getByRole('dialog', { name: 'Import pattern' }).getByRole('button', { name: 'Overwrite' }).click();
  await expect(target.locator('.message-entry[data-source="backup-result"] .message-text').last()).toContainText('Imported patches, patterns, drum tones, loops');
  await expect(target.locator('#backup-dialog')).not.toBeVisible();
  await expect(target.locator('#focus-mode')).toHaveAttribute('aria-pressed', 'false');
  await expect(target.locator('#data-info')).toBeVisible();
  await expect(target.locator('#lfo-depth')).toHaveAttribute('aria-valuenow', '0');
  await expect(target.locator('.patch-card')).toHaveCount(1);
  await expect(target.locator('.patch-audio-item')).toHaveCount(1);
  expect(await target.evaluate(() => JSON.parse(localStorage.getItem('refaceCS.drumTones.v1')).tones.map((tone) => tone.name)))
    .toEqual(['Backup kick']);
  await target.getByRole('button', { name: 'Load saved loop' }).click();
  await expect(target.locator('#looper-library-select option')).toHaveText('Backup loop');
  await context.close();
});

test('rejects unknown newer sections before changing data', async ({ page }) => {
  await page.goto('/static/reface/');
  await page.locator('#backup-open').click();
  const bytes = zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'refaceCS-backup', version: 1, sections: { sequencer: 2 } })),
  });

  await page.locator('#backup-file').setInputFiles({ name: 'newer.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(page.locator('.message-entry[data-source="backup-status"] .message-text').last()).toContainText('Unsupported backup section');
  await expect(page.locator('#backup-dialog')).toBeVisible();
  await expect(page.locator('.patch-card')).toHaveCount(0);
});

test('imports a version 1 Groove Studio backup without a tone library', async ({ page }) => {
  await page.goto('/static/reface/');
  await page.locator('#groove-panel > summary').click();
  await page.locator('.drum-lane[data-voice="kick"] .drum-step').first().click();
  const existing = await page.evaluate(() => JSON.parse(localStorage.getItem('refaceCS.drumPatterns.v1')).patterns[0]);
  const old = { ...existing, name: 'Legacy groove' };
  const bytes = zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'refaceCS-backup', version: 1, sections: { patterns: 1 } })),
    'patterns.json': strToU8(JSON.stringify([old])),
  });
  await page.locator('#backup-open').click();
  await page.locator('#backup-file').setInputFiles({ name: 'legacy.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await page.getByRole('dialog', { name: 'Import pattern' }).getByRole('button', { name: 'Overwrite' }).click();
  await expect(page.locator('.message-entry[data-source="backup-result"] .message-text').last()).toContainText('Imported patterns');
  await expect(page.locator('#drum-pattern option:checked')).toHaveText('Legacy groove');
});

test('global import accepts an existing patch ZIP', async ({ page }) => {
  const blob = await createPatchBackup([{
    id: 'legacy', name: 'Legacy patch', category: 'synth', description: '', tags: [], audio: [],
    controls: Object.fromEntries(PATCH_CONTROL_IDS.map((id) => [id, 0])),
  }]);
  await page.goto('/static/reface/');
  await expect(page.locator('.message-entry[data-source="patch-status"] .message-text').last()).toHaveText('Patch Manager ready.');
  await page.locator('#backup-open').click();
  await page.locator('#backup-file').setInputFiles({
    name: 'legacy.zip', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()),
  });
  await expect(page.locator('.message-entry[data-source="backup-result"] .message-text').last()).toHaveText('Imported legacy patch ZIP.');
  await expect(page.locator('#backup-dialog')).not.toBeVisible();
  await expect(page.locator('.patch-card')).toHaveCount(1);
});

test('identical imports are silent; different items offer ignore, create new and overwrite', async ({ page }) => {
  await page.goto('/static/reface/');
  await expect(page.locator('.message-entry[data-source="patch-status"] .message-text').last()).toHaveText('Patch Manager ready.');
  await page.locator('#footer-panel').first().locator('summary').click();
  await page.locator('#patch-save').click();
  await page.locator('#patch-name').fill('Pad');
  await page.locator('#patch-description').fill('Original');
  await page.locator('#patch-editor-form button[type="submit"]').click();
  await expect(page.locator('#patch-editor')).not.toBeVisible();
  await page.locator('#backup-open').click();
  await page.locator('#backup-section').selectOption('patches');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#backup-export').click()]);
  const bytes = await readFile(await download.path());
  async function importBackup() {
    await page.locator('#backup-open').click();
    await page.locator('#backup-file').setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: bytes });
  }
  await importBackup();
  await expect(page.locator('#backup-dialog')).not.toBeVisible();
  await expect(page.locator('.patch-card')).toHaveCount(1);
  await page.locator('.patch-card').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#patch-description').fill('Changed');
  await page.locator('#patch-editor-form button[type="submit"]').click();
  await expect(page.locator('#patch-editor')).not.toBeVisible();
  await importBackup();
  await page.getByRole('dialog', { name: 'Import patch' }).getByRole('button', { name: 'Ignore' }).click();
  await expect(page.locator('#backup-dialog')).not.toBeVisible();
  await expect(page.locator('.patch-card')).toHaveCount(1);
  await importBackup();
  await page.getByRole('dialog', { name: 'Import patch' }).getByRole('button', { name: 'Create new' }).click();
  const rename = page.getByRole('dialog', { name: 'Create new patch' });
  await expect(rename.getByLabel('Name')).toHaveValue('Pad (2)');
  await rename.getByLabel('Name').fill('Imported pad');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#backup-dialog')).not.toBeVisible();
  await expect(page.locator('.patch-card')).toHaveCount(2);
  await importBackup();
  await page.getByRole('dialog', { name: 'Import patch' }).getByRole('button', { name: 'Overwrite' }).click();
  await expect(page.locator('#backup-dialog')).not.toBeVisible();
  await expect(page.locator('.patch-card')).toHaveCount(2);
  await page.locator('#patch-view-toggle').click();
  await expect(page.locator('.patch-card').filter({ has: page.getByRole('heading', { name: 'Pad', exact: true }) }))
    .toContainText('Original');
});

test('patch equality ignores IDs and timestamps but compares attachment bytes', async ({ page }) => {
  const patch = {
    id: 'first', name: 'Audio pad', category: 'synth', description: '', tags: [],
    controls: Object.fromEntries(PATCH_CONTROL_IDS.map((id) => [id, 0])),
    createdAt: '2020-01-01', updatedAt: '2020-01-01',
    audio: [{ id: 'audio1', name: 'take.mp3', lastModified: 1, data: new Blob(['same bytes']) }],
  };
  const fixture = async (value) => Buffer.from(await (await createPatchBackup([value])).arrayBuffer());
  const first = await fixture(patch);
  const identical = await fixture({
    ...patch, id: 'second', createdAt: '2022-01-01', updatedAt: '2022-01-01',
    audio: [{ ...patch.audio[0], id: 'audio2', lastModified: 999, data: new Blob(['same bytes']) }],
  });

  const different = await fixture({
    ...patch, audio: [{ ...patch.audio[0], data: new Blob(['diff bytes']) }],
  });
  await page.goto('/static/reface/');
  await expect(page.locator('.message-entry[data-source="patch-status"] .message-text').last()).toHaveText('Patch Manager ready.');
  async function importFile(buffer) {
    await page.locator('#backup-open').click();
    await page.locator('#backup-file').setInputFiles({ name: 'patch.zip', mimeType: 'application/zip', buffer });
  }
  await importFile(first);
  await expect(page.locator('#backup-dialog')).not.toBeVisible();
  await importFile(identical);
  await expect(page.locator('#backup-dialog')).not.toBeVisible();
  await expect(page.locator('.patch-card')).toHaveCount(1);
  await importFile(different);
  await expect(page.getByRole('dialog', { name: 'Import patch' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Import patch' }).getByRole('button', { name: 'Ignore' }).click();
  await expect(page.locator('#backup-dialog')).not.toBeVisible();
});

test('loop backup imports skip identical content and preserve both versions when creating a copy', async ({ page }) => {
  await page.goto('/static/reface/');
  const phrase = writeMidi([
    { start: 0, playDuration: 0.5, channel: 0, pitch: 60, velocity: 90 },
    { start: 1, playDuration: 0.5, channel: 0, pitch: 65, velocity: 90 },
  ], 4, 120, 4);
  await page.locator('#looper-file').setInputFiles({ name: 'loop.mid', mimeType: 'audio/midi', buffer: Buffer.from(phrase) });
  await expect(page.locator('.message-entry[data-source="looper-status"] .message-text').last()).toContainText('Loaded loop.mid');
  await page.getByRole('button', { name: 'Save loop', exact: true }).click();
  await page.getByRole('dialog', { name: 'Save loop' }).getByLabel('Name').fill('Phrase');
  await page.getByRole('dialog', { name: 'Save loop' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.message-entry[data-source="looper-status"] .message-text').last()).toContainText('Saved loop');
  await page.locator('#backup-open').click();
  await page.locator('#backup-section').selectOption('loops');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#backup-export').click()]);
  const original = await readFile(await download.path());
  async function importFile(buffer) {
    await page.locator('#backup-open').click();
    await page.locator('#backup-file').setInputFiles({ name: 'loops.zip', mimeType: 'application/zip', buffer });
  }
  const files = unzipSync(original);
  const loops = JSON.parse(new TextDecoder().decode(files['loops.json']));
  loops[0].id = 'different-id';
  loops[0].updatedAt = '2020-01-01';
  loops[0].loop.notes.reverse();
  files['loops.json'] = strToU8(JSON.stringify(loops));
  await importFile(Buffer.from(zipSync(files)));
  await expect(page.locator('#backup-dialog')).not.toBeVisible();
  loops[0].loop.notes[0].pitch = 62;
  files['loops.json'] = strToU8(JSON.stringify(loops));
  await importFile(Buffer.from(zipSync(files)));
  await page.getByRole('dialog', { name: 'Import loop' }).getByRole('button', { name: 'Create new' }).click();
  const rename = page.getByRole('dialog', { name: 'Create new loop' });
  await expect(rename.getByLabel('Name')).toHaveValue('Phrase (2)');
  await rename.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog', { name: 'Import loop' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#backup-dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Load saved loop' }).click();
  await expect(page.locator('#looper-library-select option')).toHaveText(['Phrase', 'Phrase (2)']);
});
