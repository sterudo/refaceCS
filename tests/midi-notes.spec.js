import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const access = new EventTarget();
    const input = (id, name) => Object.assign(new EventTarget(), { id, name, state: 'connected' });
    const sent = [];
    const output = (id, name) => ({
      id, name, state: 'connected',
      send(data) { sent.push({ port: id, data: [...data] }); },
    });
    const reface = input('ri', 'reface CS');
    const controller = input('ci', 'External controller');
    access.inputs = new Map([[reface.id, reface], [controller.id, controller]]);
    access.outputs = new Map([
      ['ro', output('ro', 'reface CS')], ['other', output('other', 'Other output')],
    ]);
    window.testNotes = {
      access, sent,
      emit(id, data) {
        const event = new Event('midimessage');
        event.data = new Uint8Array(data);
        access.inputs.get(id).dispatchEvent(event);
      },
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
  });
  await page.goto('/static/reface/');
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
});

test('local notes use channel one, honor pitch controls, and release on blur', async ({ page }) => {
  await page.keyboard.down('a');
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('a');
  await page.locator('#transpose').press('ArrowUp');
  await page.keyboard.down('a');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0x90, 60, 100] }, { port: 'ro', data: [0x80, 60, 0] },
    { port: 'ro', data: [0x90, 61, 100] }, { port: 'ro', data: [0x80, 61, 0] },
  ]);
});

test('transposed held notes retain their original note-off pitches', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#transpose').press('ArrowUp');
  await page.keyboard.down('a');
  await page.evaluate(() => window.testNotes.emit('ci', [0x92, 60, 88]));
  await page.locator('#transpose').press('ArrowUp');
  await page.evaluate(() => window.testNotes.emit('ci', [0x92, 60, 99]));
  await page.keyboard.up('a');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0x82, 60, 17]);
    window.testNotes.emit('ci', [0x92, 60, 0]);
  });
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0x90, 61, 100] }, { port: 'ro', data: [0x92, 61, 88] },
    { port: 'ro', data: [0x92, 62, 99] }, { port: 'ro', data: [0x80, 61, 0] },
    { port: 'ro', data: [0x82, 61, 17] }, { port: 'ro', data: [0x92, 62, 0] },
  ]);
});

test('notes shifted outside the MIDI range are reported and not sent', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#transpose').press('ArrowDown');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0x90, 0, 100]);
    window.testNotes.emit('ci', [0x80, 0, 0]);
  });
  await expect(page.locator('#midi-status')).toContainText('outside the MIDI range');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
});

test('receives both inputs and forwards controller notes and CCs', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    window.testNotes.emit('ri', [0x90, 60, 90]);
    window.testNotes.emit('ci', [0x92, 60, 88]);
    window.testNotes.emit('ci', [0xb2, 74, 100]);
    window.testNotes.emit('ri', [0x80, 60, 0]);
  });
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.testNotes.emit('ci', [0x92, 60, 0]));
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0x92, 60, 88] }, { port: 'ro', data: [0xb2, 74, 100] },
    { port: 'ro', data: [0x92, 60, 0] },
  ]);
});

test('forwards controller pitch bend and CCs on their channels and mirrors supported controls', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await expect(page.locator('#midi-modwheel-target')).toHaveValue('74');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 1, 53]);
    window.testNotes.emit('ci', [0xb5, 64, 127]);
    window.testNotes.emit('ci', [0xb7, 99, 35]);
    window.testNotes.emit('ci', [0xb2, 80, 127]);
    window.testNotes.emit('ci', [0xe3, 127, 127]);
  });
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0xb2, 74, 53] }, { port: 'ro', data: [0xb5, 64, 127] },
    { port: 'ro', data: [0xb7, 99, 35] }, { port: 'ro', data: [0xb2, 80, 127] },
    { port: 'ro', data: [0xe3, 127, 127] },
  ]);
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '53');
  await expect(page.locator('#osc-type')).toHaveAttribute('aria-valuenow', '4');
  await expect(page.locator('#pitch-bend')).toHaveAttribute('aria-valuenow', '127');
});

test('modulation slider follows wheel, synth, controller and panel without echoing', async ({ page }) => {
  const slider = page.locator('#midi-modwheel-value');
  await expect(slider).toHaveValue('127');
  await expect(page.locator('#midi-modwheel-readout')).toHaveText('127');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 1, 53]));
  await expect(slider).toHaveValue('53');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '53');
  await page.evaluate(() => window.testNotes.emit('ri', [0xb0, 74, 42]));
  await expect(slider).toHaveValue('42');
  await expect(page.locator('#midi-modwheel-readout')).toHaveText('42');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb5, 74, 69]));
  await expect(slider).toHaveValue('69');
  await page.locator('#filter-cutoff').press('End');
  await expect(slider).toHaveValue('0');
  await slider.press('ArrowRight');
  await expect(slider).toHaveValue('1');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '1');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0xb2, 74, 53] }, { port: 'ro', data: [0xb5, 74, 69] },
    { port: 'ro', data: [0xb0, 74, 0] }, { port: 'ro', data: [0xb0, 74, 1] },
  ]);
});

test('modulation slider restores known CC values, retains unknown values, and sends selected CC on channel 1', async ({ page }) => {
  const slider = page.locator('#midi-modwheel-value');
  const select = page.locator('#midi-modwheel-target');
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    window.testNotes.emit('ri', [0xb3, 99, 33]);
    window.testNotes.emit('ci', [0xb4, 1, 70]);
  });
  await select.selectOption('99');
  await expect(slider).toHaveValue('33');
  await expect(slider).toHaveAttribute('aria-label', 'Modulation wheel value, CC 99');
  await page.evaluate(() => window.testNotes.emit('ri', [0xb3, 99, 44]));
  await expect(slider).toHaveValue('44');
  await select.selectOption('98');
  await expect(slider).toHaveValue('44');
  await slider.evaluate((element) => {
    element.value = '85';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#midi-modwheel-readout')).toHaveText('85');
  await select.selectOption('74');
  await expect(slider).toHaveValue('70');
  await select.selectOption('1');
  await expect(slider).toHaveValue('70');
  await slider.evaluate((element) => {
    element.value = '23';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0xb4, 74, 70] },
    { port: 'ro', data: [0xb0, 98, 85] }, { port: 'ro', data: [0xb0, 1, 23] },
  ]);
});

test('modulation slider preserves raw CC values for discrete synth controls', async ({ page }) => {
  await page.locator('#midi-modwheel-target').selectOption('80');
  const slider = page.locator('#midi-modwheel-value');
  await slider.evaluate((element) => {
    element.value = '35';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#osc-type')).toHaveAttribute('aria-valuenow', '1');
  await expect(slider).toHaveValue('35');
  await page.locator('#osc-type').press('ArrowUp');
  await expect(slider).toHaveValue('64');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0xb0, 80, 35] }, { port: 'ro', data: [0xb0, 80, 64] },
  ]);
});

test('modulation slider reports unavailable output and still updates supported panel controls', async ({ page }) => {
  await page.locator('#midi-reface-output').selectOption('');
  await page.locator('#midi-modwheel-value').press('ArrowLeft');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '126');
  await expect(page.locator('#midi-status')).toContainText('MIDI output unavailable');
});

test('slider-controlled sustain survives controller changes and is released by MIDI Reset', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#midi-modwheel-target').selectOption('64');
  const slider = page.locator('#midi-modwheel-value');
  await slider.press('Home');
  await page.evaluate(() => { window.testNotes.sent.length = 0; });
  await slider.press('End');
  await page.locator('#midi-controller-input').selectOption('ri');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([{ port: 'ro', data: [0xb0, 64, 127] }]);
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  await expect(slider).toHaveValue('0');
  const messages = await page.evaluate(() => window.testNotes.sent);
  expect(messages[1]).toEqual({ port: 'ro', data: [0xb0, 64, 0] });
});

test('remaps the modulation wheel, supports passthrough, and remembers the selection', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#midi-modwheel-target').selectOption('71');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb1, 1, 52]));
  await expect(page.locator('#filter-resonance')).toHaveAttribute('aria-valuenow', '52');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([{ port: 'ro', data: [0xb1, 71, 52] }]);
  await page.reload();
  await expect(page.locator('#midi-modwheel-target')).toHaveValue('71');
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#midi-modwheel-target').selectOption('1');
  await page.evaluate(() => window.testNotes.emit('ci', [0xbf, 1, 89]));
  await page.locator('#midi-modwheel-target').selectOption('0');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb3, 1, 12]));
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0xbf, 1, 89] }, { port: 'ro', data: [0xb3, 0, 12] },
  ]);
  await page.reload();
  await expect(page.locator('#midi-modwheel-target')).toHaveValue('0');
});

test('reports mapping persistence failures while retaining the selected mapping', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
  });
  await page.locator('#midi-modwheel-target').selectOption('99');
  await expect(page.locator('#midi-mapping-status')).toContainText('storage blocked');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 1, 63]));
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([{ port: 'ro', data: [0xb2, 99, 63] }]);
});

test('reports invalid saved mappings and unavailable browser storage', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('refaceCS.modwheelCC', 'invalid'));
  await page.reload();
  await expect(page.locator('#midi-modwheel-target')).toHaveValue('74');
  await expect(page.locator('#midi-mapping-status')).toContainText('mapping is invalid');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new Error('storage unavailable'); },
    });
  });
  await page.reload();
  await expect(page.locator('#midi-modwheel-target')).toHaveValue('74');
  await expect(page.locator('#midi-mapping-status')).toContainText('storage unavailable');
});

test('controller send failures are reported without suppressing panel updates', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    window.testNotes.access.outputs.get('ro').send = () => { throw new Error('controller output failed'); };
    window.testNotes.emit('ci', [0xb3, 1, 45]);
  });
  await expect(page.locator('#midi-status')).toContainText('controller output failed');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '45');
});

test('does not echo synth controls or forward them when synth and controller are the same port', async ({ page }) => {
  await page.evaluate(() => {
    window.testNotes.emit('ri', [0xb0, 74, 57]);
    window.testNotes.emit('ri', [0xb0, 1, 100]);
    window.testNotes.emit('ri', [0xe0, 0, 0]);
  });
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '57');
  await expect(page.locator('#pitch-bend')).toHaveAttribute('aria-valuenow', '0');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
});

test('changing a sustain mapping sends nothing and warns until sustain is released', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 64, 127]));
  await page.locator('#midi-controller-input').selectOption('ri');
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#midi-modwheel-target').selectOption('64');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb5, 1, 100]));
  await page.locator('#midi-modwheel-target').selectOption('71');
  await expect(page.locator('#midi-mapping-status')).toContainText('Sustain remains active');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0xb2, 64, 127] }, { port: 'ro', data: [0xb2, 64, 0] },
    { port: 'ro', data: [0xb5, 64, 100] },
  ]);
  await page.evaluate(() => window.testNotes.emit('ci', [0xb5, 64, 0]));
  await expect(page.locator('#midi-mapping-status')).toHaveText('');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb7, 64, 127]));
  await page.locator('#midi-reface-output').selectOption('other');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0xb2, 64, 127] }, { port: 'ro', data: [0xb2, 64, 0] },
    { port: 'ro', data: [0xb5, 64, 100] }, { port: 'ro', data: [0xb5, 64, 0] },
    { port: 'ro', data: [0xb7, 64, 127] }, { port: 'ro', data: [0xb7, 64, 0] },
  ]);
});

test('controller CC and pitch bend continue through while the arpeggiator is on', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#arp-enabled').click();
  await page.evaluate(() => {
    window.testNotes.sent.length = 0;
    window.testNotes.emit('ci', [0xb4, 1, 33]);
    window.testNotes.emit('ci', [0xe4, 12, 65]);
  });
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0xb4, 74, 33] }, { port: 'ro', data: [0xe4, 12, 65] },
  ]);
});

test('channel-mode note reset does not let stale releases silence a newer note', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0x92, 60, 90]);
    window.testNotes.emit('ci', [0xb2, 123, 0]);
    window.testNotes.emit('ci', [0x92, 60, 80]);
    window.testNotes.emit('ci', [0x82, 60, 0]);
    window.testNotes.emit('ci', [0x82, 60, 0]);
  });
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0x92, 60, 90] }, { port: 'ro', data: [0xb2, 123, 0] },
    { port: 'ro', data: [0x92, 60, 80] }, { port: 'ro', data: [0x82, 60, 0] },
  ]);
});

test('MIDI Reset releases controller sustain before resetting notes', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 64, 127]);
    window.testNotes.sent.length = 0;
  });
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  const messages = await page.evaluate(() => window.testNotes.sent);
  expect(messages).toHaveLength(33);
  expect(messages[0]).toEqual({ port: 'ro', data: [0xb2, 64, 0] });
  await expect(page.locator('#midi-status')).toContainText('MIDI reset messages sent');
});

test('keeps incoming highlights independent of local keys and pitch changes', async ({ page }) => {
  await page.evaluate(() => window.testNotes.emit('ri', [0x90, 60, 90]));
  await page.keyboard.down('a');
  await page.keyboard.up('a');
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#transpose').press('ArrowUp');
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.testNotes.emit('ri', [0x80, 60, 0]));
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'false');
});

test('releases forwarded notes when changing controller or output and clears disconnected inputs', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0x94, 64, 80]));
  await page.locator('#midi-controller-input').selectOption('ri');
  await expect(page.locator('#key-e-2')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0x94, 65, 81]));
  await page.locator('#midi-reface-output').selectOption('other');
  await page.evaluate(() => {
    window.testNotes.access.inputs.get('ci').state = 'disconnected';
    window.testNotes.access.dispatchEvent(new Event('statechange'));
  });
  await expect(page.locator('#key-f-2')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0x94, 64, 80] }, { port: 'ro', data: [0x84, 64, 0] },
    { port: 'ro', data: [0x94, 65, 81] }, { port: 'ro', data: [0x84, 65, 0] },
  ]);
});

test('surfaces output send errors', async ({ page }) => {
  await page.evaluate(() => {
    window.testNotes.access.outputs.get('ro').send = () => { throw new Error('device busy'); };
  });
  await page.keyboard.down('a');
  await expect(page.locator('#midi-status')).toContainText('MIDI send failed: device busy');
  await page.keyboard.up('a');
});

test('MIDI Reset sends both messages on every channel and clears held notes', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.down('a');
  await page.evaluate(() => {
    window.testNotes.emit('ri', [0x90, 62, 90]);
    window.testNotes.emit('ci', [0x92, 64, 88]);
    document.querySelector('#midi-reset').click();
  });
  for (const id of ['#key-c-2', '#key-d-2', '#key-e-2']) {
    await expect(page.locator(id)).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(page.locator('#midi-status')).toContainText('MIDI reset messages sent');
  await page.keyboard.up('a');
  await page.evaluate(() => {
    window.testNotes.emit('ri', [0x80, 62, 0]);
    window.testNotes.emit('ci', [0x82, 64, 0]);
  });
  const expectedReset = Array.from({ length: 16 }, (_, channel) => [
    { port: 'ro', data: [0xb0 | channel, 123, 0] },
    { port: 'ro', data: [0xb0 | channel, 120, 0] },
  ]).flat();
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0x90, 60, 100] },
    { port: 'ro', data: [0x92, 64, 88] },
    ...expectedReset,
  ]);
  await page.keyboard.down('a');
  await expect(page.locator('#key-c-2')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('a');
});

test('MIDI Reset reports partial send failures and still tries every message', async ({ page }) => {
  await page.evaluate(() => {
    const port = window.testNotes.access.outputs.get('ro');
    let attempts = 0;
    port.send = () => {
      attempts++;
      window.testNotes.attempts = attempts;
      if (attempts === 3) throw new Error('device busy');
    };
  });
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  await expect(page.locator('#midi-status')).toContainText('1 of 32 messages');
  await expect(page.locator('#midi-status')).toContainText('device busy');
  expect(await page.evaluate(() => window.testNotes.attempts)).toBe(32);
  await page.evaluate(() => {
    window.testNotes.access.outputs.get('ro').send = () => {};
  });
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  await expect(page.locator('#midi-status')).toContainText('MIDI reset messages sent');
});

test('MIDI Reset reports an unavailable output', async ({ page }) => {
  await page.locator('#midi-reface-output').selectOption('');
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  await expect(page.locator('#midi-status')).toContainText('MIDI output unavailable');
});
