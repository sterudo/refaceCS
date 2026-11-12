import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/static/reface/');
  await expect(page.locator('#app-status')).toContainText('Panel ready.');
});

async function faderPoint(page, id, y) {
  return page.locator(`#${id}`).evaluate((element, localY) => {
    const point = new DOMPoint(0, localY).matrixTransform(element.getScreenCTM());
    return { x: point.x, y: point.y };
  }, y);
}

test('fully open filter is centered and flat without a right-edge falloff', async ({ page }) => {
  const curve = page.locator('#preview-filter .graph-curve');
  for (const resonance of ['End', 'Home']) {
    await page.locator('#filter-resonance').press(resonance);
    const bounds = await curve.evaluate((element) => {
      const { y, height } = element.getBBox();
      const end = element.getPointAtLength(element.getTotalLength());
      return { y, height, endY: end.y };
    });
    expect(bounds).toEqual({ y: 68, height: 0, endY: 68 });
  }
  await page.locator('#filter-cutoff').press('ArrowDown');
  expect(await curve.evaluate((element) => element.getBBox().height)).toBeLessThan(10);
  await page.locator('#filter-resonance').press('End');
  await page.locator('#filter-cutoff').press('End');
  const endpoints = await curve.evaluate((element) => ({
    startY: element.getPointAtLength(0).y,
    endY: element.getPointAtLength(element.getTotalLength()).y,
  }));
  expect(endpoints.endY).toBeGreaterThan(endpoints.startY);
});

test('filter and separate envelopes follow the faders and balance without muting the amp', async ({ page }) => {
  const curve = (id) => page.locator(`#preview-${id} .graph-curve`);
  const initialFilter = await curve('filter').getAttribute('d');
  await page.locator('#filter-cutoff').press('End');
  await expect(curve('filter')).not.toHaveAttribute('d', initialFilter);
  const lowFilter = await curve('filter').getAttribute('d');
  await page.locator('#filter-resonance').press('Home');
  await expect(curve('filter')).not.toHaveAttribute('d', lowFilter);

  const initialAmp = await curve('amp-eg').getAttribute('d');
  const inactiveFilter = await curve('filter-eg').getAttribute('d');
  await page.locator('#eg-attack').press('Home');
  await expect(curve('amp-eg')).not.toHaveAttribute('d', initialAmp);
  expect(await curve('filter-eg').evaluate((element) => element.getBBox().height)).toBe(0);
  await page.locator('#eg-balance').press('Home');
  await expect(curve('filter-eg')).not.toHaveAttribute('d', inactiveFilter);
  await expect(page.locator('#preview-amp-eg .graph-context')).toContainText('note gate remains');
  expect(await curve('amp-eg').evaluate((element) => element.getBBox().height)).toBeCloseTo(98);

  await page.locator('#eg-balance').press('End');
  await page.locator('#eg-balance').press('PageUp');
  const amp = await curve('amp-eg').getAttribute('d');
  const filter = await curve('filter-eg').getAttribute('d');
  await page.locator('#eg-sustain').press('End');
  await expect(curve('amp-eg')).not.toHaveAttribute('d', amp);
  await expect(curve('filter-eg')).not.toHaveAttribute('d', filter);
  await expect(page.locator('#preview-amp-eg .graph-values')).toHaveText(
    await page.locator('#preview-filter-eg .graph-values').textContent());

  await page.locator('#filter-cutoff .cap').dblclick();
  await page.locator('#filter-resonance .cap').dblclick();
  await expect(curve('filter')).toHaveAttribute('d', initialFilter);
});

test('LFO and effect previews reflect destinations and type-specific parameters and reset', async ({ page }) => {
  const curves = page.locator('.visualization-card .graph-curve');
  const initial = await curves.evaluateAll((elements) => elements.map((element) => element.getAttribute('d')));
  const lfo = page.locator('#preview-lfo .graph-curve');
  const off = await lfo.getAttribute('d');
  await page.locator('#lfo-depth').press('Home');
  await expect(lfo).toHaveAttribute('d', off);
  await page.locator('#lfo-assign .position-label[data-step="4"]').click();
  await expect(lfo).not.toHaveAttribute('d', off);
  await page.locator('#osc-type').press('Home');
  await expect(page.locator('#preview-lfo .graph-context')).toContainText('FM amount');
  const slow = await lfo.getAttribute('d');
  await page.locator('#lfo-speed').press('Home');
  await expect(lfo).not.toHaveAttribute('d', slow);

  const effect = page.locator('#preview-effect .graph-curve');
  const shapes = new Set();
  await page.locator('#effect-depth').press('Home');
  for (const step of [1, 2, 3, 4]) {
    await page.locator(`#effect-type .position-label[data-step="${step}"]`).click();
    const shape = await effect.getAttribute('d');
    expect(shape).not.toMatch(/NaN|Infinity|undefined/);
    shapes.add(shape);
    const values = page.locator('#preview-effect .graph-values');
    await expect(values).toContainText(step === 1 ? 'Delay time' : step === 4 ? 'Tone' : 'Rate');
    await expect(page.locator('#preview-effect .graph-context')).not.toContainText('illustrative diagram');
    await page.locator('#effect-rate').press('Home');
    await expect(effect).not.toHaveAttribute('d', shape);
    await page.locator('#effect-rate').press('End');
  }
  expect(shapes.size).toBe(4);
  await page.locator('#effect-depth').press('End');
  await expect(effect).toHaveAttribute('d',
    await page.locator('#preview-effect .graph-reference').getAttribute('d'));
  await page.locator('#reset-faders').click();
  expect(await curves.evaluateAll((elements) => elements.map((element) => element.getAttribute('d')))).toEqual(initial);
});

test('dark page keeps the light synth and Focus Mode recolors graphs without changing luminance', async ({ page }) => {
  const cards = page.locator('.visualization-card');
  const styles = () => cards.evaluateAll((elements) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgb = (color) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (channels) => channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    return elements.map((element) => {
      const line = getComputedStyle(element.querySelector('.graph-curve')).stroke;
      const fill = getComputedStyle(element.querySelector('.graph-fill')).fill;
      const lineRGB = rgb(line);
      const fillRGB = rgb(fill);
      return {
        background: getComputedStyle(element).backgroundImage,
        line, fill, lineRGB, fillRGB,
        lineY: luminance(lineRGB),
        fillY: luminance(fillRGB),
        opacity: getComputedStyle(element.querySelector('.graph-fill')).fillOpacity,
        sectionRGB: rgb(getComputedStyle(document.querySelector(`#focus-${element.dataset.section}`)).fill),
      };
    });
  });
  const numbers = () => page.locator('.graph-number').evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).color));
  const theme = await page.evaluate(() => ({
    background: getComputedStyle(document.documentElement).backgroundColor,
    text: getComputedStyle(document.documentElement).color,
    button: getComputedStyle(document.querySelector('#focus-mode')).backgroundColor,
    caseFill: getComputedStyle(document.querySelector('#body')).fill,
    labels: getComputedStyle(document.querySelector('.section-label')).fill,
  }));
  expect(theme.background.match(/\d+/g).every((channel) => Number(channel) < 64)).toBe(true);
  expect(theme.button.match(/\d+/g).every((channel) => Number(channel) < 64)).toBe(true);
  expect(theme.text.match(/\d+/g).every((channel) => Number(channel) > 180)).toBe(true);
  expect(theme.caseFill).toContain('#case-fill');
  expect(theme.labels).toBe('rgb(65, 71, 74)');
  const normal = await styles();
  expect((await numbers()).length).toBeGreaterThan(10);
  expect((await numbers()).every((color) => color === 'rgb(255, 255, 255)')).toBe(true);
  expect(await page.locator('.graph-values').first().evaluate((element) =>
    getComputedStyle(element).color)).not.toBe('rgb(255, 255, 255)');

  await page.locator('#focus-mode').click();
  const tinted = await styles();
  const channelOrder = (channels) => channels.map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value).map(({ index }) => index);
  expect(new Set(tinted.map(({ line }) => line)).size).toBe(4);
  expect(tinted[2].line).toBe(tinted[3].line);
  for (const [index, style] of tinted.entries()) {
    expect(style.background).toBe(normal[index].background);
    expect(style.line).not.toBe(normal[index].line);
    expect(style.fill).not.toBe(normal[index].fill);
    expect(style.lineY).toBeCloseTo(normal[index].lineY, 2);
    expect(style.fillY).toBeCloseTo(normal[index].fillY, 2);
    expect(style.opacity).toBe(normal[index].opacity);
    expect(channelOrder(style.lineRGB)).toEqual(channelOrder(style.sectionRGB));
    expect(channelOrder(style.fillRGB)).toEqual(channelOrder(style.sectionRGB));
  }

  await page.locator('#lfo-depth').press('Home');
  await expect(page.locator('#preview-lfo .graph-number').first()).toHaveText('127');
  for (const id of ['hide-speakers', 'five-octaves', 'fader-size', 'reset-faders']) {
    await page.locator(`#${id}`).click();
    expect(await styles()).toEqual(tinted);
  }
  expect((await numbers()).every((color) => color === 'rgb(255, 255, 255)')).toBe(true);
  await page.locator('#focus-mode').click();
  expect(await styles()).toEqual(normal);
  expect((await numbers()).every((color) => color === 'rgb(255, 255, 255)')).toBe(true);
});

test('Hide Displays removes reserved space and preserves controls, view modes and live updates', async ({ page }) => {
  const displays = page.locator('#visualizations');
  const toggle = page.locator('#hide-displays');
  const values = () => page.locator('.fader').evaluateAll((elements) =>
    elements.map((element) => element.dataset.value));
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(displays).toBeVisible();
  await page.locator('#lfo-depth').press('Home');
  const before = await values();
  const geometry = await displays.evaluate((element) => ({
    space: element.getBoundingClientRect().height + parseFloat(getComputedStyle(element).marginBottom),
    synthTop: document.querySelector('#synth').getBoundingClientRect().top,
  }));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(displays).toBeHidden();
  const hiddenTop = await page.locator('#synth').evaluate((element) => element.getBoundingClientRect().top);
  expect(geometry.synthTop - hiddenTop).toBeCloseTo(geometry.space, 1);
  expect(await values()).toEqual(before);
  for (const id of ['focus-mode', 'hide-speakers', 'five-octaves', 'fader-size']) {
    await page.locator(`#${id}`).click();
  }
  expect(await values()).toEqual(before);
  await page.locator('#lfo-depth').press('End');
  await expect(page.locator('#preview-lfo .graph-number').first()).toHaveText('0');
  await toggle.press('Enter');
  await expect(displays).toBeVisible();
  await expect(displays).toHaveClass(/focus-mode/);
  await toggle.press(' ');
  await page.locator('#reset-faders').click();
  await expect(displays).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.press('Enter');
  await expect(displays).toBeVisible();
  for (const id of ['focus-mode', 'hide-speakers', 'five-octaves', 'fader-size']) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-pressed', 'true');
  }
});

test('display resets restore only their section, with shared EG resets and safe drag cleanup', async ({ page }) => {
  const state = () => page.locator('.fader').evaluateAll((elements) =>
    Object.fromEntries(elements.map((element) => [element.id, Number(element.dataset.value)])));
  const defaults = await state();
  const defaultCurves = await page.locator('.visualization-card').evaluateAll((cards) =>
    Object.fromEntries(cards.map((card) => [card.id, card.querySelector('.graph-curve').getAttribute('d')])));
  for (const [id, value] of Object.entries(defaults)) {
    await page.locator(`#${id}`).press(value === 0 ? 'Home' : 'End');
  }
  await page.locator('#volume').press('Home');
  await page.locator('#volume-mute').click();
  await page.locator('#pitch-range-up').click();
  const modes = ['focus-mode', 'hide-speakers', 'five-octaves', 'fader-size'];
  for (const id of modes) await page.locator(`#${id}`).click();

  for (const [display, section, key] of [
    ['lfo', 'lfo', 'Enter'], ['filter', 'filter', null],
    ['amp-eg', 'eg', ' '], ['filter-eg', 'eg', 'Enter'], ['effect', 'effect', null],
  ]) {
    for (const [id, value] of Object.entries(defaults)) {
      if (id.startsWith(`${section}-`)) await page.locator(`#${id}`).press(value === 0 ? 'Home' : 'End');
    }
    const before = await state();
    if (display === 'lfo') {
      const box = await page.locator('#lfo-depth .cap').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect(page.locator('#lfo-depth')).toHaveClass(/is-dragging/);
    }
    const reset = page.locator(`#preview-${display} .section-reset`);
    if (key) await reset.press(key);
    else await reset.click();
    const after = await state();
    for (const [id, value] of Object.entries(before)) {
      expect(after[id], `${display} reset: ${id}`).toBe(id.startsWith(`${section}-`) ? defaults[id] : value);
    }
    await expect(page.locator(`#preview-${display} .graph-curve`)).toHaveAttribute('d', defaultCurves[`preview-${display}`]);
    if (section === 'eg') {
      await expect(page.locator('#preview-amp-eg .graph-curve')).toHaveAttribute('d', defaultCurves['preview-amp-eg']);
      await expect(page.locator('#preview-filter-eg .graph-curve')).toHaveAttribute('d', defaultCurves['preview-filter-eg']);
    }
    if (display === 'lfo') {
      await expect(page.locator('#lfo-depth')).not.toHaveClass(/is-dragging/);
      const bottom = await faderPoint(page, 'lfo-depth', 160);
      await page.mouse.move(bottom.x, bottom.y);
      await page.mouse.up();
      await expect(page.locator('#lfo-depth')).toHaveAttribute('aria-valuenow', '0');
    }
  }
  await expect(page.locator('#pitch-range-value')).toHaveText('13');
  await expect(page.locator('#volume-mute')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#volume-mute').click();
  await expect(page.locator('#volume')).toHaveAttribute('aria-valuenow', '127');
  for (const id of modes) await expect(page.locator(`#${id}`)).toHaveAttribute('aria-pressed', 'true');
});

test('five read-only visualization cards reserve space above the synth in every layout', async ({ page }) => {
  await expect(page.locator('.visualization-card')).toHaveCount(5);
  await expect(page.locator('.visualization-card svg[role="img"]')).toHaveCount(5);
  await expect(page.locator('.visualization-card h2')).toHaveText([
    'LFO', 'FILTER', 'AMP ADSR', 'FILTER ADSR', 'EFFECT',
  ]);
  expect(await page.locator('#visualizations').innerText()).not.toContain('Schematic');
  await expect(page.locator('#preview-filter .graph-context')).not.toContainText('low-pass');
  await page.setViewportSize({ width: 1040, height: 900 });
  const rows = await page.locator('.visualization-card').evaluateAll((cards) =>
    cards.map((card) => card.getBoundingClientRect().top));
  expect(new Set(rows).size).toBe(1);
  const values = await page.locator('.fader').evaluateAll((elements) => elements.map((element) => element.dataset.value));
  await page.locator('#preview-filter svg').click();
  expect(await page.locator('.fader').evaluateAll((elements) => elements.map((element) => element.dataset.value))).toEqual(values);
  const geometry = () => page.evaluate(() => {
    const graphs = document.querySelector('#visualizations').getBoundingClientRect();
    return {
      toolbarBottom: document.querySelector('.toolbar').getBoundingClientRect().bottom,
      graphsTop: graphs.top,
      graphsBottom: graphs.bottom,
      synthTop: document.querySelector('#synth').getBoundingClientRect().top,
      visibleGap: document.querySelector('#body').getBoundingClientRect().top - graphs.bottom,
      originalGap: 1.75 * parseFloat(getComputedStyle(document.documentElement).fontSize)
        + 27 * document.querySelector('#synth svg').getScreenCTM().d,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      cardsFit: [...document.querySelectorAll('.visualization-card')].every((card) =>
        card.getBoundingClientRect().right <= window.innerWidth),
    };
  });
  for (const mobile of [false, true]) {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    for (const id of ['focus-mode', 'hide-speakers', 'five-octaves', 'fader-size']) {
      await page.locator(`#${id}`).click();
      const bounds = await geometry();
      expect(bounds.graphsTop).toBeGreaterThan(bounds.toolbarBottom);
      expect(bounds.synthTop).toBeGreaterThan(bounds.graphsBottom);
      expect(bounds.visibleGap).toBeCloseTo(bounds.originalGap * 0.25, 1);
      expect(bounds.overflow).toBe(false);
      expect(bounds.cardsFit).toBe(true);
    }
  }
});

test('keys remain independent and release outside the panel or after cancellation', async ({ page }) => {
  await expect(page.locator('.key[role="button"]:visible')).toHaveCount(37);
  const key = page.locator('#key-c-1');
  const nextKey = page.locator('#key-d-1');
  const box = await key.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await page.mouse.down();
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await expect(nextKey).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await expect(key).toHaveAttribute('aria-pressed', 'false');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await page.mouse.down();
  await key.dispatchEvent('pointercancel', { pointerId: 1 });
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.up();

  await key.focus();
  await page.keyboard.down('Enter');
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fader-size').focus();
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.up('Enter');
});

test('QWERTY plays the chromatic middle octave and independent chords in both keyboard views', async ({ page }) => {
  const mapping = [
    ['a', 'c-2'], ['w', 'cs-2'], ['s', 'd-2'], ['e', 'ds-2'], ['d', 'e-2'],
    ['f', 'f-2'], ['t', 'fs-2'], ['g', 'g-2'], ['y', 'gs-2'], ['h', 'a-2'],
    ['u', 'as-2'], ['j', 'b-2'], ['k', 'c-3'],
  ];
  for (const expanded of [false, true]) {
    if (expanded) await page.locator('#five-octaves').click();
    for (const [letter, id] of mapping) {
      await page.keyboard.down(letter);
      await expect(page.locator(`#key-${id}`)).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.locator('.key.is-pressed')).toHaveCount(13);
    for (const [index, [letter, id]] of mapping.entries()) {
      await page.keyboard.up(letter);
      await expect(page.locator(`#key-${id}`)).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.key.is-pressed')).toHaveCount(12 - index);
    }
  }
  await page.keyboard.down('Shift');
  await page.keyboard.down('a');
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('Shift');
  await page.keyboard.up('a');
  await expect(page.locator('.key.is-pressed')).toHaveCount(0);
});

test('QWERTY, pointer and focused-key presses retain independent ownership through the overlays', async ({ page }) => {
  await page.locator('#focus-mode').click();
  for (const [letter, id] of [['a', 'c-2'], ['w', 'cs-2']]) {
    const key = page.locator(`#key-${id}`);
    const overlay = await key.locator('.key-letter').boundingBox();
    await page.mouse.move(overlay.x + overlay.width / 2, overlay.y + overlay.height / 2);
    await page.mouse.down();
    await page.keyboard.down(letter);
    await page.keyboard.down(' ');
    await page.keyboard.up(letter);
    await expect(key).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.up();
    await expect(key).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.up(' ');
    await expect(key).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.down(letter);
    await page.keyboard.press('Enter');
    await expect(key).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.up(letter);
    await expect(key).toHaveAttribute('aria-pressed', 'false');
  }
  for (const id of ['octave', 'transpose']) {
    const fader = page.locator(`#${id}`);
    const bottom = await faderPoint(page, id, 80);
    const top = await faderPoint(page, id, 0);
    await page.keyboard.down('a');
    await page.mouse.move(bottom.x, bottom.y);
    await page.mouse.down();
    await expect(page.locator('.key.is-pressed')).toHaveCount(0);
    await expect(fader).toHaveClass(/is-dragging/);
    await page.mouse.move(top.x, top.y, { steps: 5 });
    await expect(fader).toHaveAttribute('aria-valuenow', id === 'octave' ? '4' : '6');
    await expect(fader).toHaveClass(/is-dragging/);
    await page.mouse.up();
    await page.keyboard.up('a');
    await expect(fader).not.toHaveClass(/is-dragging/);
  }
});

test('Focus key labels follow both pitch controls while letters stay anchored and pitch changes release notes', async ({ page }) => {
  await expect(page.locator('.key-note:visible')).toHaveCount(0);
  await expect(page.locator('.key-letter:visible')).toHaveCount(0);
  await page.locator('#focus-mode').click();
  const letterSize = await page.locator('#key-c-2 .key-letter').boundingBox();
  for (const expanded of [false, true]) {
    if (expanded) await page.locator('#five-octaves').click();
    await expect(page.locator('.key-note:visible')).toHaveCount(expanded ? 61 : 37);
    await expect(page.locator('.key-letter:visible')).toHaveCount(13);
    await expect(page.locator('#key-c-2 .key-letter')).toHaveText('a');
    await expect(page.locator('#key-c-3 .key-letter')).toHaveText('k');
    const mappedLetter = await page.locator('#key-c-2 .key-letter').boundingBox();
    expect(mappedLetter.width).toBeCloseTo(letterSize.width, 1);
    expect(mappedLetter.height).toBeCloseTo(letterSize.height, 1);
    await expect(page.locator('#key-c-2 .key-note')).toHaveText('C4');
    await expect(page.locator('#key-cs-2 .key-note')).toHaveText('C#4');
    await expect(page.locator(`#key-c-${expanded ? 0 : 1} .key-note`)).toHaveText(expanded ? 'C2' : 'C3');
    await expect(page.locator(`#key-c-${expanded ? 5 : 4} .key-note`)).toHaveText(expanded ? 'C7' : 'C6');

    const misplaced = await page.locator('.key:visible').evaluateAll((keys) => keys.flatMap((key) => {
      const label = key.querySelector('.key-note');
      const bounds = label.getBoundingClientRect();
      const surface = key.querySelector('use').getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return bounds.top >= surface.top && bounds.bottom < surface.top + 20
        && hit?.closest('.key') === key ? [] : [key.id];
    }));
    expect(misplaced).toEqual([]);
    await page.keyboard.down('a');
    await page.keyboard.down('g');
    await page.locator('#octave').press('ArrowUp');
    await expect(page.locator('.key.is-pressed')).toHaveCount(0);
    await expect(page.locator('#key-c-2 .key-note')).toHaveText('C5');
    await page.keyboard.down('a');
    await expect(page.locator('.key.is-pressed')).toHaveCount(0);
    await page.keyboard.up('a');
    await page.keyboard.up('g');

    await page.keyboard.down('a');
    await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#transpose').press('ArrowUp');
    await expect(page.locator('.key.is-pressed')).toHaveCount(0);
    await page.keyboard.up('a');
    await expect(page.locator('#key-c-2 .key-note')).toHaveText('C#5');
    await expect(page.locator('#key-c-2 .key-letter')).toHaveText('a');
    await expect(page.locator('#key-c-2')).toHaveAttribute('aria-label', 'C sharp, octave 5');
    await expect(page.locator('#key-c-2 title')).toHaveText('C sharp, octave 5');
    await page.keyboard.down('a');
    await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.up('a');

    await page.locator('#octave').press('End');
    await page.locator('#transpose').press('End');
    await expect(page.locator(`#key-c-${expanded ? 0 : 1} .key-note`)).toHaveText(expanded ? 'F#-1' : 'F#0');
    await page.keyboard.down('a');
    await page.locator('#octave').press('End');
    await page.locator('#transpose').press('End');
    await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.up('a');
    await page.locator('#octave').press('Home');
    await page.locator('#transpose').press('Home');
    await expect(page.locator(`#key-c-${expanded ? 5 : 4} .key-note`)).toHaveText(expanded ? 'F#9' : 'F#8');
    await page.locator('#reset-faders').click();
    await expect(page.locator('#key-c-2 .key-note')).toHaveText('C4');
  }
  await page.locator('#focus-mode').click();
  await expect(page.locator('.key-note:visible')).toHaveCount(0);
  await expect(page.locator('.key-letter:visible')).toHaveCount(0);
});

test('QWERTY ignores typing and shortcuts and clears held notes on layout changes and loss of visibility', async ({ page }) => {
  await page.evaluate(() => {
    const fields = document.createElement('div');
    fields.id = 'typing-fields';
    fields.innerHTML = '<input><textarea></textarea><select><option>A</option></select>'
      + '<div contenteditable="true">editable</div><div role="textbox" tabindex="0"></div>';
    document.body.append(fields);
  });
  for (const selector of ['input', 'textarea', 'select', '[contenteditable]', '[role="textbox"]']) {
    await page.locator(`#typing-fields ${selector}`).focus();
    await page.keyboard.press('a');
    await expect(page.locator('.key.is-pressed')).toHaveCount(0);
  }
  await expect(page.locator('#typing-fields input')).toHaveValue('a');
  await page.locator('#volume').focus();
  const consumed = await page.evaluate(() => ['ctrlKey', 'altKey', 'metaKey', 'isComposing', 'repeat'].map((flag) => {
    const event = new KeyboardEvent('keydown', {
      code: 'KeyA', key: 'a', bubbles: true, cancelable: true, [flag]: true,
    });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  }));
  expect(consumed).toEqual([false, false, false, false, false]);
  await expect(page.locator('.key.is-pressed')).toHaveCount(0);

  await page.keyboard.down('a');
  await page.locator('#focus-mode').click();
  await page.locator('#hide-displays').click();
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('a');
  for (const id of ['five-octaves', 'hide-speakers', 'fader-size', 'reset-faders']) {
    await page.keyboard.down('a');
    await page.keyboard.down('w');
    await expect(page.locator('.key.is-pressed')).toHaveCount(2);
    await page.locator(`#${id}`).click();
    await expect(page.locator('.key.is-pressed')).toHaveCount(0);
    await page.keyboard.up('a');
    await page.keyboard.up('w');
  }
  await page.keyboard.down('a');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.key.is-pressed')).toHaveCount(0);
  await page.keyboard.up('a');
  await page.keyboard.down('a');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  await expect(page.locator('.key.is-pressed')).toHaveCount(0);
  await page.keyboard.up('a');
});

test('faders drag to their limits without jumping when the handle is grabbed', async ({ page }) => {
  const fader = page.locator('#filter-cutoff');
  const cap = fader.locator('.cap');
  const box = await cap.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 2);
  await expect(fader).toHaveAttribute('aria-valuenow', '127');

  const bottom = await faderPoint(page, 'filter-cutoff', 80);
  const top = await faderPoint(page, 'filter-cutoff', 0);
  await page.mouse.move(bottom.x, bottom.y);
  await page.mouse.down();
  await expect(fader).toHaveAttribute('aria-valuenow', '0');
  await page.mouse.move(top.x, top.y, { steps: 10 });
  await expect(fader).toHaveAttribute('aria-valuenow', '127');
  await page.mouse.up();
  await expect(fader).not.toHaveClass(/is-dragging/);
});

test('2x doubles travel without scaling keys or handles or changing values', async ({ page }) => {
  const geometry = () => page.evaluate(() => {
    const fader = document.querySelector('#filter-cutoff');
    const box = (selector) => {
      const { width, height } = document.querySelector(selector).getBoundingClientRect();
      return { width, height };
    };
    return {
      key: box('#key-c-1'),
      logo: box('#cs-logo'),
      logoGap: document.querySelector('#keyboard').getBoundingClientRect().top
        - document.querySelector('#cs-logo').getBoundingClientRect().bottom,
      handle: box('#filter-cutoff .cap'),
      track: box('#filter-cutoff .track'),
      panelHeight: document.querySelector('#synth svg').viewBox.baseVal.height,
      keyboardY: document.querySelector('#keyboard').getBoundingClientRect().y,
      value: fader.getAttribute('aria-valuenow'),
    };
  });
  const normal = await geometry();
  await page.locator('#fader-size').click();
  await expect(page.locator('#fader-size')).toHaveAttribute('aria-pressed', 'true');
  const doubled = await geometry();
  expect(doubled.key.width).toBeCloseTo(normal.key.width, 1);
  expect(doubled.key.height).toBeCloseTo(normal.key.height, 1);
  expect(doubled.logo.width).toBeCloseTo(normal.logo.width, 1);
  expect(doubled.logo.height).toBeCloseTo(normal.logo.height, 1);
  expect(normal.logoGap).toBeGreaterThan(0);
  expect(doubled.logoGap).toBeCloseTo(normal.logoGap, 1);
  expect(doubled.handle.height).toBeCloseTo(normal.handle.height, 1);
  expect(doubled.track.height).toBeCloseTo(normal.track.height * 2, 1);
  expect(doubled.panelHeight).toBe(normal.panelHeight + 80);
  expect(doubled.keyboardY).toBeGreaterThan(normal.keyboardY);
  expect(doubled.value).toBe(normal.value);

  const bottom = await faderPoint(page, 'filter-cutoff', 160);
  await page.mouse.click(bottom.x, bottom.y);
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
  await page.locator('#fader-size').click();
  const restored = await geometry();
  expect(restored.track.height).toBeCloseTo(normal.track.height, 1);
  expect(restored.key).toEqual(normal.key);
  expect(restored.value).toBe('0');
});

test('wheel adjusts only the hovered fader with Alt steps and blocks page scrolling locally', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  const fader = page.locator('#filter-cutoff');
  await fader.press('End');
  await page.locator('#focus-mode').focus();
  await fader.locator('.cap').hover();
  const scrollY = await page.evaluate(() => window.scrollY);
  const graph = page.locator('#preview-filter .graph-curve');
  const initialCurve = await graph.getAttribute('d');
  await page.mouse.wheel(0, -120);
  await expect(fader).toHaveAttribute('aria-valuenow', '1');
  await expect(graph).not.toHaveAttribute('d', initialCurve);
  await expect(page.locator('#fader-value-filter-cutoff')).toHaveText('1');
  await expect(page.locator('#filter-resonance')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#focus-mode')).toBeFocused();
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, -120);
  await expect(fader).toHaveAttribute('aria-valuenow', '11');
  await page.keyboard.up('Alt');
  await page.mouse.wheel(0, 120);
  await expect(fader).toHaveAttribute('aria-valuenow', '10');
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -120);
  await expect(fader).toHaveAttribute('aria-valuenow', '11');
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  await fader.press('Shift+ArrowUp');
  await expect(fader).toHaveAttribute('aria-valuenow', '21');

  for (const [key, deltaY, value] of [['Home', -120, '127'], ['End', 120, '0']]) {
    await fader.press(key);
    const allowed = await fader.evaluate((element, delta) =>
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true })), deltaY);
    expect(allowed).toBe(false);
    await expect(fader).toHaveAttribute('aria-valuenow', value);
  }
  await page.locator('h1').hover();
  const outsideScrollY = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(outsideScrollY);
});

test('Alt wheel keeps selectors and Transpose at single steps in compact double-travel mode', async ({ page }) => {
  for (const id of ['hide-displays', 'hide-speakers', 'focus-mode', 'five-octaves', 'fader-size']) {
    await page.locator(`#${id}`).click();
  }
  for (const id of ['octave', 'looper', 'lfo-assign', 'osc-type', 'effect-type', 'transpose']) {
    const fader = page.locator(`#${id}`);
    await fader.press('End');
    const min = Number(await fader.getAttribute('aria-valuemin'));
    const target = id === 'osc-type' ? fader.locator('.position-label').first() : fader.locator('.cap');
    await target.hover();
    await page.keyboard.down('Alt');
    await page.mouse.wheel(0, -120);
    await expect(fader).toHaveAttribute('aria-valuenow', String(min + 1));
    if (id === 'osc-type') {
      await expect(fader.locator('.selection-led[data-value="1"]')).toHaveClass(/is-on/);
    }
    if (id === 'octave') {
      await expect(page.locator('.octave-step[data-step="-1"]')).toHaveAttribute('aria-disabled', 'false');
    }
    if (id === 'transpose') await expect(page.locator('#transpose-value')).toHaveText('-5');
    await page.mouse.wheel(0, 120);
    await expect(fader).toHaveAttribute('aria-valuenow', String(min));
    await page.keyboard.up('Alt');
  }
});

test('wheel respects mute restoration, pitch bend behavior and ignored zoom or horizontal events', async ({ page }) => {
  const wheel = (id, options) => page.locator(`#${id}`).evaluate((element, init) =>
    element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })), options);
  const mute = page.locator('#volume-mute');
  await mute.click();
  for (const options of [{ deltaY: -120, ctrlKey: true }, { deltaX: 120, deltaY: 0 },
    { deltaX: 120, deltaY: 1 }, { deltaY: 0 }]) {
    expect(await wheel('volume', options)).toBe(true);
    await expect(mute).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('#volume')).toHaveAttribute('aria-valuenow', '0');
  }
  expect(await wheel('volume', { deltaY: 120 })).toBe(false);
  await expect(mute).toHaveAttribute('aria-disabled', 'true');
  expect(await wheel('volume', { deltaY: -1, deltaMode: 1 })).toBe(false);
  await expect(page.locator('#volume')).toHaveAttribute('aria-valuenow', '1');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  expect(await wheel('pitch-bend', { deltaY: -1, deltaMode: 2 })).toBe(false);
  await page.locator('h1').hover();
  await expect(page.locator('#pitch-bend')).toHaveAttribute('aria-valuenow', '65');
});

test('Home moves every fader to the top and End to the bottom at both travel sizes', async ({ page }) => {
  for (const travel of [80, 160]) {
    if (travel === 160) {
      await page.locator('#fader-size').click();
      await page.locator('#hide-speakers').click();
      await page.locator('#focus-mode').click();
    }
    for (const fader of await page.getByRole('slider').all()) {
      await fader.press('Home');
      await expect(fader).toHaveAttribute('aria-valuenow', await fader.getAttribute('aria-valuemax'));
      await expect(fader.locator('.cap')).toHaveAttribute('y', '0');
      await fader.press('End');
      await expect(fader).toHaveAttribute('aria-valuenow', await fader.getAttribute('aria-valuemin'));
      await expect(fader.locator('.cap')).toHaveAttribute('y', String(travel));
    }
  }
});

test('keyboard fader changes are bounded and update the local looper LEDs', async ({ page }) => {
  const looper = page.locator('#looper');
  await looper.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(looper).toHaveAttribute('aria-valuetext', 'Play');
  await expect(looper.locator('.selection-led[data-value="2"]')).toHaveClass(/is-on/);
  await page.keyboard.press('ArrowUp');
  await expect(looper).toHaveAttribute('aria-valuetext', 'Record');
  await expect(looper.locator('.selection-led[data-value="2"]')).not.toHaveClass(/is-on/);
  await expect(looper.locator('.selection-led[data-value="3"]')).toHaveClass(/is-on/);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await expect(looper).toHaveAttribute('aria-valuenow', '4');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await expect(looper).toHaveAttribute('aria-valuenow', '0');
  await expect(looper.locator('.selection-led.is-on')).toHaveCount(0);
});

test('selector tracks have one line per label in normal and 2x travel', async ({ page }) => {
  for (const travel of [80, 160]) {
    if (travel === 160) await page.locator('#fader-size').click();
    const scales = await page.locator('.fader[data-max="4"]').evaluateAll((faders) =>
      faders.map((fader) => {
        const track = fader.querySelector('.track');
        const shape = document.querySelector(track.getAttribute('href'));
        const lines = [...shape.querySelector('path').getAttribute('d').matchAll(/M-17 (\d+)H17/g)];
        return {
          id: fader.id,
          lines: lines.map((line) =>
            new DOMPoint(0, Number(line[1])).matrixTransform(track.getScreenCTM()).y),
          labels: [...fader.querySelectorAll('.scale-label')].map((label) =>
            new DOMPoint(0, Number(label.getAttribute('y')) - 3)
              .matrixTransform(label.getScreenCTM()).y),
        };
      }));
    expect(scales.map((scale) => scale.id)).toEqual([
      'octave', 'looper', 'lfo-assign', 'osc-type', 'effect-type',
    ]);
    for (const scale of scales) {
      expect(scale.lines, scale.id).toHaveLength(5);
      expect(scale.labels, scale.id).toHaveLength(5);
      for (const [index, y] of scale.lines.entries()) {
        expect(y, scale.id).toBeCloseTo(scale.labels[index], 3);
      }
    }
    await expect(page.locator('#lfo-depth .track')).toHaveAttribute('href', '#fader-track');
    await expect(page.locator('#osc-texture .track')).toHaveAttribute('href', '#fader-track');
    await expect(page.locator('#effect-depth .track')).toHaveAttribute('href', '#fader-track');
  }
});

test('oscillator positions select FM through Saw and light only their colored LED at both travel sizes', async ({ page }) => {
  const fader = page.locator('#osc-type');
  const modes = ['FM', 'Ring modulation', 'Sync', 'Pulse', 'Multi-saw'];
  const colors = ['rgb(72, 169, 255)', 'rgb(0, 255, 0)', 'rgb(255, 255, 0)', 'rgb(255, 165, 0)', 'rgb(255, 0, 0)'];
  for (const travel of [80, 160]) {
    if (travel === 160) await page.locator('#fader-size').click();
    for (const [index, mode] of modes.entries()) {
      const point = await faderPoint(page, 'osc-type', index * travel / 4);
      await page.mouse.click(point.x, point.y);
      await expect(fader).toHaveAttribute('aria-valuetext', mode);
      await expect(page.locator('#app-status')).toHaveText(`Oscillator type: ${mode} (local preview)`);
      const activeLED = fader.locator('.selection-led.is-on');
      await expect(activeLED).toHaveCount(1);
      await expect(activeLED).toHaveCSS('fill', colors[index]);
      await expect(activeLED).toHaveAttribute('cy', String(index * travel / 4));
      const geometry = await activeLED.evaluate((led) => {
        const fader = led.closest('.fader');
        const label = fader.querySelector(`.scale-label[data-step="${led.dataset.value}"]`);
        const light = led.getBoundingClientRect();
        return {
          diameter: led.getBBox().width,
          labelGap: light.left - label.getBoundingClientRect().right,
          textureGap: document.querySelector('#osc-texture .cap').getBoundingClientRect().left - light.right,
          scale: fader.getScreenCTM().a,
        };
      });
      expect(geometry.diameter).toBe(6);
      expect(geometry.labelGap).toBeGreaterThan(0);
      expect(geometry.textureGap).toBeGreaterThanOrEqual(8 * geometry.scale);
      for (const inactiveLED of await fader.locator('.selection-led:not(.is-on)').all()) {
        await expect(inactiveLED).toHaveCSS('fill', 'rgb(0, 0, 0)');
      }
    }
  }
});

test('pitch bend recenters and losing window focus releases held notes', async ({ page }) => {
  const top = await faderPoint(page, 'pitch-bend', 0);
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await expect(page.locator('#pitch-bend')).toHaveAttribute('aria-valuenow', '127');
  await page.mouse.up();
  await expect(page.locator('#pitch-bend')).toHaveAttribute('aria-valuenow', '64');

  const key = page.locator('#key-cs-1');
  await key.focus();
  await page.keyboard.down(' ');
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.up(' ');
});

test('page load and Reset apply the requested fader positions without changing travel size', async ({ page }) => {
  const positions = {
    'pitch-bend': 0.5,
    transpose: 0.5,
    volume: 0.5,
    octave: 0.5,
    looper: 0,
    tempo: 0,
    'lfo-assign': 0,
    'lfo-depth': 0,
    'lfo-speed': 0,
    portamento: 0,
    'osc-type': 0,
    'osc-texture': 0,
    'osc-mod': 0,
    'filter-cutoff': 1,
    'filter-resonance': 0,
    'eg-balance': 0,
    'eg-attack': 0,
    'eg-decay': 1,
    'eg-sustain': 1,
    'eg-release': 0,
    'effect-type': 0,
    'effect-depth': 0,
    'effect-rate': 0,
  };
  async function expectStartingPositions(travel) {
    const actual = await page.locator('.fader').evaluateAll((faders) => faders.map((fader) => ({
      id: fader.id,
      value: Number(fader.getAttribute('aria-valuenow')),
      min: Number(fader.dataset.min ?? 0),
      max: Number(fader.dataset.max),
      y: Number(fader.querySelector('.cap').getAttribute('y')),
    })));
    expect(actual.map((fader) => fader.id).sort()).toEqual(Object.keys(positions).sort());
    for (const fader of actual) {
      const range = fader.max - fader.min;
      expect(fader.value, fader.id).toBe(Math.round(fader.min + positions[fader.id] * range));
      expect(Math.abs(fader.y - travel * (1 - positions[fader.id])), fader.id)
        .toBeLessThanOrEqual(travel / (2 * range) + 0.01);
    }
    await expect(page.locator('#osc-saw-led')).toHaveCSS('fill', 'rgb(255, 0, 0)');
    await expect(page.locator('#osc-type .selection-led.is-on')).toHaveCount(1);
    await expect(page.locator('#looper .selection-led.is-on')).toHaveCount(0);
  }

  await expectStartingPositions(80);
  for (const travel of [80, 160]) {
    if (travel === 160) await page.locator('#fader-size').click();
    for (const fader of await page.getByRole('slider').all()) {
      await fader.focus();
      await page.keyboard.press('Home');
    }
    await page.locator('#looper').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#looper .selection-led.is-on')).toHaveCount(1);
    await page.locator('#filter-cutoff').focus();
    await page.keyboard.press('End');

    await page.locator('#key-c-1').focus();
    await page.keyboard.down(' ');
    await page.locator('#reset-faders').evaluate((button) => button.click());
    await expect(page.locator('#key-c-1')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.up(' ');
    await expectStartingPositions(travel);
    await expect(page.locator('#fader-size')).toHaveAttribute('aria-pressed', String(travel === 160));
    await expect(page.locator('#app-status')).toContainText('Faders reset');
  }
});

test('Focus Mode changes only presentation and keeps live readouts aligned at both travel sizes', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Focus Mode', exact: true });
  const values = () => page.locator('.fader').evaluateAll((faders) =>
    faders.map((fader) => fader.dataset.value));
  const starting = await values();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#fader-values')).toBeHidden();
  await expect(page.locator('.focus-section:visible')).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await values()).toEqual(starting);
  await expect(page.locator('.focus-section:visible')).toHaveCount(6);
  await expect(page.locator('#looper-panel-wash')).toHaveCSS('opacity', '0.8');
  for (const element of await page.locator('.focus-looper').all()) {
    await expect(element).toHaveCSS('opacity', '0.2');
  }
  for (const id of ['pitch-bend', 'volume', 'octave']) {
    await expect(page.locator(`#${id}`)).toHaveCSS('opacity', '1');
    expect(await page.locator(`#${id}`).evaluate((fader) =>
      getComputedStyle(fader).getPropertyValue('--cap-fill'))).toBe('');
  }
  for (const [id, gradient] of [
    ['filter-cutoff', 'cutoff-cap-fill'],
    ['filter-resonance', 'resonance-cap-fill'],
  ]) {
    expect(await page.locator(`#${id}`).evaluate((fader) =>
      getComputedStyle(fader).getPropertyValue('--cap-fill'))).toBe(`url(#${gradient})`);
  }

  for (const travel of [80, 160]) {
    if (travel === 160) await page.locator('#fader-size').click();
    const readouts = await page.locator('.fader').evaluateAll((faders) => faders.map((fader) => {
      const readout = document.querySelector(`#fader-value-${fader.id}`);
      const bounds = readout.getBoundingClientRect();
      const origin = new DOMPoint(0, 0).matrixTransform(fader.getScreenCTM());
      const label = [...document.querySelectorAll('.control-label text')]
        .find((text) => text.getAttribute('x') === readout.getAttribute('x'));
      return {
        value: fader.dataset.value,
        text: readout.textContent,
        centerX: bounds.x + bounds.width / 2,
        faderX: origin.x,
        top: bounds.top,
        labelBottom: label?.getBoundingClientRect().bottom ?? 0,
        color: getComputedStyle(readout).fill,
      };
    }));
    expect(readouts).toHaveLength(23);
    for (const readout of readouts) {
      expect(readout.text).toBe(readout.value);
      expect(Math.abs(readout.centerX - readout.faderX)).toBeLessThan(0.5);
      expect(readout.top).toBeGreaterThan(readout.labelBottom);
      expect(readout.color).toBe('rgb(128, 128, 128)');
    }

    const looperTop = await faderPoint(page, 'looper', 0);
    await page.mouse.click(looperTop.x, looperTop.y);
    await expect(page.locator('#fader-value-looper')).toHaveText('4');
    await page.locator('#filter-cutoff').focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#fader-value-filter-cutoff')).toHaveText('1');
    await page.locator('#reset-faders').click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#fader-value-filter-cutoff')).toHaveText('127');
    await expect(page.locator('#fader-value-looper')).toHaveText('0');
    await expect(page.locator('#fader-size')).toHaveAttribute('aria-pressed', String(travel === 160));
    await expect(page.locator('.focus-section').first()).toHaveAttribute('height', String(travel + 98));
    await expect(page.locator('#looper-panel-wash')).toHaveAttribute('height', String(travel + 26));
  }

  await page.locator('#osc-texture').focus();
  await page.keyboard.press('ArrowUp');
  const changed = await values();
  await toggle.click();
  expect(await values()).toEqual(changed);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#fader-values')).toBeHidden();
  await expect(page.locator('.focus-section:visible')).toHaveCount(0);
  await expect(page.locator('#looper-panel-wash')).toBeHidden();
  await expect(page.locator('#looper')).toHaveCSS('opacity', '1');
  expect(await page.locator('#filter-cutoff').evaluate((fader) =>
    getComputedStyle(fader).getPropertyValue('--cap-fill'))).toBe('');
  await toggle.click();
  await expect(page.locator('#fader-value-osc-texture')).toHaveText('1');
});

test('Hide Speakers narrows the case without scaling controls or losing state', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Hide Speakers', exact: true });
  const geometry = () => page.evaluate(() => {
    const box = (selector) => {
      const { width, height } = document.querySelector(selector).getBoundingClientRect();
      return { width, height };
    };
    const body = document.querySelector('#body').getBoundingClientRect();
    const keyboard = document.querySelector('#keyboard').getBoundingClientRect();
    return {
      panel: box('#synth'),
      body: box('#body'),
      leftMargin: keyboard.left - body.left,
      rightMargin: body.right - keyboard.right,
      ventsInsideCase: document.querySelector('#body-vents').getBoundingClientRect().left
        >= document.querySelector('#body').getBoundingClientRect().left,
      key: box('#key-c-1'),
      handle: box('#filter-cutoff .cap'),
      logo: box('#cs-logo'),
      values: [...document.querySelectorAll('.fader')].map((fader) => fader.dataset.value),
    };
  });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.speaker:visible')).toHaveCount(2);
  await page.locator('#osc-texture').focus();
  await page.keyboard.press('ArrowUp');
  await page.locator('#focus-mode').click();
  await page.locator('#fader-size').click();
  const full = await geometry();
  await toggle.click();
  const compact = await geometry();
  expect(compact.panel.width).toBeLessThan(full.panel.width);
  expect(compact.body.width).toBeLessThan(full.body.width);
  expect(compact.ventsInsideCase).toBe(true);
  expect(compact.leftMargin).toBeCloseTo(compact.rightMargin, 1);
  for (const element of ['key', 'handle', 'logo']) {
    expect(compact[element].width).toBeCloseTo(full[element].width, 1);
    expect(compact[element].height).toBeCloseTo(full[element].height, 1);
  }
  expect(compact.values).toEqual(full.values);
  await expect(page.locator('.speaker:visible')).toHaveCount(0);
  await expect(page.locator('#focus-mode')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#fader-size')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fader-size').click();
  const compactNormal = await geometry();
  expect(compactNormal.leftMargin).toBeCloseTo(compactNormal.rightMargin, 1);
  await page.locator('#fader-size').click();

  const top = await faderPoint(page, 'filter-resonance', 0);
  await page.mouse.click(top.x, top.y);
  await expect(page.locator('#filter-resonance')).toHaveAttribute('aria-valuenow', '127');
  await page.locator('#reset-faders').click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.speaker:visible')).toHaveCount(0);
  await expect(page.locator('#fader-value-osc-texture')).toHaveText('0');
  await toggle.click();
  const restored = await geometry();
  expect(restored.panel.width).toBeCloseTo(full.panel.width, 1);
  expect(restored.key.width).toBeCloseTo(full.key.width, 1);
  await expect(page.locator('.speaker:visible')).toHaveCount(2);

  await page.setViewportSize({ width: 390, height: 844 });
  const wideScroll = await page.locator('.instrument-scroll').evaluate((element) => element.scrollWidth);
  await toggle.click();
  const narrowScroll = await page.locator('.instrument-scroll').evaluate((element) => element.scrollWidth);
  expect(narrowScroll).toBeLessThan(wideScroll);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('end panels synchronize the bounded Octave selector in every view combination', async ({ page }) => {
  const octave = page.locator('#octave');
  const down = page.getByRole('button', { name: 'Octave down', exact: true });
  const up = page.getByRole('button', { name: 'Octave up', exact: true });
  for (const focus of [false, true]) {
    if (focus) await page.locator('#focus-mode').click();
    for (const doubled of [false, true]) {
      const sizeToggle = page.locator('#fader-size');
      if (await sizeToggle.getAttribute('aria-pressed') !== String(doubled)) await sizeToggle.click();
      for (const hidden of [false, true]) {
        const speakerToggle = page.locator('#hide-speakers');
        if (await speakerToggle.getAttribute('aria-pressed') !== String(hidden)) await speakerToggle.click();
        await page.locator('#reset-faders').click();
        await down.click();
        await expect(octave).toHaveAttribute('aria-valuetext', '-1');
        await expect(page.locator('#fader-value-octave')).toHaveText('1');
        await up.click();
        await expect(octave).toHaveAttribute('aria-valuetext', '0');
        await up.focus();
        await page.keyboard.press('Enter');
        await expect(octave).toHaveAttribute('aria-valuetext', '+1');
        await page.keyboard.press(' ');
        await expect(octave).toHaveAttribute('aria-valuetext', '+2');
        await expect(up).toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('Enter');
        await expect(octave).toHaveAttribute('aria-valuenow', '4');
        await expect(octave.locator('.cap')).toHaveAttribute('y', '0');

        await octave.focus();
        await page.keyboard.press('End');
        await expect(down).toHaveAttribute('aria-disabled', 'true');
        await down.focus();
        await page.keyboard.press(' ');
        await expect(octave).toHaveAttribute('aria-valuetext', '-2');
        await expect(octave.locator('.cap')).toHaveAttribute('y', doubled ? '160' : '80');
        await expect(page.locator('#fader-value-octave')).toHaveText('0');
        await up.click();
        await expect(octave).toHaveAttribute('aria-valuetext', '-1');
        await expect(down).toHaveAttribute('aria-disabled', 'false');
        await expect(page.locator('#app-status')).toContainText('Octave: -1');
        await page.locator('#reset-faders').click();
        await expect(octave).toHaveAttribute('aria-valuetext', '0');
        await expect(down).toHaveAttribute('aria-disabled', 'false');
        await expect(up).toHaveAttribute('aria-disabled', 'false');
      }
    }
  }
});

test('Transpose snaps to semitones, stays centered at zero, and displays its signed value in every mode', async ({ page }) => {
  const transpose = page.getByRole('slider', { name: 'Transpose', exact: true });
  const topLabel = page.locator('#transpose-value');
  await expect(transpose).toHaveAttribute('aria-valuemin', '-6');
  await expect(transpose).toHaveAttribute('aria-valuemax', '6');
  await expect(transpose).toHaveAttribute('aria-valuenow', '0');
  await expect(topLabel).toHaveText('0');
  await expect(transpose.locator('.cap')).toHaveAttribute('y', '40');
  for (const hidden of [false, true]) {
    if (hidden) await page.locator('#hide-speakers').click();
    for (const focus of [false, true]) {
      const focusToggle = page.locator('#focus-mode');
      if (await focusToggle.getAttribute('aria-pressed') !== String(focus)) await focusToggle.click();
      for (const travel of [80, 160]) {
        const sizeToggle = page.locator('#fader-size');
        if (await sizeToggle.getAttribute('aria-pressed') !== String(travel === 160)) await sizeToggle.click();
        await expect(topLabel).toBeVisible();
        const top = await faderPoint(page, 'transpose', 0);
        await page.mouse.move(top.x, top.y);
        await page.mouse.down();
        for (let value = 6; value >= -6; value--) {
          const point = await faderPoint(page, 'transpose', travel * (6 - value) / 12);
          await page.mouse.move(point.x, point.y);
          const text = value > 0 ? `+${value}` : String(value);
          await expect(transpose).toHaveAttribute('aria-valuenow', String(value));
          await expect(transpose).toHaveAttribute('aria-valuetext', `${text} semitones`);
          await expect(topLabel).toHaveText(text);
          if (focus) await expect(page.locator('#fader-value-transpose')).toHaveText(text);
        }
        await page.mouse.up();
        await expect(transpose).toHaveAttribute('aria-valuenow', '-6');
        await transpose.locator('.cap').dblclick();
        await expect(transpose).toHaveAttribute('aria-valuenow', '0');
        await expect(transpose.locator('.cap')).toHaveAttribute('y', String(travel / 2));
        await expect(topLabel).toHaveText('0');
      }
    }
  }
  await transpose.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await expect(topLabel).toHaveText('-6');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await expect(topLabel).toHaveText('+6');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(topLabel).toHaveText('+5');
  await page.keyboard.press('PageDown');
  await expect(topLabel).toHaveText('+4');
  await expect(page.locator('#octave')).toHaveAttribute('aria-valuenow', '2');
  await page.locator('#reset-faders').click();
  await expect(topLabel).toHaveText('0');
});

for (const reset of ['double-click', 'Delete']) {
  test(`${reset} resets only the selected fader and refreshes its LEDs and octave end state`, async ({ page }) => {
    const snapshot = () => page.locator('.fader').evaluateAll((faders) =>
      Object.fromEntries(faders.map((fader) => [fader.id, fader.dataset.value])));
    const starting = await snapshot();
    for (const travel of [80, 160]) {
      if (travel === 160) {
        await page.locator('#fader-size').click();
        await page.locator('#hide-speakers').click();
        await page.locator('#focus-mode').click();
      }
      for (const fader of await page.getByRole('slider').all()) {
        const id = await fader.getAttribute('id');
        const min = await fader.getAttribute('aria-valuemin');
        const max = await fader.getAttribute('aria-valuemax');
        await fader.focus();
        await page.keyboard.press(starting[id] === max ? 'End' : 'Home');
        expect(await fader.getAttribute('aria-valuenow'), id).not.toBe(starting[id]);
        const before = await snapshot();
        if (reset === 'Delete') await fader.press('Delete');
        else await fader.locator('.cap').dblclick();
        await expect(fader).toHaveAttribute('aria-valuenow', starting[id]);
        expect(await snapshot()).toEqual({ ...before, [id]: starting[id] });
        if (id === 'transpose') {
          await expect(page.locator('#transpose-value')).toHaveText('0');
        } else if (id === 'octave') {
          await expect(page.locator('#octave-down')).toHaveAttribute('aria-disabled', 'false');
          await expect(page.locator('#octave-up')).toHaveAttribute('aria-disabled', 'false');
        }
        if (max === '4' && min === '0') {
          if (id === 'osc-type') {
            await expect(page.locator('#osc-saw-led')).toHaveClass(/is-on/);
          } else if (id === 'looper') {
            await expect(fader.locator('.selection-led.is-on')).toHaveCount(0);
          }
        }
      }
      await expect(page.locator('#fader-size')).toHaveAttribute('aria-pressed', String(travel === 160));
      await expect(page.locator('#focus-mode')).toHaveAttribute('aria-pressed', String(travel === 160));
      await expect(page.locator('#hide-speakers')).toHaveAttribute('aria-pressed', String(travel === 160));
    }
    const trackPoint = await faderPoint(page, 'filter-cutoff', 160);
    await page.mouse.dblclick(trackPoint.x, trackPoint.y);
    await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
  });
}

test('Delete ends an active drag and resets mute state without resetting other controls', async ({ page }) => {
  const filter = page.locator('#filter-cutoff');
  const initialCurve = await page.locator('#preview-filter .graph-curve').getAttribute('d');
  await filter.press('End');
  const handle = await filter.locator('.cap').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await expect(filter).toHaveClass(/is-dragging/);
  await page.keyboard.press('Delete');
  await expect(filter).not.toHaveClass(/is-dragging/);
  const bottom = await faderPoint(page, 'filter-cutoff', 80);
  await page.mouse.move(bottom.x + 2, bottom.y);
  await page.mouse.up();
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
  await expect(page.locator('#preview-filter .graph-curve')).toHaveAttribute('d', initialCurve);
  await page.locator('#volume-mute').click();
  await page.locator('#volume').press('Delete');
  await expect(page.locator('#volume')).toHaveAttribute('aria-valuenow', '64');
  await expect(page.locator('#volume-mute')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#pitch-range-up').click();
  await page.locator('#pitch-bend').press('Home');
  await page.locator('#pitch-bend').press('Delete');
  await expect(page.locator('#pitch-bend')).toHaveAttribute('aria-valuenow', '64');
  await expect(page.locator('#pitch-range-value')).toHaveText('13');
  await filter.press('End');
  await page.locator('#focus-mode').press('Delete');
  await expect(filter).toHaveAttribute('aria-valuenow', '0');
});

test('5 Octaves fits the expanded range in the same frame without changing controls in any view', async ({ page }) => {
  const toggle = page.getByRole('button', { name: '5 Octaves', exact: true });
  const geometry = () => page.evaluate(() => {
    const box = (selector) => {
      const { width, height } = document.querySelector(selector).getBoundingClientRect();
      return { width, height };
    };
    return {
      keyboard: box('#keyboard'),
      white: box('#key-c-1'),
      black: box('#key-cs-1'),
      handle: box('#filter-cutoff .cap'),
      body: box('#body'),
      values: [...document.querySelectorAll('.fader')].map((fader) => fader.dataset.value),
    };
  });
  const notes = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b'];
  const expected = [0, 1, 2, 3, 4].flatMap((octave) => notes.map((note) => `key-${note}-${octave}`));
  expected.push('key-c-5');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.key:visible')).toHaveCount(37);
  await page.locator('#transpose').focus();
  await page.keyboard.press('ArrowUp');
  await page.locator('#octave-up').click();

  for (const hidden of [false, true]) {
    if (hidden) await page.locator('#hide-speakers').click();
    for (const focus of [false, true]) {
      const focusToggle = page.locator('#focus-mode');
      if (await focusToggle.getAttribute('aria-pressed') !== String(focus)) await focusToggle.click();
      for (const doubled of [false, true]) {
        const sizeToggle = page.locator('#fader-size');
        if (await sizeToggle.getAttribute('aria-pressed') !== String(doubled)) await sizeToggle.click();
        const normal = await geometry();
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.key:visible')).toHaveCount(61);
        const actual = await page.locator('.key:visible').evaluateAll((keys) => keys.map((key) => key.id));
        expect(actual.sort()).toEqual([...expected].sort());
        const expanded = await geometry();
        expect(expanded.keyboard.width).toBeCloseTo(normal.keyboard.width, 1);
        expect(expanded.keyboard.height).toBeCloseTo(normal.keyboard.height, 1);
        for (const color of ['white', 'black']) {
          expect(expanded[color].width).toBeCloseTo(normal[color].width * 22 / 36, 1);
          expect(expanded[color].height).toBeCloseTo(normal[color].height, 1);
        }
        expect(expanded.body).toEqual(normal.body);
        expect(expanded.handle).toEqual(normal.handle);
        expect(expanded.values).toEqual(normal.values);
        await expect(page.locator('#panel-description')).toContainText('61 keys');
        await toggle.click();
        await expect(page.locator('.key:visible')).toHaveCount(37);
        const restored = await geometry();
        expect(restored).toEqual(normal);
      }
    }
  }
  await toggle.click();
  await page.locator('#reset-faders').click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.key:visible')).toHaveCount(61);
});

test('added keys support independent presses and cancellation, and switching releases held keys', async ({ page }) => {
  const toggle = page.getByRole('button', { name: '5 Octaves', exact: true });
  await page.locator('#key-c-2').focus();
  await page.keyboard.down(' ');
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await toggle.evaluate((button) => button.click());
  await expect(page.locator('.key.is-pressed')).toHaveCount(0);
  await page.keyboard.up(' ');

  const low = page.getByRole('button', { name: 'C, octave 2', exact: true });
  const high = page.getByRole('button', { name: 'C, octave 7', exact: true });
  const lowBox = await low.boundingBox();
  await page.mouse.move(lowBox.x + lowBox.width / 2, lowBox.y + lowBox.height * 0.8);
  await page.mouse.down();
  await high.focus();
  await page.keyboard.down('Enter');
  await expect(low).toHaveAttribute('aria-pressed', 'true');
  await expect(high).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#key-c-1')).toHaveAttribute('aria-pressed', 'false');
  await toggle.evaluate((button) => button.click());
  await expect(page.locator('.key.is-pressed')).toHaveCount(0);
  await expect(page.locator('.key:visible')).toHaveCount(37);
  await page.mouse.up();
  await page.keyboard.up('Enter');
  await expect(page.locator('#key-c-0')).toBeHidden();
  await expect(page.locator('#key-c-5')).toBeHidden();

  await toggle.click();
  const sharp = page.getByRole('button', { name: 'C sharp, octave 6', exact: true });
  const sharpBox = await sharp.boundingBox();
  await page.mouse.move(sharpBox.x + sharpBox.width / 2, sharpBox.y + sharpBox.height / 2);
  await page.mouse.down();
  await expect(sharp).toHaveAttribute('aria-pressed', 'true');
  await sharp.dispatchEvent('pointercancel', { pointerId: 1 });
  await expect(sharp).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.up();
  await sharp.focus();
  await page.keyboard.down('Enter');
  await expect(sharp).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(sharp).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.up('Enter');
});

test('five-position labels select exact values without dragging in normal and compact views', async ({ page }) => {
  const ids = ['octave', 'looper', 'lfo-assign', 'osc-type', 'effect-type'];
  const snapshot = () => page.locator('.fader').evaluateAll((faders) =>
    Object.fromEntries(faders.map((fader) => [fader.id, fader.dataset.value])));
  await expect(page.locator('.position-label')).toHaveCount(25);
  await expect(page.locator('#portamento .scale-label').first()).toHaveCSS('pointer-events', 'none');

  for (const compact of [false, true]) {
    if (compact) {
      await page.locator('#hide-speakers').click();
      await page.locator('#focus-mode').click();
      await page.locator('#five-octaves').click();
    }
    for (const travel of [80, 160]) {
      const sizeToggle = page.locator('#fader-size');
      if (await sizeToggle.getAttribute('aria-pressed') !== String(travel === 160)) await sizeToggle.click();
      for (const id of ids) {
        const fader = page.locator(`#${id}`);
        for (const step of [4, 3, 2, 1, 0]) {
          const before = await snapshot();
          await fader.locator(`.position-label[data-step="${step}"]`).click();
          await expect(fader).toHaveAttribute('aria-valuenow', String(step));
          await expect(fader).not.toHaveClass(/is-dragging/);
          await expect(fader).toBeFocused();
          await expect(fader.locator('.cap')).toHaveAttribute('y', String(travel * (1 - step / 4)));
          await expect(page.locator(`#fader-value-${id}`)).toHaveText(String(step));
          expect(await snapshot()).toEqual({ ...before, [id]: String(step) });
          for (const led of await fader.locator('.selection-led').all()) {
            const selected = await led.getAttribute('data-value') === String(step);
            if (selected) await expect(led).toHaveClass(/is-on/);
            else await expect(led).not.toHaveClass(/is-on/);
          }
        }
        await fader.locator('.position-label[data-step="4"]').dblclick();
        await expect(fader).toHaveAttribute('aria-valuenow', '4');
        await page.keyboard.press('ArrowDown');
        await expect(fader).toHaveAttribute('aria-valuenow', '3');
      }
    }
  }
});

test('fader handles share a stronger highlight for hover, keyboard focus, and captured dragging', async ({ page }) => {
  const fader = page.locator('#filter-cutoff');
  const cap = fader.locator('.cap');
  const original = await fader.getAttribute('aria-valuenow');
  await page.mouse.move(1, 1);
  await expect(cap).toHaveCSS('filter', 'none');
  await fader.hover();
  await expect(cap).toHaveCSS('filter', /brightness\(1\.25\).*drop-shadow/);
  const glow = await cap.evaluate((element) => getComputedStyle(element).filter);
  await expect(fader).toHaveAttribute('aria-valuenow', original);
  await expect(fader).not.toHaveClass(/is-dragging/);
  await page.mouse.move(1, 1);
  await expect(cap).toHaveCSS('filter', 'none');

  await fader.focus();
  await page.keyboard.press('ArrowDown');
  await expect(cap).toHaveCSS('filter', glow);
  await page.locator('#fader-size').focus();
  await expect(cap).toHaveCSS('filter', 'none');

  const box = await cap.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(1, 1);
  await expect(fader).toHaveClass(/is-dragging/);
  await expect(cap).toHaveCSS('filter', glow);
  await page.mouse.up();
  await expect(fader).not.toHaveClass(/is-dragging/);
  await page.locator('#fader-size').focus();
  await page.mouse.move(2, 2);
  await expect(cap).toHaveCSS('filter', 'none');
});

test('glow eases in and out even with reduced motion, without animating handle movement', async ({ page }) => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    const result = await page.locator('#filter-cutoff').evaluate((fader) => {
      const cap = fader.querySelector('.cap');
      getComputedStyle(cap).filter;
      const sample = () => {
        const animation = cap.getAnimations().find((item) => item.transitionProperty === 'filter');
        if (!animation) throw new Error('Expected a glow transition');
        const duration = animation.effect.getComputedTiming().duration;
        animation.pause();
        animation.currentTime = duration / 4;
        const brightness = Number(getComputedStyle(cap).filter.match(/brightness\(([\d.]+)\)/)[1]);
        animation.finish();
        return { duration, brightness, end: getComputedStyle(cap).filter };
      };
      fader.classList.add('is-dragging');
      const fadeIn = sample();
      fader.classList.remove('is-dragging');
      const fadeOut = sample();
      return { fadeIn, fadeOut };
    });
    expect(result.fadeIn.duration).toBe(180);
    expect(result.fadeOut.duration).toBe(180);
    expect(result.fadeIn.brightness).toBeGreaterThan(1);
    expect(result.fadeIn.brightness).toBeLessThan(1.0625);
    expect(result.fadeOut.brightness).toBeGreaterThan(1.1875);
    expect(result.fadeOut.brightness).toBeLessThan(1.25);
    expect(result.fadeOut.end).toBe('none');
  }

  const fader = page.locator('#filter-cutoff');
  await fader.focus();
  await page.keyboard.press('End');
  await expect(fader.locator('.cap')).toHaveAttribute('y', '80');
  await expect(fader.locator('.cap')).toHaveCSS('transition-property', 'filter');
  await expect(page.locator('#key-c-1 use')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('#osc-saw-led')).toHaveCSS('transition-duration', '0s');
});

test('MUTE saves and restores Volume across view changes and supports keyboard activation', async ({ page }) => {
  const volume = page.locator('#volume');
  const mute = page.locator('#volume-mute');
  const label = page.locator('#mute-label');
  await expect(label).toHaveText('MUTE');
  await volume.focus();
  await page.keyboard.press('PageUp');
  await page.keyboard.press('ArrowDown');
  await expect(volume).toHaveAttribute('aria-valuenow', '73');
  await mute.click();
  await expect(volume).toHaveAttribute('aria-valuenow', '0');
  await expect(volume.locator('.cap')).toHaveAttribute('y', '80');
  await expect(label).toHaveText('UNMUTE');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect(mute).toHaveAttribute('aria-disabled', 'false');
  await page.locator('#filter-cutoff').focus();
  await page.keyboard.press('End');
  for (const id of ['focus-mode', 'hide-speakers', 'fader-size', 'five-octaves']) {
    await page.locator(`#${id}`).click();
    await expect(label).toHaveText('UNMUTE');
    await expect(mute).toHaveAttribute('aria-disabled', 'false');
    await expect(volume).toHaveAttribute('aria-valuenow', '0');
  }
  await expect(volume.locator('.cap')).toHaveAttribute('y', '160');
  await mute.click();
  await expect(volume).toHaveAttribute('aria-valuenow', '73');
  await expect(page.locator('#fader-value-volume')).toHaveText('73');
  await expect(label).toHaveText('MUTE');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
  await mute.focus();
  await page.keyboard.press(' ');
  await expect(volume).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('Enter');
  await expect(volume).toHaveAttribute('aria-valuenow', '73');

  await volume.focus();
  await page.keyboard.press('End');
  await mute.click();
  await expect(label).toHaveText('UNMUTE');
  await mute.click();
  await expect(label).toHaveText('MUTE');
  await expect(volume).toHaveAttribute('aria-valuenow', '0');
});

test('touching muted Volume discards restoration even at zero, and positive volume or Reset clears mute', async ({ page }) => {
  const volume = page.locator('#volume');
  const mute = page.locator('#volume-mute');
  const label = page.locator('#mute-label');
  await mute.click();
  await volume.locator('.cap').click();
  await expect(volume).toHaveAttribute('aria-valuenow', '0');
  await expect(label).toHaveText('UNMUTE');
  await expect(mute).toHaveAttribute('aria-disabled', 'true');
  await mute.focus();
  await page.keyboard.press('Enter');
  await expect(volume).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#app-status')).toContainText('Raise the Volume fader to unmute');
  await volume.focus();
  await page.keyboard.press('ArrowUp');
  await expect(volume).toHaveAttribute('aria-valuenow', '1');
  await expect(label).toHaveText('MUTE');
  await expect(mute).toHaveAttribute('aria-disabled', 'false');
  await mute.click();
  await mute.click();
  await expect(volume).toHaveAttribute('aria-valuenow', '1');

  await mute.click();
  await volume.focus();
  await page.keyboard.press('End');
  await expect(mute).toHaveAttribute('aria-disabled', 'true');
  await volume.locator('.cap').dblclick();
  await expect(volume).toHaveAttribute('aria-valuenow', '64');
  await expect(label).toHaveText('MUTE');
  await mute.click();
  await page.locator('#reset-faders').click();
  await expect(volume).toHaveAttribute('aria-valuenow', '64');
  await expect(label).toHaveText('MUTE');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await expect(mute).toHaveAttribute('aria-disabled', 'false');
});

test('clickable labels glow on hover without changing values, including under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const snapshot = () => page.locator('.fader').evaluateAll((faders) =>
    faders.map((fader) => fader.dataset.value));
  const starting = await snapshot();
  for (const selector of [
    '#osc-type .position-label[data-step="4"]', '#volume-mute', '#pitch-range-down', '#pitch-range-up',
  ]) {
    const label = page.locator(selector);
    await page.mouse.move(1, 1);
    await expect(label).toHaveCSS('filter', 'none');
    await label.hover();
    await expect(label).toHaveCSS('filter', /brightness\(1\.25\).*drop-shadow/);
    await expect(label).toHaveCSS('transition-duration', '0.18s');
    expect(await snapshot()).toEqual(starting);
    await page.mouse.move(1, 1);
    await expect(label).toHaveCSS('filter', 'none');
  }
  await page.locator('#volume-mute').focus();
  await page.keyboard.press('Tab');
  await page.locator('#volume-mute').focus();
  await expect(page.locator('#volume-mute')).toHaveCSS('filter', /brightness\(1\.25\).*drop-shadow/);
});

test('pitch bend range steps by semitones, stays within 0-24, and does not move the bend fader', async ({ page }) => {
  const range = page.locator('#pitch-range-value');
  const down = page.getByRole('button', { name: 'Decrease pitch bend range', exact: true });
  const up = page.getByRole('button', { name: 'Increase pitch bend range', exact: true });
  const bend = page.locator('#pitch-bend');
  const snapshot = () => page.locator('.fader').evaluateAll((faders) =>
    faders.map((fader) => fader.dataset.value));
  await expect(range).toHaveText('12');
  await bend.focus();
  await page.keyboard.press('Home');
  const before = await snapshot();
  for (let value = 11; value >= 0; value--) {
    await down.click();
    await expect(range).toHaveText(String(value));
  }
  await expect(down).toHaveAttribute('aria-disabled', 'true');
  await down.focus();
  await page.keyboard.press('Enter');
  await expect(range).toHaveText('0');
  await up.focus();
  await page.keyboard.press(' ');
  await expect(range).toHaveText('1');
  await expect(down).toHaveAttribute('aria-disabled', 'false');
  for (let value = 2; value <= 24; value++) {
    await page.keyboard.press('Enter');
    await expect(range).toHaveText(String(value));
  }
  await expect(up).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  await expect(range).toHaveText('24');
  await expect(page.locator('#pitch-range')).toHaveAttribute('aria-label', 'Pitch bend range: 24 semitones');
  expect(await snapshot()).toEqual(before);
  await down.click();
  await expect(range).toHaveText('23');
  await expect(up).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('#app-status')).toContainText('Pitch bend range: 23 semitones');
  await bend.locator('.cap').dblclick();
  await expect(bend).toHaveAttribute('aria-valuenow', '64');
  await expect(range).toHaveText('23');
  await page.locator('#reset-faders').click();
  await expect(range).toHaveText('12');
  await expect(down).toHaveAttribute('aria-disabled', 'false');
  await expect(up).toHaveAttribute('aria-disabled', 'false');
});

test('pitch bend range controls remain aligned and preserve their value across view changes', async ({ page }) => {
  const range = page.locator('#pitch-range-value');
  const up = page.locator('#pitch-range-up');
  await up.click();
  for (const id of ['focus-mode', 'hide-speakers', 'fader-size', 'five-octaves']) {
    await page.locator(`#${id}`).click();
    await expect(range).toHaveText('13');
    await expect(up).toBeVisible();
    const geometry = await page.locator('#pitch-range').evaluate((control) => {
      const bounds = control.getBoundingClientRect();
      const bend = document.querySelector('#pitch-bend');
      const origin = new DOMPoint(0, 0).matrixTransform(bend.getScreenCTM());
      const next = document.querySelector('#lower-panel .control-label text').getBoundingClientRect();
      return {
        center: bounds.left + bounds.width / 2,
        bendCenter: origin.x,
        gap: next.left - bounds.right,
      };
    });
    expect(geometry.center).toBeCloseTo(geometry.bendCenter, 1);
    expect(geometry.gap).toBeGreaterThan(0);
    await up.click();
    await expect(range).toHaveText('14');
    await page.locator('#pitch-range-down').click();
    await expect(range).toHaveText('13');
  }
  await page.locator('#reset-faders').click();
  await expect(range).toHaveText('12');
  for (const id of ['focus-mode', 'hide-speakers', 'fader-size', 'five-octaves']) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-pressed', 'true');
  }
});
