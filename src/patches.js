import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export const PATCH_CONTROL_IDS = [
  'lfo-assign',
  'lfo-depth',
  'lfo-speed',
  'portamento',
  'osc-type',
  'osc-texture',
  'osc-mod',
  'filter-cutoff',
  'filter-resonance',
  'eg-balance',
  'eg-attack',
  'eg-decay',
  'eg-sustain',
  'eg-release',
  'effect-type',
  'effect-depth',
  'effect-rate',
];

export const STARTER_CATEGORIES = [
  'pads',
  'bass',
  'plucks',
  'keys',
  'synth',
  'FM',
  'noise',
  'FX',
  'Percussion',
];

const PATCH_STORE_NAME = 'patches';
const PATCH_DATABASE_NAME = 'refaceCS-library';
const BACKUP_FILE_NAME = 'patches.json';
const BACKUP_FORMAT = 'refaceCS-patch-backup';
const BACKUP_VERSION = 1;
const patchIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

const controlMaximums = Object.fromEntries(PATCH_CONTROL_IDS.map((id) => [
  id,
  ['lfo-assign', 'osc-type', 'effect-type'].includes(id) ? 4 : 127,
]));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeText(value, label, { optional = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const text = value.trim().normalize('NFC');
  if (!optional && !text) throw new Error(`${label} is required.`);
  return text;
}

export function validatePatch(source) {
  assert(source && typeof source === 'object' && !Array.isArray(source), 'Patch data is invalid.');
  assert(typeof source.id === 'string' && patchIdPattern.test(source.id), 'Patch ID is invalid.');

  const name = normalizeText(source.name, 'Patch name');
  const description = normalizeText(source.description ?? '', 'Description', { optional: true });
  const category = normalizeText(source.category, 'Category');
  assert(source.favorite === undefined || typeof source.favorite === 'boolean', 'Favorite state is invalid.');
  assert(Array.isArray(source.tags), 'Patch tags are invalid.');
  const tags = [];
  const seenTags = new Set();
  for (const value of source.tags) {
    const tag = normalizeText(value, 'Tag');
    const key = tag.toLocaleLowerCase();
    if (!seenTags.has(key)) {
      seenTags.add(key);
      tags.push(tag);
    }
  }

  assert(source.controls && typeof source.controls === 'object' && !Array.isArray(source.controls),
    'Patch controls are invalid.');
  const controls = {};
  for (const id of PATCH_CONTROL_IDS) {
    const value = source.controls[id];
    assert(Number.isInteger(value) && value >= 0 && value <= controlMaximums[id],
      `Patch control "${id}" is invalid.`);
    controls[id] = value;
  }

  assert(Array.isArray(source.audio) && source.audio.length <= 3, 'A patch can have up to three MP3 attachments.');
  const audioIds = new Set();
  const audio = source.audio.map((item) => {
    assert(item && typeof item === 'object' && !Array.isArray(item), 'Audio attachment is invalid.');
    assert(typeof item.id === 'string' && patchIdPattern.test(item.id), 'Audio attachment ID is invalid.');
    assert(!audioIds.has(item.id), 'Audio attachment IDs must be unique within a patch.');
    audioIds.add(item.id);
    const itemName = normalizeText(item.name, 'Audio filename');
    assert(item.data instanceof Blob, 'Audio attachment data is missing.');
    return {
      id: item.id,
      name: itemName,
      type: 'audio/mpeg',
      lastModified: Number.isFinite(item.lastModified) ? item.lastModified : 0,
      data: item.data,
    };
  });

  const createdAt = typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString();
  const updatedAt = typeof source.updatedAt === 'string' ? source.updatedAt : createdAt;
  return {
    id: source.id,
    name,
    description,
    category,
    tags,
    controls,
    audio,
    favorite: Boolean(source.favorite),
    createdAt,
    updatedAt,
  };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
  });
}

export class PatchStore {
  constructor() {
    this.databasePromise = null;
  }

  open() {
    if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(PATCH_DATABASE_NAME, 2);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(PATCH_STORE_NAME)) {
            request.result.createObjectStore(PATCH_STORE_NAME, { keyPath: 'id' });
          }
          if (!request.result.objectStoreNames.contains('library-settings')) {
            const settings = request.result.createObjectStore('library-settings', { keyPath: 'id' });
            settings.put({ id: 'categories', values: [...STARTER_CATEGORIES] });
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => database.close();
          resolve(database);
        };
        request.onerror = () => reject(request.error || new Error('Could not open patch storage.'));
        request.onblocked = () => reject(new Error('Patch storage is blocked by another open tab.'));
      }).catch((error) => {
        this.databasePromise = null;
        throw error;
      });
    }
    return this.databasePromise;
  }

  async list() {
    const database = await this.open();
    const transaction = database.transaction(PATCH_STORE_NAME, 'readonly');
    const done = transactionComplete(transaction);
    const result = await requestResult(transaction.objectStore(PATCH_STORE_NAME).getAll());
    await done;
    return result.map(validatePatch);
  }

  async put(patch) {
    const record = validatePatch(patch);
    const database = await this.open();
    const transaction = database.transaction([PATCH_STORE_NAME, 'library-settings'], 'readwrite');
    const done = transactionComplete(transaction);
    transaction.objectStore(PATCH_STORE_NAME).put(record);
    this.registerCategory(transaction, record.category);
    await done;
    return record;
  }

  async replace(deleteId, patch) {
    const record = validatePatch(patch);
    assert(deleteId !== record.id, 'Replacement patch ID must differ from the deleted patch ID.');
    const database = await this.open();
    const transaction = database.transaction([PATCH_STORE_NAME, 'library-settings'], 'readwrite');
    const done = transactionComplete(transaction);
    const objectStore = transaction.objectStore(PATCH_STORE_NAME);
    objectStore.put(record);
    objectStore.delete(deleteId);
    this.registerCategory(transaction, record.category);
    await done;
    return record;
  }

  async delete(id) {
    const database = await this.open();
    const transaction = database.transaction(PATCH_STORE_NAME, 'readwrite');
    const done = transactionComplete(transaction);
    transaction.objectStore(PATCH_STORE_NAME).delete(id);
    await done;
  }

  registerCategory(transaction, category) {
    const settings = transaction.objectStore('library-settings');
    const request = settings.get('categories');
    request.onsuccess = () => {
      const values = [...new Set([...request.result.values, category])];
      settings.put({ id: 'categories', values });
    };
  }

  async listCategories() {
    const database = await this.open();
    const transaction = database.transaction([PATCH_STORE_NAME, 'library-settings'], 'readwrite');
    const done = transactionComplete(transaction);
    const settings = transaction.objectStore('library-settings');
    const result = await requestResult(settings.get('categories'));
    const patches = await requestResult(transaction.objectStore(PATCH_STORE_NAME).getAll());
    const values = [...new Set([...result.values, ...patches.map((patch) => patch.category)])];
    settings.put({ id: 'categories', values });
    await done;
    return values;
  }

  async deleteCategory(category) {
    const database = await this.open();
    const transaction = database.transaction([PATCH_STORE_NAME, 'library-settings'], 'readwrite');
    const done = transactionComplete(transaction);
    const patches = await requestResult(transaction.objectStore(PATCH_STORE_NAME).getAll());
    if (patches.some((patch) => patch.category === category)) {
      await done;
      throw new Error('Only unused categories can be deleted.');
    }
    const settings = transaction.objectStore('library-settings');
    const result = await requestResult(settings.get('categories'));
    settings.put({ id: 'categories', values: result.values.filter((value) => value !== category) });
    await done;
  }

  async deleteTag(tag) {
    const database = await this.open();
    const transaction = database.transaction(PATCH_STORE_NAME, 'readwrite');
    const done = transactionComplete(transaction);
    const objectStore = transaction.objectStore(PATCH_STORE_NAME);
    const patches = await requestResult(objectStore.getAll());
    for (const patch of patches) {
      if (patch.tags.includes(tag)) {
        objectStore.put({
          ...patch,
          tags: patch.tags.filter((value) => value !== tag),
          updatedAt: new Date().toISOString(),
        });
      }
    }
    await done;
  }
}

export async function createPatchBackup(patches) {
  const files = {};
  const manifest = { format: BACKUP_FORMAT, version: BACKUP_VERSION, patches: [] };
  const patchIds = new Set();

  for (const source of patches) {
    const patch = validatePatch(source);
    assert(!patchIds.has(patch.id), 'Patch IDs must be unique in a backup.');
    patchIds.add(patch.id);
    const audio = [];
    for (const attachment of patch.audio) {
      const path = `audio/${patch.id}/${attachment.id}.mp3`;
      files[path] = new Uint8Array(await attachment.data.arrayBuffer());
      audio.push({
        id: attachment.id,
        name: attachment.name,
        lastModified: attachment.lastModified,
        path,
      });
    }
    manifest.patches.push({
      id: patch.id,
      name: patch.name,
      description: patch.description,
      category: patch.category,
      tags: patch.tags,
      favorite: Boolean(source.favorite),
      controls: patch.controls,
      audio,
      createdAt: patch.createdAt,
      updatedAt: patch.updatedAt,
    });
  }

  files[BACKUP_FILE_NAME] = strToU8(JSON.stringify(manifest));
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}

export async function readPatchBackup(file) {
  let entries;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    throw new Error(`Could not read ZIP backup: ${error.message || error}`);
  }

  const manifestFile = entries[BACKUP_FILE_NAME];
  assert(manifestFile, 'ZIP backup does not contain patches.json.');
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(manifestFile));
  } catch {
    throw new Error('ZIP backup manifest is not valid JSON.');
  }
  assert(manifest?.format === BACKUP_FORMAT && manifest.version === BACKUP_VERSION,
    'This patch backup format or version is not supported.');
  assert(Array.isArray(manifest.patches), 'ZIP backup patch list is invalid.');

  const expectedFiles = new Set([BACKUP_FILE_NAME]);
  const patchIds = new Set();
  const patches = manifest.patches.map((source) => {
    assert(source && typeof source === 'object' && Array.isArray(source.audio),
      'ZIP backup patch data is invalid.');
    assert(typeof source.id === 'string' && patchIdPattern.test(source.id), 'ZIP backup patch ID is invalid.');
    assert(!patchIds.has(source.id), 'ZIP backup contains duplicate patch IDs.');
    assert(source.audio.length <= 3, 'A patch can have up to three MP3 attachments.');
    patchIds.add(source.id);
    const audio = source.audio.map((attachment) => {
      assert(attachment && typeof attachment === 'object', 'ZIP backup audio metadata is invalid.');
      assert(typeof attachment.id === 'string' && patchIdPattern.test(attachment.id),
        'ZIP backup audio ID is invalid.');
      const expectedPath = `audio/${source.id}/${attachment.id}.mp3`;
      assert(attachment.path === expectedPath, 'ZIP backup audio path is invalid.');
      const data = entries[expectedPath];
      assert(data instanceof Uint8Array, `ZIP backup is missing "${attachment.name}".`);
      expectedFiles.add(expectedPath);
      return {
        id: attachment.id,
        name: attachment.name,
        lastModified: attachment.lastModified,
        data: new Blob([data], { type: 'audio/mpeg' }),
      };
    });
    return validatePatch({ ...source, audio });
  });

  assert(Object.keys(entries).every((path) => expectedFiles.has(path)),
    'ZIP backup contains unexpected files.');
  return patches.map((patch, index) => ({ ...patch, favorite: Boolean(manifest.patches[index].favorite) }));
}
