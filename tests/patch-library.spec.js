import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/static/reface/');
  await expect(page.locator('#app-status')).toContainText('Panel ready.');
  await expect(page.locator('#patch-status')).toHaveText('Patch library ready.');
});

async function savePatch(page, { name, description = '', category = 'synth', tags = '' }) {
  await page.locator('#patch-save').click();
  await page.locator('#patch-name').fill(name);
  await page.locator('#patch-description').fill(description);
  await page.locator('#patch-category').fill(category);
  await page.locator('#patch-tags').fill(tags);
  await page.locator('#patch-editor-form button[type="submit"]').click();
  return page.locator('.patch-card').filter({ has: page.getByRole('heading', { name }) });
}

async function connectMockMidi(page) {
  await page.addInitScript(() => {
    window.patchMessages = [];
    const input = Object.assign(new EventTarget(), { id: 'reface-in', name: 'reface CS input', state: 'connected' });
    const output = {
      id: 'reface-out', name: 'reface CS output', state: 'connected',
      send(data) { window.patchMessages.push([...data]); },
    };
    const access = Object.assign(new EventTarget(), {
      inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]),
    });
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
  });
  await page.reload();
  await expect(page.locator('#patch-status')).toHaveText('Patch library ready.');
  await page.locator('#midi-connect').click();
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
}

async function mockAudioInputs(page) {
  await page.addInitScript(() => {
    window.captureStats = { inputs: [], stopped: 0 };
    window.midiCountsAtCapture = [];
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      configurable: true,
      value: async () => [
        { kind: 'audioinput', deviceId: 'interface', label: 'Synth interface' },
        { kind: 'audioinput', deviceId: 'microphone', label: 'Microphone' },
      ],
    });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async ({ audio }) => {
        window.midiCountsAtCapture.push(window.patchMessages.length);
        window.captureStats.inputs.push(audio.deviceId?.exact || 'default');
        const context = new AudioContext();
        await context.resume();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0.2;
        const destination = context.createMediaStreamDestination();
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            window.captureStats.stopped++;
            stop();
            oscillator.stop();
            void context.close();
          };
        }
        return destination.stream;
      },
    });
  });
  await connectMockMidi(page);
}

test('records selected audio input for at most ten seconds, previews and persists a real MP3', async ({ page }) => {
  await mockAudioInputs(page);
  await page.locator('#lfo-depth').press('Home');
  const card = await savePatch(page, { name: 'Recorded synth' });
  await page.locator('#lfo-depth').press('End');
  await page.evaluate(() => { window.patchMessages = []; });
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  const dialog = page.locator('#patch-recorder');
  await expect(dialog.locator('#patch-record-start')).toBeEnabled();
  await expect(page.locator('#lfo-depth')).toHaveAttribute('aria-valuenow', '127');
  expect(await page.evaluate(() => window.midiCountsAtCapture)).toEqual([17]);
  expect(await page.evaluate(() => window.patchMessages)).toHaveLength(17);
  await dialog.locator('#patch-record-input').selectOption({ label: 'Synth interface' });
  await dialog.locator('#patch-record-start').click();
  await expect(dialog.locator('#patch-record-status')).toContainText('Recording');
  await expect(dialog.locator('#patch-record-save')).toBeEnabled({ timeout: 15000 });
  await expect(dialog.locator('audio')).toBeVisible();
  await expect(card.locator('.patch-audio-item')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.captureStats)).toEqual({
    inputs: ['default', 'interface'], stopped: 2,
  });
  const decoded = await dialog.locator('audio').evaluate(async (audio) => {
    const blob = await (await fetch(audio.src)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header = bytes.findIndex((byte, index) => byte === 0xff
      && (bytes[index + 1] & 0xfe) === 0xfa);
    const bitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bytes[header + 2] >> 4];
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const audible = buffer.getChannelData(0).some((value) => Math.abs(value) > 0.01);
    const result = { type: blob.type, duration: buffer.duration, audible, bitrate };
    await context.close();
    return result;
  });
  expect(decoded.type).toBe('audio/mpeg');
  expect(decoded.audible).toBe(true);
  expect(decoded.bitrate).toBe(256);
  expect(decoded.duration).toBeGreaterThan(9.5);
  // MP3 frame padding can extend playback slightly beyond the captured samples.
  expect(decoded.duration).toBeLessThan(10.1);
  await dialog.locator('#patch-record-save').click();
  await expect(dialog).not.toBeVisible();
  await expect(card.locator('.patch-audio-item')).toHaveCount(1);
  await expect(card.locator('.patch-audio-name')).toContainText('.mp3');
  await page.reload();
  await expect(page.locator('.patch-audio-item')).toHaveCount(1);
});

test('manual stop supports discarding and storage-error retry without losing the recording', async ({ page }) => {
  await mockAudioInputs(page);
  const card = await savePatch(page, { name: 'Short recording' });
  const dialog = page.locator('#patch-recorder');
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-start')).toBeEnabled();
  await dialog.locator('#patch-record-start').click();
  await expect(dialog.locator('#patch-record-stop')).toBeEnabled();
  await expect.poll(async () => Number(
    (await dialog.locator('#patch-record-status').textContent()).match(/^Recording ([\d.]+)/)?.[1],
  )).toBeGreaterThanOrEqual(0.3);
  await dialog.locator('#patch-record-stop').click();
  await expect(dialog.locator('#patch-record-save')).toBeEnabled();
  const url = await dialog.locator('audio').getAttribute('src');
  await page.evaluate(async () => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); };
  });
  await dialog.locator('#patch-record-save').click();
  await expect(dialog.locator('#patch-record-status')).toContainText('Storage quota exceeded');
  await expect(dialog.locator('#patch-record-save')).toBeEnabled();
  await expect(dialog.locator('audio')).toHaveAttribute('src', url);
  await expect(card.locator('.patch-audio-item')).toHaveCount(0);
  await page.evaluate(async () => {
    IDBObjectStore.prototype.put = window.originalPut;
  });
  await dialog.locator('#patch-record-save').click();
  await expect(dialog).not.toBeVisible();
  await expect(card.locator('.patch-audio-item')).toHaveCount(1);
  expect(await page.evaluate(async (oldUrl) => {
    try {
      await fetch(oldUrl);
      return false;
    } catch {
      return true;
    }
  }, url)).toBe(true);
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-start')).toBeEnabled();
  await dialog.locator('#patch-record-start').click();
  await expect.poll(async () => Number(
    (await dialog.locator('#patch-record-status').textContent()).match(/^Recording ([\d.]+)/)?.[1],
  )).toBeGreaterThanOrEqual(0.3);
  await dialog.locator('#patch-record-stop').click();
  await expect(dialog.locator('#patch-record-save')).toBeEnabled();
  await dialog.locator('#patch-record-discard').click();
  await expect(dialog).not.toBeVisible();
  await expect(card.locator('.patch-audio-item')).toHaveCount(1);
});

test('reports denied audio permission and cleans up a late permission grant after discard', async ({ page }) => {
  await mockAudioInputs(page);
  const card = await savePatch(page, { name: 'Permission check' });
  await page.evaluate(() => {
    window.realCapture = navigator.mediaDevices.getUserMedia;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
    });
  });
  const dialog = page.locator('#patch-recorder');
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-status')).toContainText('permission was denied');
  await expect(dialog.locator('#patch-record-start')).toBeDisabled();
  await dialog.locator('#patch-record-discard').click();
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: (constraints) => new Promise((resolve) => {
        window.grantCapture = async () => resolve(await window.realCapture(constraints));
      }),
    });
  });
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await dialog.locator('#patch-record-discard').click();
  await page.evaluate(() => window.grantCapture());
  await expect.poll(() => page.evaluate(() => window.captureStats.stopped)).toBe(1);
  await expect(dialog).not.toBeVisible();
  await expect(card.locator('.patch-audio-item')).toHaveCount(0);
});

test('Escape during capture releases the input without saving an attachment', async ({ page }) => {
  await mockAudioInputs(page);
  const card = await savePatch(page, { name: 'Canceled capture' });
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  const dialog = page.locator('#patch-recorder');
  await expect(dialog.locator('#patch-record-start')).toBeEnabled();
  await dialog.locator('#patch-record-start').click();
  await expect(dialog.locator('#patch-record-stop')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.captureStats.stopped)).toBe(1);
  await expect(card.locator('.patch-audio-item')).toHaveCount(0);
});

test('remembers selected input for other patches and across reloads, and records from that input', async ({ page }) => {
  await mockAudioInputs(page);
  const first = await savePatch(page, { name: 'First input choice' });
  const second = await savePatch(page, { name: 'Next input choice' });
  const dialog = page.locator('#patch-recorder');
  await first.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-start')).toBeEnabled();
  await dialog.locator('#patch-record-input').selectOption('interface');
  await dialog.locator('#patch-record-discard').click();
  await second.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-start')).toBeEnabled();
  await expect(dialog.locator('#patch-record-input')).toHaveValue('interface');
  await dialog.locator('#patch-record-discard').click();
  await page.reload();
  await expect(page.locator('#patch-status')).toHaveText('Patch library ready.');
  await page.locator('#midi-connect').click();
  await second.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-start')).toBeEnabled();
  await expect(dialog.locator('#patch-record-input')).toHaveValue('interface');
  await dialog.locator('#patch-record-start').click();
  await expect(dialog.locator('#patch-record-stop')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.captureStats.inputs)).toEqual(['default', 'interface']);
  await page.keyboard.press('Escape');
});

test('warns and selects the default input when the remembered device is unavailable', async ({ page }) => {
  await mockAudioInputs(page);
  const card = await savePatch(page, { name: 'Disconnected input' });
  const dialog = page.locator('#patch-recorder');
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-start')).toBeEnabled();
  await dialog.locator('#patch-record-input').selectOption('interface');
  await dialog.locator('#patch-record-discard').click();
  await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
    value: async () => [{ kind: 'audioinput', deviceId: 'microphone', label: 'Microphone' }],
  }));
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-start')).toBeEnabled();
  await expect(dialog.locator('#patch-record-input')).toHaveValue('default');
  await expect(dialog.locator('#patch-record-warning')).toContainText('previously selected audio input is unavailable');
});

test('reports preference-storage errors while remembering the input within the open page', async ({ page }) => {
  await mockAudioInputs(page);
  const card = await savePatch(page, { name: 'Blocked preference storage' });
  await page.evaluate(() => {
    localStorage.setItem('refaceCS-recording-input', 'microphone');
    const get = Storage.prototype.getItem;
    window.originalStorageGet = get;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'refaceCS-recording-input') throw new DOMException('Storage blocked', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'refaceCS-recording-input') throw new DOMException('Storage blocked', 'SecurityError');
      return set.call(this, key, value);
    };
  });
  const dialog = page.locator('#patch-recorder');
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-start')).toBeEnabled();
  await expect(dialog.locator('#patch-record-warning')).toContainText('Could not restore');
  await dialog.locator('#patch-record-input').selectOption('interface');
  await expect(dialog.locator('#patch-record-warning')).toContainText('Could not remember');
  await dialog.locator('#patch-record-discard').click();
  await page.evaluate(() => { Storage.prototype.getItem = window.originalStorageGet; });
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-start')).toBeEnabled();
  await expect(dialog.locator('#patch-record-input')).toHaveValue('interface');
});

test('explains secure-context and unsupported-browser recording requirements', async ({ page }) => {
  await connectMockMidi(page);
  const card = await savePatch(page, { name: 'Unavailable capture' });
  await page.evaluate(() => Object.defineProperty(window, 'isSecureContext', {
    configurable: true, value: false,
  }));
  const dialog = page.locator('#patch-recorder');
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-status')).toContainText('HTTPS or localhost');
  await expect(dialog.locator('#patch-record-start')).toBeDisabled();
  await dialog.locator('#patch-record-discard').click();
  await page.evaluate(() => {
    Object.defineProperty(window, 'isSecureContext', { value: true });
    window.MediaRecorder = undefined;
  });
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(dialog.locator('#patch-record-status')).toContainText('not supported in this browser');
  await expect(dialog.locator('#patch-record-start')).toBeDisabled();
});

test('Record loads app controls but blocks audio capture when MIDI output is unavailable', async ({ page }) => {
  await page.evaluate(() => {
    window.captureRequests = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      window.captureRequests++;
      throw new Error('Audio capture must not be requested');
    } });
  });
  await page.locator('#lfo-depth').press('Home');
  const card = await savePatch(page, { name: 'No MIDI recording' });
  await page.locator('#lfo-depth').press('End');
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.locator('#lfo-depth')).toHaveAttribute('aria-valuenow', '127');
  await expect(page.locator('#patch-status')).toContainText('MIDI output unavailable');
  await expect(page.locator('#patch-status')).toContainText('Recording blocked');
  await expect(page.locator('#patch-recorder')).not.toBeVisible();
  expect(await page.evaluate(() => window.captureRequests)).toBe(0);
  await expect(card.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
});

test('saves sound controls and patch metadata in IndexedDB and recalls them after reload', async ({ page }) => {
  await page.locator('#lfo-depth').press('Home');
  await page.locator('#portamento').press('Home');
  const card = await savePatch(page, {
    name: 'Cloud Pad',
    description: 'Slow, airy texture',
    category: 'Ambient',
    tags: 'soft, evolving',
  });

  await expect(card.locator('.patch-description')).toHaveCount(0);
  await expect(card.locator('.patch-category')).toHaveText('Ambient');
  await expect(card.locator('.patch-tags')).toContainText('soft');
  await expect(card.locator('.patch-tags')).toContainText('evolving');
  await expect(card.locator('.patch-fader-outline')).toHaveCount(1);
  await page.reload();
  const savedCard = page.locator('.patch-card').filter({ has: page.getByRole('heading', { name: 'Cloud Pad' }) });
  await expect(savedCard).toContainText('Cloud Pad');
  await page.locator('#patch-view-toggle').click();
  await expect(savedCard.locator('.patch-description')).toHaveText('Slow, airy texture');
  await savedCard.getByRole('button', { name: 'Load' }).click();
  await expect(page.locator('#lfo-depth')).toHaveAttribute('aria-valuenow', '127');
});

test('filters by favorites, category, and tag and recalls locally without MIDI', async ({ page }) => {
  const pad = await savePatch(page, {
    name: 'Bright Pad',
    category: 'pads',
    tags: 'bright, wide',
  });
  await savePatch(page, { name: 'Low Bass', category: 'bass', tags: 'dark' });
  await pad.getByRole('button', { name: 'Add Bright Pad to favorites' }).click();
  await page.locator('#patch-favorites-only').check();
  await expect(page.locator('.patch-card')).toHaveCount(1);
  await page.locator('#patch-category-filter').getByRole('button', { name: 'pads', exact: true }).click();
  await page.locator('#patch-tag-filter').getByRole('button', { name: 'wide', exact: true }).click();
  await expect(page.locator('.patch-card')).toContainText('Bright Pad');

  await page.locator('#filter-cutoff').press('End');
  await page.locator('.patch-card').getByRole('button', { name: 'Load' }).click();
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
  await expect(page.locator('#patch-status')).toContainText('MIDI output unavailable');
  await expect(page.locator('#midi-status')).toContainText('patch values were not sent');
});

test('multi-select filters use OR within each group and AND with name and favorites', async ({ page }) => {
  const first = await savePatch(page, { name: 'Air Pad', category: 'pads', tags: 'soft' });
  await savePatch(page, { name: 'Air Bass', category: 'bass', tags: 'dark' });
  await savePatch(page, { name: 'Air Keys', category: 'keys', tags: 'soft' });
  await savePatch(page, { name: 'Other Pad', category: 'pads', tags: 'soft' });
  await first.getByRole('button', { name: 'Add Air Pad to favorites' }).click();
  const categories = page.locator('#patch-category-filter');
  const tags = page.locator('#patch-tag-filter');
  await categories.getByRole('button', { name: 'pads', exact: true }).click();
  await categories.getByRole('button', { name: 'bass', exact: true }).click();
  await tags.getByRole('button', { name: 'soft', exact: true }).click();
  await tags.getByRole('button', { name: 'dark', exact: true }).click();
  await page.locator('#patch-name-filter').fill('aIR');
  await expect(page.locator('.patch-card h3')).toHaveText(['Air Bass', 'Air Pad']);
  await page.locator('#patch-favorites-only').check();
  await expect(page.locator('.patch-card h3')).toHaveText(['Air Pad']);
  await page.locator('#patch-clear-filters').click();
  await expect(page.locator('.patch-card')).toHaveCount(4);
  await expect(categories.locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(tags.locator('[aria-pressed="true"]')).toHaveCount(0);
});

test('highlights saving and aligns filter actions with matching button heights', async ({ page }) => {
  const saveStyle = await page.locator('#patch-save').evaluate((button) => {
    const style = getComputedStyle(button);
    return { background: style.backgroundColor, weight: Number(style.fontWeight) };
  });
  const [red, green, blue] = saveStyle.background.match(/\d+/g).map(Number);
  expect(green).toBeGreaterThan(red);
  expect(green).toBeGreaterThan(blue);
  expect(saveStyle.weight).toBeGreaterThanOrEqual(700);
  await expect(page.locator('.patch-filter-actions #patch-view-toggle')).toBeVisible();
  await expect(page.locator('.patch-filter-actions #patch-manage-labels')).toBeVisible();
  const clear = await page.locator('#patch-clear-filters').boundingBox();
  const detailed = await page.locator('#patch-view-toggle').boundingBox();
  const manage = await page.locator('#patch-manage-labels').boundingBox();
  const filters = await page.locator('.patch-filters').boundingBox();
  expect(clear.height).toBeCloseTo(detailed.height, 1);
  expect(clear.height).toBeCloseTo(manage.height, 1);
  expect(clear.y).toBeCloseTo(detailed.y, 1);
  expect(manage.x + manage.width).toBeCloseTo(filters.x + filters.width, 1);
});

test('compact snapshot reflects positions and detailed view remains available with Load at top right', async ({ page }) => {
  await page.locator('#lfo-depth').press('Home');
  const card = await savePatch(page, { name: 'Snapshot', description: 'Detailed description' });
  await expect(card.locator('.patch-select')).toHaveText('Preview');
  await expect(card.locator('.patch-actions button')).toHaveText([
    'Preview', 'Edit', '', 'Add MP3', 'Record',
  ]);
  await expect(card.locator('.patch-description')).toHaveCount(0);
  await expect(card.locator('.patch-delete svg')).toHaveClass(/patch-icon-trash/);
  await expect(card.locator('header .patch-favorite svg')).toHaveClass(/patch-icon-star/);
  expect(await card.locator('.patch-favorite svg').evaluate((svg) => getComputedStyle(svg).fill)).toBe('none');
  await expect(page.getByText('Name contains', { exact: true })).toHaveCount(0);
  await expect(card.getByText('Drag tracks to reorder, or use Up and Down.', { exact: true })).toHaveCount(0);
  const caps = card.locator('.patch-outline-cap');
  await expect(caps).toHaveCount(17);
  await expect(card.locator('[data-control="lfo-depth"] .patch-outline-cap')).toHaveAttribute('y1', '6');
  await expect(card.locator('[data-control="lfo-speed"] .patch-outline-cap')).toHaveAttribute('y1', '33');
  await expect(card.locator('header .patch-load')).toHaveCount(1);
  const titleBox = await card.locator('h3').boundingBox();
  const loadBox = await card.locator('.patch-load').boundingBox();
  const favoriteBox = await card.locator('.patch-favorite').boundingBox();
  expect(favoriteBox.x + favoriteBox.width).toBeLessThanOrEqual(loadBox.x);
  expect(loadBox.x).toBeGreaterThan(titleBox.x);
  expect(loadBox.y).toBeCloseTo(titleBox.y, 0);
  await page.locator('#patch-view-toggle').click();
  await expect(page.locator('#patch-view-toggle')).toHaveAttribute('title', /descriptions and labeled fader values/);
  await expect(card.locator('.patch-description')).toHaveText('Detailed description');
  await expect(card.locator('.patch-controls')).toBeVisible();
  await expect(card.locator('.patch-fader-outline')).toHaveCount(0);
  await page.locator('#patch-view-toggle').click();
  await expect(card.locator('.patch-description')).toHaveCount(0);
  await expect(card.locator('.patch-fader-outline')).toBeVisible();
  await card.locator('.patch-favorite').click();
  await expect(card.locator('.patch-favorite')).toHaveAttribute('aria-pressed', 'true');
  expect(await card.locator('.patch-favorite svg').evaluate((svg) => getComputedStyle(svg).fill)).toBe('rgb(255, 213, 74)');
});

test('Left and Right select filtered neighboring cards without wrapping, changing the synth, or interrupting typing', async ({ page }) => {
  const first = await savePatch(page, { name: 'A Pad', category: 'pads' });
  await savePatch(page, { name: 'B Bass', category: 'bass' });
  await savePatch(page, { name: 'C Pad', category: 'pads' });
  await page.locator('#patch-category-filter').getByRole('button', { name: 'pads', exact: true }).click();
  await page.locator('#filter-cutoff').press('End');
  await first.locator('h3').click();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.patch-card.is-selected h3')).toHaveText('A Pad');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.patch-card.is-selected h3')).toHaveText('C Pad');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.patch-card.is-selected h3')).toHaveText('C Pad');
  await page.locator('#patch-name-filter').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.patch-card.is-selected h3')).toHaveText('C Pad');
  await page.locator('#filter-cutoff').press('ArrowRight');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '1');
  await expect(page.locator('.patch-card.is-selected h3')).toHaveText('C Pad');
  await page.locator('#patch-name-filter').fill('C');
  await expect(page.locator('#patch-name-filter')).toBeFocused();
  await page.locator('#patch-name-filter').fill('nothing');
  await expect(page.locator('.patch-card.is-selected')).toHaveCount(0);
});

test('keyboard selection starts the next preview immediately and ignores stale playback results', async ({ page }) => {
  await page.addInitScript(() => {
    window.previewRequests = [];
    window.Audio = class extends EventTarget {
      constructor() {
        super();
        this.src = '';
      }
      play() {
        return new Promise((resolve, reject) => {
          window.previewRequests.push({ url: this.src, resolve, reject });
        });
      }
      pause() {}
      load() {}
      removeAttribute(name) {
        if (name === 'src') this.src = '';
      }
    };
  });
  await page.reload();
  await expect(page.locator('#patch-status')).toHaveText('Patch library ready.');
  const first = await savePatch(page, { name: 'A Preview' });
  const second = await savePatch(page, { name: 'B Preview' });
  for (const [card, filename] of [[first, 'first.mp3'], [second, 'second.mp3']]) {
    await card.getByRole('button', { name: 'Add MP3' }).click();
    await page.locator('#patch-audio-file').setInputFiles({
      name: filename, mimeType: 'audio/mpeg', buffer: Buffer.from(filename),
    });
    await expect(card.locator('.patch-audio-item')).toHaveCount(1);
  }
  await first.locator('h3').click();
  await expect.poll(() => page.evaluate(() => window.previewRequests.length)).toBe(1);
  expect(await page.evaluate(async () => (await fetch(window.previewRequests[0].url)).text())).toBe('first.mp3');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.patch-card.is-selected h3')).toHaveText('B Preview');
  await expect.poll(() => page.evaluate(() => window.previewRequests.length)).toBe(2);
  expect(await page.evaluate(async () => (await fetch(window.previewRequests[1].url)).text())).toBe('second.mp3');
  await page.evaluate(() => window.previewRequests[1].resolve());
  await expect(page.locator('#patch-status')).toContainText('Playing second.mp3 from B Preview.');
  await page.evaluate(() => window.previewRequests[0].reject(new DOMException('Interrupted', 'AbortError')));
  await expect(page.locator('#patch-status')).toContainText('Playing second.mp3 from B Preview.');
});

test('upgrades existing version-one patch storage without losing saved sounds', async ({ page }) => {
  await savePatch(page, { name: 'Legacy Patch', category: 'Legacy category', tags: 'legacy' });
  const patch = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('refaceCS-library');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise((resolve, reject) => {
      const request = database.transaction('patches').objectStore('patches').getAll();
      request.onsuccess = () => resolve(request.result[0]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return result;
  });
  await page.route('**/storage-migration.html', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Storage migration test</title>',
  }));
  await page.goto('/storage-migration.html');
  await page.evaluate(async (record) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('refaceCS-library');
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('refaceCS-library', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('patches', { keyPath: 'id' }).put(record);
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
  }, patch);
  await page.goto('/static/reface/');
  await expect(page.locator('#patch-status')).toHaveText('Patch library ready.');
  await expect(page.locator('.patch-card h3')).toHaveText('Legacy Patch');
  await expect(page.locator('#patch-category-filter').getByRole('button', { name: 'Legacy category', exact: true })).toBeVisible();
  await expect(page.locator('.patch-tags')).toHaveText('legacy');
});

test('deletes unused categories persistently and removes a tag from every patch without changing other data', async ({ page }) => {
  const first = await savePatch(page, { name: 'A Custom', category: 'Unused later', tags: 'shared, keep' });
  await savePatch(page, { name: 'B Custom', category: 'bass', tags: 'shared' });
  await first.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#patch-category').fill('pads');
  await page.locator('#patch-editor-form button[type="submit"]').click();
  await page.locator('#patch-manage-labels').click();
  const manager = page.locator('#patch-label-manager');
  await expect(manager.getByRole('button', { name: 'Delete category pads', exact: true })).toBeDisabled();
  await manager.getByRole('button', { name: 'Delete category Unused later', exact: true }).click();
  await expect(page.locator('#patch-label-status')).toContainText('Unused later deleted.');
  await manager.getByRole('button', { name: 'Delete category FM', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await manager.getByRole('button', { name: 'Delete tag shared', exact: true }).click();
  await expect(page.locator('#patch-label-status')).toContainText('shared removed');
  await page.locator('#patch-label-manager-close').click();
  await expect(first.locator('.patch-tags')).toHaveText('keep');
  await page.reload();
  await expect(page.locator('#patch-status')).toHaveText('Patch library ready.');
  await expect(page.locator('#patch-category-filter').getByRole('button', { name: 'FM', exact: true })).toHaveCount(0);
  await expect(page.locator('#patch-category-filter').getByRole('button', { name: 'Unused later', exact: true })).toHaveCount(0);
  await expect(page.locator('#patch-tag-filter').getByRole('button', { name: 'shared', exact: true })).toHaveCount(0);
  await expect(page.locator('.patch-card h3')).toHaveText(['A Custom', 'B Custom']);
});

test('confirms replacement when renaming a patch to an existing name', async ({ page }) => {
  await savePatch(page, { name: 'Existing Pad', description: 'Original' });
  const source = await savePatch(page, { name: 'New Pad', description: 'Replacement' });
  await source.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#patch-name').fill('Existing Pad');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#patch-editor-form button[type="submit"]').click();

  await expect(page.locator('.patch-card')).toHaveCount(1);
  await page.locator('#patch-view-toggle').click();
  await expect(page.locator('.patch-card')).toContainText('Replacement');
});

test('keeps patch cards at or below 500px and reflows them for narrow viewports', async ({ page }) => {
  await savePatch(page, { name: 'Grid One' });
  await savePatch(page, { name: 'Grid Two' });
  await savePatch(page, { name: 'Grid Three' });
  const desktopCards = await page.locator('.patch-card').evaluateAll((elements) => elements.map((element) => {
    const { left, top, width } = element.getBoundingClientRect();
    return { left, top, width };
  }));
  expect(desktopCards.every(({ width }) => width <= 500)).toBe(true);
  expect(desktopCards[0].top).toBe(desktopCards[1].top);
  expect(desktopCards[0].left).not.toBe(desktopCards[1].left);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCards = await page.locator('.patch-card').evaluateAll((elements) => elements.map((element) => {
    const { left, right } = element.getBoundingClientRect();
    return { left, right };
  }));
  expect(mobileCards[0].left).toBe(mobileCards[1].left);
  expect(mobileCards.every(({ right }) => right <= 390)).toBe(true);
});

test('continues patch CC sends and reports a partial recall after one send failure', async ({ page }) => {
  await page.addInitScript(() => {
    const input = Object.assign(new EventTarget(), { id: 'reface-in', name: 'reface CS input', state: 'connected' });
    const output = {
      id: 'reface-out',
      name: 'reface CS output',
      state: 'connected',
      send(data) {
        if (data[1] === 77) throw new Error('simulated CC failure');
        window.patchMessages.push([...data]);
      },
    };
    window.patchMessages = [];
    const access = Object.assign(new EventTarget(), {
      inputs: new Map([[input.id, input]]),
      outputs: new Map([[output.id, output]]),
    });
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
  });
  await page.reload();
  await expect(page.locator('#patch-status')).toHaveText('Patch library ready.');
  await page.locator('#midi-connect').click();
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
  const card = await savePatch(page, { name: 'Partial Send' });
  await card.getByRole('button', { name: 'Load' }).click();
  await expect(page.locator('#patch-status')).toContainText('16 CC values sent, 1 failed');
  expect(await page.evaluate(() => window.patchMessages)).toHaveLength(16);
  expect(await page.evaluate(() => window.patchMessages.some((message) => message[1] === 77))).toBe(false);
  await page.evaluate(() => {
    window.captureRequests = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      window.captureRequests++;
      throw new Error('Audio capture must not be requested');
    } });
  });
  await card.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.locator('#patch-status')).toContainText('Recording blocked');
  await expect(page.locator('#patch-status')).toContainText('16 CC values sent, 1 failed');
  await expect(page.locator('#patch-recorder')).not.toBeVisible();
  expect(await page.evaluate(() => window.captureRequests)).toBe(0);
});

test('attaches, reorders, removes, and persists MP3s on a patch card', async ({ page }) => {
  const card = await savePatch(page, { name: 'Three Tracks' });
  await card.getByRole('button', { name: 'Add MP3' }).click();
  await page.locator('#patch-audio-file').setInputFiles([
    { name: 'one.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('fake mp3 one') },
    { name: 'two.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('fake mp3 two') },
    { name: 'three.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('fake mp3 three') },
  ]);
  const tracks = card.locator('.patch-audio-item');
  await expect(tracks).toHaveCount(3);
  await expect(card.getByText(/^Audio \(\d\/\d\)$/)).toHaveCount(0);
  for (const [name, icon] of [
    ['Play one.mp3', 'play'], ['Move one.mp3 earlier', 'up'],
    ['Move one.mp3 later', 'down'], ['Remove one.mp3', 'trash'],
  ]) {
    const control = card.getByRole('button', { name, exact: true });
    await expect(control).toHaveText('');
    await expect(control).toHaveAttribute('title', name);
    await expect(control.locator('svg')).toHaveClass(new RegExp(`patch-icon-${icon}`));
  }
  await expect(card.getByRole('button', { name: 'Add MP3' })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Record', exact: true })).toBeDisabled();
  await tracks.nth(0).dragTo(tracks.nth(1));
  await expect(tracks.nth(0)).toContainText('two.mp3');
  await expect(tracks.nth(1)).toContainText('one.mp3');
  await page.reload();
  await expect(page.locator('.patch-card .patch-audio-item').nth(0)).toContainText('two.mp3');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.patch-card').getByRole('button', { name: 'Remove one.mp3' }).click();
  await expect(page.locator('.patch-card .patch-audio-item')).toHaveCount(2);
  await expect(card.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
});

test('exports and imports a ZIP backup with patch metadata, favorite state, and audio', async ({ page }) => {
  const card = await savePatch(page, {
    name: 'Backup Pad',
    description: 'Included in the backup',
    category: 'pads',
    tags: 'backup',
  });
  await card.getByRole('button', { name: 'Add MP3' }).click();
  await page.locator('#patch-audio-file').setInputFiles({
    name: 'preview.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('fake mp3'),
  });
  await card.getByRole('button', { name: 'Add Backup Pad to favorites' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#patch-export').click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  const backup = await readFile(backupPath);

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.patch-card').getByRole('button', { name: 'Delete Backup Pad', exact: true }).click();
  await expect(page.locator('.patch-card')).toHaveCount(0);
  await page.locator('#patch-import').click();
  await page.locator('#patch-import-file').setInputFiles({
    name: 'patches.zip',
    mimeType: 'application/zip',
    buffer: backup,
  });

  const imported = page.locator('.patch-card').filter({ has: page.getByRole('heading', { name: 'Backup Pad' }) });
  await page.locator('#patch-view-toggle').click();
  await expect(imported).toContainText('Included in the backup');
  await expect(imported.locator('.patch-category')).toHaveText('pads');
  await expect(imported.locator('.patch-audio-item')).toContainText('preview.mp3');
  await expect(imported.getByRole('button', { name: 'Remove Backup Pad from favorites' })).toHaveAttribute('aria-pressed', 'true');
  await imported.getByRole('button', { name: 'Remove Backup Pad from favorites' }).click();
  await expect(imported.getByRole('button', { name: 'Add Backup Pad to favorites' })).toHaveAttribute('aria-pressed', 'false');
});
