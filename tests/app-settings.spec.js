import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/static/reface/');
  await expect(page.locator('.message-entry[data-source="app-status"] .message-text').last()).toContainText('Panel ready.');
});

test('dark synth control cycles modes and offers all modes in its right-click menu', async ({ page }) => {
  const mode = page.locator('#dark-synth-mode');
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
  await mode.click();
  await expect(page.locator('#synth svg')).toHaveClass(/dark-synth-case/);
  await expect(mode).toHaveAttribute('data-mode', 'case');
  await expect(page.locator('#body')).toHaveCSS('fill', 'rgb(37, 42, 44)');
  await expect(page.locator('#body')).toHaveCSS('stroke', 'none');
  await expect(page.locator('#body-edge')).toBeHidden();
  await expect(page.locator('#control-strip')).toHaveCSS('stroke', 'rgb(0, 0, 0)');
  await expect(page.locator('#yamaha-link text')).toHaveCSS('fill', 'rgb(196, 204, 206)');
  await expect(page.locator('#yamaha-link #path4')).toHaveCSS('fill', 'rgb(196, 204, 206)');
  await expect(page.locator('#cs-logo')).toHaveCSS('stroke', 'rgb(196, 204, 206)');
  await expect(page.locator('#arp-enabled .arp-lens')).toHaveCSS('fill', 'rgb(74, 83, 85)');
  await expect(page.locator('#arp-enabled text')).toHaveCSS('fill', 'rgb(238, 241, 239)');
  await expect(page.locator('#arp-held-notes')).toHaveCSS('fill', 'rgb(238, 241, 239)');
  await mode.click();
  await expect(page.locator('#synth svg')).toHaveClass(/dark-synth-keys/);
  await mode.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Dark synth mode choices' });
  await expect(menu).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Dark case only' }).click();
  await expect(mode).toHaveAttribute('data-mode', 'case');
  await expect(page.locator('#synth svg')).not.toHaveClass(/dark-synth-keys/);
  await mode.click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click();
  await expect(page.locator('#body-edge')).toBeVisible();
  await expect(page.locator('#yamaha-link #path4')).toHaveCSS('fill', 'rgb(30, 34, 33)');
});

test('startup preferences persist and sections can be reordered', async ({ page }) => {
  await page.locator('#app-settings-open').click();
  await page.locator('[data-setting="startupMessages"]').selectOption('hide');
  await page.locator('[data-setting="startupFocusMode"]').selectOption('show');
  await page.locator('[data-setting="startupSection:groove-panel"]').selectOption('open');
  await page.getByRole('button', { name: 'Move up Patch Manager' }).click();
  await page.locator('#settings-tempo-mode').selectOption('specific');
  await page.locator('#settings-tempo-value').fill('137');
  await page.locator('#settings-close').click();

  await page.reload();
  await expect(page.locator('#message-center')).toBeHidden();
  await expect(page.locator('#synth svg')).toHaveClass(/focus-mode/);
  await expect(page.locator('#groove-panel')).toHaveAttribute('open', '');
  await expect(page.locator('#settings-sections > details').first()).toHaveId('footer-panel');
  await expect(page.locator('#drum-tempo')).toHaveValue('137');
});

test('dark mode brightens every cyan housing action and restores the light-mode colors', async ({ page }) => {
  const targets = [
    ...['focus-mode', 'hide-speakers', 'hide-displays', 'five-octaves', 'reset-faders', 'fader-size']
      .map((id) => [`#${id}`, 'color']),
    ...['looper-transfer-open', 'looper-load', 'looper-save'].map((id) => [`#${id} path`, 'stroke']),
    ...['volume-mute', 'looper-meter', 'looper-quantize', 'pitch-range-down', 'pitch-range-up',
      'looper-bars-down', 'looper-bars-up'].map((id) => [`#${id} text`, 'fill']),
  ];
  const readColors = () => page.evaluate((targets) => targets.map(([selector, property]) =>
    getComputedStyle(document.querySelector(selector)).getPropertyValue(property)), targets);
  const light = await readColors();
  for (const mode of ['case', 'keys']) {
    await page.locator('#dark-synth-mode').click();
    await expect(page.locator('#dark-synth-mode')).toHaveAttribute('data-mode', mode);
    const dark = await readColors();
    for (let i = 0; i < targets.length; i++) {
      const before = light[i].match(/\d+/g).map(Number);
      const after = dark[i].match(/\d+/g).map(Number);
      for (let channel = 0; channel < 3; channel++) expect(after[channel], targets[i][0]).toBeGreaterThan(before[channel]);
      expect(dark[i]).toBe(dark[0]);
    }
  }
  await page.locator('#dark-synth-mode').click();
  expect(await readColors()).toEqual(light);
});

test('housing step symbols are fifty percent larger and Dark Synth label gap is seventy percent smaller', async ({ page }) => {
  const metrics = await page.evaluate(() => {
    const group = document.querySelector('#dark-synth-mode');
    const label = group.querySelector('text');
    const buttonX = Number(group.querySelector('.arp-bezel').getAttribute('x'));
    const width = label.getComputedTextLength();
    const baseSize = parseFloat(getComputedStyle(document.querySelector('#pitch-range')).fontSize);
    return {
      gapRatio: (buttonX - Number(label.getAttribute('x')) - width) / (buttonX - width),
      sizeRatios: [...document.querySelectorAll('.housing-step > text')]
        .map((text) => parseFloat(getComputedStyle(text).fontSize) / baseSize),
    };
  });
  expect(metrics.gapRatio).toBeCloseTo(0.3, 2);
  expect(metrics.sizeRatios).toHaveLength(6);
  for (const ratio of metrics.sizeRatios) expect(ratio).toBe(1.5);
});

test('settings apply dark mode immediately and keep dependent fields aligned and conditional', async ({ page }) => {
  await page.locator('#app-settings-open').click();
  const darkSelect = page.locator('#settings-dark-synth');
  await darkSelect.selectOption('keys');
  await expect(page.locator('#synth svg')).toHaveClass(/dark-synth-case/);
  await expect(page.locator('#synth svg')).toHaveClass(/dark-synth-keys/);
  await expect(page.locator('#dark-synth-mode')).toHaveAttribute('data-mode', 'keys');

  const sections = page.locator('#settings-section-order > li');
  await expect(sections).toHaveCount(2);
  for (const row of await sections.all()) {
    const select = await row.locator('select').boundingBox();
    const up = await row.getByRole('button', { name: /Move up/ }).boundingBox();
    expect(Math.abs((select.y + select.height / 2) - (up.y + up.height / 2))).toBeLessThan(2);
    expect(up.x).toBeGreaterThan(select.x + select.width);
  }
  const checkbox = page.locator('#settings-enable-audio');
  const layout = await checkbox.evaluate((input) => {
    const box = input.getBoundingClientRect();
    const text = document.createRange();
    text.selectNodeContents(input.parentElement.lastChild);
    const label = text.getBoundingClientRect();
    return { inputRight: box.right, labelLeft: label.left, inputY: box.y + box.height / 2, labelY: label.y + label.height / 2 };
  });
  expect(layout.labelLeft - layout.inputRight).toBeLessThan(20);
  expect(Math.abs(layout.inputY - layout.labelY)).toBeLessThan(3);

  const patchRow = page.locator('#settings-specific-patch-row');
  const tempoRow = page.locator('#settings-tempo-value-row');
  await expect(patchRow).toBeHidden();
  await expect(tempoRow).toBeHidden();
  await page.locator('#settings-midi-action').selectOption('specific-patch');
  await expect(patchRow).toBeVisible();
  await page.locator('#settings-midi-action').selectOption('capture');
  await expect(patchRow).toBeHidden();
  await page.locator('#settings-tempo-mode').selectOption('specific');
  await expect(tempoRow).toBeVisible();
  const tempoMode = await page.locator('#settings-tempo-mode').boundingBox();
  const tempoValue = await page.locator('#settings-tempo-value').boundingBox();
  expect(tempoValue.width).toBeLessThanOrEqual(100);
  expect(Math.abs((tempoMode.y + tempoMode.height / 2) - (tempoValue.y + tempoValue.height / 2))).toBeLessThan(2);
  await page.locator('#settings-tempo-mode').selectOption('default');
  await expect(tempoRow).toBeHidden();

  await page.locator('#settings-close').click();
  await page.reload();
  await expect(page.locator('#dark-synth-mode')).toHaveAttribute('data-mode', 'keys');
  await page.locator('#app-settings-open').click();
  await expect(darkSelect).toHaveValue('keys');
});

test('settings remain usable at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#app-settings-open').click();
  await page.locator('#settings-midi-action').selectOption('specific-patch');
  await page.locator('#settings-tempo-mode').selectOption('specific');
  await expect(page.locator('#settings-specific-patch-row')).toBeVisible();
  await expect(page.locator('#settings-tempo-value')).toBeVisible();
  const overflow = await page.locator('#app-settings').evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('reset restores dialog settings without deleting patterns or unrelated preferences', async ({ page }) => {
  await page.locator('#position-expression').check();
  await page.locator('#focus-mode').click();
  await page.locator('#dark-synth-mode').click();
  await page.locator('#app-settings-open').click();
  await page.locator('[data-setting="grooveLinkedStartup"]').selectOption('on');
  await page.locator('[data-setting="startupSection:groove-panel"]').selectOption('open');
  await page.getByLabel('Ignore unsaved Synth state when loading patch').check();
  await page.getByLabel('Hide audio samples on patches').check();
  const patternsBefore = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('refaceCS.drumPatterns.v1')).patterns.map((pattern) => pattern.id));

  await page.locator('#settings-reset').click();
  await page.getByRole('dialog', { name: 'Reset settings' }).getByRole('button', { name: 'Reset settings', exact: true }).click();

  await expect(page.locator('#dark-synth-mode')).toHaveAttribute('data-mode', 'off');
  await expect(page.locator('#focus-mode')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#drum-linked')).not.toBeChecked();
  await expect(page.locator('[data-setting="startupSection:groove-panel"]')).toHaveValue('last');
  await expect(page.locator('#groove-panel')).not.toHaveAttribute('open');
  await expect(page.getByLabel('Ignore unsaved Synth state when loading patch')).not.toBeChecked();
  await expect(page.getByLabel('Hide audio samples on patches')).not.toBeChecked();
  await expect(page.locator('#position-expression')).toBeChecked();
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('refaceCS.drumPatterns.v1')).patterns.map((pattern) => pattern.id))).toEqual(patternsBefore);
});
