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

async function learnFader(page, target, cc, { channel = 2, initial = 0, key = 'Home' } = {}) {
  await page.locator('#midi-controller-input').selectOption('ci');
  if (await page.locator('#midi-learn').getAttribute('aria-pressed') === 'false') {
    await page.locator('#midi-learn').click();
  }
  await page.locator(`#${target}`).press(key);
  await expect(page.locator(`#${target}`)).toHaveClass(/is-midi-learn-target/);
  await page.evaluate(({ cc, channel, initial }) => {
    window.testNotes.sent.length = 0;
    window.testNotes.emit('ci', [0xb0 | channel, cc, initial]);
  }, { cc, channel, initial });
  await expect(page.locator('.message-entry[data-source="midi-learn-status"] .message-text').last()).toContainText(`CC ${cc}, channel ${channel + 1} assigned`);
}

test('MIDI Learn selects only on-screen faders, consumes assignment CCs and repeats until disabled', async ({ page }) => {
  await expect(page.locator('#midi-learn')).toBeDisabled();
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#midi-learn').click();
  await page.evaluate(() => window.testNotes.emit('ri', [0xb0, 74, 80]));
  await expect(page.locator('#midi-learn-assignments option')).toHaveText('No learned assignments');
  await page.locator('#filter-cutoff .hit-area').click({ position: { x: 10, y: 15 } });
  const targetValue = await page.locator('#filter-cutoff').getAttribute('aria-valuenow');
  await page.evaluate(() => window.testNotes.emit('ri', [0xb0, 71, 23]));
  await expect(page.locator('#filter-cutoff')).toHaveClass(/is-midi-learn-target/);
  await page.evaluate(() => {
    window.testNotes.sent.length = 0;
    window.testNotes.emit('ci', [0xb2, 21, 0]);
  });
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', targetValue);
  await expect(page.locator('#filter-cutoff')).not.toHaveClass(/is-midi-learn-target/);
  await expect(page.locator('#midi-learn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#midi-learn').click();
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 21, 100]);
    window.testNotes.emit('ci', [0xb2, 21, 127]);
    window.testNotes.emit('ci', [0xb2, 21, 55]);
  });
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toEqual([
    [0xb2, 74, 127], [0xb2, 74, 55],
  ]);
  await learnFader(page, 'filter-resonance', 22);
  await expect(page.locator('#midi-learn-assignments option')).toHaveCount(2);
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
});

test('MIDI Learn pickup re-arms after other edits and detects crossing without requiring an exact CC', async ({ page }) => {
  await learnFader(page, 'filter-cutoff', 21);
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 21, 127]);
    window.testNotes.emit('ci', [0xb2, 21, 30]);
    window.testNotes.emit('ri', [0xb0, 74, 70]);
    window.testNotes.sent.length = 0;
    window.testNotes.emit('ci', [0xb2, 21, 50]);
  });
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '70');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 21, 80]);
    window.testNotes.emit('ci', [0xb2, 21, 90]);
  });
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '90');
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toEqual([
    [0xb2, 74, 80], [0xb2, 74, 90],
  ]);
  await page.locator('#midi-learn').click();
  await page.locator('#filter-cutoff').press('End');
  await page.evaluate(() => {
    window.testNotes.sent.length = 0;
    window.testNotes.emit('ci', [0xb2, 21, 60]);
  });
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 21, 0]));
  expect(await page.evaluate(() => window.testNotes.sent.at(-1).data)).toEqual([0xb2, 74, 0]);
});

test('MIDI Learn pickup re-arms on an actual patch recall', async ({ page }) => {
  await page.locator('#filter-cutoff').press('End');
  await page.locator('#patch-save-display').click();
  await page.locator('#patch-name').fill('Closed filter');
  await page.locator('#patch-editor-form button[type="submit"]').click();
  await learnFader(page, 'filter-cutoff', 21);
  await page.locator('#midi-learn').click();
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 21, 127]));
  await page.locator('#footer-panel').first().locator('summary').click();
  await page.locator('.patch-card').filter({ has: page.getByRole('heading', { name: 'Closed filter' }) })
    .getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByRole('dialog', { name: 'Unsaved sound' })
    .getByRole('button', { name: /Discard/ }).click();
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
  await page.evaluate(() => {
    window.testNotes.sent.length = 0;
    window.testNotes.emit('ci', [0xb2, 21, 60]);
  });
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 21, 0]);
    window.testNotes.emit('ci', [0xb2, 21, 20]);
  });
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '20');
});

test('MIDI Learn replaces duplicate sources, maps the wheel only on its learned channel, and clears back to CC 1', async ({ page }) => {
  await learnFader(page, 'filter-cutoff', 1);
  await learnFader(page, 'filter-resonance', 1, { key: 'End' });
  await expect(page.locator('#midi-learn-assignments option')).toHaveCount(1);
  await expect(page.locator('#midi-learn-assignments option')).toHaveText('Ch 3, CC 1 -> Filter resonance');
  await page.locator('#midi-learn').click();
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb3, 1, 25]);
    window.testNotes.emit('ci', [0xb2, 1, 0]);
    window.testNotes.emit('ci', [0xb2, 1, 44]);
  });
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toEqual([
    [0xb3, 1, 25], [0xb2, 71, 0], [0xb2, 71, 44],
  ]);
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
  await page.locator('#midi-learn-clear').click();
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 1, 77]));
  await expect(page.locator('#midi-modwheel-value')).toHaveValue('77');
  await expect(page.locator('#filter-resonance')).toHaveAttribute('aria-valuenow', '44');
  expect(await page.evaluate(() => window.testNotes.sent.at(-1).data)).toEqual([0xb2, 1, 77]);
  await expect(page.locator('#midi-learn-clear')).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await expect(page.locator('#midi-learn-assignments option')).toHaveText('No learned assignments');
});

test('MIDI Learn persists per controller, resets pickup on reconnect, and never restores learning mode', async ({ page }) => {
  await learnFader(page, 'filter-cutoff', 21);
  await page.reload();
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await expect(page.locator('#midi-learn')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#midi-learn-assignments option')).toHaveText('Ch 3, CC 21 -> Filter cutoff');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 21, 40]);
    const second = Object.assign(new EventTarget(), { id: 'ci2', name: 'Second controller', state: 'connected' });
    window.testNotes.access.inputs.set(second.id, second);
    window.testNotes.access.dispatchEvent(new Event('statechange'));
  });
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
  await page.locator('#midi-controller-input').selectOption('ci2');
  await page.evaluate(() => window.testNotes.emit('ci2', [0xb2, 21, 33]));
  expect(await page.evaluate(() => window.testNotes.sent.at(-1).data)).toEqual([0xb2, 21, 33]);
  await expect(page.locator('#midi-learn-assignments option')).toHaveText('No learned assignments');
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 21, 127]);
    window.testNotes.access.inputs.get('ci').state = 'disconnected';
    window.testNotes.access.dispatchEvent(new Event('statechange'));
  });
  await expect(page.locator('#midi-learn')).toBeDisabled();
  await page.evaluate(() => {
    window.testNotes.access.inputs.get('ci').state = 'connected';
    window.testNotes.access.dispatchEvent(new Event('statechange'));
    window.testNotes.sent.length = 0;
    window.testNotes.emit('ci', [0xb2, 21, 30]);
  });
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
  await page.locator('#midi-controller-input').selectOption('ri');
  await expect(page.locator('#midi-learn')).toBeDisabled();
});

test('MIDI Learn scales selectors, pitch bend, signed transpose and tempo through the existing control paths', async ({ page }) => {
  await learnFader(page, 'effect-type', 21);
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 21, 127]);
    window.testNotes.emit('ci', [0xb2, 21, 64]);
  });
  await expect(page.locator('#effect-type')).toHaveAttribute('aria-valuenow', '2');
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toEqual([
    [0xb2, 17, 0], [0xb2, 17, 64],
  ]);
  await learnFader(page, 'pitch-bend', 22, { key: 'End' });
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 22, 0]);
    window.testNotes.emit('ci', [0xb2, 22, 64]);
  });
  expect(await page.evaluate(() => window.testNotes.sent.at(-1).data)).toEqual([0xe2, 0, 64]);
  await page.evaluate(() => { window.testNotes.access.sysexEnabled = true; });
  await learnFader(page, 'transpose', 23, { key: 'End' });
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 23, 0]);
    window.testNotes.emit('ci', [0xb2, 23, 64]);
  });
  await expect(page.locator('#transpose')).toHaveAttribute('aria-valuenow', '0');
  await expect.poll(() => page.evaluate(() => window.testNotes.sent.at(-1).data)).toEqual([
    0xf0, 0x43, 0x10, 0x7f, 0x1c, 0x03, 0, 0, 7, 64, 0xf7,
  ]);
  await learnFader(page, 'tempo', 24, { initial: 127 });
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 24, 127]);
    window.testNotes.emit('ci', [0xb2, 24, 64]);
  });
  await expect(page.locator('#tempo')).toHaveAttribute('aria-valuenow', '141');
  await expect.poll(() => page.evaluate(() => window.testNotes.sent.at(-1).data)).toEqual([
    0xf0, 0x43, 0x10, 0x7f, 0x1c, 0x03, 0, 0, 8, 1, 13, 0xf7,
  ]);
});

test('MIDI Learn accepts channel-10 CCs without consuming drum notes or channel-mode messages', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#midi-learn').click();
  await page.locator('#filter-cutoff').press('Home');
  await page.evaluate(() => {
    window.testNotes.sent.length = 0;
    window.testNotes.emit('ci', [0xb2, 123, 0]);
  });
  await expect(page.locator('.message-entry[data-source="midi-learn-status"] .message-text').last()).toContainText('cannot be learned');
  await expect(page.locator('#filter-cutoff')).toHaveClass(/is-midi-learn-target/);
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb9, 21, 0]);
    window.testNotes.emit('ci', [0xb9, 21, 127]);
  });
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toEqual([
    [0xb2, 123, 0], [0xb9, 74, 127],
  ]);
  await page.locator('#midi-learn').click();
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0x92, 60, 90]);
    window.testNotes.emit('ci', [0x82, 60, 0]);
    window.testNotes.emit('ci', [0xb2, 123, 0]);
  });
  expect(await page.evaluate(() => window.testNotes.sent.slice(-3).map((event) => event.data))).toEqual([
    [0x92, 60, 90], [0x82, 60, 0], [0xb2, 123, 0],
  ]);
});

test('MIDI Learn applies local octave changes and the looper Stop action, not just outgoing CCs', async ({ page }) => {
  await learnFader(page, 'octave', 21, { key: 'End' });
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 21, 0]);
    window.testNotes.emit('ci', [0xb2, 21, 127]);
  });
  await expect(page.locator('#octave')).toHaveAttribute('aria-valuenow', '4');
  await page.keyboard.down('a');
  await page.keyboard.up('a');
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toEqual([
    [0x90, 84, 100], [0x80, 84, 0],
  ]);
  await learnFader(page, 'looper', 22, { key: 'End' });
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 22, 0]));
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('MIDI reset messages sent');
  expect(await page.evaluate(() => window.testNotes.sent.length)).toBe(48);
  expect(await page.evaluate(() => window.testNotes.sent.at(-1).data)).toEqual([0xbf, 120, 0]);
});

test('MIDI Learn releases sustain held by a control before its assignment replaces forwarding', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 64, 127]));
  await learnFader(page, 'filter-cutoff', 64);
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toEqual([[0xb2, 64, 0]]);
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 64, 127]);
    window.testNotes.emit('ci', [0xb2, 64, 50]);
  });
  expect(await page.evaluate(() => window.testNotes.sent.slice(-2).map((event) => event.data))).toEqual([
    [0xb2, 74, 127], [0xb2, 74, 50],
  ]);
});

test('MIDI Learn reports persistence and MIDI send failures without losing the live mapping', async ({ page }) => {
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
  });
  await learnFader(page, 'filter-cutoff', 21);
  await expect(page.locator('.message-entry[data-source="preferences-status"] .message-text').last()).toContainText('storage blocked');
  await page.evaluate(() => {
    window.testNotes.access.outputs.get('ro').send = () => { throw new Error('learned send failed'); };
    window.testNotes.emit('ci', [0xb2, 21, 127]);
    window.testNotes.emit('ci', [0xb2, 21, 55]);
  });
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '55');
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('learned send failed');
});

test('MIDI Learn reports invalid saved bindings instead of installing them', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('refaceCS.preferences.v1', JSON.stringify({
    midiLearn: [{ port: 'ci', channel: 2, cc: 21, target: 'nonexistent' }],
  })));
  await page.reload();
  await expect(page.locator('.message-entry[data-source="midi-learn-status"] .message-text').last()).toContainText('Invalid saved MIDI Learn assignments');
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 21, 55]));
  expect(await page.evaluate(() => window.testNotes.sent.at(-1).data)).toEqual([0xb2, 21, 55]);
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

test('overlapping local and controller notes retrigger cleanly without stacking or stale releases', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.down('a');
  await page.evaluate(() => window.testNotes.emit('ci', [0x90, 60, 90]));
  await page.keyboard.up('a');
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toEqual([
    [0x90, 60, 100], [0x80, 60, 0], [0x90, 60, 90],
  ]);
  await page.evaluate(() => window.testNotes.emit('ci', [0x80, 60, 0]));
  expect(await page.evaluate(() => window.testNotes.sent.at(-1).data)).toEqual([0x80, 60, 0]);
});

test('repeated controller Note Ons cannot leave stacked notes after their releases', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0x93, 60, 90]);
    window.testNotes.emit('ci', [0x93, 60, 80]);
    window.testNotes.emit('ci', [0x83, 60, 0]);
  });
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toEqual([
    [0x93, 60, 90], [0x83, 60, 0], [0x93, 60, 80],
  ]);
  await page.evaluate(() => window.testNotes.emit('ci', [0x83, 60, 0]));
  expect(await page.evaluate(() => window.testNotes.sent.at(-1).data)).toEqual([0x83, 60, 0]);
});

test('notes shifted outside the MIDI range are reported and not sent', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.locator('#transpose').press('ArrowDown');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0x90, 0, 100]);
    window.testNotes.emit('ci', [0x80, 0, 0]);
  });
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('outside the MIDI range');
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
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0xb2, 1, 53]);
    window.testNotes.emit('ci', [0xb5, 64, 127]);
    window.testNotes.emit('ci', [0xb7, 99, 35]);
    window.testNotes.emit('ci', [0xb2, 80, 127]);
    window.testNotes.emit('ci', [0xe3, 127, 127]);
  });
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0xb2, 1, 53] }, { port: 'ro', data: [0xb5, 64, 127] },
    { port: 'ro', data: [0xb7, 99, 35] }, { port: 'ro', data: [0xb2, 80, 127] },
    { port: 'ro', data: [0xe3, 127, 127] },
  ]);
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
  await expect(page.locator('#osc-type')).toHaveAttribute('aria-valuenow', '4');
  await expect(page.locator('#pitch-bend')).toHaveAttribute('aria-valuenow', '127');
});

test('MIDI controls align in one compact row and reuse top toolbar button and select styling', async ({ page }) => {
  const controls = page.locator('.midi-learn-controls');
  await expect(page.getByLabel('Assignments', { exact: true })).toHaveAttribute('id', 'midi-learn-assignments');
  await expect(page.locator('#midi-modwheel-target')).toHaveCount(0);
  const button = page.locator('#midi-reset');
  for (const id of ['midi-learn', 'midi-learn-clear']) {
    for (const property of ['padding', 'font-size']) {
      await expect(page.locator(`#${id}`)).toHaveCSS(property, await button.evaluate(
        (element, name) => getComputedStyle(element).getPropertyValue(name), property));
    }
  }
  for (const property of ['padding', 'border-radius', 'background-color', 'color', 'font-size']) {
    const expected = await page.locator('#midi-controller-input').evaluate(
      (element, name) => getComputedStyle(element).getPropertyValue(name), property);
    await expect(page.locator('#midi-learn-assignments')).toHaveCSS(property, expected);
  }
  const boxes = await controls.locator(':scope > button, :scope > label').evaluateAll(
    (elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, right: box.right, center: box.y + box.height / 2 };
    }));
  for (let index = 1; index < boxes.length; index++) {
    expect(boxes[index].center).toBeCloseTo(boxes[0].center, 1);
    expect(boxes[index].x - boxes[index - 1].right).toBeCloseTo(8, 1);
  }
  await page.setViewportSize({ width: 360, height: 900 });
  const bounds = await controls.boundingBox();
  for (const element of await controls.locator(':scope > button, :scope > label').all()) {
    const box = await element.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
});

test('modulation value sends standard CC 1 and follows only incoming CC 1 without echoing', async ({ page }) => {
  const slider = page.locator('#midi-modwheel-value');
  await expect(slider).toHaveValue('0');
  await expect(page.locator('#midi-modwheel-readout')).toHaveText('0');
  await expect(slider).toHaveAttribute('aria-label', 'Modulation wheel value, CC 1');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([]);
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 1, 53]));
  await expect(slider).toHaveValue('53');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
  await page.evaluate(() => window.testNotes.emit('ri', [0xb0, 1, 42]));
  await expect(slider).toHaveValue('42');
  await expect(page.locator('#midi-modwheel-readout')).toHaveText('42');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb5, 74, 69]));
  await expect(slider).toHaveValue('42');
  await page.locator('#filter-cutoff').press('End');
  await expect(slider).toHaveValue('42');
  await slider.press('ArrowRight');
  await expect(slider).toHaveValue('43');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '0');
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0xb2, 1, 53] }, { port: 'ro', data: [0xb5, 74, 69] },
    { port: 'ro', data: [0xb0, 74, 0] }, { port: 'ro', data: [0xb0, 1, 43] },
  ]);
});

test('modulation slider reports unavailable output and keeps its local CC 1 readout', async ({ page }) => {
  await page.locator('#midi-reface-output').selectOption('');
  await page.locator('#midi-modwheel-value').press('ArrowRight');
  await expect(page.locator('#midi-modwheel-readout')).toHaveText('1');
  await expect(page.locator('#filter-cutoff')).toHaveAttribute('aria-valuenow', '127');
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('MIDI output unavailable');
});

test('obsolete wheel mappings do not override standard CC 1 after reload', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('refaceCS.modwheelCC', '71'));
  await page.reload();
  await page.getByRole('button', { name: 'Connect MIDI' }).click();
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 1, 53]));
  await page.locator('#midi-modwheel-value').press('ArrowRight');
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toEqual([
    [0xb2, 1, 53], [0xb0, 1, 54],
  ]);
  await expect(page.locator('#filter-resonance')).toHaveAttribute('aria-valuenow', '0');
});

test('controller send failures are reported without suppressing panel updates', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    window.testNotes.access.outputs.get('ro').send = () => { throw new Error('controller output failed'); };
    window.testNotes.emit('ci', [0xb3, 74, 45]);
  });
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('controller output failed');
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

test('forwarded sustain is released on controller and output changes', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb2, 64, 127]));
  await page.locator('#midi-controller-input').selectOption('ri');
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => window.testNotes.emit('ci', [0xb5, 64, 100]));
  expect(await page.evaluate(() => window.testNotes.sent)).toEqual([
    { port: 'ro', data: [0xb2, 64, 127] }, { port: 'ro', data: [0xb2, 64, 0] },
    { port: 'ro', data: [0xb5, 64, 100] },
  ]);
  await page.evaluate(() => window.testNotes.emit('ci', [0xb5, 64, 0]));
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
    { port: 'ro', data: [0xb4, 1, 33] }, { port: 'ro', data: [0xe4, 12, 65] },
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
  expect(messages).toHaveLength(48);
  expect(messages[0]).toEqual({ port: 'ro', data: [0xb2, 64, 0] });
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('MIDI reset messages sent');
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
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('MIDI send failed: device busy');
  await page.keyboard.up('a');
});

test('MIDI Reset releases sustain and tracked notes before resetting every channel and clearing held notes', async ({ page }) => {
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
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('MIDI reset messages sent');
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
    ...Array.from({ length: 16 }, (_, channel) => ({ port: 'ro', data: [0xb0 | channel, 64, 0] })),
    { port: 'ro', data: [0x80, 60, 0] },
    { port: 'ro', data: [0x82, 64, 0] },
    { port: 'ro', data: [0x80, 62, 0] },
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
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('1 of 48 messages');
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('device busy');
  expect(await page.evaluate(() => window.testNotes.attempts)).toBe(48);
  await page.evaluate(() => {
    window.testNotes.access.outputs.get('ro').send = () => {};
  });
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('MIDI reset messages sent');
});

test('MIDI Reset reports an unavailable output', async ({ page }) => {
  await page.locator('#midi-reface-output').selectOption('');
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('MIDI output unavailable');
});

test('MIDI Reset retries a tracked note-off after the original send failed', async ({ page }) => {
  await page.locator('#midi-controller-input').selectOption('ci');
  await page.evaluate(() => {
    window.testNotes.emit('ci', [0x94, 72, 90]);
    const port = window.testNotes.access.outputs.get('ro');
    const send = port.send;
    port.send = (data) => {
      if (data[0] === 0x84) throw new Error('note-off blocked');
      send(data);
    };
    window.testNotes.emit('ci', [0x84, 72, 0]);
    port.send = send;
    window.testNotes.sent.length = 0;
  });
  await page.getByRole('button', { name: 'MIDI Reset' }).click();
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toContainEqual([0x84, 72, 0]);
  await expect(page.locator('.message-entry[data-source="midi-status"] .message-text').last()).toContainText('MIDI reset messages sent');
});

test('Stop releases a repeated reface key on its original MIDI channel', async ({ page }) => {
  await page.evaluate(() => {
    window.testNotes.emit('ri', [0x95, 65, 90]);
    window.testNotes.emit('ri', [0x95, 65, 80]);
    window.testNotes.emit('ri', [0x85, 65, 0]);
  });
  await page.locator('#looper .position-label[data-step="0"]').click();
  expect(await page.evaluate(() => window.testNotes.sent.map((event) => event.data))).toContainEqual([0x85, 65, 0]);
  await expect(page.locator('#key-f-2')).toHaveAttribute('aria-pressed', 'false');
});
