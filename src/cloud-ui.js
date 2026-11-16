import { createReporter } from './notifications.js';
import { getPreference, setPreference } from './preferences.js';
import { confirmAction } from './dialogs.js';
import { GoogleDrive, authorizeDrive, loadGoogleIdentity } from './google-drive.js';
import { applyCloudBackup, listCloudBackups, readCloudBackup, saveCloudBackup } from './cloud-backup.js';

export function setupCloudBackup(sources) {
  const dialog = document.querySelector('#cloud-dialog');
  const status = createReporter('backups', 'cloud-status');
  const validation = document.querySelector('#cloud-validation');
  const clientId = document.querySelector('#cloud-client-id');
  const name = document.querySelector('#cloud-name');
  const versions = document.querySelector('#cloud-versions');
  const connect = document.querySelector('#cloud-connect');
  const disconnect = document.querySelector('#cloud-disconnect');
  const save = document.querySelector('#cloud-save');
  const refresh = document.querySelector('#cloud-refresh');
  const merge = document.querySelector('#cloud-merge');
  const replace = document.querySelector('#cloud-replace');
  const close = document.querySelector('#cloud-close');
  let identityReady = false;
  let busy = false;
  let session;
  let drive;
  let folder;
  document.querySelector('#cloud-origin').textContent = window.location.origin;
  clientId.value = getPreference('googleClientId', (value) => typeof value === 'string', '');

  function updateControls() {
    const connected = Boolean(session && Date.now() < session.expiresAt && folder);
    connect.disabled = busy || !identityReady;
    disconnect.disabled = busy || !session;
    clientId.disabled = busy;
    name.disabled = busy || !connected;
    versions.disabled = busy || !connected || !versions.options.length;
    save.disabled = refresh.disabled = busy || !connected;
    merge.disabled = replace.disabled = busy || !connected || !versions.options.length;
    close.disabled = busy;
  }

  function connectedDrive() {
    if (!session || Date.now() >= session.expiresAt || !folder) {
      session = drive = folder = undefined;
      versions.replaceChildren();
      updateControls();
      throw new Error('Google Drive authorization has expired. Connect again.');
    }
    return drive;
  }

  async function loadVersions() {
    const files = await listCloudBackups(connectedDrive(), folder);
    versions.replaceChildren(...files.map((file) => new Option(file.name, file.id)));
    updateControls();
    return files.length;
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    updateControls();
    status('');
    try {
      await action();
    } catch (error) {
      if (error.status === 401) {
        session = drive = folder = undefined;
        versions.replaceChildren();
        status('Google Drive authorization expired or was revoked. Connect again.', 'error');
      } else {
        status(`Cloud backup failed: ${error.message || error}`, 'error');
      }
    } finally {
      busy = false;
      updateControls();
    }
  }

  document.querySelector('#cloud-open').addEventListener('click', () => {
    validation.textContent = '';
    status('');
    dialog.showModal();
    updateControls();
    if (!identityReady) {
      status('Loading Google sign-in…');
      loadGoogleIdentity().then(() => {
        identityReady = true;
        if (dialog.open) status('Enter your OAuth client ID and connect to Google Drive.');
        updateControls();
      }).catch((error) => { status(error.message || String(error), 'error'); });
    }
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  clientId.addEventListener('change', () => {
    validation.textContent = '';
    if (session) {
      session = drive = folder = undefined;
      versions.replaceChildren();
      status('Client ID changed. Connect again.');
      updateControls();
    }
  });
  connect.addEventListener('click', () => {
    const value = clientId.value.trim();
    if (!value) {
      validation.textContent = 'Enter your Google OAuth client ID.';
      clientId.focus();
      return;
    }
    validation.textContent = '';
    setPreference('googleClientId', value);
    session = drive = folder = undefined;
    versions.replaceChildren();
    void run(async () => {
      session = await authorizeDrive(value);
      drive = new GoogleDrive(session.token);
      folder = await drive.folder();
      const count = await loadVersions();
      status(`Connected to Google Drive. ${count} backup version(s) available.`);
    });
  });
  disconnect.addEventListener('click', () => {
    session = drive = folder = undefined;
    versions.replaceChildren();
    status('Disconnected from Google Drive; existing backups were not deleted.');
    updateControls();
  });
  refresh.addEventListener('click', () => void run(async () => {
    const count = await loadVersions();
    status(`${count} backup version(s) available.`);
  }));
  save.addEventListener('click', () => {
    const backupName = name.value.trim();
    if (!backupName) {
      validation.textContent = 'Enter a backup name.';
      name.focus();
      return;
    }
    validation.textContent = '';
    void run(async () => {
      await saveCloudBackup(connectedDrive(), folder, sources, backupName);
      await loadVersions();
      status(`Saved cloud backup "${backupName}".`);
    });
  });
  async function restore(replaceExisting) {
    if (replaceExisting && !await confirmAction('Replace browser data',
      'Replace saved patches, patterns, loops and SuperKnob presets with this backup? Older backups leave SuperKnob presets unchanged. A recovery backup will first be saved to Google Drive.', 'Replace')) return;
    await run(async () => {
      const remote = connectedDrive();
      const snapshot = await readCloudBackup(remote, versions.value);
      if (replaceExisting) await saveCloudBackup(remote, folder, sources, 'Recovery before restore', 'recovery');
      await applyCloudBackup(sources, snapshot, replaceExisting);
      if (replaceExisting) await loadVersions();
      status(replaceExisting
        ? 'Cloud backup restored. A recovery backup was saved before replacement.'
        : 'Cloud backup merged into this browser.');
    });
  }
  merge.addEventListener('click', () => void restore(false));
  replace.addEventListener('click', () => void restore(true));
  updateControls();
}
