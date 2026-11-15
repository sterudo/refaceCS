import { validPatterns } from './drum-machine.js';
import { validTones } from './drum-tones.js';
import { validateSavedLoops } from './looper.js';
import { validatePatch } from './patches.js';

const format = 'refaceCS-cloud-backup';
const maxBytes = 256 * 1024 * 1024;
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);

async function digest(blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function saveCloudBackup(drive, folder, sources, name, kind = 'named') {
  const patches = await sources.patches.list();
  const categories = await sources.patches.listCategories();
  const patterns = sources.drums.listPatterns();
  const tones = sources.drums.listTones();
  const loops = await sources.looper.listSavedLoops();
  const createdAt = new Date().toISOString();
  const audioSize = patches.reduce((sum, patch) => sum + patch.audio.reduce((size, item) => size + item.data.size, 0), 0);
  if (audioSize > maxBytes) throw new Error('Cloud backup audio exceeds 256 MB.');
  const records = [];
  for (const patch of patches) {
    const audio = [];
    for (const attachment of patch.audio) {
      const checksum = await digest(attachment.data);
      const file = await drive.createFile(folder, `audio-${crypto.randomUUID()}.mp3`, attachment.data, 'audio/mpeg',
        { refaceType: 'audio' });
      if (!validId(file.id)) throw new Error('Google Drive returned an invalid audio file ID.');
      audio.push({ ...attachment, data: undefined, fileId: file.id, sha256: checksum });
    }
    records.push({ ...patch, audio });
  }
  const snapshot = {
    format, version: 1, sections: { patches: 1, patterns: 2, loops: 1 }, name, createdAt, kind,
    patches: records, categories, patterns, tones, loops,
  };
  const data = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
  if (data.size > maxBytes) throw new Error('Cloud backup metadata exceeds 256 MB.');
  return drive.createFile(folder, `${name} - ${createdAt.replace(/:/g, '-')}.json`, data, 'application/json',
    { refaceType: 'backup', createdAt, kind });
}

export async function listCloudBackups(drive, folder) {
  if (!validId(folder)) throw new Error('Invalid Google Drive folder ID.');
  const files = await drive.list(`'${folder}' in parents and trashed = false and appProperties has { key='refaceType' and value='backup' }`);
  return files.sort((a, b) => (b.appProperties?.createdAt || b.createdTime).localeCompare(a.appProperties?.createdAt || a.createdTime));
}

export async function readCloudBackup(drive, id) {
  if (!validId(id)) throw new Error('Invalid cloud backup ID.');
  const blob = await drive.download(id);
  if (blob.size > maxBytes) throw new Error('Cloud backup metadata exceeds 256 MB.');
  const data = JSON.parse(await blob.text());
  const sections = data?.sections;
  if (data?.format !== format || data.version !== 1 || !sections || Array.isArray(sections)
    || Object.keys(sections).length !== 3 || sections.patches !== 1 || sections.loops !== 1
    || ![1, 2].includes(sections.patterns)) {
    throw new Error('Unsupported cloud backup format or section version.');
  }
  if (!Array.isArray(data.patches) || !Array.isArray(data.categories)
    || !data.categories.every((value) => typeof value === 'string' && value.trim())
    || !validPatterns(data.patterns) || (sections.patterns === 2 && !validTones(data.tones))) throw new Error('Invalid cloud backup data.');
  validateSavedLoops(data.loops);
  const patches = [];
  let total = 0;
  for (const patch of data.patches) {
    if (!Array.isArray(patch.audio) || patch.audio.length > 3) throw new Error('Invalid cloud audio list.');
    const audio = [];
    for (const attachment of patch.audio) {
      if (!validId(attachment.fileId) || !/^[a-f0-9]{64}$/.test(attachment.sha256)) {
        throw new Error('Invalid cloud audio reference.');
      }
      const content = await drive.download(attachment.fileId);
      total += content.size;
      if (total > maxBytes) throw new Error('Cloud backup audio exceeds 256 MB.');
      if (await digest(content) !== attachment.sha256) throw new Error(`Cloud audio "${attachment.name}" is damaged or changed.`);
      const { fileId, sha256, ...metadata } = attachment;
      audio.push({ ...metadata, data: content });
    }
    patches.push(validatePatch({ ...patch, audio }));
  }
  if (new Set(patches.map((patch) => patch.id)).size !== patches.length) throw new Error('Duplicate patch IDs in cloud backup.');
  return { patches, categories: data.categories, patterns: data.patterns, tones: data.tones, loops: data.loops };
}

export async function applyCloudBackup(sources, snapshot, replace) {
  const completed = [];
  try {
    if (replace) await sources.patches.replaceAll(snapshot.patches, snapshot.categories);
    else {
      await sources.patches.importPatches(snapshot.patches, { activateSingle: false });
      await sources.patches.importCategories(snapshot.categories);
    }
    completed.push('patches');
    if (replace) sources.drums.replacePatterns(snapshot.patterns);
    else await sources.drums.importPatterns(snapshot.patterns, { activateSingle: false });
    completed.push('patterns');
    if (snapshot.tones) {
      if (replace) sources.drums.replaceTones(snapshot.tones);
      else await sources.drums.importTones(snapshot.tones);
      completed.push('drum tones');
    }
    if (replace) await sources.looper.replaceSavedLoops(snapshot.loops);
    else await sources.looper.importSavedLoops(snapshot.loops, { activateSingle: false });
  } catch (error) {
    throw new Error(`${error.message || error}${completed.length ? ` Already restored: ${completed.join(', ')}.` : ''}`);
  }
}
