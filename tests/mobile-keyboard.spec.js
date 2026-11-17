import { test, expect } from '@playwright/test';

async function drag(page, client, from, to, beforeRelease = async () => {}) {
  if (client) {
    const point = (x, y) => ({ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from.x, from.y)] });
    for (let step = 1; step <= 8; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [point(from.x + (to.x - from.x) * step / 8, from.y + (to.y - from.y) * step / 8)] });
    }
    await beforeRelease();
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await beforeRelease();
    await page.mouse.up();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/static/reface/');
  await expect(page.locator('.message-entry[data-source="app-status"] .message-text').last()).toContainText('Panel ready.');
});

test('a deliberate horizontal drag pans the expanded keyboard and releases its initial note', async ({ page }) => {
  const keyboard = page.locator('#keyboard-keys');
  const key = page.locator('#key-c-2');
  await page.locator('#five-octaves').click();
  await expect(keyboard).toHaveAttribute('transform', 'translate(-434 0)');

  await key.scrollIntoViewIfNeeded();
  const bounds = await key.boundingBox();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(x - 60, y, { steps: 5 });
  await expect.poll(() => keyboard.getAttribute('transform')).not.toBe('translate(-434 0)');
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.up();
});

test('the Glissando switch plays mouse drags across keys and persists', async ({ page }) => {
  const keyboard = page.locator('#keyboard-keys');
  const start = page.locator('#key-c-2');
  const next = page.locator('#key-e-2');
  await page.locator('#glissando').click();
  await expect(page.locator('#glissando')).toHaveAttribute('aria-pressed', 'true');

  await start.scrollIntoViewIfNeeded();
  const from = await start.boundingBox();
  const to = await next.boundingBox();
  const y = from.y + from.height / 2;
  await page.mouse.move(from.x + from.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(start).toHaveAttribute('aria-pressed', 'false');
  await expect(next).toHaveAttribute('aria-pressed', 'true');
  await expect(keyboard).toHaveAttribute('transform', 'translate(0 0)');
  await page.mouse.up();
  await expect(next).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await expect(page.locator('#glissando')).toHaveAttribute('aria-pressed', 'true');
});

test('mobile landscape uses a touch-sized five-octave keyboard and compact layout', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.reload();
  const panel = page.locator('#synth svg');
  await expect(panel).toHaveClass(/mobile-landscape/);
  await expect(page.locator('#five-octaves')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#fader-size')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#visualizations')).toBeHidden();
  await expect(page.locator('#octave-down')).toBeHidden();
  await expect(page.locator('.speaker').first()).toBeHidden();
  await expect(page.locator('#device-panel')).toBeVisible();
  await expect(page.locator('#keyboard-keys')).toHaveAttribute('transform', 'translate(-434 0)');
  await expect(page.locator('#arp-label')).toHaveText('ARP');
  await expect(page.locator('#yamaha-link')).toBeHidden();

  const key = await page.locator('#key-c-2').boundingBox();
  expect(key.width).toBeGreaterThanOrEqual(28);
  expect(key.height).toBeGreaterThanOrEqual(72);

  await page.setViewportSize({ width: 800, height: 390 });
  await expect(page.locator('#arp-label')).toHaveText('ARP');
  await expect(page.locator('#cs-logo')).toBeHidden();
});

test('desktop note and chord readouts keep updating while hidden on mobile', async ({ page }) => {
  const readouts = page.locator('#arp-readouts');
  await expect(readouts).toBeVisible();
  await page.keyboard.down('a');
  await page.keyboard.down('d');
  await page.keyboard.down('g');
  await expect(page.locator('#arp-held-notes')).toHaveText('C4 E4 G4');
  await expect(page.locator('#arp-detected-chord')).toHaveText('C');
  await expect(page.locator('#arp-detected-chord')).toHaveClass(/chord-major/);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(readouts).toBeHidden();
  await page.keyboard.up('a');
  await page.keyboard.up('d');
  await page.keyboard.up('g');
  await page.keyboard.down('a');
  await page.keyboard.down('d');
  await page.keyboard.down('g');
  await expect(page.locator('#arp-held-notes')).toHaveText('C4 E4 G4');
  await expect(page.locator('#arp-detected-chord')).toHaveText('C');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(readouts).toBeVisible();
  await expect(page.locator('#arp-held-notes')).toHaveText('None');
  await page.keyboard.up('a');
  await page.keyboard.up('d');
  await page.keyboard.up('g');
  await page.keyboard.down('a');
  await expect(page.locator('#arp-held-notes')).toHaveText('C4');
  await page.keyboard.up('a');
});

test('SuperKnob switches between the desktop top and mobile arpeggiator row', async ({ page }) => {
  const knob = page.locator('#super-knob');
  const centerY = (element) => element.evaluate((node) => {
    const { top, height } = node.getBoundingClientRect();
    return top + height / 2;
  });
  await expect(knob).toHaveAttribute('transform', 'translate(920 52)');
  expect(await centerY(knob)).toBeLessThan(await centerY(page.locator('#arp-mode')));
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(knob).toHaveAttribute('transform', 'translate(800 260)');
  const bounds = await knob.boundingBox();
  const arp = await page.locator('#arp-mode').boundingBox();
  const patch = await page.locator('#patch-display').boundingBox();
  expect(bounds.x).toBeGreaterThan(arp.x + arp.width);
  expect(bounds.x).toBeGreaterThan(patch.x + patch.width);
  expect(Math.abs(await centerY(knob) - await centerY(page.locator('#arp-mode')))).toBeLessThan(12);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(knob).toHaveAttribute('transform', 'translate(920 52)');
  expect(await centerY(knob)).toBeLessThan(await centerY(page.locator('#arp-mode')));
});

test('mobile controls pack left, keep their menus aligned, and restore the desktop layout', async ({ page }) => {
  const controls = page.locator('#soft-synth-mode, #dark-synth-mode, #device-panel > g, #arp-controls, #arp-label, #arp-controls > g, #patch-display, #patch-display-screen > rect, #patch-name-clip > rect');
  const snapshot = () => controls.evaluateAll((elements) => elements.map((element) => ({
    id: element.id,
    geometry: ['transform', 'x', 'y', 'width', 'height'].map((name) => element.getAttribute(name)),
    labels: [...element.querySelectorAll('.device-label')].map((label) => label.textContent),
  })));
  const desktop = await snapshot();
  for (const width of [844, 568]) {
    await page.setViewportSize({ width, height: 390 });
    await expect(page.locator('#arp-label')).toHaveText('ARP');
    await expect(page.locator('#super-knob')).toHaveAttribute('transform',
      width === 568 ? 'translate(134.5 304)' : 'translate(800 260)');
    const top = ['#soft-synth-mode', '#dark-synth-mode', '#device-midi-transmit',
      '#device-midi-receive', '#device-local-control', '#device-speaker-output'];
    let right = (await page.locator('#mobile-menu-open').boundingBox()).x + 32;
    for (const selector of top) {
      const control = page.locator(selector);
      const bounds = await control.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(right);
      expect(bounds.x + bounds.width).toBeLessThan(width);
      expect((await control.locator('.device-label').textContent()).length).toBeLessThanOrEqual(4);
      right = bounds.x + bounds.width;
    }
    const mode = await page.locator('#arp-mode').boundingBox();
    const patch = await page.locator('#patch-display').boundingBox();
    expect(patch.x - mode.x - mode.width).toBeGreaterThan(0);
    expect(patch.x - mode.x - mode.width).toBeLessThan(8);
    expect(patch.x + patch.width).toBeLessThan(width);

    for (const [selector, name] of [
      ['#arp-rate', 'Arpeggiator rates'], ['#arp-mode', 'Arpeggiator modes'],
      ['#dark-synth-mode', 'Dark synth mode choices'],
    ]) {
      const control = page.locator(selector);
      await control.click({ button: 'right' });
      const menu = page.getByRole('menu', { name });
      await expect(menu).toBeVisible();
      const buttonBounds = await control.boundingBox();
      const menuBounds = await menu.boundingBox();
      expect(Math.abs(menuBounds.x - buttonBounds.x)).toBeLessThan(5);
      expect(menuBounds.y).toBeGreaterThan(buttonBounds.y + buttonBounds.height);
      expect(menuBounds.x + menuBounds.width).toBeLessThan(width);
      await menu.getByRole('menuitemradio').first().click();
      await expect(menu).toBeHidden();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#arp-label')).toHaveText('ARPEGGIATOR');
  expect(await snapshot()).toEqual(desktop);
});

test('mobile black keys are twenty percent shorter without narrowing or losing their labels', async ({ page }) => {
  const white = page.locator('#key-c-2 use');
  const black = page.locator('#key-cs-2 use');
  const proportions = async () => (await black.boundingBox()).height / (await white.boundingBox()).height;
  const desktopProportions = await proportions();
  await page.locator('#focus-mode').click();
  for (const viewport of [{ width: 891, height: 514 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => await proportions() / desktopProportions).toBeCloseTo(0.8, 2);
    await expect.poll(() => white.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(49.6, 1);
    expect(await black.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(27.2, 1);
    const height = (await black.boundingBox()).height;
    await page.keyboard.down('w');
    await expect(page.locator('#key-cs-2')).toHaveAttribute('aria-pressed', 'true');
    const pressed = await black.boundingBox();
    expect(pressed.height).toBeCloseTo(height, 1);
    const label = await page.locator('#key-cs-2 .key-letter').boundingBox();
    expect(label.y).toBeGreaterThan(pressed.y);
    expect(label.y + label.height).toBeLessThan(pressed.y + pressed.height);
    await page.keyboard.up('w');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(proportions).toBeCloseTo(desktopProportions, 2);
  await expect(page.locator('#key-cs-2 .key-letter')).toHaveAttribute('y', '155');
});

test('mobile resizing crops the contents without shrinking faders or key widths', async ({ page }) => {
  await page.setViewportSize({ width: 891, height: 514 });
  await expect(page.locator('#synth svg')).toHaveClass(/mobile-landscape/);
  const geometry = () => page.evaluate(() => {
    const size = (selector) => {
      const { width, height } = document.querySelector(selector).getBoundingClientRect();
      return { width, height };
    };
    return {
      fader: size('#expression .track'),
      handle: size('#expression .cap'),
      target: size('#expression .hit-area'),
      key: size('#key-c-1 use'),
      blackKey: size('#key-cs-1 use'),
      arp: size('#arp-mode'),
      keyboard: size('#keyboard > rect'),
      housingLeft: document.querySelector('#body').getBoundingClientRect().left,
    };
  });
  const reference = await geometry();
  expect(reference.key.width).toBeGreaterThanOrEqual(44);
  expect(reference.blackKey.width).toBeGreaterThanOrEqual(24);
  expect(reference.target.width).toBeGreaterThanOrEqual(24);
  expect(reference.fader.height / 55.2).toBeCloseTo(1.3, 2);
  expect(reference.fader.width / 20.4).toBeCloseTo(1.3, 2);
  for (const viewport of [
    { width: 844, height: 390 }, { width: 800, height: 390 },
    { width: 740, height: 375 }, { width: 667, height: 375 },
    { width: 568, height: 320 }, { width: 900, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => (await geometry()).fader.width).toBeCloseTo(reference.fader.width, 1);
    const current = await geometry();
    for (const control of ['fader', 'handle', 'target', 'arp']) {
      expect(current[control].width).toBeCloseTo(reference[control].width, 1);
      expect(current[control].height).toBeCloseTo(reference[control].height, 1);
    }
    expect(current.key.width).toBeCloseTo(reference.key.width, 1);
    expect(current.blackKey.width).toBeCloseTo(reference.blackKey.width, 1);
    expect(current.key.height).toBeGreaterThanOrEqual(72);
    expect(current.blackKey.height).toBeGreaterThanOrEqual(40);
    expect(current.key.height).toBeLessThanOrEqual(reference.key.height + 0.05);
    for (const selector of ['#synth svg', '#body', '#body-edge', '#control-strip', '#keyboard > rect', '#fader-pan-area']) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds.x, `${selector} left at ${viewport.width}`).toBeGreaterThanOrEqual(-0.5);
      expect(bounds.x + bounds.width, `${selector} right at ${viewport.width}`).toBeLessThanOrEqual(viewport.width + 0.5);
    }
    expect(current.housingLeft).toBeCloseTo(reference.housingLeft, 1);
    const body = await page.locator('#body').boundingBox();
    const keyboard = await page.locator('#keyboard > rect').boundingBox();
    const leftEdge = keyboard.x - body.x;
    const rightEdge = body.x + body.width - keyboard.x - keyboard.width;
    expect(leftEdge).toBeCloseTo(rightEdge, 1);
    expect(leftEdge).toBeGreaterThan(12);
    expect(leftEdge).toBeLessThan(15);
    const synth = await page.locator('#synth').boundingBox();
    expect(synth.x).toBe(0);
    expect(synth.width).toBe(viewport.width);
  }
  await page.setViewportSize({ width: 667, height: 514 });
  await expect.poll(async () => (await geometry()).key.height).toBeCloseTo(reference.key.height, 1);
  const narrower = await geometry();
  expect(narrower.key.height).toBeCloseTo(reference.key.height, 1);
  expect(narrower.keyboard.width).toBeLessThan(reference.keyboard.width);
  const narrowMax = Number(await page.locator('#fader-pan-area').getAttribute('aria-valuemax'));
  await page.setViewportSize({ width: 891, height: 514 });
  await expect.poll(async () => Number(await page.locator('#fader-pan-area').getAttribute('aria-valuemax'))).toBeLessThan(narrowMax);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#fader-size').click();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#fader-size')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#expression .track')).toHaveAttribute('transform', 'scale(1 2)');
});

test('narrow desktop MIDI and synth view buttons use 8px text without affecting mobile sizing', async ({ page }) => {
  const buttons = page.locator('.midi-actions button');
  const viewButtons = page.locator('#visual-toggles > button:not(#mobile-menu-open)');
  const normal = await buttons.first().evaluate((button) => getComputedStyle(button).fontSize);
  const normalView = await viewButtons.first().evaluate((button) => getComputedStyle(button).fontSize);
  for (const width of [901, 1000, 1099]) {
    await page.setViewportSize({ width, height: 900 });
    for (const button of [...await buttons.all(), ...await viewButtons.all()]) {
      await expect(button).toHaveCSS('font-size', '8px');
    }
  }
  await page.setViewportSize({ width: 800, height: 900 });
  for (const button of await viewButtons.all()) await expect(button).toHaveCSS('font-size', '8px');
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(buttons.first()).toHaveCSS('font-size', normal);
  for (const button of await viewButtons.all()) await expect(button).toHaveCSS('font-size', normalView);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('#mobile-menu-open').click();
  for (const button of await viewButtons.all()) await expect(button).toHaveCSS('font-size', '12px');
  await expect(buttons.first()).toHaveCSS('font-size', normal);
});

test('mobile menu retains header actions and restores the desktop header on resize', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const menu = page.locator('#app-menu');
  const open = page.getByRole('button', { name: 'Open app menu' });
  await expect(menu).toBeHidden();
  await expect(open).toBeVisible();
  const synth = await page.locator('#synth').boundingBox();
  const opener = await open.boundingBox();
  expect(synth.y).toBe(0);
  expect(opener.x).toBeLessThan(6);
  expect(opener.y).toBeLessThan(12);
  await expect(page.locator('#glissando')).toBeHidden();
  await expect(page.locator('#reset-faders')).toBeHidden();

  await open.click();
  await expect(menu).toBeVisible();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.locator('#glissando')).toBeVisible();
  await expect(menu.locator('#reset-faders')).toBeVisible();
  for (const id of ['midi-connect', 'app-settings-open', 'device-settings-open', 'backup-open',
    'help-open', 'midi-reface-input', 'midi-reface-output', 'midi-controller-input', 'message-center']) {
    await expect(menu.locator(`#${id}`)).toBeVisible();
  }
  await page.locator('#app-settings-open').click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#app-settings')).toBeVisible();
  await expect(page.locator('#app-settings #message-center')).toHaveCount(0);
  await page.locator('#settings-close').click();
  await open.click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await open.click();
  await page.getByRole('button', { name: 'Close app menu' }).click();
  await expect(menu).toBeHidden();
  await expect(open).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(menu).toBeHidden();
  await open.click();
  await expect(menu).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(menu).toBeVisible();
  await expect(open).toBeHidden();
  await expect(menu).not.toHaveAttribute('popover');
  await expect(page.locator('#midi-connect')).toBeVisible();
  await expect(page.locator('.instrument-scroll > #visual-toggles')).toBeVisible();
  await expect(page.locator('#glissando')).toBeVisible();
});

for (const input of ['mouse', 'touch']) {
  test(`mobile fader background pans independently with ${input}, while faders still adjust`, async ({ page, context }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const client = input === 'touch' ? await context.newCDPSession(page) : null;
    if (client) await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const values = () => page.locator('.fader').evaluateAll((faders) => faders.map((fader) => fader.dataset.value));
    const keyboard = await page.locator('#keyboard-keys').getAttribute('transform');
    const faderPanel = page.locator('#fader-panel');
    const initial = await faderPanel.getAttribute('transform');
    const strip = await page.locator('#control-strip').boundingBox();
    const expression = page.locator('#expression');
    const cap = await expression.locator('.cap').boundingBox();
    const bottom = await expression.evaluate((fader) => {
      const bottom = Number(fader.querySelector('.hit-area').getAttribute('height'));
      const { x, y } = new DOMPoint(0, bottom).matrixTransform(fader.getScreenCTM());
      return { x, y };
    });
    await drag(page, client, { x: cap.x + cap.width / 2, y: cap.y + cap.height / 2 }, bottom);
    await expect(expression).toHaveAttribute('aria-valuenow', '0');
    await expect(faderPanel).toHaveAttribute('transform', initial);
    const before = await values();
    const background = await page.locator('#fader-pan-area').boundingBox();
    const start = { x: background.x + background.width - 24, y: background.y + background.height - 4 };
    const end = { x: background.x + 24, y: start.y };
    for (let swipe = 0; swipe < 3; swipe++) await drag(page, client, start, end);
    await expect(faderPanel).not.toHaveAttribute('transform', initial);
    expect(await page.locator('#control-strip').boundingBox()).toEqual(strip);
    expect(await values()).toEqual(before);
    await expect(page.locator('#keyboard-keys')).toHaveAttribute('transform', keyboard);
    await expect(page.locator('#fader-viewport')).not.toHaveClass(/is-dragging/);
    const panned = await faderPanel.getAttribute('transform');
    const slider = page.locator('#effect-rate');
    const bounds = await slider.locator('.cap').boundingBox();
    const top = await slider.evaluate((fader) => {
      const { x, y } = new DOMPoint(0, 0).matrixTransform(fader.getScreenCTM());
      return { x, y };
    });
    expect(bounds.x).toBeGreaterThan(background.x);
    expect(bounds.x + bounds.width).toBeLessThan(background.x + background.width);
    await drag(page, client, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, top);
    await expect(slider).toHaveAttribute('aria-valuenow', '127');
    await expect(faderPanel).toHaveAttribute('transform', panned);
    await expect(page.locator('#keyboard-keys')).toHaveAttribute('transform', keyboard);
    for (let swipe = 0; swipe < 3; swipe++) await drag(page, client, end, start);
    await expect(faderPanel).toHaveAttribute('transform', initial);
  });

  test(`fixed-width mobile keys remain pannable and support glissando with ${input}`, async ({ page, context }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    const client = input === 'touch' ? await context.newCDPSession(page) : null;
    if (client) await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const frame = page.locator('#keyboard > rect');
    await frame.scrollIntoViewIfNeeded();
    const bounds = await frame.boundingBox();
    const start = { x: bounds.x + bounds.width - 30, y: bounds.y + bounds.height - 12 };
    const end = { x: bounds.x + 30, y: start.y };
    const faderPanel = await page.locator('#fader-panel').getAttribute('transform');
    for (let swipe = 0; swipe < 4; swipe++) await drag(page, client, start, end);
    await expect(page.locator('#fader-panel')).toHaveAttribute('transform', faderPanel);
    const last = await page.locator('#key-c-5 use').boundingBox();
    expect(last.x).toBeGreaterThan(bounds.x);
    expect(last.x + last.width).toBeLessThan(bounds.x + bounds.width + 5);
    await drag(page, client,
      { x: last.x + last.width / 2, y: start.y },
      { x: last.x + last.width / 2, y: start.y },
      async () => {
        await expect(page.locator('#key-c-5')).toHaveAttribute('aria-pressed', 'true');
        const pressed = await page.locator('#key-c-5 use').boundingBox();
        expect(pressed.height).toBeCloseTo(last.height, 1);
      });
    await expect(page.locator('#key-c-5')).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#mobile-menu-open').click();
    await page.locator('#glissando').click();
    await expect(page.locator('#app-menu')).toBeHidden();
    await frame.scrollIntoViewIfNeeded();
    const from = await page.locator('#key-a-4 use').boundingBox();
    const to = await page.locator('#key-b-4 use').boundingBox();
    await drag(page, client,
      { x: from.x + from.width / 2, y: from.y + from.height - 12 },
      { x: to.x + to.width / 2, y: to.y + to.height - 12 },
      async () => {
        await expect(page.locator('#key-a-4')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#key-b-4')).toHaveAttribute('aria-pressed', 'true');
      });
    await expect(page.locator('#key-b-4')).toHaveAttribute('aria-pressed', 'false');
  });
}

test('compact view actions describe their behavior and highlight visible speakers and displays', async ({ page }) => {
  await expect(page.locator('#focus-mode')).toHaveText('Focus');
  await expect(page.locator('#hide-speakers')).toHaveText('Speakers');
  await expect(page.locator('#hide-displays')).toHaveText('Displays');
  await expect(page.locator('#reset-faders')).toHaveText('Reset');
  await expect(page.locator('#fader-size')).toHaveText('2x Fader');
  for (const id of ['focus-mode', 'hide-speakers', 'hide-displays', 'reset-faders', 'fader-size']) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('title', /\S+/);
  }
  for (const [id, content] of [['hide-speakers', '.speaker'], ['hide-displays', '#visualizations']]) {
    const action = page.locator(`#${id}`);
    await expect(action).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(content).first()).toBeVisible();
    await action.click();
    await expect(action).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(content).first()).toBeHidden();
  }
  await page.reload();
  for (const id of ['hide-speakers', 'hide-displays']) {
    const action = page.locator(`#${id}`);
    await expect(action).toHaveAttribute('aria-pressed', 'false');
    await action.click();
    await expect(action).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.locator('.speaker').first()).toBeVisible();
  await expect(page.locator('#visualizations')).toBeVisible();
});
