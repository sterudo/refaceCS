import { test, expect } from '@playwright/test';
import { decodeParameter, encodeParameter } from '../src/synth-midi.js';
import { writeMidi } from '../src/midi-file.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const input = Object.assign(new EventTarget(), { id: 'ri', name: 'reface CS', state: 'connected' });
    const controller = Object.assign(new EventTarget(), { id: 'ci', name: 'Controller', state: 'connected' });
    const values = {
      '0,0,0': [0], '0,0,1': [16], '0,0,2': [0, 4, 0, 1], '0,0,6': [1],
      '0,0,11': [0], '0,0,12': [1], '0,0,13': [1], '0,0,14': [1],
      '0,0,15': [52], '0,0,20': [1], '48,0,0': [100],
      '0,0,7': [64], '0,0,8': [0, 120],
    };
    for (let address = 2; address <= 18; address++) {
      values[`48,0,${address}`] = [[9, 13, 14].includes(address) ? 127 : address === 16 ? 4 : 0];
    }
    const sent = [];
    const output = {
      id: 'ro', name: 'reface CS', state: 'connected',
      send(data) {
        sent.push([...data]);
        if (data[0] !== 0xf0) return;
        const key = [...data.slice(6, 9)].join(',');
        if (data[2] === 0x10 && window.deviceTest.failWrites) throw new Error('device send failed');
        if (data[2] === 0x10 && !window.deviceTest.ignoreWrites) values[key] = [...data.slice(9, -1)];
        if (data[2] === 0x30 && values[key] && !window.deviceTest.noReplies) {
          setTimeout(() => {
            const event = new Event('midimessage');
            event.data = new Uint8Array([0xf0, 0x43, 0x10, 0x7f, 0x1c, 3,
              ...data.slice(6, 9), ...values[key], 0xf7]);
            input.dispatchEvent(event);
          }, 0);
        }
      },
    };
    const access = (sysexEnabled) => Object.assign(new EventTarget(), {
      sysexEnabled, inputs: new Map([['ri', input], ['ci', controller]]), outputs: new Map([['ro', output]]),
    });
    const ordinary = access(false);
    const sysex = access(true);
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async (options) => {
        if (options?.sysex && sessionStorage.getItem('deny-device-sysex') === 'true') throw new Error('permission denied');
        return options?.sysex ? sysex : ordinary;
      },
    });
    window.deviceTest = { values, sent, ordinary, input, output, controller, ignoreWrites: false,
      noReplies: sessionStorage.getItem('device-no-replies') === 'true',
      emit(data) {
        const event = new Event('midimessage');
        event.data = new Uint8Array(data);
        controller.dispatchEvent(event);
      } };
  });
  await page.goto('/static/reface/');
  await page.locator('#midi-connect').click();
  await expect(page.locator('#device-settings-status')).toContainText('Read complete');
  await expect(page.locator('#capture-status')).toContainText('Captured');
});

const dialog = (page) => page.getByRole('dialog', { name: 'Device settings' });
const writes = (page) => page.evaluate(() => window.deviceTest.sent.filter((message) => message[0] === 0xf0 && message[2] === 0x10));

test('connected status is in the dot tooltip and toolbar controls have equal spacing', async ({ page }) => {
  const badge = page.locator('#midi-badge');
  await expect(badge).toHaveAttribute('title', /reface input available/);
  await expect(badge).toHaveAttribute('title', /Device settings read complete/);
  await expect(page.locator('#midi-status')).toBeHidden();
  await expect(page.locator('#device-panel-status')).toBeHidden();
  await page.locator('#data-info-close').click();
  const elements = await Promise.all(['#midi-badge', '#device-settings-open', '#midi-reset', '#backup-open', '#data-info-open']
    .map((selector) => page.locator(selector).boundingBox()));
  for (let index = 1; index < elements.length; index++) {
    expect(elements[index].x - (elements[index - 1].x + elements[index - 1].width)).toBeCloseTo(8, 1);
    expect(elements[index].y + elements[index].height / 2).toBeCloseTo(elements[0].y + elements[0].height / 2, 1);
  }
});

test('reads settings, stages verified defaults and leaves unknown defaults untouched', async ({ page }) => {
  await page.locator('#device-settings-open').click();
  const settings = dialog(page);
  await expect(settings.getByRole('row', { name: /Master Tune/ })).toContainText('0.1');
  await settings.getByRole('button', { name: 'Read settings' }).click();
  await expect(settings.locator('#device-settings-status')).toContainText('Read complete');
  await expect(settings.getByRole('row', { name: /Master Tune/ })).toContainText('0.1');
  await expect(settings.getByLabel('Pitch-bend direction')).toHaveValue('-1');
  await settings.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(settings.getByLabel('Pitch-bend direction')).toHaveValue('1');
  await expect(settings.getByLabel('MIDI Control')).toHaveValue('0');
  await expect(settings.getByLabel('Master Tune (cents)')).toHaveValue('0.1');
  await expect(settings.locator('#device-settings-status')).toContainText('Defaults not verified');
  expect(await writes(page)).toEqual([]);
});

test('applies only edits, verifies replies and synchronizes the panel bend range', async ({ page }) => {
  await page.locator('#device-settings-open').click();
  const settings = dialog(page);
  await settings.getByRole('button', { name: 'Read settings' }).click();
  await expect(settings.locator('#device-settings-status')).toContainText('Read complete');
  await settings.getByLabel('MIDI receive channel').selectOption('1');
  await settings.getByLabel('Master Tune (cents)').fill('-1.2');
  await settings.getByLabel('Pitch-bend range (semitones)').fill('7');
  await settings.getByRole('button', { name: 'Apply changes' }).click();
  await expect(settings.locator('#device-settings-status')).toHaveText('Changes confirmed by the synth.');
  await expect(page.locator('#device-midi-receive')).toHaveAttribute('data-value', '1');
  expect(await writes(page)).toEqual([
    [0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 1, 1, 0xf7],
    [0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 2, 0, 3, 15, 4, 0xf7],
    [0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 15, 57, 0xf7],
  ]);
  await expect(page.locator('#pitch-range-value')).toHaveText('7');
});

test('does not claim confirmation when a setting reads back differently', async ({ page }) => {
  await page.locator('#device-settings-open').click();
  const settings = dialog(page);
  await settings.getByRole('button', { name: 'Read settings' }).click();
  await expect(settings.locator('#device-settings-status')).toContainText('Read complete');
  await page.evaluate(() => { window.deviceTest.ignoreWrites = true; });
  await settings.getByLabel('Speaker output').selectOption('0');
  await settings.getByRole('button', { name: 'Apply changes' }).click();
  await expect(settings.locator('#device-settings-status')).toContainText('could not be confirmed');
  await expect(settings.getByRole('row', { name: /Speaker output/ })).toContainText('unconfirmed');
  await expect(settings.getByLabel('Speaker output')).toHaveValue('0');
});

test('a different pitch read-back replaces the requested range', async ({ page }) => {
  await page.evaluate(() => { window.deviceTest.ignoreWrites = true; });
  await page.locator('#device-settings-open').click();
  const settings = dialog(page);
  await settings.getByLabel('Pitch-bend range (semitones)').fill('7');
  await settings.getByRole('button', { name: 'Apply changes' }).click();
  await expect(settings.locator('#device-settings-status')).toContainText('could not be confirmed');
  await expect(settings.getByLabel('Pitch-bend range (semitones)')).toHaveValue('7');
  await expect(page.locator('#pitch-range-value')).toHaveText('12');
});

test('preserves draft edits during a read and reports missing replies', async ({ page }) => {
  await page.evaluate(() => { delete window.deviceTest.values['0,0,13']; });
  await page.locator('#device-settings-open').click();
  const settings = dialog(page);
  await settings.getByLabel('Speaker output').selectOption('0');
  await settings.getByRole('button', { name: 'Read settings' }).click();
  await expect(settings.locator('#device-settings-status')).toContainText('Read complete');
  await expect(settings.getByRole('row', { name: /Speaker output/ })).toContainText('No response');
  await expect(settings.getByLabel('Speaker output')).toHaveValue('0');
  await settings.getByRole('button', { name: 'Apply changes' }).click();
  await expect(settings.locator('#device-settings-status')).toHaveText('Changes confirmed by the synth.');
  expect(await writes(page)).toEqual([[0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 13, 0, 0xf7]]);
});

test('automatically reads direction before changing range and preserves inversion', async ({ page }) => {
  await page.locator('#pitch-range-up').click();
  await expect.poll(() => writes(page)).toContainEqual([0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 15, 51, 0xf7]);
  await expect(page.locator('#pitch-range-value')).toHaveText('13');
});

test('missing pitch direction requires an explicit direction before sending', async ({ page }) => {
  await page.evaluate(() => { delete window.deviceTest.values['0,0,15']; });
  await page.locator('#device-settings-open').click();
  await dialog(page).getByRole('button', { name: 'Read settings' }).click();
  await expect(dialog(page).locator('#device-settings-status')).toContainText('Read complete');
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await page.locator('#pitch-range-up').click();
  await page.getByRole('dialog', { name: 'Pitch-bend direction unknown' }).getByRole('button', { name: 'Read direction' }).click();
  const choice = page.getByRole('dialog', { name: 'Choose pitch-bend direction' });
  await expect(choice).toBeVisible();
  expect(await writes(page)).toEqual([]);
  await choice.getByRole('button', { name: 'Inverted' }).click();
  await expect.poll(() => writes(page)).toContainEqual([0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 15, 51, 0xf7]);
});

test('changing the selected device clears readings and pending edits', async ({ page }) => {
  await page.locator('#device-settings-open').click();
  const settings = dialog(page);
  await settings.getByRole('button', { name: 'Read settings' }).click();
  await expect(settings.locator('#device-settings-status')).toContainText('Read complete');
  await settings.getByLabel('Speaker output').selectOption('0');
  await settings.getByRole('button', { name: 'Close' }).click();
  await page.locator('#midi-reface-output').selectOption('');
  await page.locator('#device-settings-open').click();
  await expect(settings.locator('#device-settings-status')).toContainText('pending edits were cleared');
  await expect(settings.getByLabel('Speaker output')).toHaveValue('');
  await settings.getByRole('button', { name: 'Apply changes' }).click();
  await expect(settings.locator('#device-settings-status')).toHaveText('No changes to apply.');
  expect(await writes(page)).toEqual([]);
});

test('device reads override a legacy saved range without prompting or writing', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('refaceCS.preferences.v1', JSON.stringify({ pitchRange: 7 })));
  await page.reload();
  await expect(page.locator('#pitch-range-value')).toHaveText('12');
  await page.evaluate(() => { window.deviceTest.values['0,0,15'] = [59]; });
  await page.locator('#midi-connect').click();
  await expect(page.locator('#device-settings-status')).toContainText('Read complete');
  await expect(page.locator('#pitch-range-value')).toHaveText('5');
  await expect(page.getByRole('dialog', { name: 'Restore pitch-bend range' })).toHaveCount(0);
  expect(await writes(page)).toEqual([]);

  await page.evaluate(() => { window.deviceTest.values['0,0,15'] = [58]; });
  await page.locator('#device-settings-open').click();
  await dialog(page).getByRole('button', { name: 'Read settings' }).click();
  await expect(dialog(page).locator('#device-settings-status')).toContainText('Read complete');
  await expect(page.locator('#pitch-range-value')).toHaveText('6');
  expect(await writes(page)).toEqual([]);
});

test('a missing pitch read does not prompt or restore a legacy saved range', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('refaceCS.preferences.v1', JSON.stringify({ pitchRange: 7 })));
  await page.reload();
  await page.evaluate(() => { delete window.deviceTest.values['0,0,15']; });
  await page.locator('#midi-connect').click();
  await expect(page.locator('#device-settings-status')).toContainText('Read complete');
  await expect(page.locator('#pitch-range-value')).toHaveText('12');
  await expect(page.locator('#device-panel-status')).toContainText('no response');
  await expect(page.getByRole('dialog', { name: 'Restore pitch-bend range' })).toHaveCount(0);
  expect(await writes(page)).toEqual([]);
});

test('a direction read applies the adjustment to the actual device range', async ({ page }) => {
  await page.evaluate(() => { delete window.deviceTest.values['0,0,15']; });
  await page.locator('#device-settings-open').click();
  await dialog(page).getByRole('button', { name: 'Read settings' }).click();
  await expect(dialog(page).locator('#device-settings-status')).toContainText('Read complete');
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await page.evaluate(() => { window.deviceTest.values['0,0,15'] = [60]; });
  await page.locator('#pitch-range-up').click();
  await page.getByRole('dialog', { name: 'Pitch-bend direction unknown' }).getByRole('button', { name: 'Read direction' }).click();
  await expect.poll(() => writes(page)).toContainEqual([0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 15, 59, 0xf7]);
  await expect(page.locator('#pitch-range-value')).toHaveText('5');
});

test('a zero direction read updates the display even if the change is cancelled', async ({ page }) => {
  await page.evaluate(() => { delete window.deviceTest.values['0,0,15']; });
  await page.locator('#device-settings-open').click();
  await dialog(page).getByRole('button', { name: 'Read settings' }).click();
  await expect(dialog(page).locator('#device-settings-status')).toContainText('Read complete');
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await page.evaluate(() => { window.deviceTest.values['0,0,15'] = [64]; });
  await page.locator('#pitch-range-up').click();
  await page.getByRole('dialog', { name: 'Pitch-bend direction unknown' }).getByRole('button', { name: 'Read direction' }).click();
  const choice = page.getByRole('dialog', { name: 'Choose pitch-bend direction' });
  await expect(choice).toBeVisible();
  await choice.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#pitch-range-value')).toHaveText('0');
  expect(await writes(page)).toEqual([]);
});

test('failed writes remain pending and are reported', async ({ page }) => {
  await page.locator('#device-settings-open').click();
  const settings = dialog(page);
  await settings.getByLabel('Speaker output').selectOption('0');
  await page.evaluate(() => { window.deviceTest.failWrites = true; });
  await settings.getByRole('button', { name: 'Apply changes' }).click();
  await expect(settings.locator('#device-settings-status')).toContainText('failed or could not be confirmed');
  await expect(settings.getByRole('row', { name: /Speaker output/ })).toContainText('failed');
  await expect(settings.getByLabel('Speaker output')).toHaveValue('0');
});

test('panel controls cycle, offer keyboard menus, and preserve dialog drafts', async ({ page }) => {
  const receive = page.locator('#device-midi-receive');
  await expect(receive).toHaveAttribute('data-value', '16');
  await page.locator('#device-settings-open').click();
  await dialog(page).getByLabel('Speaker output').selectOption('0');
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await page.locator('#device-speaker-output').click();
  await expect(page.locator('#device-speaker-output')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#device-speaker-output')).toHaveAttribute('data-confidence', 'confirmed');
  await page.locator('#device-settings-open').click();
  await expect(dialog(page).getByLabel('Speaker output')).toHaveValue('0');
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await receive.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('menu', { name: 'Receive channel choices' }).getByRole('menuitemradio', { name: '16', exact: true }).click();
  await expect(receive).toHaveAttribute('data-value', '15');
  await receive.click();
  await expect(receive).toHaveAttribute('data-value', '16');
  await receive.click();
  await expect(receive).toHaveAttribute('data-value', '0');
});

test('receive changes release old notes and immediately route all outgoing channel messages', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    window.deviceTest.sent.length = 0;
    window.deviceTest.emit([0x92, 65, 90]);
    window.deviceTest.noReplies = true;
  });
  const receive = page.locator('#device-midi-receive');
  await receive.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Receive channel choices' }).getByRole('menuitemradio', { name: '2', exact: true }).click();
  await expect.poll(() => writes(page)).toContainEqual([0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 1, 1, 0xf7]);
  await page.evaluate(() => {
    window.deviceTest.emit([0x92, 66, 91]);
    window.deviceTest.emit([0x82, 66, 0]);
    window.deviceTest.emit([0xb2, 74, 55]);
    window.deviceTest.emit([0xe2, 0, 64]);
  });
  await page.locator('#filter-cutoff').press('End');
  await expect(receive).toHaveAttribute('data-confidence', 'unconfirmed');
  const messages = await page.evaluate(() => window.deviceTest.sent);
  const change = messages.findIndex((data) => data[0] === 0xf0 && data[2] === 0x10);
  expect(messages.slice(0, change)).toContainEqual([0x82, 65, 0]);
  expect(messages).toContainEqual([0x91, 66, 91]);
  expect(messages).toContainEqual([0x81, 66, 0]);
  expect(messages).toContainEqual([0xb1, 74, 55]);
  expect(messages).toContainEqual([0xe1, 0, 64]);
  expect(messages).toContainEqual([0xb1, 74, 0]);
  await expect(page.locator('#device-panel-status')).toContainText('unconfirmed');
  await page.evaluate(() => { window.deviceTest.noReplies = false; });
  await receive.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Receive channel choices' }).getByRole('menuitemradio', { name: 'All' }).click();
  await expect(receive).toHaveAttribute('data-confidence', 'confirmed');
  await page.evaluate(() => window.deviceTest.emit([0x92, 67, 90]));
  expect(await page.evaluate(() => window.deviceTest.sent)).toContainEqual([0x92, 67, 90]);
});

test('failed panel writes do not change state or routing', async ({ page }) => {
  await page.evaluate(() => { window.deviceTest.failWrites = true; });
  await page.locator('#device-midi-receive').click();
  await expect(page.locator('#device-panel-status')).toContainText('failed');
  await expect(page.locator('#device-midi-receive')).toHaveAttribute('data-value', '16');
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.deviceTest.emit([0x92, 65, 90]));
  expect(await page.evaluate(() => window.deviceTest.sent)).toContainEqual([0x92, 65, 90]);
});

test('a different receive read-back restores routing to the reported channel', async ({ page }) => {
  await page.evaluate(() => { window.deviceTest.ignoreWrites = true; });
  const receive = page.locator('#device-midi-receive');
  await receive.click();
  await expect(page.locator('#device-panel-status')).toContainText('unconfirmed');
  await expect(receive).toHaveAttribute('data-value', '16');
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.deviceTest.emit([0x92, 65, 90]));
  expect(await page.evaluate(() => window.deviceTest.sent)).toContainEqual([0x92, 65, 90]);
});

test('missing replies leave assumed values visible and first switch click sends Off', async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem('device-no-replies', 'true'));
  await page.reload();
  await page.locator('#midi-connect').click();
  await expect(page.locator('#device-panel-status')).toContainText('no response', { timeout: 8000 });
  await expect(page.locator('#device-panel-status')).toBeVisible();
  await expect(page.locator('#midi-badge')).toHaveAttribute('title', /no response/);
  const speaker = page.locator('#device-speaker-output');
  await expect(speaker).toHaveAttribute('aria-pressed', 'true');
  await expect(speaker).toHaveAttribute('data-confidence', 'assumed');
  await speaker.click();
  await expect.poll(() => writes(page)).toContainEqual([0xf0, 0x43, 0x10, 0x7f, 0x1c, 3, 0, 0, 13, 0, 0xf7]);
  await expect(speaker).toHaveAttribute('aria-pressed', 'false');
  await expect(speaker).toHaveAttribute('data-confidence', 'unconfirmed');
});

test('SysEx denial leaves MIDI connected and controls report failures without changing assumptions', async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem('deny-device-sysex', 'true'));
  await page.reload();
  await page.locator('#midi-connect').click();
  await expect(page.locator('#device-panel-status')).toContainText('Could not read');
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.locator('#device-panel-status')).toBeVisible();
  await expect(page.locator('#midi-status')).toBeVisible();
  await expect(page.locator('#midi-badge')).toHaveAttribute('title', /Could not read/);
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
  await page.keyboard.press('a');
  expect(await page.evaluate(() => window.deviceTest.sent)).toContainEqual([0x90, 60, 100]);
  await page.locator('#device-speaker-output').click();
  await expect(page.locator('#device-panel-status')).toContainText('Could not change');
  await expect(page.locator('#device-speaker-output')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#device-speaker-output')).toHaveAttribute('data-confidence', 'assumed');
  await page.evaluate(() => sessionStorage.removeItem('deny-device-sysex'));
  await page.locator('#device-settings-open').click();
  await dialog(page).getByRole('button', { name: 'Read settings' }).click();
  await expect(page.locator('#device-panel-status')).toContainText('Device settings read complete');
  await expect(page.locator('#midi-status')).toBeHidden();
  await expect(page.locator('#device-panel-status')).toBeHidden();
  await expect(page.locator('#midi-badge')).not.toHaveAttribute('title', /permission denied/);
});

test('arpeggiator output follows a specific receive channel', async ({ page }) => {
  const receive = page.locator('#device-midi-receive');
  await receive.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Receive channel choices' }).getByRole('menuitemradio', { name: '3', exact: true }).click();
  await expect(receive).toHaveAttribute('data-confidence', 'confirmed');
  await page.evaluate(() => { window.deviceTest.sent.length = 0; });
  await page.locator('#arp-enabled').click();
  await page.keyboard.down('a');
  await expect.poll(() => page.evaluate(() => window.deviceTest.sent.some((data) => data[0] === 0x92 && data[1] === 60))).toBe(true);
  await page.keyboard.up('a');
});

test('device dialog fits a small viewport and keeps its bottom actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await page.locator('#device-settings-open').click();
  const settings = dialog(page);
  expect(await settings.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(450);
  const close = settings.getByRole('button', { name: 'Close' });
  await expect(close).toBeInViewport();
  await close.click();
  await expect(settings).not.toBeVisible();
});

test('panel labels are inline and view controls stay left without overlapping', async ({ page }) => {
  for (const id of ['midi-transmit', 'midi-receive', 'local-control', 'speaker-output']) {
    const control = page.locator(`#device-${id}`);
    const label = await control.locator('.device-label').boundingBox();
    const widget = await control.locator(id.startsWith('midi-') ? 'rect[rx]' : '.arp-bezel').boundingBox();
    expect(label.x + label.width).toBeLessThan(widget.x);
    expect(label.y).toBeLessThan(widget.y + widget.height);
    expect(label.y + label.height).toBeGreaterThan(widget.y);
  }
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    for (const compact of [false, true]) {
      if (compact) await page.locator('#hide-speakers').click();
      const toggles = await page.locator('#visual-toggles').boundingBox();
      const panel = await page.locator('#device-midi-transmit').boundingBox();
      const synth = await page.locator('#synth svg').boundingBox();
      expect(toggles.x).toBeLessThan(panel.x);
      expect(toggles.x + toggles.width).toBeLessThanOrEqual(panel.x);
      expect(toggles.y).toBeGreaterThanOrEqual(synth.y);
      if (compact) await page.locator('#hide-speakers').click();
    }
  }
});

test('loop playback routes to receive channel and retains source channel when returned to All', async ({ page }) => {
  const phrase = writeMidi([{ start: 0.25, playDuration: 0.5, channel: 2, pitch: 65, velocity: 79 }], 4, 120, 4);
  await page.locator('#looper-file').setInputFiles({ name: 'routing.mid', mimeType: 'audio/midi', buffer: Buffer.from(phrase) });
  await expect(page.locator('#looper-status')).toContainText('Loaded routing.mid');
  await page.locator('#device-midi-receive').click();
  await expect(page.locator('#device-midi-receive')).toHaveAttribute('data-value', '0');
  await page.evaluate(() => { window.deviceTest.sent.length = 0; });
  await page.locator('#looper .position-label[data-step="2"]').click();
  await expect.poll(() => page.evaluate(() => window.deviceTest.sent)).toContainEqual([0x90, 65, 79]);
  await page.locator('#device-midi-receive').click({ button: 'right' });
  await page.getByRole('menu', { name: 'Receive channel choices' }).getByRole('menuitemradio', { name: 'All' }).click();
  await expect(page.locator('#looper')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#device-midi-receive')).toHaveAttribute('data-value', '16');
  await page.evaluate(() => { window.deviceTest.sent.length = 0; });
  await page.locator('#looper .position-label[data-step="2"]').click();
  await expect.poll(() => page.evaluate(() => window.deviceTest.sent)).toContainEqual([0x92, 65, 79]);
});

test('zero range has no confirmed direction and requires a fresh choice', async ({ page }) => {
  await page.locator('#device-settings-open').click();
  const settings = dialog(page);
  await settings.getByRole('button', { name: 'Read settings' }).click();
  await expect(settings.locator('#device-settings-status')).toContainText('Read complete');
  await settings.getByLabel('Pitch-bend range (semitones)').fill('0');
  await settings.getByRole('button', { name: 'Apply changes' }).click();
  await expect(settings.locator('#device-settings-status')).toHaveText('Changes confirmed by the synth.');
  await expect(settings.getByRole('row', { name: /Pitch-bend direction/ })).toContainText('No direction at zero');
  await settings.getByRole('button', { name: 'Close' }).click();
  await page.locator('#pitch-range-up').click();
  await page.getByRole('dialog', { name: 'Pitch-bend direction unknown' }).getByRole('button', { name: 'Read direction' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose pitch-bend direction' })).toBeVisible();
});

test('master tune and pitch range validate MIDI encodings', () => {
  expect(encodeParameter('master-tune', -102.4).data).toEqual([0, 0, 0, 0]);
  expect(encodeParameter('master-tune', 102.3).data).toEqual([0, 7, 15, 15]);
  expect(decodeParameter([0, 0, 2], [0, 3, 15, 4]).value).toBe(-1.2);
  expect(decodeParameter([0, 0, 15], [40]).value).toBe(-24);
  expect(decodeParameter([0, 0, 2], [0, 8, 0, 0])).toBeNull();
  expect(encodeParameter('pitch-range', -25)).toBeNull();
});
