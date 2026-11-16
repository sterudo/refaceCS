import { test, expect } from '@playwright/test';

async function mockMidi(page, ports) {
  await page.addInitScript((initialPorts) => {
    const access = new EventTarget();
    access.inputs = new Map(initialPorts.inputs.map((port) => [
      port.id, Object.assign(new EventTarget(), port, { state: 'connected' }),
    ]));
    access.outputs = new Map(initialPorts.outputs.map((port) => [port.id, { ...port, state: 'connected' }]));
    window.testMidi = access;
    window.midiRequests = [];
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async (...args) => {
        window.midiRequests.push(args);
        return access;
      },
    });
  }, ports);
  await page.goto('/static/reface/');
}

test('connecting without a reface leaves dismissed Messages closed', async ({ page }) => {
  await mockMidi(page, { inputs: [{ id: 'keyboard', name: 'Controller' }], outputs: [] });
  await page.locator('#app-settings-open').click();
  await page.getByLabel('Enable audio', { exact: true }).uncheck();
  await page.locator('#settings-close').click();
  await page.locator('#messages-close').click();
  await page.locator('#midi-connect').click();
  await expect(page.locator('#midi-connect')).toBeHidden();
  await expect(page.locator('.message-entry[data-source="midi-status"]').last()).toHaveAttribute('data-severity', 'warning');
  await expect(page.locator('#message-center')).toBeHidden();
});

test('MIDI connection errors reopen dismissed Messages', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async () => { throw new Error('Permission denied'); },
    });
  });
  await page.goto('/static/reface/');
  await page.locator('#app-settings-open').click();
  await page.getByLabel('Enable audio', { exact: true }).uncheck();
  await page.locator('#settings-close').click();
  await page.locator('#messages-close').click();
  await page.locator('#midi-connect').click();
  await expect(page.locator('#message-center')).toBeVisible();
  await expect(page.locator('.message-entry[data-source="midi-status"]').last()).toContainText('Permission denied');
});

test('discovers reface ports, supports a separate controller and follows hot-plug', async ({ page }) => {
  await mockMidi(page, {
    inputs: [{ id: 'ri', name: 'Yamaha reface CS' }, { id: 'keyboard', name: 'Controller' }],
    outputs: [{ id: 'ro', name: 'Yamaha reface CS' }],
  });
  await expect(page.locator('#midi-badge')).toHaveText('MIDI not connected');
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
  await expect(page.locator('#midi-badge')).toHaveAttribute('title', /^MIDI connected:/);
  await expect(page.locator('#midi-badge')).toHaveAttribute('aria-label', /^MIDI connected:/);
  await expect(page.locator('#midi-badge')).toHaveCSS('border-radius', '50%');
  await expect(page.locator('#midi-connect')).toBeHidden();
  const padding = await page.locator('#midi-reset').evaluate((element) => getComputedStyle(element).padding);
  for (const id of ['device-settings-open', 'backup-open']) {
    await expect(page.locator(`#${id}`)).toHaveCSS('padding', padding);
  }
  await expect(page.locator('#midi-reface-input')).toHaveValue('ri');
  await expect(page.locator('#midi-reface-output')).toHaveValue('ro');
  await expect(page.locator('#midi-controller-input')).toHaveValue('ri');
  expect(await page.evaluate(() => window.midiRequests)).toEqual([[], [{ sysex: true }]]);

  await page.locator('#midi-controller-input').selectOption('keyboard');
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
  await page.evaluate(() => {
    window.testMidi.inputs.get('ri').state = 'disconnected';
    window.testMidi.dispatchEvent(new Event('statechange'));
  });
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports unavailable');
  await expect(page.locator('#midi-badge')).not.toHaveAttribute('title', /MIDI connected/);
  await expect(page.locator('#midi-controller-input')).toHaveValue('keyboard');
  await page.evaluate(() => {
    window.testMidi.inputs.get('ri').state = 'connected';
    window.testMidi.dispatchEvent(new Event('statechange'));
  });
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
  await expect(page.locator('#midi-controller-input')).toHaveValue('keyboard');
});

test('connecting MIDI keeps the header beside the title and wraps long status messages within it', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await mockMidi(page, {
    inputs: [{ id: 'ri', name: '2- reface CS-1' }, { id: 'keyboard', name: 'loopMIDI Port' }],
    outputs: [{ id: 'ro', name: '2- reface CS-1' }],
  });
  await page.evaluate(() => {
    window.testMidi.sysexEnabled = true;
    window.testMidi.outputs.get('ro').send = () => {
      throw new Error('The selected MIDI output is temporarily unavailable. Reconnect the instrument and try again.');
    };
  });
  const before = await page.locator('.midi-ports').boundingBox();
  await page.locator('#midi-connect').click();
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('MIDI send failed');
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toBeVisible();
  const after = await page.locator('.midi-ports').boundingBox();
  expect(after.y).toBeCloseTo(before.y, 0);
  const layout = await page.locator('.toolbar').evaluate((header) => {
    const title = header.querySelector('h1').getBoundingClientRect();
    const ports = header.querySelector('.midi-ports').getBoundingClientRect();
    const status = header.querySelector('#message-center').getBoundingClientRect();
    return {
      sameRow: ports.top < title.bottom,
      contained: status.right <= header.getBoundingClientRect().right + 1,
      noOverflow: header.scrollWidth <= header.clientWidth + 1,
    };
  });
  expect(layout).toEqual({ sameRow: true, contained: true, noOverflow: true });

  await page.setViewportSize({ width: 2400, height: 900 });
  const wide = await page.locator('.toolbar').evaluate((header) => ({
    sameRow: header.querySelector('.midi-ports').getBoundingClientRect().top < header.querySelector('h1').getBoundingClientRect().bottom,
    noOverflow: header.scrollWidth <= header.clientWidth + 1,
  }));
  expect(wide).toEqual({ sameRow: true, noOverflow: true });

  await page.setViewportSize({ width: 480, height: 900 });
  const narrow = await page.locator('.toolbar').evaluate((header) => ({
    noOverflow: header.scrollWidth <= header.clientWidth + 1,
    portsFit: header.querySelector('.midi-ports').getBoundingClientRect().right <= header.getBoundingClientRect().right + 1,
  }));
  expect(narrow).toEqual({ noOverflow: true, portsFit: true });
});

test('restores the selected controller when available and otherwise uses the default', async ({ page }) => {
  await mockMidi(page, {
    inputs: [{ id: 'ri', name: 'Yamaha reface CS' }, { id: 'keyboard', name: 'Controller' }],
    outputs: [{ id: 'ro', name: 'Yamaha reface CS' }],
  });
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await page.locator('#midi-controller-input').selectOption('keyboard');
  await page.reload();
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await expect(page.locator('#midi-controller-input')).toHaveValue('keyboard');
  await page.evaluate(() => window.testMidi.inputs.delete('keyboard'));
  await page.reload();
  await page.evaluate(() => window.testMidi.inputs.delete('keyboard'));
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await expect(page.locator('#midi-controller-input')).toHaveValue('ri');
});

test('requires manual correction for ambiguous or unmatched ports', async ({ page }) => {
  await mockMidi(page, {
    inputs: [{ id: 'a', name: 'reface A' }, { id: 'b', name: 'reface B' }],
    outputs: [{ id: 'out', name: 'Yamaha USB MIDI' }],
  });
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports unavailable');
  await expect(page.locator('#midi-reface-input')).toHaveValue('');
  await page.locator('#midi-reface-input').selectOption('b');
  await expect(page.locator('#midi-controller-input')).toHaveValue('b');
  await page.locator('#midi-reface-output').selectOption('out');
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
  await page.locator('#midi-reface-input').selectOption('');
  await expect(page.locator('#midi-reface-input')).toHaveValue('');
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports unavailable');
});

test('reports permission errors and allows retry', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); },
    });
  });
  await page.goto('/static/reface/');
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await expect(page.locator('#midi-badge')).toHaveText('MIDI access failed');
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('Permission denied');
  await expect(page.getByRole('button', { name: 'Connect MIDI' })).toBeEnabled();
});

test('reports unsupported Web MIDI', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined });
  });
  await page.goto('/static/reface/');
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await expect(page.locator('#midi-badge')).toHaveText('MIDI unavailable');
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('secure context');
});
