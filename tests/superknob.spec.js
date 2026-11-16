import { test, expect } from '@playwright/test';
import { createPatchBackup, readPatchBackup, validatePatch, PATCH_CONTROL_IDS } from '../src/patches.js';
import { defaultSuperKnob, drawMapping, mappingValue, validateSuperKnob } from '../src/superknob.js';

test('macro definitions validate targets, independent curves, and supported cycle timing', () => {
  const definition = defaultSuperKnob();
  definition.mappings.push({ target: 'pitch-bend', enabled: false, values: Array(128).fill(64) });
  const copy = validateSuperKnob(definition);
  definition.mappings[0].values[0] = 100;
  expect(copy.mappings[0].values[0]).toBe(0);
  for (const invalid of [
    { ...copy, mappings: [copy.mappings[0], copy.mappings[0]] },
    { ...copy, mappings: [{ ...copy.mappings[0], target: 'tempo' }] },
    { ...copy, mappings: [{ ...copy.mappings[0], values: [0, 127] }] },
    { ...copy, cycle: { mode: 'seconds', seconds: 0, beats: 4 } },
    { ...copy, cycle: { mode: 'sync', seconds: 5, beats: 3 } },
    ...[0, 121, '5', null, NaN].map((recordSeconds) => ({ ...copy, recordSeconds })),
  ]) expect(() => validateSuperKnob(invalid)).toThrow('Invalid SuperKnob');
  const { recordSeconds, ...legacy } = copy;
  expect(recordSeconds).toBe(5);
  expect(validateSuperKnob(legacy).recordSeconds).toBe(5);
});

test('drawing supports descending lines and interpolation at fractional knob positions', () => {
  const values = Array(128).fill(0);
  drawMapping(values, { x: 127, y: 0 }, { x: 0, y: 127 });
  expect(values).toEqual(Array.from({ length: 128 }, (_, i) => 127 - i));
  expect(mappingValue({ values }, 63.5)).toBe(63.5);
  drawMapping(values, { x: 10, y: 200 }, { x: 10, y: 200 });
  expect(values[10]).toBe(127);
});

test('embedded macros round-trip through patch ZIPs without changing legacy patches', async () => {
  const legacy = validatePatch({
    id: 'legacy', name: 'Legacy', category: 'synth', tags: [], audio: [],
    controls: Object.fromEntries(PATCH_CONTROL_IDS.map((id) => [id, 0])),
  });
  expect(legacy.superKnob).toBeUndefined();
  const definition = defaultSuperKnob();
  definition.recordSeconds = 2;
  definition.cycle.seconds = 8;
  const embedded = validatePatch({ ...legacy, id: 'macro', superKnob: definition });
  definition.mappings[0].values[0] = 50;
  expect(embedded.superKnob.mappings[0].values[0]).toBe(0);
  const result = await readPatchBackup(await createPatchBackup([legacy, embedded]));
  expect(result[0].superKnob).toBeUndefined();
  expect(result[1].superKnob).toEqual(embedded.superKnob);
  expect(() => validatePatch({ ...legacy, superKnob: { mappings: [] } })).toThrow('Invalid SuperKnob');
});

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function addMapping(page, id) {
  await page.locator('#superknob-target').selectOption(id);
  await page.locator('#superknob-add').click();
}

async function point(page, position, value) {
  await page.locator('#superknob-point-x').fill(String(position));
  await page.locator('#superknob-point-x').dispatchEvent('input');
  await page.locator('#superknob-point-y').fill(String(value));
  await page.locator('#superknob-set-point').click();
}

async function saveMacro(page, name) {
  await page.locator('#superknob-save-as').click();
  const prompt = page.getByRole('dialog', { name: 'Save SuperKnob preset', exact: true });
  await prompt.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await prompt.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(prompt).toHaveCount(0);
}

test.describe('SuperKnob interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/static/reface/');
    await expect(page.locator('.message-entry[data-source="app-status"] .message-text').last()).toContainText('Panel ready.');
  });

  test('default cutoff, simultaneous mappings, discrete targets, and manual overrides use absolute values', async ({ page }) => {
    const knob = page.locator('#super-knob');
    await expect(knob).not.toHaveClass(/is-custom/);
    await knob.press('End');
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
    await page.locator('#super-knob-configure').click();
    await addMapping(page, 'filter-resonance');
    await page.locator('#superknob-reset-curve').click();
    await addMapping(page, 'lfo-assign');
    await page.locator('#superknob-reset-curve').click();
    await page.locator('#superknob-close').click();
    await knob.press('Home');
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
    await expect(page.locator('#filter-resonance')).toHaveAttribute('aria-valuenow', '127');
    await expect(page.locator('#lfo-assign')).toHaveAttribute('aria-valuenow', '4');
    await expect(knob).toHaveClass(/is-custom/);
    await page.locator('#filter-resonance').press('End');
    await expect(page.locator('#filter-resonance')).toHaveAttribute('aria-valuenow', '0');
    await knob.press('ArrowDown');
    await expect(page.locator('#filter-resonance')).toHaveAttribute('aria-valuenow', '126');
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '126');
  });

  test('configuration is non-modal, movable, keyboard closable, and leaves original faders usable', async ({ page }) => {
    const cycle = await page.locator('#super-knob-cycle').boundingBox();
    const edit = await page.locator('#super-knob-configure').boundingBox();
    expect(cycle.y).toBeCloseTo(edit.y, 1);
    expect(cycle.x + cycle.width).toBeLessThan(edit.x);
    await page.locator('#super-knob').click({ button: 'right' });
    const editor = page.locator('#superknob-editor');
    expect(await editor.evaluate((element) => element.matches(':modal'))).toBe(false);
    const before = await editor.boundingBox();
    const header = await page.locator('.superknob-header h2').boundingBox();
    await page.mouse.move(header.x + 10, header.y + 10);
    await page.mouse.down();
    await page.mouse.move(header.x + 50, header.y + 40);
    await page.mouse.up();
    const after = await editor.boundingBox();
    expect(after.x).toBeGreaterThan(before.x);
    await page.locator('#osc-mod').press('Home');
    await expect(page.locator('#osc-mod')).toHaveAttribute('aria-valuenow', '127');
    await expect(editor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect(page.locator('#super-knob')).toBeFocused();
    await page.locator('#super-knob').press('Shift+F10');
    await expect(editor).toBeVisible();
  });

  test('straight-line drawing creates a decreasing curve and point editing changes exact values', async ({ page }) => {
    await page.locator('#super-knob-configure').click();
    await page.locator('#superknob-tool').selectOption('line');
    const coords = await page.locator('#superknob-graph').evaluate((element) => {
      const matrix = element.getScreenCTM();
      const a = new DOMPoint(50, 20).matrixTransform(matrix);
      const b = new DOMPoint(620, 250).matrixTransform(matrix);
      return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
    });
    await page.mouse.move(coords.a.x, coords.a.y);
    await page.mouse.down();
    await page.mouse.move(coords.b.x, coords.b.y, { steps: 10 });
    await page.mouse.up();
    await setRange(page, 'superknob-preview', 0);
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
    await setRange(page, 'superknob-preview', 127);
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
    await point(page, 64, 99);
    await setRange(page, 'superknob-preview', 64);
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '99');
  });

  test('recording waits for the selected fader, then performs exactly one five-second sweep', async ({ page }) => {
    await page.clock.install();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.locator('#super-knob-configure').click();
    await page.locator('#superknob-record').click();
    await expect(page.locator('#superknob-record-state')).toHaveText('ARMED');
    await page.clock.runFor(10000);
    await expect(page.locator('#super-knob')).toHaveAttribute('aria-valuenow', '127');
    await page.locator('#osc-mod').press('Home');
    await expect(page.locator('#superknob-record-state')).toHaveText('ARMED');
    await page.locator('#filter-cutoff').press('End');
    await expect(page.locator('#superknob-record-state')).toHaveText('RECORDING');
    await page.clock.runFor(2500);
    const halfway = Number(await page.locator('#super-knob').getAttribute('aria-valuenow'));
    expect(halfway).toBeGreaterThanOrEqual(62);
    expect(halfway).toBeLessThanOrEqual(65);
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
    await setRange(page, 'superknob-record-fader', 127);
    await page.clock.runFor(2400);
    await expect(page.locator('#superknob-record-state')).toHaveText('RECORDING');
    await page.clock.runFor(200);
    await expect(page.locator('#superknob-record-state')).toHaveText('READY');
    await expect(page.locator('#super-knob')).toHaveAttribute('aria-valuenow', '127');
    await page.clock.runFor(6000);
    await expect(page.locator('#super-knob')).toHaveAttribute('aria-valuenow', '127');
    await setRange(page, 'superknob-preview', 0);
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
    await setRange(page, 'superknob-preview', 127);
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
    const definition = await page.evaluate(() => JSON.parse(localStorage.getItem('refaceCS.preferences.v1')).superKnobState.definition);
    expect(definition.mappings[0].values[32]).toBeGreaterThan(50);
    expect(definition.mappings[0].values[32]).toBeLessThan(80);
  });

  test('cancelling an incomplete take preserves the previous curve', async ({ page }) => {
    await page.clock.install();
    await page.locator('#super-knob-configure').click();
    const original = await page.locator('#superknob-curves path').getAttribute('d');
    await page.locator('#superknob-record').click();
    await setRange(page, 'superknob-record-fader', 0);
    await page.clock.runFor(2000);
    await page.locator('#superknob-record').click();
    await expect(page.locator('#superknob-record-state')).toHaveText('READY');
    await expect(page.locator('#superknob-curves path')).toHaveAttribute('d', original);
    await page.clock.runFor(5000);
    await expect(page.locator('#superknob-record-state')).toHaveText('READY');
  });

  test('recording duration is independent of synchronized playback settings and survives reload', async ({ page }) => {
    await page.clock.install();
    await page.locator('#super-knob-configure').click();
    await setRange(page, 'superknob-record-fader', 35);
    await page.locator('#superknob-record-seconds').fill('2');
    await page.locator('#superknob-record-seconds').press('Tab');
    await page.locator('#superknob-playback-seconds').fill('8');
    await page.locator('#superknob-playback-seconds').press('Tab');
    await expect(page.locator('#superknob-seconds')).toHaveValue('8');
    await expect(page.locator('#superknob-record-description')).toContainText('2-second');
    await page.locator('#superknob-playback-mode').selectOption('sync');
    await page.locator('#superknob-playback-beats').selectOption('8');
    await expect(page.locator('#superknob-cycle-mode')).toHaveValue('sync');
    await expect(page.locator('#superknob-beats')).toHaveValue('8');
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '35');
    await page.locator('#superknob-record').click();
    await expect(page.locator('#superknob-record-seconds')).toBeDisabled();
    await setRange(page, 'superknob-record-fader', 0);
    await page.clock.runFor(1000);
    expect(Number(await page.locator('#super-knob').getAttribute('aria-valuenow'))).toBeGreaterThan(60);
    expect(Number(await page.locator('#super-knob').getAttribute('aria-valuenow'))).toBeLessThan(67);
    await setRange(page, 'superknob-record-fader', 127);
    await page.clock.runFor(900);
    await expect(page.locator('#superknob-record-state')).toHaveText('RECORDING');
    await page.clock.runFor(200);
    await expect(page.locator('#superknob-record-state')).toHaveText('READY');
    await expect(page.locator('#superknob-record-seconds')).toBeEnabled();
    await page.locator('#superknob-close').click();
    await page.locator('#superknob-cycle-mode').selectOption('seconds');
    await page.locator('#super-knob').press('End');
    await page.locator('#superknob-cycle-toggle').click();
    await page.clock.runFor(2000);
    expect(Number(await page.locator('#super-knob').getAttribute('aria-valuenow'))).toBeGreaterThan(29);
    expect(Number(await page.locator('#super-knob').getAttribute('aria-valuenow'))).toBeLessThan(35);
    await page.reload();
    await page.locator('#super-knob-configure').click();
    await expect(page.locator('#superknob-record-seconds')).toHaveValue('2');
    await expect(page.locator('#superknob-playback-seconds')).toHaveValue('8');
    await expect(page.locator('#superknob-playback-beats')).toHaveValue('8');
    await expect(page.locator('#superknob-audition')).not.toBeChecked();
  });

  test('configuration remains within a narrow viewport with timing and audition controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#superknob-open').click();
    const dimensions = await page.locator('#superknob-editor').evaluate((element) => ({
      width: element.clientWidth, content: element.scrollWidth,
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.width);
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(390);
  });

  test('duration cycling reverses, manual movement stops it, and configuration prevents starting it', async ({ page }) => {
    await page.clock.install();
    await page.locator('#superknob-seconds').fill('1');
    await page.locator('#superknob-seconds').press('Tab');
    await page.locator('#super-knob').press('End');
    await page.locator('#superknob-cycle-toggle').click();
    await page.clock.runFor(500);
    let value = Number(await page.locator('#super-knob').getAttribute('aria-valuenow'));
    expect(value).toBeGreaterThan(55);
    expect(value).toBeLessThan(70);
    await page.clock.runFor(1000);
    value = Number(await page.locator('#super-knob').getAttribute('aria-valuenow'));
    expect(value).toBeGreaterThan(55);
    expect(value).toBeLessThan(70);
    await page.locator('#super-knob').press('End');
    await expect(page.locator('#superknob-cycle-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.clock.runFor(2000);
    await expect(page.locator('#super-knob')).toHaveAttribute('aria-valuenow', '0');
    await page.locator('#superknob-cycle-toggle').click();
    await page.locator('#super-knob-configure').click();
    await expect(page.locator('#superknob-cycle-toggle')).toBeDisabled();
    await expect(page.locator('#super-knob-cycle')).toHaveAttribute('aria-pressed', 'false');
  });

  test('tempo-sync cycling follows shared tempo changes without jumping phase', async ({ page }) => {
    await page.clock.install();
    await page.locator('#superknob-cycle-mode').selectOption('sync');
    await page.locator('#superknob-beats').selectOption('4');
    await page.locator('#super-knob').press('End');
    await page.locator('#superknob-cycle-toggle').click();
    await page.clock.runFor(1000);
    let value = Number(await page.locator('#super-knob').getAttribute('aria-valuenow'));
    expect(value).toBeGreaterThan(55);
    expect(value).toBeLessThan(70);
    await page.locator('#tempo').press('Home');
    await page.clock.runFor(500);
    value = Number(await page.locator('#super-knob').getAttribute('aria-valuenow'));
    expect(value).toBeGreaterThan(120);
    await page.locator('#midi-reset').click();
    await expect(page.locator('#superknob-cycle-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  test('stopping a cycle persists a valid position without automatically resuming after reload', async ({ page }) => {
    await page.clock.install();
    await page.locator('#super-knob').press('End');
    await page.locator('#superknob-cycle-toggle').click();
    await page.clock.runFor(731);
    await page.locator('#superknob-cycle-toggle').click();
    const position = await page.locator('#super-knob').getAttribute('aria-valuenow');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('refaceCS.preferences.v1')).superKnobState);
    expect(Number.isInteger(saved.position)).toBe(true);
    expect(saved.position).toBe(Number(position));
    await page.reload();
    await expect(page.locator('#super-knob')).toHaveAttribute('aria-valuenow', position);
    await expect(page.locator('#superknob-cycle-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.message-entry[data-source="superknob-status"][data-severity="error"]')).toHaveCount(0);
  });

  test('disabling and removing a mapping preserves manual values and restoring default clears the glow', async ({ page }) => {
    await page.locator('#super-knob-configure').click();
    await addMapping(page, 'expression');
    await page.locator('#superknob-reset-curve').click();
    await page.getByLabel('Enable Expression mapping', { exact: true }).uncheck();
    await setRange(page, 'superknob-preview', 0);
    await expect(page.locator('#expression')).toHaveAttribute('aria-valuenow', '127');
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
    await page.getByRole('button', { name: 'Remove Expression mapping', exact: true }).click();
    await expect(page.locator('#super-knob')).not.toHaveClass(/is-custom/);
    await page.getByRole('button', { name: 'Remove Cutoff mapping', exact: true }).click();
    await expect(page.locator('#superknob-record')).toBeDisabled();
    await expect(page.locator('#superknob-graph')).toBeVisible();
    await page.locator('#superknob-presets').selectOption('');
    await page.getByRole('dialog', { name: 'Load SuperKnob preset' }).getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.locator('#super-knob')).not.toHaveClass(/is-custom/);
    await expect(page.getByRole('button', { name: 'Remove Cutoff mapping', exact: true })).toBeVisible();
  });

  test('macro presets survive reload and embedded patch copies stay independent', async ({ page }) => {
    await page.locator('#super-knob-configure').click();
    await point(page, 0, 35);
    await saveMacro(page, 'Bloom');
    await page.locator('#superknob-include').check();
    await page.locator('#superknob-close').click();
    await page.locator('#patch-save-display').click();
    await page.locator('#patch-name').fill('Embedded macro');
    await expect(page.locator('#patch-include-superknob')).toBeChecked();
    await page.locator('#patch-editor-form button[type="submit"]').click();
    await expect(page.locator('#patch-editor')).toBeHidden();
    await page.locator('#super-knob-configure').click();
    await point(page, 0, 90);
    await page.locator('#superknob-save').click();
    await page.locator('#superknob-close').click();
    await expect(page.locator('#patch-display-screen')).toHaveAttribute('aria-label', 'Embedded macro (unsaved changes)');
    await page.reload();
    await page.locator('#super-knob-configure').click();
    await expect(page.locator('#superknob-presets option:checked')).toHaveText('Bloom');
    await setRange(page, 'superknob-preview', 0);
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '90');
    await page.locator('#superknob-close').click();
    if (!await page.locator('#footer-panel').evaluate((element) => element.open)) await page.locator('#footer-panel > summary').click();
    await page.locator('.patch-card').filter({ has: page.getByRole('heading', { name: 'Embedded macro', exact: true }) })
      .getByRole('button', { name: 'Load', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved sound' }).getByRole('button', { name: 'Discard and load' }).click();
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
    await page.locator('#super-knob').press('End');
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '35');
    await page.locator('#super-knob-configure').click();
    await page.locator('#superknob-presets').selectOption({ label: 'Bloom' });
    await page.getByRole('dialog', { name: 'Load SuperKnob preset' }).getByRole('button', { name: 'Load', exact: true }).click();
    await setRange(page, 'superknob-preview', 0);
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '90');
  });
});
