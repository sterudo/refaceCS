import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  await page.addInitScript(() => {
    const access = new EventTarget();
    const reface = Object.assign(new EventTarget(), { id: 'ri', name: 'reface CS', state: 'connected' });
    const controller = Object.assign(new EventTarget(), { id: 'ci', name: 'Controller', state: 'connected' });
    const sent = [];
    access.inputs = new Map([[reface.id, reface], [controller.id, controller]]);
    access.outputs = new Map([['ro', {
      id: 'ro', name: 'reface CS', state: 'connected',
      send(data) { sent.push([...data]); },
    }]]);
    window.chordTest = {
      access, sent,
      emit(port, data) {
        const event = new Event('midimessage');
        event.data = new Uint8Array(data);
        access.inputs.get(port).dispatchEvent(event);
      },
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
  });
  await page.goto('/static/reface/');
  await page.evaluate(() => document.querySelector('#midi-connect').click());
  await expect(page.locator('#midi-badge')).toHaveText('reface MIDI ports available');
  await page.evaluate(() => {
    const input = document.querySelector('#midi-controller-input');
    input.value = 'ci';
    input.dispatchEvent(new Event('change'));
  });
});

test('defaults to latch and 1/16 with matching playback behavior', async ({ page }) => {
  await expect(page.locator('#arp-latch')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#arp-rate')).toHaveAttribute('aria-label', 'Rate: 1/16');
  await page.evaluate(() => {
    document.querySelector('#arp-enabled').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.chordTest.emit('ci', [0x90, 60, 90]);
    window.chordTest.emit('ci', [0x80, 60, 0]);
  });
  await expect(page.locator('#arp-held-notes')).toHaveText('None');
  await page.clock.runFor(125);
  expect(await page.evaluate(() => window.chordTest.sent)).toEqual([
    [0x90, 60, 90], [0x80, 60, 0], [0x90, 60, 90],
  ]);
});

test('identifies supported chord families and extended chords without fifths', async ({ page }) => {
  const cases = [
    [[60, 64, 67], 'C'], [[60, 63, 67], 'Cm'],
    [[60, 64, 68], 'Caug'], [[60, 63, 66], 'Cdim'],
    [[60, 64, 67, 70], 'C7'], [[60, 64, 67, 71], 'Cmaj7'], [[60, 63, 67, 70], 'Cm7'],
    [[60, 64, 70], 'C7'], [[60, 64, 71], 'Cmaj7'], [[60, 63, 70], 'Cm7'],
    [[60, 64, 67, 70, 74], 'C9'], [[60, 64, 67, 71, 74], 'Cmaj9'], [[60, 63, 67, 70, 74], 'Cm9'],
    [[60, 64, 70, 74], 'C9'], [[60, 64, 71, 74], 'Cmaj9'], [[60, 63, 70, 74], 'Cm9'],
    [[60, 64, 67, 70, 74, 77], 'C11'], [[60, 64, 67, 71, 74, 77], 'Cmaj11'],
    [[60, 63, 67, 70, 74, 77], 'Cm11'],
    [[60, 64, 70, 74, 77], 'C11'], [[60, 64, 71, 74, 77], 'Cmaj11'],
    [[60, 63, 70, 74, 77], 'Cm11'],
  ];
  for (const [notes, expected] of cases) {
    await page.evaluate((pitches) => {
      for (const note of pitches) window.chordTest.emit('ri', [0x90, note, 90]);
    }, notes);
    await expect(page.locator('#arp-detected-chord')).toHaveText(expected);
    await page.evaluate((pitches) => {
      for (const note of pitches) window.chordTest.emit('ri', [0x80, note, 0]);
    }, notes);
  }
});

test('colors major and minor chord families while leaving other chords neutral', async ({ page }) => {
  const chord = page.locator('#arp-detected-chord');
  const neutral = await chord.evaluate((element) => getComputedStyle(element).fill);
  const cases = [
    [[60, 64, 67], 'C', 'major'],
    [[60, 64, 71, 74], 'Cmaj9', 'major'],
    [[60, 63, 67], 'Cm', 'minor'],
    [[60, 63, 70, 74, 77], 'Cm11', 'minor'],
    [[60, 64, 68], 'Caug', null],
    [[60, 63, 66], 'Cdim', null],
    [[60, 64, 70], 'C7', null],
  ];
  const colors = {};
  for (const [notes, name, quality] of cases) {
    await page.evaluate((pitches) => {
      for (const note of pitches) window.chordTest.emit('ri', [0x90, note, 90]);
    }, notes);
    await expect(chord).toHaveText(name);
    const color = await chord.evaluate((element) => getComputedStyle(element).fill);
    if (quality) colors[quality] = color;
    else expect(color).toBe(neutral);
    await page.evaluate((pitches) => {
      for (const note of pitches) window.chordTest.emit('ri', [0x80, note, 0]);
    }, notes);
    await expect(chord).toHaveText('None');
    await expect(chord).toHaveCSS('fill', neutral);
  }
  const [majorRed, majorGreen, majorBlue] = colors.major.match(/\d+/g).map(Number);
  const [minorRed, minorGreen, minorBlue] = colors.minor.match(/\d+/g).map(Number);
  expect(majorGreen).toBeGreaterThan(Math.max(majorRed, majorBlue));
  expect(minorBlue).toBeGreaterThan(Math.max(minorRed, minorGreen));
});

test('recognizes inversions, prefers the bass root, and ignores unrecognized combinations', async ({ page }) => {
  await page.evaluate(() => {
    for (const note of [64, 67, 72]) window.chordTest.emit('ri', [0x90, note, 90]);
  });
  await expect(page.locator('#arp-held-notes')).toHaveText('E4 G4 C5');
  await expect(page.locator('#arp-detected-chord')).toHaveText('C');
  await page.evaluate(() => {
    for (const note of [64, 67, 72]) window.chordTest.emit('ri', [0x80, note, 0]);
    for (const note of [64, 68, 72]) window.chordTest.emit('ri', [0x90, note, 90]);
  });
  await expect(page.locator('#arp-detected-chord')).toHaveText('Eaug');
  await page.evaluate(() => {
    for (const note of [64, 68, 72]) window.chordTest.emit('ri', [0x80, note, 0]);
    for (const note of [60, 61, 62]) window.chordTest.emit('ri', [0x90, note, 90]);
  });
  await expect(page.locator('#arp-detected-chord')).toHaveText('None');
});

test('combines held notes from both MIDI inputs and on-screen keys and clears on reset', async ({ page }) => {
  await page.evaluate(() => {
    window.chordTest.emit('ri', [0x90, 60, 90]);
    window.chordTest.emit('ci', [0x92, 64, 90]);
    document.activeElement.blur();
  });
  await page.keyboard.down('g');
  await expect(page.locator('#arp-held-notes')).toHaveText('C4 E4 G4');
  await expect(page.locator('#arp-detected-chord')).toHaveText('C');
  await page.evaluate(() => document.querySelector('#midi-reset').click());
  await expect(page.locator('#arp-held-notes')).toHaveText('None');
  await expect(page.locator('#arp-detected-chord')).toHaveText('None');
  await page.keyboard.up('g');
});

test('keeps duplicate pitches until every source releases and removes disconnected notes', async ({ page }) => {
  await page.evaluate(() => {
    window.chordTest.emit('ri', [0x90, 60, 90]);
    window.chordTest.emit('ci', [0x91, 60, 90]);
    window.chordTest.emit('ri', [0x80, 60, 0]);
  });
  await expect(page.locator('#arp-held-notes')).toHaveText('C4');
  await page.evaluate(() => {
    window.chordTest.access.inputs.get('ci').state = 'disconnected';
    window.chordTest.access.dispatchEvent(new Event('statechange'));
  });
  await expect(page.locator('#arp-held-notes')).toHaveText('None');
});
