import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { validateSuperKnob } from './superknob.js';

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

export const PATCH_TYPES = ['hardware', 'soft-synth'];

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
const BACKUP_VERSION = 2;
const patchIdPattern = /^[A-Za-z0-9_-]{1,100}$/;
const controlMaximums = Object.fromEntries(PATCH_CONTROL_IDS.map((id) => [
  id,
  ['lfo-assign', 'osc-type', 'effect-type'].includes(id) ? 4 : 127,
]));

function factoryControls(overrides) {
  return {
    'lfo-assign': 0,
    'lfo-depth': 0,
    'lfo-speed': 0,
    portamento: 0,
    'osc-type': 0,
    'osc-texture': 64,
    'osc-mod': 0,
    'filter-cutoff': 127,
    'filter-resonance': 0,
    'eg-balance': 0,
    'eg-attack': 0,
    'eg-decay': 127,
    'eg-sustain': 127,
    'eg-release': 0,
    'effect-type': 0,
    'effect-depth': 0,
    'effect-rate': 0,
    ...overrides,
  };
}

export const SYSTEM_PATCHES = [
  {
    id: 'system-soft-bass',
    name: 'First Bass',
    description: 'A focused saw bass with a short envelope and a warm low-pass filter.',
    category: 'bass',
    tags: ['factory', 'soft synth'],
    type: 'soft-synth',
    author: 'System',
    controls: factoryControls({
      'osc-texture': 64, 'filter-cutoff': 43, 'filter-resonance': 24,
      'eg-attack': 0, 'eg-decay': 42, 'eg-sustain': 62, 'eg-release': 20,
    }),
    audio: [],
    favorite: false,
  },
  {
    id: 'system-soft-lead',
    name: 'Bright Pulse Lead',
    description: 'A bright pulse lead with gentle volume movement.',
    category: 'leads',
    tags: ['factory', 'soft synth'],
    type: 'soft-synth',
    author: 'System',
    controls: factoryControls({
      'lfo-assign': 1, 'lfo-speed': 36, 'lfo-depth': 24, 'osc-type': 1, 'osc-texture': 42,
      'filter-cutoff': 92, 'filter-resonance': 28,
      'eg-attack': 3, 'eg-decay': 35, 'eg-sustain': 82, 'eg-release': 24,
    }),
    audio: [],
    favorite: false,
  },
  {
    id: 'system-soft-pad',
    name: 'Slow Saw Pad',
    description: 'A soft saw pad with a slow attack, gentle volume movement, and a long release.',
    category: 'pads',
    tags: ['factory', 'soft synth'],
    type: 'soft-synth',
    author: 'System',
    controls: factoryControls({
      'lfo-assign': 1, 'lfo-speed': 25, 'lfo-depth': 18, 'osc-texture': 64,
      'filter-cutoff': 78, 'filter-resonance': 10,
      'eg-attack': 47, 'eg-decay': 74, 'eg-sustain': 89, 'eg-release': 76,
    }),
    audio: [],
    favorite: false,
  },
].map((patch) => validatePatch({ ...patch, hidden: false }));

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
  const type = source.type ?? 'hardware';
  const author = source.author ?? 'User';
  assert(PATCH_TYPES.includes(type), 'Patch type is invalid.');
  assert(author === 'System' || author === 'User', 'Patch author is invalid.');
  assert(source.hidden === undefined || typeof source.hidden === 'boolean', 'Patch visibility is invalid.');
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
    type,
    author,
    hidden: author === 'System' && Boolean(source.hidden),
    tags,
    controls,
    ...(source.superKnob === undefined ? {} : { superKnob: validateSuperKnob(source.superKnob) }),
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
        const request = indexedDB.open(PATCH_DATABASE_NAME, 3);
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
      }).then(async (database) => {
        await this.seedSystemPatches(database);
        return database;
      }).catch((error) => {
        this.databasePromise = null;
        throw error;
      });
    }
    return this.databasePromise;
  }

  async seedSystemPatches(database) {
    const transaction = database.transaction([PATCH_STORE_NAME, 'library-settings'], 'readwrite');
    const done = transactionComplete(transaction);
    const patchStore = transaction.objectStore(PATCH_STORE_NAME);
    const settingsStore = transaction.objectStore('library-settings');
    const [existing, categoryRecord] = await Promise.all([
      requestResult(patchStore.getAll()),
      requestResult(settingsStore.get('categories')),
    ]);
    const ids = new Set(existing.map((patch) => patch.id));
    for (const patch of SYSTEM_PATCHES) {
      if (!ids.has(patch.id)) patchStore.put(patch);
    }
    const categories = categoryRecord?.values ?? [...STARTER_CATEGORIES];
    settingsStore.put({
      id: 'categories',
      values: [...new Set([...categories, ...SYSTEM_PATCHES.map((patch) => patch.category)])],
    });
    await done;
  }

  async list() {
    const database = await this.open();
    const transaction = database.transaction(PATCH_STORE_NAME, 'readonly');
    const done = transactionComplete(transaction);
    const result = await requestResult(transaction.objectStore(PATCH_STORE_NAME).getAll());
    await done;
    return result.map(validatePatch);
  }

  async replaceAll(patches, categories) {
    const records = patches.map(validatePatch).filter((record) => record.author !== 'System');
    assert(Array.isArray(categories) && categories.every((value) => typeof value === 'string' && value.trim()),
      'Patch categories are invalid.');
    const database = await this.open();
    const transaction = database.transaction([PATCH_STORE_NAME, 'library-settings'], 'readwrite');
    const done = transactionComplete(transaction);
    const objectStore = transaction.objectStore(PATCH_STORE_NAME);
    const existing = await requestResult(objectStore.getAll());
    const systemPatches = existing.filter((record) => record.author === 'System');
    const combined = [...records, ...systemPatches];
    assert(new Set(combined.map((record) => record.id)).size === combined.length, 'Patch IDs must be unique.');
    objectStore.clear();
    for (const record of combined) objectStore.put(record);
    transaction.objectStore('library-settings').put({
      id: 'categories',
      values: [...new Set([...categories, ...combined.map((record) => record.category)])],
    });
    await done;
  }

  async put(patch) {
    const record = validatePatch(patch);
    assert(record.author !== 'System', 'System patches are read-only; save a copy instead.');
    const database = await this.open();
    const transaction = database.transaction([PATCH_STORE_NAME, 'library-settings'], 'readwrite');
    const done = transactionComplete(transaction);
    const objectStore = transaction.objectStore(PATCH_STORE_NAME);
    const existing = await requestResult(objectStore.get(record.id));
    assert(existing?.author !== 'System', 'System patches are read-only; save a copy instead.');
    objectStore.put(record);
    this.registerCategory(transaction, record.category);
    await done;
    return record;
  }

  async replace(deleteId, patch) {
    const record = validatePatch(patch);
    assert(record.author !== 'System', 'System patches are read-only; save a copy instead.');
    assert(deleteId !== record.id, 'Replacement patch ID must differ from the deleted patch ID.');
    const database = await this.open();
    const transaction = database.transaction([PATCH_STORE_NAME, 'library-settings'], 'readwrite');
    const done = transactionComplete(transaction);
    const objectStore = transaction.objectStore(PATCH_STORE_NAME);
    const [existingDelete, existingTarget] = await Promise.all([
      requestResult(objectStore.get(deleteId)),
      requestResult(objectStore.get(record.id)),
    ]);
    assert(existingDelete?.author !== 'System' && existingTarget?.author !== 'System',
      'System patches are read-only; save a copy instead.');
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
    const objectStore = transaction.objectStore(PATCH_STORE_NAME);
    const existing = await requestResult(objectStore.get(id));
    assert(existing?.author !== 'System', 'System patches cannot be deleted.');
    objectStore.delete(id);
    await done;
  }

  async setHidden(id, hidden) {
    assert(typeof hidden === 'boolean', 'Patch visibility is invalid.');
    const database = await this.open();
    const transaction = database.transaction(PATCH_STORE_NAME, 'readwrite');
    const done = transactionComplete(transaction);
    const objectStore = transaction.objectStore(PATCH_STORE_NAME);
    const existing = await requestResult(objectStore.get(id));
    assert(existing?.author === 'System', 'Only System patches can be hidden.');
    objectStore.put({ ...existing, hidden, updatedAt: new Date().toISOString() });
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

  async addCategories(categories) {
    const values = categories.map((value) => normalizeText(value, 'Category'));
    const database = await this.open();
    const transaction = database.transaction('library-settings', 'readwrite');
    const done = transactionComplete(transaction);
    const settings = transaction.objectStore('library-settings');
    const current = await requestResult(settings.get('categories'));
    settings.put({ id: 'categories', values: [...new Set([...current.values, ...values])] });
    await done;
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
      if (patch.author !== 'System' && patch.tags.includes(tag)) {
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
      type: patch.type,
      author: patch.author,
      hidden: patch.hidden,
      tags: patch.tags,
      favorite: Boolean(source.favorite),
      controls: patch.controls,
      ...(patch.superKnob === undefined ? {} : { superKnob: patch.superKnob }),
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
    let total = 0;
    const names = new Set();
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        total += entry.originalSize;
        if (names.has(entry.name) || total > 256 * 1024 * 1024) {
          throw new Error('ZIP contains duplicate files or exceeds the 256 MB expanded size limit');
        }
        names.add(entry.name);
        return true;
      },
    });
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
  assert(manifest?.format === BACKUP_FORMAT && [1, BACKUP_VERSION].includes(manifest.version),
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
