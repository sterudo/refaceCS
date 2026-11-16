import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/static/reface/');
  await expect(page.locator('.message-entry[data-source="app-status"] .message-text').last()).toContainText('Panel ready.');
});

test('help windows are non-modal, draggable, resizable, and independently dismissible', async ({ page }) => {
  await page.locator('[data-help-target="lfo-speed"]').click();
  const first = page.locator('.help-window').first();
  expect(await first.evaluate((dialog) => dialog.matches(':modal'))).toBe(false);

  await page.locator('#focus-mode').click();
  await expect(page.locator('#focus-mode')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.help-window')).toHaveCount(1);

  await page.locator('#help-open').click({ modifiers: ['Alt'] });
  const dialogs = page.locator('.help-window');
  await expect(dialogs).toHaveCount(2);
  await expect(dialogs.last()).toContainText('Limitations');
  await dialogs.last().getByRole('button', { name: 'Close About refaceCS help' }).click();

  const windowBefore = await first.evaluate((dialog) => ({
    left: dialog.getBoundingClientRect().left,
    top: dialog.getBoundingClientRect().top,
  }));
  const header = await first.locator('.help-window-header').boundingBox();
  await page.mouse.move(header.x + 120, header.y + 20);
  await page.mouse.down();
  await page.mouse.move(header.x + 60, header.y - 25);
  await page.mouse.up();
  const windowAfter = await first.evaluate((dialog) => ({
    left: dialog.getBoundingClientRect().left,
    top: dialog.getBoundingClientRect().top,
  }));
  expect(windowAfter.left).toBeCloseTo(windowBefore.left - 60, 0);
  expect(windowAfter.top).toBeCloseTo(windowBefore.top - 45, 0);

  const beforeResize = await first.boundingBox();
  const grip = await first.locator('.help-window-resize').boundingBox();
  expect(grip.width).toBeGreaterThanOrEqual(28);
  expect(grip.height).toBeGreaterThanOrEqual(28);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 120, grip.y + grip.height / 2 + 40);
  await page.mouse.up();
  const afterResize = await first.boundingBox();
  expect(afterResize.width).toBeCloseTo(beforeResize.width + 120, 0);
  expect(afterResize.height).toBeCloseTo(beforeResize.height + 40, 0);
  await first.locator('.help-window-resize').press('ArrowRight');
  expect((await first.boundingBox()).width).toBeCloseTo(afterResize.width + 16, 0);

  await page.locator('#help-open').click({ modifiers: ['Alt'] });
  const firstZIndex = Number(await first.evaluate((dialog) => dialog.style.zIndex));
  await first.locator('.help-window-resize').focus();
  expect(Number(await first.evaluate((dialog) => dialog.style.zIndex))).toBeGreaterThan(firstZIndex);
  await expect(first.locator('.help-window-close')).toHaveAttribute('title', 'Close help window (Escape)');
  await page.keyboard.press('Escape');
  await expect(dialogs).toHaveCount(1);
  await dialogs.first().locator('.help-window-close').click();
  await expect(dialogs).toHaveCount(0);
});

test('help opens next to its target with content height and a 90vh maximum', async ({ page }) => {
  const trigger = page.locator('[data-help-target="lfo-speed"]');
  await trigger.scrollIntoViewIfNeeded();
  const target = await trigger.boundingBox();
  await trigger.click();
  const dialog = page.locator('.help-window');
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds.width).toBeCloseTo(500, 0);
  expect(bounds.height).toBeLessThan(200);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(target.y + target.height / 2);
  expect(target.y + target.height / 2 - bounds.y - bounds.height).toBeLessThanOrEqual(13);
  expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 8);
  await dialog.locator('.help-window-close').click();

  await page.locator('#help-open').click();
  const tall = await dialog.boundingBox();
  expect(tall.height).toBeCloseTo(viewport.height * 0.9, 0);
  expect(tall.y + tall.height).toBeLessThanOrEqual(viewport.height - 8);
  expect(await dialog.locator('.help-window-content').evaluate((body) => body.scrollHeight > body.clientHeight)).toBe(true);
  await page.setViewportSize({ width: 480, height: 500 });
  await expect.poll(async () => (await dialog.boundingBox()).height).toBeLessThanOrEqual(450);
  const narrow = await dialog.boundingBox();
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(472);
  expect(narrow.y + narrow.height).toBeLessThanOrEqual(492);
});

test('opening help replaces all existing windows unless Alt-clicked', async ({ page }) => {
  await page.locator('[data-help-target="lfo-speed"]').click();
  const dialogs = page.locator('.help-window');
  await page.locator('#help-open').click({ modifiers: ['Alt'] });
  await expect(dialogs).toHaveCount(2);
  await expect(dialogs.first()).toContainText('LFO — Speed');
  await page.locator('#help-open').click({ modifiers: ['Alt'] });
  await expect(dialogs).toHaveCount(3);

  await page.locator('#help-open').click();
  await expect(dialogs).toHaveCount(1);
  await expect(dialogs.first()).toContainText('About refaceCS');
  await page.keyboard.press('Escape');
  await expect(dialogs).toHaveCount(0);
  await expect(page.locator('#help-open')).toBeFocused();
});

test('keyboard-opened windows anchor to the target and repeated windows cascade', async ({ page }) => {
  const trigger = page.locator('[data-help-target="lfo-speed"]');
  await trigger.focus();
  await trigger.press('Enter');
  const dialogs = page.locator('.help-window');
  const first = await dialogs.first().boundingBox();
  await dialogs.first().locator('.help-window-close').click();
  await expect(trigger).toBeFocused();
  await trigger.press('Space');
  const reopened = await dialogs.first().boundingBox();
  expect(reopened.x).toBeCloseTo(first.x, 0);
  expect(reopened.y).toBeCloseTo(first.y, 0);
  await trigger.press('Alt+Enter');
  await expect(dialogs).toHaveCount(2);
  const second = await dialogs.last().boundingBox();
  expect(second.y).toBeCloseTo(reopened.y + 28, 0);
  await trigger.press('Space');
  await expect(dialogs).toHaveCount(1);
  await dialogs.first().locator('.help-window-close').click();
  await expect(trigger).toBeFocused();
});

test('Alt-wheel changes only the hovered window background without scrolling or fading text', async ({ page }) => {
  await page.locator('[data-help-target="lfo-speed"]').click();
  const dialog = page.locator('.help-window').first();
  await dialog.hover();
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Alt');
  await expect(dialog).toHaveCSS('background-color', 'rgba(24, 34, 41, 0.95)');
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(dialog.locator('.help-window-header')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

  await dialog.dispatchEvent('wheel', { altKey: true, deltaY: 100 });
  await expect(dialog).toHaveCSS('background-color', 'rgba(24, 34, 41, 0.9)');
  await dialog.dispatchEvent('wheel', { deltaY: 100 });
  await expect(dialog).toHaveCSS('background-color', 'rgba(24, 34, 41, 0.9)');
  for (let i = 0; i < 30; i++) await dialog.dispatchEvent('wheel', { altKey: true, deltaY: 100 });
  await expect(dialog).toHaveCSS('background-color', 'rgba(24, 34, 41, 0.2)');
  for (let i = 0; i < 30; i++) await dialog.dispatchEvent('wheel', { altKey: true, deltaY: -100 });
  await expect(dialog).toHaveCSS('background-color', 'rgb(24, 34, 41)');
  await dialog.dispatchEvent('wheel', { altKey: true, deltaY: 100 });
  await page.locator('#help-open').click({ modifiers: ['Alt'] });
  await expect(page.locator('.help-window').last()).toHaveCSS('background-color', 'rgb(24, 34, 41)');
  await expect(dialog).toHaveCSS('background-color', 'rgba(24, 34, 41, 0.95)');
});

test('hover highlights the originating help target and clears on leave, close, and replacement', async ({ page }) => {
  const trigger = page.locator('[data-help-target="lfo-speed"]');
  await trigger.click();
  const dialogs = page.locator('.help-window');
  await dialogs.first().hover();
  await expect(trigger).toHaveClass(/help-target-active/);
  await expect(trigger).toHaveCSS('outline-width', '2px');
  await expect(page.locator('[data-help-target="lfo-depth"]')).not.toHaveClass(/help-target-active/);
  await page.mouse.move(1, 1);
  await expect(trigger).not.toHaveClass(/help-target-active/);

  await trigger.press('Alt+Enter');
  await dialogs.first().hover({ position: { x: 10, y: 10 } });
  await expect(trigger).toHaveClass(/help-target-active/);
  await page.keyboard.press('Escape');
  await expect(dialogs).toHaveCount(1);
  await expect(trigger).toHaveClass(/help-target-active/);
  await dialogs.first().locator('.help-window-close').click();
  await expect(trigger).not.toHaveClass(/help-target-active/);

  await trigger.press('Enter');
  await dialogs.first().hover();
  await expect(trigger).toHaveClass(/help-target-active/);
  await page.locator('#help-open').press('Enter');
  await expect(trigger).not.toHaveClass(/help-target-active/);
  await expect(dialogs).toHaveCount(1);
  await dialogs.first().hover();
  await expect(page.locator('#help-open')).toHaveClass(/help-target-active/);
});

test('About, Looper, Groove Studio, and Patch Manager default to 900px width within the viewport', async ({ page }) => {
  const dialog = page.locator('.help-window');
  for (const selector of ['#help-open', '[data-help-target="looper"]', '#groove-help-open', '#patch-help-open']) {
    await page.locator(selector).click();
    expect((await dialog.boundingBox()).width).toBeCloseTo(900, 0);
    await dialog.locator('.help-window-close').click();
  }
  await page.locator('#patch-help-open').click();
  await page.setViewportSize({ width: 480, height: 500 });
  await expect.poll(async () => (await dialog.boundingBox()).width).toBeLessThanOrEqual(464);
});

test('top Help includes the playing tips instead of a separate bottom panel', async ({ page }) => {
  await expect(page.locator('main > details > summary').filter({ hasText: /^Help$/ })).toHaveCount(0);
  await page.locator('#help-open').click();
  const dialog = page.getByRole('dialog', { name: 'About refaceCS', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Playing and panel controls' })).toBeVisible();
  const tips = dialog.getByRole('list').filter({ hasText: 'Hold keys to press them.' });
  await expect(tips.getByRole('listitem')).toHaveCount(8);
  await expect(tips).toContainText('Alt+wheel makes larger changes on continuous faders.');
  await expect(tips).toContainText('Home sets the top; End sets the bottom.');
  await expect(tips).toContainText('A W S E D F T G Y H U J K plays the middle octave');
  await expect(tips).toContainText('Looper LEDs show the UI looper state, not the hardware looper.');
});

test('version opens dated history in newest-first order and supports keyboard reopening', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Open Version History help', exact: true });
  await expect(trigger).toHaveText('v0.10');
  await expect(trigger).toHaveAttribute('title', /released 2026-11-16/);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Version History', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(false);
  expect((await dialog.boundingBox()).width).toBeCloseTo(900, 0);
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveText([
    'v0.10 - 2026-11-16', 'v0.8 - 2026-11-16', 'v0.7 - 2026-11-15', 'v0.6 - 2026-11-15', 'v0.5 - 2026-11-15',
    'v0.4 - 2026-11-15', 'v0.3 - 2026-11-15', 'v0.2 - 2026-11-15', 'v0.1 - 2026-11-12',
  ]);
  await expect(dialog).toContainText('Contextual help');
  await expect(dialog).toContainText('MIDI Learn with pickup');
  await expect(dialog).toContainText('Local ZIP and manual Google Drive backups');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await expect(dialog).toBeVisible();
});

test('Patch Manager help has collapsed feature sections and does not toggle the library or save a patch', async ({ page }) => {
  const panel = page.locator('#footer-panel');
  const trigger = page.getByRole('button', { name: 'Open Patch Manager help', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Patch Manager', exact: true });
  await expect(panel).not.toHaveAttribute('open', '');
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(panel).not.toHaveAttribute('open', '');
  await expect(page.locator('#patch-editor')).not.toBeVisible();
  await expect(dialog.getByText('The Patch Manager saves and organizes sounds', { exact: false })).toBeVisible();
  await expect(dialog.locator('details[open]')).toHaveCount(0);
  await dialog.getByText('Loading sounds and protecting unsaved changes', { exact: true }).click();
  await expect(dialog.getByText('Without an output, the patch loads only in the app.', { exact: false })).toBeVisible();
  await dialog.getByText('MP3 previews and recording', { exact: true }).click();
  await expect(dialog.getByText('Each patch supports up to three MP3 attachments.', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.press('Space');
  await expect(dialog).toBeVisible();
  await expect(panel).not.toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await panel.locator(':scope > summary').click();
  await trigger.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(panel).toHaveAttribute('open', '');
  await expect(page.locator('#patch-editor')).not.toBeVisible();
});

test('Groove Studio help leaves the panel closed and keeps all sections after the introduction collapsed', async ({ page }) => {
  const panel = page.locator('#groove-panel');
  await expect(panel).not.toHaveAttribute('open', '');
  await page.locator('#groove-help-open').click();
  await expect(panel).not.toHaveAttribute('open', '');
  const dialog = page.getByRole('dialog', { name: 'Groove Studio', exact: true });
  await expect(dialog.getByText('Groove Studio is a sixteenth-note step sequencer', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Groove Studio is a sixteenth-note step sequencer', { exact: false })).toContainText('internal drum synth, external MIDI devices, or both');
  await expect(dialog.locator('details')).toHaveCount(11);
  await expect(dialog.locator('details[open]')).toHaveCount(0);
  const steps = dialog.locator('details').filter({ has: page.locator('summary', { hasText: 'Steps, bars, and velocity' }) });
  await steps.locator('summary').click();
  await expect(steps.getByText('Each step is a sixteenth note:', { exact: false })).toBeVisible();
  await expect(steps.getByText('Levels 1 to 5 correspond', { exact: false })).toBeVisible();
  await expect(dialog.locator('details[open]')).toHaveCount(1);
  const routing = dialog.locator('details').filter({ has: page.locator('summary', { hasText: 'Internal audio and external MIDI' }) });
  await routing.locator('summary').click();
  await expect(routing.getByText('Sends drum notes to the independent output/channel', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#groove-help-open')).toBeFocused();
  await page.locator('#groove-help-open').press('Space');
  await expect(dialog).toBeVisible();
  await expect(panel).not.toHaveAttribute('open', '');
  await expect(page.locator('#drum-play')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await panel.locator(':scope > summary').click();
  await page.locator('#groove-help-open').click();
  await expect(panel).toHaveAttribute('open', '');
  await expect(dialog).toBeVisible();
});

test('panel help labels open their matching oscillator, filter, effect, and tempo copy', async ({ page }) => {
  await page.locator('[data-help-target="tempo"]').click();
  await expect(page.locator('.help-window').last()).toContainText('shared beat rate');
  await page.locator('.help-window-close').last().click();

  await page.locator('[data-help-target="lfo-assign"]').click();
  await expect(page.locator('.help-window').last()).toContainText('OSC2 pitch for Sync/Ring');
  await page.locator('.help-window-close').last().click();

  await page.locator('[data-help-target="osc-texture"]').click();
  await expect(page.locator('.help-window').last()).toContainText('Adds an octave-lower sub-oscillator');
  await page.locator('.help-window-close').last().click();

  await page.locator('[data-help-target="osc-mod"]').click();
  await expect(page.locator('.help-window').last()).toContainText('Changes the pitch of the modulator oscillator');
  await page.locator('.help-window-close').last().click();

  await page.locator('[data-help-target="filter-cutoff"]').click();
  await expect(page.locator('.help-window').last()).toContainText('low-pass filter');
  await expect(page.locator('.help-window').last().getByRole('listitem')).toHaveCount(2);
  await page.locator('.help-window-close').last().click();

  await page.locator('[data-help-target="effect-type"]').click();
  await expect(page.locator('.help-window').last().getByRole('listitem')).toHaveCount(6);
  await page.locator('.help-window-close').last().click();

  await page.locator('[data-help-target="effect-rate"]').click();
  await expect(page.locator('.help-window').last()).toContainText('Sets delay time');
});

test('CS logo opens synth information and Yamaha logo remains an external link', async ({ page }) => {
  await page.locator('#cs-logo').click();
  const dialog = page.locator('.help-window').last();
  await expect(dialog).toContainText('Detailed Specification');
  await expect(dialog.locator('details')).not.toHaveAttribute('open', '');
  await dialog.locator('summary').click();
  await expect(dialog.locator('details')).toHaveAttribute('open', '');

  await expect(page.locator('#yamaha-link')).toHaveAttribute('href', 'https://www.yamaha.com/en/');
  await expect(page.locator('#yamaha-link')).toHaveAttribute('target', '_blank');
  await dialog.locator('.help-window-close').click();
  await page.locator('#yamaha-link').scrollIntoViewIfNeeded();
  const hits = await page.locator('#yamaha-link').evaluate((anchor) => {
    const points = [[204, 245], [216.82, 261.82], [230, 276], [330, 263]];
    return points.map(([x, y]) => {
      const screen = new DOMPoint(x, y).matrixTransform(anchor.getScreenCTM());
      return anchor.contains(document.elementFromPoint(screen.x, screen.y));
    });
  });
  expect(hits).toEqual([true, true, true, true]);
});
