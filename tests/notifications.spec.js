import { test, expect } from '@playwright/test';

async function open(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined });
  });
  await page.goto('/static/reface/');
  await expect(page.locator('.message-entry[data-source="patch-status"]').last()).toContainText('Patch Manager ready.');
}

async function addMessages(page, count) {
  await page.locator('#focus-mode').evaluate((button, n) => {
    for (let i = 0; i < n; i++) button.click();
  }, count);
}

test('appends feedback, filters categories without deleting history, glows and resets on reload', async ({ page }) => {
  await open(page);
  const rows = page.locator('.message-entry');
  const initial = await rows.count();
  const initialMidi = await page.locator('.message-entry[data-category="midi"]').count();
  await addMessages(page, 2);
  await expect(rows).toHaveCount(initial + 2);
  await page.locator('#midi-connect').click();
  await expect(rows.nth(initial)).toContainText('Focus Mode on');
  await expect(rows.nth(initial + 1)).toContainText('Focus Mode off');
  await expect(page.locator('.message-entry[data-source="midi-status"]').last()).toContainText('secure context');
  await expect(page.locator('.message-entry[data-source="drum-status"]').last()).toContainText('Drum audio ready');
  const total = await rows.count();
  await expect(page.locator('#message-center')).toHaveClass(/has-new-message/);
  await expect(page.locator('#message-center')).not.toHaveClass(/has-new-message/, { timeout: 3000 });
  const filters = page.getByRole('group', { name: 'Filter messages' });
  await filters.getByRole('button', { name: 'MIDI', exact: true }).click();
  await expect(page.locator('.message-entry:not([hidden])')).toHaveCount(initialMidi + 1);
  await filters.getByRole('button', { name: 'App', exact: true }).click();
  await expect(rows.nth(initial)).toBeVisible();
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('.message-entry[hidden]')).toHaveCount(0);
  await expect(rows).toHaveCount(total);
  await filters.getByRole('button', { name: 'reface', exact: true }).click();
  await expect(page.locator('#message-empty')).toBeVisible();
  await addMessages(page, 1);
  await expect(page.locator('#message-center')).toHaveClass(/has-new-message/);
  await expect(page.locator('.message-entry:not([hidden])')).toHaveCount(0);
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(rows.last()).toContainText('Focus Mode on');
  await page.reload();
  await expect(page.locator('.message-entry[data-source="patch-status"]').last()).toContainText('Patch Manager ready.');
  await expect(page.locator('.message-entry[data-source="midi-status"]')).toHaveCount(0);
  await expect(page.locator('#midi-status, #app-status, #midisettingslog')).toHaveCount(0);
});

test('retains queued startup errors and treats notification text as text', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('refaceCS.preferences.v1', '{invalid'));
  await open(page);
  await expect(page.locator('.message-entry[data-source="preferences-status"]')).toContainText('Could not restore');
  await page.locator('#backup-open').click();
  await page.evaluate(() => {
    File.prototype.arrayBuffer = async () => { throw new Error('<img src=x onerror=alert(1)>'); };
  });
  await page.locator('#backup-file').setInputFiles({
    name: '<img src=x onerror=alert(1)>.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip'),
  });
  await expect(page.locator('.message-entry[data-source="backup-status"]')).toContainText('Could not import backup');
  await expect(page.locator('.message-entry[data-source="backup-status"]')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#message-log img')).toHaveCount(0);
});

test('follows new messages at the bottom but leaves a reader at their scroll position', async ({ page }) => {
  await open(page);
  const log = page.locator('#message-log');
  await addMessages(page, 40);
  await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(4);
  await log.evaluate((el) => new Promise((resolve) => {
    el.addEventListener('scroll', () => resolve(), { once: true });
    el.scrollTop = 0;
  }));
  await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBe(0);
  await addMessages(page, 1);
  await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBe(0);
  await log.evaluate((el) => new Promise((resolve) => {
    el.addEventListener('scroll', () => resolve(), { once: true });
    el.scrollTop = el.scrollHeight;
  }));
  await addMessages(page, 1);
  await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(4);
});

test('pins branding, top controls and the log without overflow on wide and narrow screens', async ({ page }) => {
  await open(page);
  await addMessages(page, 20);
  for (const width of [1920, 2400, 800, 480, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('#message-slot')).toHaveCSS('height', '100px');
    await expect.poll(() => page.locator('#message-log').evaluate((log) =>
      log.scrollHeight - log.clientHeight - log.scrollTop,
    )).toBeLessThan(4);
    await page.evaluate(() => window.scrollTo(0, 450));
    await expect.poll(async () => page.locator('.toolbar').evaluate((header) =>
      Math.abs(header.getBoundingClientRect().top),
    )).toBeLessThan(1);
    const layout = await page.locator('.toolbar').evaluate((header) => {
      const brand = header.querySelector('.toolbar-brand').getBoundingClientRect();
      const center = header.querySelector('#message-center').getBoundingClientRect();
      const controls = header.querySelector('.midi-ports').getBoundingClientRect();
      const badge = header.querySelector('#midi-badge').getBoundingClientRect();
      const connect = header.querySelector('#midi-connect').getBoundingClientRect();
      return {
        heightFits: center.height === 100,
        brandPinned: brand.top >= 0 && brand.bottom < 600,
        controlsPinned: controls.top >= 0 && controls.bottom < center.top,
        badgeFits: badge.bottom <= connect.top,
        messagesPinned: center.top >= 0 && center.bottom < 600,
        noOverflow: header.scrollWidth <= header.clientWidth + 1,
      };
    });
    expect(layout, `viewport ${width}`).toEqual({
      heightFits: true, brandPinned: true, controlsPinned: true, badgeFits: true, messagesPinned: true, noOverflow: true,
    });
  }
});

test('keeps the single log usable in nested modals and retains inline field validation', async ({ page }) => {
  await open(page);
  await page.route('https://accounts.google.com/**', (route) => route.abort());
  await page.locator('#backup-open').click();
  await expect(page.locator('#backup-dialog #message-center')).toHaveCount(1);
  await page.locator('#cloud-open').click();
  await expect(page.locator('#cloud-dialog #message-center')).toHaveCount(1);
  await expect.poll(() => page.locator('#cloud-dialog').evaluate((dialog) =>
    dialog.getBoundingClientRect().top - document.querySelector('#message-center').getBoundingClientRect().bottom,
  )).toBeGreaterThanOrEqual(7);
  await page.getByRole('group', { name: 'Filter messages' }).getByRole('button', { name: 'Backups', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Backups', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#cloud-close').click();
  await expect(page.locator('#backup-dialog #message-center')).toHaveCount(1);
  await page.locator('#messages-close').click();
  await expect(page.locator('#message-center')).toBeHidden();
  await expect(page.locator('#backup-dialog')).toBeFocused();
  await page.locator('#backup-file').setInputFiles({
    name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('invalid'),
  });
  await expect(page.locator('.message-entry[data-source="backup-status"]').last()).toContainText('Could not import');
  await expect(page.locator('#message-center')).toBeHidden();
  await expect(page.locator('#messages-open')).toHaveClass(/has-unread-error/);
  await page.locator('#backup-close').click();
  await expect(page.locator('#message-slot #message-center')).toHaveCount(1);
  await page.locator('#messages-open').click();
  await expect(page.locator('#message-center')).toBeVisible();
  await page.locator('#groove-panel > summary').click();
  await page.locator('#drum-new').click();
  const dialog = page.getByRole('dialog', { name: 'Drum pattern name', exact: true });
  await page.locator('#messages-close').click();
  await dialog.getByRole('textbox').fill(' ');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Enter a name.');
  await expect(page.locator('#message-center')).toBeHidden();
  await expect(page.locator('#message-log')).not.toContainText('Enter a name.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#message-slot #message-center')).toHaveCount(1);
});

test('dismisses without losing history and marks hidden errors red until explicitly opened', async ({ page }) => {
  await open(page);
  const center = page.locator('#message-center');
  const show = page.locator('#messages-open');
  const filters = page.getByRole('group', { name: 'Filter messages' });
  await addMessages(page, 30);
  await filters.getByRole('button', { name: 'App', exact: true }).click();
  await page.locator('#message-log').evaluate((log) => new Promise((resolve) => {
    log.addEventListener('scroll', () => resolve(), { once: true });
    log.scrollTop = 0;
  }));
  const count = await page.locator('.message-entry').count();
  await page.locator('#messages-close').click();
  await expect(center).toBeHidden();
  await expect(show).toBeVisible();
  const normalBackground = await show.evaluate((button) => getComputedStyle(button).backgroundColor);
  await expect(show).toBeFocused();
  expect(await show.evaluate((button) => button.previousElementSibling.contains(document.querySelector('#midi-controller-input')))).toBe(true);
  await addMessages(page, 1);
  await expect(page.locator('.message-entry')).toHaveCount(count + 1);
  await expect(center).toBeHidden();
  await expect(show).not.toHaveClass(/has-unread-error/);
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(show).toBeInViewport();
  await show.click();
  await expect(center).toBeVisible();
  await expect(show).toBeHidden();
  await expect(filters.getByRole('button', { name: 'App', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('#message-log').evaluate((log) => log.scrollTop)).toBe(0);
  await page.locator('#messages-close').click();
  await page.locator('#midi-connect').click();
  await expect(center).toBeHidden();
  await expect(show).toHaveClass(/has-unread-error/);
  await expect(show).toHaveAccessibleName('Messages (new errors)');
  await expect(show).toHaveCSS('background-color', 'rgb(165, 42, 53)');
  await expect(page.locator('#midi-connect')).toBeFocused();
  await addMessages(page, 1);
  await expect(show).toHaveClass(/has-unread-error/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('refaceCS.preferences.v1')).messagesVisible)).toBe(false);
  await show.click();
  await expect(center).toBeVisible();
  await expect(show).not.toHaveClass(/has-unread-error/);
  await expect(show).toHaveCSS('background-color', normalBackground);
  await expect(filters.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.message-entry[data-source="midi-status"][data-severity="error"]').last()).toBeVisible();
  await page.locator('#messages-close').click();
  await expect(show).toHaveCSS('background-color', normalBackground);
  await page.reload();
  await expect(center).toBeHidden();
});

test('Settings-hidden messages stay hidden on MIDI errors and retain the startup preference', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('refaceCS.preferences.v1', JSON.stringify({ startupMessages: 'hide' }));
  });
  await open(page);
  await page.locator('#midi-connect').click();
  await expect(page.locator('#message-center')).toBeHidden();
  await expect(page.locator('#messages-open')).toHaveClass(/has-unread-error/);
  await page.locator('#messages-open').click();
  await expect(page.locator('#message-center')).toBeVisible();
  await expect(page.locator('#messages-open')).not.toHaveClass(/has-unread-error/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('refaceCS.preferences.v1')).startupMessages)).toBe('hide');
  await page.reload();
  await expect(page.locator('#message-center')).toBeHidden();
});

test('matches the dark background and resizes only height with a 100px default and 75px minimum', async ({ page }) => {
  await open(page);
  const center = page.locator('#message-center');
  const resize = page.getByRole('button', { name: 'Resize message panel height', exact: true });
  await expect(center).toHaveCSS('background-color', 'rgb(30, 30, 30)');
  await expect(center).toHaveCSS('height', '100px');
  const before = await center.boundingBox();
  let handle = await resize.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2 + 80, { steps: 4 });
  await page.mouse.up();
  await expect(center).toHaveCSS('height', '180px');
  expect((await center.boundingBox()).width).toBeCloseTo(before.width, 1);
  handle = await resize.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 60, 0, { steps: 4 });
  await page.mouse.up();
  await expect(center).toHaveCSS('height', '75px');
  await resize.press('ArrowDown');
  await expect(center).toHaveCSS('height', '85px');
  await resize.press('ArrowLeft');
  expect((await center.boundingBox()).width).toBeCloseTo(before.width, 1);
  await page.locator('#messages-close').click();
  await page.locator('#messages-open').click();
  await expect(center).toHaveCSS('height', '85px');
});

test('routes recorder errors to Messages and keeps elapsed recording time as a readout', async ({ page }) => {
  await page.addInitScript(() => {
    const access = new EventTarget();
    const input = Object.assign(new EventTarget(), { id: 'ri', name: 'reface CS', state: 'connected' });
    const output = { id: 'ro', name: 'reface CS', state: 'connected', send() {} };
    access.inputs = new Map([['ri', input]]);
    access.outputs = new Map([['ro', output]]);
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
    window.denyRecording = true;
    navigator.mediaDevices.enumerateDevices = async () => [];
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.denyRecording) throw new DOMException('Denied', 'NotAllowedError');
      const context = new AudioContext();
      await context.resume();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); oscillator.stop(); void context.close(); };
      }
      return destination.stream;
    };
  });
  await page.goto('/static/reface/');
  await expect(page.locator('.message-entry[data-source="patch-status"]').last()).toContainText('Patch Manager ready');
  await page.locator('#midi-connect').click();
  await expect(page.locator('.message-entry[data-source="capture-status"]').last()).toContainText('Automatic capture skipped');
  await page.locator('#patch-save').click();
  await page.locator('#patch-name').fill('Notification recording');
  await page.locator('#patch-editor-form').getByRole('button', { name: 'Save patch', exact: true }).click();
  const library = page.locator('details:has(> #patch-library)');
  if (await library.getAttribute('open') === null) await library.locator('summary').click();
  const record = page.locator('.patch-card').getByRole('button', { name: 'Record', exact: true });
  await record.click();
  await expect(page.locator('.message-entry[data-source="patch-record-status"]').last()).toContainText('permission was denied');
  await expect(page.locator('#patch-recorder #message-center')).toHaveCount(1);
  await page.locator('#patch-record-discard').click();
  await page.evaluate(() => { window.denyRecording = false; });
  await record.click();
  await expect(page.locator('#patch-record-start')).toBeEnabled();
  await page.locator('#patch-record-start').click();
  const messages = page.locator('.message-entry[data-source="patch-record-status"]');
  const count = await messages.count();
  await expect.poll(async () => Number((await page.locator('#patch-record-progress').textContent()).split(' / ')[0])).toBeGreaterThanOrEqual(0.3);
  await expect(messages).toHaveCount(count);
  await page.locator('#patch-record-discard').click();
  await expect(page.locator('#patch-recorder')).not.toBeVisible();
  await expect(page.locator('#message-slot #message-center')).toHaveCount(1);
});
