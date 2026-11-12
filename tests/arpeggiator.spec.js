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
      click(id) { document.querySelector(id).click(); },
      select(id, value) {
        const element = document.querySelector(id);
        element.value = value;
        element.dispatchEvent(new Event('change'));
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
    const tempo = document.querySelector('#arp-tempo');
    tempo.value = '150';
    tempo.dispatchEvent(new Event('change'));
    window.arpTest.select('#arp-rate', '16');
    window.arpTest.click('#arp-enabled');
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
    const tempo = document.querySelector('#arp-tempo');
    tempo.value = '300';
    tempo.dispatchEvent(new Event('change'));
    window.arpTest.select('#arp-rate', '32');
    window.arpTest.click('#arp-chord');
    window.arpTest.click('#arp-enabled');
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
    await page.clock.runFor((expected.length - 1) * 25);
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

test('invalid tempo and failed note-off are reported without continuing playback', async ({ page }) => {
  await page.evaluate(() => {
    const tempo = document.querySelector('#arp-tempo');
    tempo.value = '0';
    tempo.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#arp-status')).toContainText('30 to 300 BPM');
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
