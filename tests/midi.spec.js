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

test('discovers reface ports, supports a separate controller and follows hot-plug', async ({ page }) => {
  await mockMidi(page, {
    inputs: [{ id: 'ri', name: 'Yamaha reface CS' }, { id: 'keyboard', name: 'Controller' }],
    outputs: [{ id: 'ro', name: 'Yamaha reface CS' }],
  });
  await expect(page.locator('#midi-badge')).toHaveText('MIDI not connected');
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
  await expect(page.locator('#midi-reface-input')).toHaveValue('ri');
  await expect(page.locator('#midi-reface-output')).toHaveValue('ro');
  await expect(page.locator('#midi-controller-input')).toHaveValue('ri');
  expect(await page.evaluate(() => window.midiRequests)).toEqual([[]]);

  await page.locator('#midi-controller-input').selectOption('keyboard');
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
  await page.evaluate(() => {
    window.testMidi.inputs.get('ri').state = 'disconnected';
    window.testMidi.dispatchEvent(new Event('statechange'));
  });
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports unavailable');
  await expect(page.locator('#midi-controller-input')).toHaveValue('keyboard');
  await page.evaluate(() => {
    window.testMidi.inputs.get('ri').state = 'connected';
    window.testMidi.dispatchEvent(new Event('statechange'));
  });
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
  await expect(page.locator('#midi-controller-input')).toHaveValue('keyboard');
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
  await expect(page.locator('#midi-status')).toContainText('Permission denied');
  await expect(page.getByRole('button', { name: 'Connect MIDI' })).toBeEnabled();
});

test('reports unsupported Web MIDI', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined });
  });
  await page.goto('/static/reface/');
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await expect(page.locator('#midi-badge')).toHaveText('MIDI unavailable');
  await expect(page.locator('#midi-status')).toContainText('secure context');
});
