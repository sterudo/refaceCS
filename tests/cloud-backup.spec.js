import { test, expect } from '@playwright/test';

test('Drive setup instructions show the current app origin', async ({ page }) => {
  await page.goto('/static/reface/');
  await page.locator('#backup-open').click();
  await page.locator('#cloud-open').click();
  const setup = page.locator('#cloud-dialog .cloud-setup');
  await expect(setup).not.toHaveAttribute('open');
  await setup.locator('summary').click();
  await expect(setup).toHaveAttribute('open', '');
  await expect(setup.locator('#cloud-origin')).toHaveText(new URL(page.url()).origin);
  await expect(setup).toContainText('Test users');
  await setup.locator('summary').click();
  await expect(setup).not.toHaveAttribute('open');
});

test('named Drive backups keep audio separate and preserve a recovery point on replacement', async ({ page }) => {
  const files = new Map();
  let nextId = 0;
  let failRecovery = false;
  await page.addInitScript(() => {
    window.google = { accounts: { oauth2: {
      initTokenClient(config) {
        return { requestAccessToken() {
          config.callback({ access_token: 'test-token', expires_in: 3600, scope: config.scope });
        } };
      },
      hasGrantedAllScopes() { return true; },
    } } };
  });
  await page.route('https://www.googleapis.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,OPTIONS', 'access-control-expose-headers': 'Location' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    expect(request.headers().authorization).toBe('Bearer test-token');
    if (url.pathname === '/drive/v3/files' && request.method() === 'GET') {
      const q = url.searchParams.get('q');
      const values = [...files.values()].filter((file) => q.includes('mimeType =')
        ? file.mimeType === 'application/vnd.google-apps.folder'
        : file.appProperties?.refaceType === 'backup' && file.content);
      return route.fulfill({ json: { files: values }, headers: cors });
    }
    if (url.pathname === '/drive/v3/files' && request.method() === 'POST') {
      const metadata = request.postDataJSON();
      const id = `id${++nextId}`;
      files.set(id, { ...metadata, id });
      return route.fulfill({ json: { id }, headers: cors });
    }
    if (url.pathname === '/upload/drive/v3/files' && request.method() === 'POST') {
      if (failRecovery && request.postDataJSON().appProperties?.kind === 'recovery') {
        return route.fulfill({ status: 500, body: 'recovery failed', headers: cors });
      }
      const id = `id${++nextId}`;
      files.set(id, { ...request.postDataJSON(), id, createdTime: new Date().toISOString() });
      return route.fulfill({ status: 200, headers: { ...cors, Location: `https://www.googleapis.com/resumable/${id}` } });
    }
    if (url.pathname.startsWith('/resumable/') && request.method() === 'PUT') {
      const id = url.pathname.split('/').at(-1);
      const file = files.get(id);
      file.content = request.postDataBuffer();
      return route.fulfill({ json: { id, name: file.name, appProperties: file.appProperties }, headers: cors });
    }
    if (url.pathname.startsWith('/drive/v3/files/') && request.method() === 'GET') {
      const id = url.pathname.split('/').at(-1);
      return route.fulfill({ body: files.get(id).content, headers: cors });
    }
    throw new Error(`Unexpected Drive request: ${request.method()} ${url}`);
  });
  await page.goto('/static/reface/');
  await expect(page.locator('#patch-status')).toHaveText('Patch library ready.');
  await page.locator('#footer-panel').first().locator('summary').click();
  await page.locator('#patch-save').click();
  await page.locator('#patch-name').fill('Cloud pad');
  await page.locator('#patch-editor-form button[type="submit"]').click();
  await expect(page.locator('#patch-editor')).not.toBeVisible();
  const card = page.locator('.patch-card').filter({ has: page.getByRole('heading', { name: 'Cloud pad' }) });
  await card.getByRole('button', { name: 'Add MP3' }).click();
  await page.locator('#patch-audio-file').setInputFiles({
    name: 'audio.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('audio bytes'),
  });
  await expect(card.locator('.patch-audio-item')).toHaveCount(1);
  await page.locator('#groove-panel > summary').click();
  await page.getByRole('button', { name: 'Kick lane options' }).click();
  await page.getByRole('slider', { name: 'Kick tune' }).fill('3');
  await page.getByRole('button', { name: 'Save tone for Kick' }).click();
  await page.getByRole('dialog', { name: 'Save drum tone' }).getByLabel('Name').fill('Cloud kick');
  await page.getByRole('dialog', { name: 'Save drum tone' }).getByRole('button', { name: 'Save' }).click();
  await page.locator('#backup-open').click();
  await page.locator('#cloud-open').click();
  await page.locator('#cloud-client-id').fill('test-client-id');
  await page.locator('#cloud-connect').click();
  await expect(page.locator('#cloud-status')).toContainText('Connected to Google Drive');
  await page.locator('#cloud-name').fill('My backup');
  await page.locator('#cloud-save').click();
  await expect(page.locator('#cloud-status')).toContainText('Saved cloud backup');
  const audioFile = [...files.values()].find((file) => file.appProperties?.refaceType === 'audio');
  const backup = [...files.values()].find((file) => file.appProperties?.refaceType === 'backup');
  expect(audioFile.content).toEqual(Buffer.from('audio bytes'));
  const manifest = JSON.parse(backup.content.toString());
  expect(manifest.patches[0].audio[0].fileId).toBe(audioFile.id);
  expect(manifest.tones.map((tone) => tone.name)).toEqual(['Cloud kick']);
  expect(JSON.stringify(manifest)).not.toContain('test-client-id');
  expect(JSON.stringify(manifest)).not.toContain('test-token');
  audioFile.content = Buffer.from('damaged');
  await page.locator('#cloud-merge').click();
  await expect(page.locator('#cloud-status')).toContainText('damaged or changed');
  expect([...files.values()].filter((file) => file.appProperties?.refaceType === 'backup')).toHaveLength(1);
  audioFile.content = Buffer.from('audio bytes');
  await page.locator('#cloud-close').click();
  await page.locator('#backup-close').click();
  await page.getByRole('button', { name: 'Load tone for Kick' }).click();
  await page.getByRole('dialog', { name: 'Kick tones' }).getByRole('button', { name: 'Delete Cloud kick' }).click();
  await page.getByRole('dialog', { name: 'Delete drum tone' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Kick tones' }).getByRole('button', { name: 'Close' }).click();
  await card.getByRole('button', { name: 'Delete Cloud pad' }).click();
  await page.getByRole('dialog', { name: 'Delete patch' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.patch-card')).toHaveCount(0);
  await page.locator('#backup-open').click();
  await page.locator('#cloud-open').click();
  failRecovery = true;
  await page.locator('#cloud-replace').click();
  await page.getByRole('dialog', { name: 'Replace browser data' }).getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('#cloud-status')).toContainText('recovery failed');
  await expect(page.locator('.patch-card')).toHaveCount(0);
  failRecovery = false;
  await page.locator('#cloud-replace').click();
  await page.getByRole('dialog', { name: 'Replace browser data' }).getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('#cloud-status')).toContainText('recovery backup was saved');
  await expect(page.locator('#cloud-versions option')).toHaveCount(2);
  const recovery = [...files.values()].find((file) => file.appProperties?.kind === 'recovery');
  expect(JSON.parse(recovery.content.toString()).patches).toHaveLength(0);
  expect(JSON.parse(recovery.content.toString()).tones).toHaveLength(0);
  await page.locator('#cloud-close').click();
  await page.locator('#backup-close').click();
  await expect(card.locator('.patch-audio-item')).toContainText('audio.mp3');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('refaceCS.drumTones.v1')).tones.map((tone) => tone.name)))
    .toEqual(['Cloud kick']);
});
