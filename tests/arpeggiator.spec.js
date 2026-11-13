import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  await page.addInitScript(() => {
    const access = new EventTarget();
    const input = (id, name) => Object.assign(new EventTarget(), { id, name, state: 'connected' });
    const reface = input('ri', 'reface CS');
    const controller = input('ci', 'Controller');
    const sent = [];
    access.inputs = new Map([[reface.id, reface], [controller.id, controller]]);
    access.outputs = new Map([['ro', {
      id: 'ro', name: 'reface CS', state: 'connected',
      send(data) { sent.push({ data: [...data], time: Date.now() }); },
    }]]);
    window.arpTest = {
      access, sent,
      emit(port, data) {
        const event = new Event('midimessage');
        event.data = new Uint8Array(data);
        access.inputs.get(port).dispatchEvent(event);
      },
      click(id, options = {}) { document.querySelector(id).dispatchEvent(new MouseEvent('click', { bubbles: true, ...options })); },
      select(id, value) {
        const element = document.querySelector(id);
        if (id === '#arp-rate' || id === '#arp-mode') {
          element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
          document.querySelector(`#arp-menu-layer [data-value="${value}"]`)
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } else {
          element.value = value;
          element.dispatchEvent(new Event('change'));
        }
      },
      tempo(value) {
        while (Number(document.querySelector('#arp-tempo').dataset.value) !== value) {
          const current = Number(document.querySelector('#arp-tempo').dataset.value);
          this.click(current < value ? '#arp-tempo-up' : '#arp-tempo-down',
            { shiftKey: Math.abs(value - current) >= 10 });
        }
      },
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
  });
  await page.goto('/static/reface/');
  await page.evaluate(() => window.arpTest.click('#midi-connect'));
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
  await page.evaluate(() => window.arpTest.select('#midi-controller-input', 'ci'));
  await page.evaluate(() => {
    window.arpTest.select('#arp-rate', '8');
    window.arpTest.click('#arp-latch');
  });
});

test('panel buttons cycle and expose selectable menus with keyboard support', async ({ page }) => {
  const rate = page.locator('#arp-rate');
  const mode = page.locator('#arp-mode');
  await expect(page.locator('#arp-controls')).toBeVisible();
  await expect(page.locator('.arpeggiator')).toHaveCount(0);
  await rate.click();
  await expect(rate).toHaveCSS('outline-style', 'none');
  await expect(rate).toHaveAttribute('aria-label', 'Rate: 1/16');
  await rate.click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Arpeggiator rates' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: '1/32' }).click();
  await expect(rate).toHaveAttribute('aria-label', 'Rate: 1/32');
  await expect(rate).toHaveAttribute('aria-expanded', 'false');
  await rate.click();
  await expect(rate).toHaveAttribute('aria-label', 'Rate: 1/2');
  await mode.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menu', { name: 'Arpeggiator modes' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'First/last/middle' }).click();
  await expect(mode).toHaveAttribute('aria-label', 'Mode: First/last/middle');
  await mode.click({ button: 'right' });
  await expect(page.getByRole('menuitemradio')).toHaveCount(6);
  await page.getByRole('menuitemradio', { name: 'Random' }).click();
  await expect(mode).toHaveAttribute('aria-label', 'Mode: Random');
  await mode.press('Shift+F10');
  await page.keyboard.press('Escape');
  await expect(mode).toHaveAttribute('aria-expanded', 'false');
});

test('tempo control supports steps, wheel, bounds and shared activation reset', async ({ page }) => {
  const tempo = page.locator('#arp-tempo');
  const up = page.locator('#arp-tempo-up');
  const down = page.locator('#arp-tempo-down');
  const synthTempo = page.locator('#tempo');
  await expect(tempo).toHaveAttribute('data-value', '120');
  await expect(tempo.locator('.arp-segment.is-lit')).toHaveCount(13);
  await down.click();
  await expect(tempo).toHaveAttribute('data-value', '119');
  await up.click({ modifiers: ['Shift'] });
  await expect(tempo).toHaveAttribute('data-value', '129');
  await tempo.evaluate((element) => element.dispatchEvent(new WheelEvent('wheel',
    { deltaY: 1, bubbles: true, cancelable: true })));
  await expect(tempo).toHaveAttribute('data-value', '128');
  await tempo.evaluate((element) => element.dispatchEvent(new WheelEvent('wheel',
    { deltaY: -1, altKey: true, bubbles: true, cancelable: true })));
  await expect(tempo).toHaveAttribute('data-value', '138');
  await page.locator('#arp-tempo-display').dblclick();
  await expect(tempo).toHaveAttribute('data-value', '120');
  await up.click();
  await expect(tempo).toHaveAttribute('data-value', '121');
  await page.locator('#arp-enabled').click();
  await expect(tempo).toHaveAttribute('data-value', '120');
  await up.click({ modifiers: ['Shift'] });
  await expect(tempo).toHaveAttribute('data-value', '130');
  await page.locator('#arp-tempo-display').dblclick();
  await expect(tempo).toHaveAttribute('data-value', '120');
  await expect(synthTempo).toHaveAttribute('aria-valuenow', '120');
  await synthTempo.press('ArrowUp');
  await expect(tempo).toHaveAttribute('data-value', '121');
  await up.click();
  await expect(synthTempo).toHaveAttribute('aria-valuenow', '122');
  await page.evaluate(() => window.arpTest.tempo(40));
  await expect(down).toHaveAttribute('aria-disabled', 'true');
  await page.evaluate(() => window.arpTest.click('#arp-tempo-down'));
  await expect(tempo).toHaveAttribute('data-value', '40');
  await expect(tempo.locator('.arp-segment.is-lit')).toHaveCount(10);
  await page.evaluate(() => window.arpTest.tempo(240));
  await expect(up).toHaveAttribute('aria-disabled', 'true');
  await page.evaluate(() => window.arpTest.click('#arp-tempo-up'));
  await expect(tempo).toHaveAttribute('data-value', '240');
  await page.locator('#arp-enabled').click();
  await page.locator('#arp-enabled').click();
  await expect(tempo).toHaveAttribute('data-value', '120');
});

test('panel controls and menus remain usable in compact and double-travel layouts', async ({ page }) => {
  await page.locator('#hide-speakers').click();
  await page.locator('#fader-size').click();
  await page.locator('#focus-mode').click();
  await page.locator('#five-octaves').click();
  const logo = await page.locator('text').filter({ hasText: /^YAMAHA$/ }).boundingBox();
  const label = await page.locator('#arp-label').boundingBox();
  const controls = await page.locator('#arp-enabled').boundingBox();
  expect(label.x).toBeGreaterThan(logo.x + logo.width);
  expect(controls.x).toBeGreaterThan(label.x + label.width);
  const readouts = await page.locator('#arp-readouts').evaluate((element) => {
    const notes = element.querySelector('#arp-held-notes');
    const chord = element.querySelector('#arp-detected-chord');
    return [Number(notes.getAttribute('x')), Number(chord.getAttribute('x'))];
  });
  expect(readouts[1] - readouts[0]).toBe(147.5);
  await page.locator('#arp-mode').click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: 'Down/up' }).click();
  await expect(page.locator('#arp-mode')).toHaveAttribute('aria-label', 'Mode: Down/up');
  await page.locator('#arp-chord').click();
  await expect(page.locator('#arp-chord')).toHaveAttribute('aria-pressed', 'true');
});

test('extra space below fader labels is preserved across layouts', async ({ page }) => {
  for (const toggle of [null, '#fader-size', '#focus-mode', '#hide-speakers', '#five-octaves']) {
    if (toggle) await page.locator(toggle).click();
    const geometry = await page.evaluate(() => {
      const label = document.querySelector('#lower-panel > .control-label text');
      const button = document.querySelector('#arp-enabled');
      const keyboard = document.querySelector('#keyboard');
      const scale = document.querySelector('#synth svg').getCTM().d;
      const labelBaseline = new DOMPoint(0, Number(label.getAttribute('y'))).matrixTransform(label.getCTM()).y;
      return {
        gap: (button.getCTM().f - labelBaseline) / scale,
        labelSize: Number.parseFloat(getComputedStyle(label).fontSize),
        keyboardOffset: (keyboard.getCTM().f - button.getCTM().f) / scale,
      };
    });
    expect(geometry.gap).toBeCloseTo(19 + geometry.labelSize * 2, 4);
    expect(geometry.keyboardOffset).toBeCloseTo(52, 4);
  }
  await page.locator('#arp-rate').click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: '1/32' }).click();
  await expect(page.locator('#arp-rate')).toHaveAttribute('aria-label', 'Rate: 1/32');
});

for (const [mode, expected] of [
  ['up', [60, 64, 67, 60, 64]],
  ['down', [67, 64, 60, 67, 64]],
  ['updown', [60, 64, 67, 64, 60]],
  ['downup', [67, 64, 60, 64, 67]],
  ['firstlastmiddle', [60, 67, 64, 60, 67]],
]) {
  test(`${mode} follows its note order on channel 1`, async ({ page }) => {
    await page.evaluate((selectedMode) => {
      window.arpTest.select('#arp-mode', selectedMode);
      for (const note of [60, 64, 67]) window.arpTest.emit('ci', [0x93, note, 80]);
      window.arpTest.sent.length = 0;
      window.arpTest.click('#arp-enabled');
    }, mode);
    await page.clock.runFor(1000);
    const messages = await page.evaluate(() => window.arpTest.sent.map(({ data }) => data));
    expect(messages.filter((data) => data[0] === 0x90).map((data) => data[1])).toEqual(expected);
    expect(messages.filter((data) => data[0] === 0x83).map((data) => data[1])).toEqual([60, 64, 67]);
  });
}

test('tempo and rate determine step length and the 50 percent gate', async ({ page }) => {
  await page.evaluate(() => {
    window.arpTest.select('#arp-rate', '16');
    window.arpTest.click('#arp-enabled');
    window.arpTest.tempo(150);
    window.arpTest.emit('ci', [0x92, 60, 87]);
  });

  await page.clock.runFor(49);
  expect(await page.evaluate(() => window.arpTest.sent.map(({ data }) => data))).toEqual([[0x90, 60, 87]]);
  await page.clock.runFor(1);
  expect(await page.evaluate(() => window.arpTest.sent.map(({ data }) => data))).toEqual([
    [0x90, 60, 87], [0x80, 60, 0],
  ]);
  await page.clock.runFor(50);
  expect(await page.evaluate(() => window.arpTest.sent.map(({ data }) => data))).toEqual([
    [0x90, 60, 87], [0x80, 60, 0], [0x90, 60, 87],
  ]);
});

test('moving the tempo fader changes the running arpeggiator timing', async ({ page }) => {
  await page.evaluate(() => {
    window.arpTest.select('#arp-rate', '16');
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ci', [0x92, 60, 87]);
  });
  await page.locator('#tempo').press('Home');
  await expect(page.locator('#arp-tempo')).toHaveAttribute('data-value', '240');
  await page.clock.runFor(63);
  expect(await page.evaluate(() => window.arpTest.sent.map(({ data }) => data))).toEqual([
    [0x90, 60, 87], [0x80, 60, 0], [0x90, 60, 87], [0x80, 60, 0], [0x90, 60, 87],
  ]);
});

test('mute silences sounding notes but keeps the pattern running for unmute', async ({ page }) => {
  await page.evaluate(() => {
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ci', [0x92, 60, 87]);
    document.querySelector('#volume-mute').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.arpTest.sent.map(({ data }) => data))).toEqual([
    [0x90, 60, 87], [0x80, 60, 0],
  ]);
  await page.evaluate(() => document.querySelector('#volume-mute').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.clock.runFor(250);
  expect(await page.evaluate(() => window.arpTest.sent.filter(({ data }) => data[0] === 0x90).map(({ data }) => data)))
    .toEqual([[0x90, 60, 87], [0x90, 60, 87]]);
});

test('transpose follows changes during arpeggiation and preserves note-off pitches', async ({ page }) => {
  await page.locator('#transpose').press('ArrowUp');
  await page.evaluate(() => {
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ci', [0x92, 60, 87]);
  });
  await page.locator('#transpose').press('ArrowUp');
  await page.clock.runFor(250);
  expect(await page.evaluate(() => window.arpTest.sent.map(({ data }) => data))).toEqual([
    [0x90, 61, 87], [0x80, 61, 0], [0x90, 62, 87],
  ]);
});

test('arpeggiator resumes when a transposed held note returns to the MIDI range', async ({ page }) => {
  await page.locator('#transpose').press('ArrowDown');
  await page.evaluate(() => {
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ci', [0x92, 0, 87]);
  });
  await expect(page.locator('#arp-status')).toContainText('outside the MIDI range');
  expect(await page.evaluate(() => window.arpTest.sent)).toEqual([]);
  await page.locator('#transpose').press('ArrowUp');
  expect(await page.evaluate(() => window.arpTest.sent.map(({ data }) => data))).toEqual([[0x90, 0, 87]]);
});

test('chord mode uses the transposed sounding key', async ({ page }) => {
  await page.locator('#transpose').press('ArrowUp');
  await page.evaluate(() => {
    window.arpTest.click('#arp-chord');
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ci', [0x90, 60, 90]);
  });
  await page.clock.runFor(750);
  expect(await page.evaluate(() => window.arpTest.sent.filter(({ data }) => data[0] === 0x90).map(({ data }) => data[1])))
    .toEqual([60, 64, 67, 71]);
});

test('chord mode builds C-major triads and black-key diatonic sevenths', async ({ page }) => {
  await page.evaluate(() => {
    window.arpTest.click('#arp-chord');
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ci', [0x90, 60, 90]);
  });
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.arpTest.sent.filter(({ data }) => data[0] === 0x90).map(({ data }) => data[1])))
    .toEqual([60, 64, 67]);
  await page.evaluate(() => {
    window.arpTest.emit('ci', [0x80, 60, 0]);
    window.arpTest.sent.length = 0;
    window.arpTest.emit('ci', [0x90, 61, 90]);
  });
  await page.clock.runFor(750);
  expect(await page.evaluate(() => window.arpTest.sent.filter(({ data }) => data[0] === 0x90).map(({ data }) => data[1])))
    .toEqual([60, 64, 67, 71]);
});

test('all twelve chord roots use their specified diatonic intervals', async ({ page }) => {
  await page.evaluate(() => {
    window.arpTest.select('#arp-rate', '32');
    window.arpTest.click('#arp-chord');
    window.arpTest.click('#arp-enabled');
    window.arpTest.tempo(240);
  });
  const chords = [
    [60, 64, 67], [60, 64, 67, 71], [62, 65, 69], [62, 65, 69, 72],
    [64, 67, 71], [65, 69, 72], [65, 69, 72, 76], [67, 71, 74],
    [67, 71, 74, 77], [69, 72, 76], [69, 72, 76, 79], [71, 74, 77],
  ];
  for (const [index, expected] of chords.entries()) {
    await page.evaluate((note) => {
      window.arpTest.sent.length = 0;
      window.arpTest.emit('ci', [0x90, note, 90]);
    }, 60 + index);
    await page.clock.runFor((expected.length - 1) * 32);
    expect(await page.evaluate(() => window.arpTest.sent.filter(({ data }) => data[0] === 0x90).map(({ data }) => data[1])))
      .toEqual(expected);
    await page.evaluate((note) => window.arpTest.emit('ci', [0x80, note, 0]), 60 + index);
  }
});

test('latch replaces released patterns and stops when turned off', async ({ page }) => {
  await page.evaluate(() => {
    window.arpTest.click('#arp-latch');
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ci', [0x90, 60, 90]);
    window.arpTest.emit('ci', [0x80, 60, 0]);
  });
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.arpTest.sent.filter(({ data }) => data[0] === 0x90).map(({ data }) => data[1])))
    .toEqual([60, 60, 60]);
  await page.evaluate(() => {
    window.arpTest.sent.length = 0;
    window.arpTest.emit('ci', [0x90, 62, 90]);
    window.arpTest.emit('ci', [0x80, 62, 0]);
  });
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.arpTest.sent.filter(({ data }) => data[0] === 0x90).map(({ data }) => data[1])))
    .toEqual([62, 62]);
  await page.evaluate(() => {
    window.arpTest.click('#arp-latch');
    window.arpTest.sent.length = 0;
  });
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.arpTest.sent)).toEqual([]);
});

test('random repeats at most three times, even for one note', async ({ page }) => {
  await page.evaluate(() => {
    Math.random = () => 0;
    window.arpTest.select('#arp-mode', 'random');
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ci', [0x90, 60, 90]);
  });
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => window.arpTest.sent.filter(({ data }) => data[0] === 0x90).map(({ data }) => data[1])))
    .toEqual([60, 60, 60, 60]);
  const times = await page.evaluate(() => window.arpTest.sent.filter(({ data }) => data[0] === 0x90).map(({ time }) => time));
  expect(times.map((time) => time - times[0])).toEqual([0, 250, 500, 1000]);
});

test('switching off resumes held controller notes; reface input is never echoed', async ({ page }) => {
  await page.evaluate(() => {
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ri', [0x90, 62, 90]);
    window.arpTest.emit('ci', [0x93, 60, 75]);
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ci', [0x83, 60, 5]);
  });
  expect(await page.evaluate(() => window.arpTest.sent.map(({ data }) => data))).toEqual([
    [0x90, 60, 75], [0x80, 60, 0], [0x93, 60, 75], [0x83, 60, 5],
  ]);
});

test('switching on and off transfers a held on-screen note without leaving it sounding', async ({ page }) => {
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.down('a');
  await page.evaluate(() => {
    window.arpTest.click('#arp-enabled');
    window.arpTest.click('#arp-enabled');
  });
  await page.keyboard.up('a');
  expect(await page.evaluate(() => window.arpTest.sent.map(({ data }) => data))).toEqual([
    [0x90, 60, 100], [0x80, 60, 0], [0x90, 60, 100],
    [0x80, 60, 0], [0x90, 60, 100], [0x80, 60, 0],
  ]);
});

test('failed note-off is reported without continuing playback', async ({ page }) => {
  await page.evaluate(() => {
    const output = window.arpTest.access.outputs.get('ro');
    output.send = (data) => {
      if (data[0] === 0x80) throw new Error('device busy');
      window.arpTest.sent.push({ data: [...data], time: Date.now() });
    };
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ci', [0x90, 60, 90]);
  });
  await page.clock.runFor(500);
  await expect(page.locator('#arp-status')).toContainText('note-off failed');
  expect(await page.evaluate(() => window.arpTest.sent.filter(({ data }) => data[0] === 0x90).length)).toBe(1);
});

test('MIDI Reset and controller disconnection stop a latched pattern', async ({ page }) => {
  await page.evaluate(() => {
    window.arpTest.click('#arp-latch');
    window.arpTest.click('#arp-enabled');
    window.arpTest.emit('ci', [0x90, 60, 90]);
    window.arpTest.emit('ci', [0x80, 60, 0]);
    window.arpTest.click('#midi-reset');
    window.arpTest.sent.length = 0;
  });
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.arpTest.sent)).toEqual([]);
  await page.evaluate(() => {
    window.arpTest.emit('ci', [0x90, 64, 90]);
    window.arpTest.emit('ci', [0x80, 64, 0]);
    window.arpTest.access.inputs.get('ci').state = 'disconnected';
    window.arpTest.access.dispatchEvent(new Event('statechange'));
    window.arpTest.sent.length = 0;
  });
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.arpTest.sent)).toEqual([]);
});
