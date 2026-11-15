import { askName, choose } from './dialogs.js';

export async function equalValue(a, b) {
  if (a instanceof Blob || b instanceof Blob) {
    if (!(a instanceof Blob) || !(b instanceof Blob) || a.size !== b.size) return false;
    const left = new Uint8Array(await a.arrayBuffer());
    const right = new Uint8Array(await b.arrayBuffer());
    return left.every((value, index) => value === right[index]);
  }
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) {
      if (!await equalValue(a[index], b[index])) return false;
    }
    return true;
  }
  const ignored = new Set(['id', 'createdAt', 'updatedAt', 'lastModified']);
  const keysA = Object.keys(a).filter((key) => !ignored.has(key)).sort();
  const keysB = Object.keys(b).filter((key) => !ignored.has(key)).sort();
  if (keysA.length !== keysB.length || keysA.some((key, index) => key !== keysB[index])) return false;
  for (const key of keysA) if (!await equalValue(a[key], b[key])) return false;
  return true;
}

export async function resolveImport(item, existing, kind, equals = equalValue) {
  const matches = existing.filter((candidate) => candidate.id === item.id
    || candidate.name.toLocaleLowerCase() === item.name.toLocaleLowerCase());
  if (matches.length > 1) throw new Error(`${kind} ID and name match different existing items`);
  const match = matches[0];
  if (!match) return { action: 'new', item };
  if (await equals(match, item)) return { action: 'identical', item: match };
  const action = await choose(`Import ${kind}`, `"${item.name}" differs from the existing "${match.name}".`, [
    ['Overwrite', 'overwrite'], ['Ignore', 'ignore'], ['Create new', 'create'],
  ]);
  if (!action || action === 'ignore') return { action: 'ignore' };
  if (action === 'overwrite') return { action, item: { ...item, id: match.id }, match };
  const used = new Set(existing.map((value) => value.name.toLocaleLowerCase()));
  let suffix = 2;
  let suggested = `${item.name} (${suffix})`;
  while (used.has(suggested.toLocaleLowerCase())) suggested = `${item.name} (${++suffix})`;
  const name = await askName(`Create new ${kind}`, 'Choose a name for the imported item.', suggested,
    (value) => used.has(value.toLocaleLowerCase()) ? 'That name is already in use.' : '');
  if (!name) return { action: 'ignore' };
  return { action: 'new', item: { ...item, id: crypto.randomUUID(), name } };
}
