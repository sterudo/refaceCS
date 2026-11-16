import { createReporter } from './notifications.js';
import { DRUM_VOICES, defaultDrumLane } from './drum-audio.js';
import { askName, choose, confirmAction, exportDialog } from './dialogs.js';
import { resolveImport } from './import-conflicts.js';

const storageKey = 'refaceCS.drumTones.v1';
const keys = ['level', 'tuning', 'decay', 'tone'];
export const toneValues = (lane) => Object.fromEntries(keys.map((key) => [key, lane[key]]));
export function validToneValues(value) {
  return value && [['level', 0, 100], ['tuning', -24, 24], ['decay', 0.02, 2], ['tone', 0, 100]]
    .every(([key, min, max]) => Number.isFinite(value[key]) && value[key] >= min && value[key] <= max);
}
export function validTones(tones) {
  return Array.isArray(tones) && tones.every((tone) => tone && typeof tone.id === 'string' && tone.id
    && typeof tone.name === 'string' && tone.name.trim() && typeof tone.favorite === 'boolean'
    && DRUM_VOICES.some((voice) => voice.id === tone.voice) && validToneValues(tone.controls))
    && new Set(tones.map((tone) => tone.id)).size === tones.length
    && new Set(tones.map((tone) => `${tone.voice}:${tone.name.toLocaleLowerCase()}`)).size === tones.length;
}

export function createDrumTones({ onChange, onLibraryChange, onError, preview }) {
  let tones = [];
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) {
      const data = JSON.parse(saved);
      if (data.version !== 1 || !validTones(data.tones)) throw new Error('Invalid saved tone library');
      tones = data.tones;
    }
  } catch (error) {
    onError(`Could not restore drum tones: ${error.message || error}. Stored data is unchanged.`);
  }
  function write(next) {
    if (!validTones(next)) throw new Error('Invalid tone library');
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, tones: next }));
    tones = next;
  }
  function changed(lane) {
    const voice = DRUM_VOICES.find((item) => item.id === lane.voice);
    const baseline = lane.toneBaseline ?? toneValues(defaultDrumLane(voice));
    return keys.some((key) => lane[key] !== baseline[key]);
  }
  function markSaved(lane, tone) {
    lane.toneId = tone.id;
    lane.toneBaseline = toneValues(lane);
    onChange();
  }
  async function saveAs(lane) {
    const source = tones.find((tone) => tone.id === lane.toneId && tone.voice === lane.voice);
    const name = await askName('Save drum tone', 'Name this instrument variation.', source ? `${source.name} copy` : '',
      (value) => tones.some((tone) => tone.voice === lane.voice && tone.name.toLocaleLowerCase() === value.toLocaleLowerCase())
        ? 'A tone with that name already exists for this instrument.' : '');
    if (!name) return false;
    const tone = { id: crypto.randomUUID(), voice: lane.voice, name, favorite: false, controls: toneValues(lane) };
    write([...tones, tone]);
    markSaved(lane, tone);
    return true;
  }
  async function save(lane) {
    const active = tones.find((tone) => tone.id === lane.toneId && tone.voice === lane.voice);
    if (!active) return saveAs(lane);
    const action = await choose('Save drum tone', `Save changes to "${active.name}"?`,
      [['Cancel', 'cancel'], ['Overwrite', 'overwrite'], ['Save as', 'save-as']]);
    if (action === 'save-as') return saveAs(lane);
    if (action !== 'overwrite') return false;
    const updated = { ...active, controls: toneValues(lane) };
    write(tones.map((tone) => tone.id === active.id ? updated : tone));
    markSaved(lane, updated);
    return true;
  }
  async function protect(lane) {
    if (!changed(lane)) return true;
    const active = tones.find((tone) => tone.id === lane.toneId && tone.voice === lane.voice);
    const action = await choose('Unsaved drum tone', 'The lane tone has changes since its last saved variation.',
      [['Cancel', 'cancel'], ['Discard and load', 'discard'],
        ...(active ? [['Overwrite and load', 'overwrite']] : []), ['Save as and load', 'save-as']]);
    if (action === 'discard') return true;
    if (action === 'save-as') return saveAs(lane);
    if (action === 'overwrite') {
      const updated = { ...active, controls: toneValues(lane) };
      write(tones.map((tone) => tone.id === active.id ? updated : tone));
      markSaved(lane, updated);
      return true;
    }
    return false;
  }
  async function apply(lane, tone) {
    if (!await protect(lane)) return false;
    Object.assign(lane, tone.controls);
    markSaved(lane, tone);
    return true;
  }
  async function importTones(incoming) {
    if (!validTones(incoming)) throw new Error('Invalid drum tones');
    let next = structuredClone(tones);
    let last = null;
    for (const tone of incoming) {
      if (next.some((item) => item.id === tone.id && item.voice !== tone.voice)) {
        throw new Error('A tone ID belongs to a different instrument');
      }
      const sameVoice = next.filter((item) => item.voice === tone.voice);
      const resolution = await resolveImport(tone, sameVoice, 'drum tone');
      if (resolution.action === 'ignore') continue;
      last = resolution.item;
      if (resolution.action === 'identical') continue;
      if (resolution.match) next = next.map((item) => item.id === resolution.match.id ? resolution.item : item);
      else next.push(resolution.item);
    }
    write(next);
    onLibraryChange();
    return last;
  }
  async function importFile(lane, file) {
    if (file.size > 1024 * 1024) throw new Error('Tone file exceeds 1 MB');
    const data = JSON.parse(await file.text());
    if (data?.format !== 'refaceCS-drum-tone' || data.version !== 1 || !validTones([data.tone])) {
      throw new Error('Invalid or unsupported drum tone file');
    }
    if (data.tone.voice !== lane.voice) throw new Error('This tone belongs to a different instrument');
    if (!await protect(lane)) return;
    const imported = await importTones([data.tone]);
    if (imported) {
      Object.assign(lane, imported.controls);
      markSaved(lane, imported);
    }
  }
  async function exportLane(lane) {
    const voice = DRUM_VOICES.find((item) => item.id === lane.voice);
    const active = tones.find((tone) => tone.id === lane.toneId && tone.voice === lane.voice);
    const result = await exportDialog(active?.name ?? voice.name, [
      { id: 'tone', label: 'Drum tone (JSON)', extension: '.json' },
    ]);
    if (!result) return;
    const tone = { id: active?.id ?? crypto.randomUUID(), voice: lane.voice, name: active?.name ?? voice.name,
      favorite: active?.favorite ?? false, controls: toneValues(lane) };
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'refaceCS-drum-tone', version: 1, tone })],
      { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function open(lane) {
    const voice = DRUM_VOICES.find((item) => item.id === lane.voice);
    const dialog = document.createElement('dialog');
    dialog.className = 'patch-editor drum-tone-dialog';
    const title = document.createElement('h2');
    title.id = `drum-tones-${crypto.randomUUID()}`;
    title.textContent = `${voice.name} tones`;
    dialog.setAttribute('aria-labelledby', title.id);
    const searchLabel = document.createElement('label');
    searchLabel.textContent = 'Filter by name ';
    const search = document.createElement('input');
    search.type = 'search';
    searchLabel.append(search);
    const favoritesLabel = document.createElement('label');
    favoritesLabel.className = 'drum-tone-favorites';
    const favorites = document.createElement('input');
    favorites.type = 'checkbox';
    favoritesLabel.append(favorites, ' Favorites only');
    const sortLabel = document.createElement('label');
    sortLabel.textContent = 'Sort ';
    const sort = document.createElement('select');
    sort.add(new Option('Name', 'name'));
    sort.add(new Option('Favorites first', 'favorites'));
    sortLabel.append(sort);
    const feedback = createReporter('groove', 'drum-tone-status');
    const list = document.createElement('div');
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    dialog.append(title, searchLabel, favoritesLabel, sortLabel, list, close);
    document.body.append(dialog);
    function render() {
      const filtered = tones.filter((tone) => tone.voice === lane.voice
        && tone.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())
        && (!favorites.checked || tone.favorite))
        .sort((a, b) => (sort.value === 'favorites' ? Number(b.favorite) - Number(a.favorite) : 0)
          || a.name.localeCompare(b.name));
      list.replaceChildren();
      if (!filtered.length) list.textContent = 'No matching tones.';
      for (const tone of filtered) {
        const row = document.createElement('div');
        row.className = 'drum-tone-row';
        const name = document.createElement('span');
        name.textContent = tone.name;
        const favorite = document.createElement('button');
        favorite.type = 'button';
        favorite.textContent = tone.favorite ? '★' : '☆';
        favorite.setAttribute('aria-label', `${tone.favorite ? 'Unfavorite' : 'Favorite'} ${tone.name}`);
        favorite.addEventListener('click', () => {
          try { write(tones.map((item) => item.id === tone.id ? { ...item, favorite: !item.favorite } : item)); render(); }
          catch (error) { feedback(`Could not update favorite: ${error.message || error}`, 'error'); }
        });
        const play = document.createElement('button');
        play.type = 'button';
        play.textContent = 'Preview';
        play.setAttribute('aria-label', `Preview ${tone.name}`);
        play.addEventListener('click', async () => {
          try { await preview({ ...lane, ...tone.controls }); }
          catch (error) { feedback(`Could not preview tone: ${error.message || error}`, 'error'); }
        });
        const load = document.createElement('button');
        load.type = 'button';
        load.textContent = 'Load';
        load.setAttribute('aria-label', `Load ${tone.name}`);
        load.addEventListener('click', async () => {
          try { if (await apply(lane, tone)) dialog.close(); }
          catch (error) { feedback(`Could not load tone: ${error.message || error}`, 'error'); }
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Delete';
        remove.setAttribute('aria-label', `Delete ${tone.name}`);
        remove.addEventListener('click', async () => {
          if (!await confirmAction('Delete drum tone', `Delete "${tone.name}"? Patterns keep their own tone settings.`, 'Delete')) return;
          try { write(tones.filter((item) => item.id !== tone.id)); onLibraryChange(); render(); }
          catch (error) { feedback(`Could not delete tone: ${error.message || error}`, 'error'); }
        });
        row.append(name, favorite, play, load, remove);
        list.append(row);
      }
    }
    search.addEventListener('input', render);
    favorites.addEventListener('change', render);
    sort.addEventListener('change', render);
    render();
    dialog.showModal();
  }
  return {
    changed, save, open, importFile, exportLane, importTones,
    name: (lane) => tones.find((tone) => tone.id === lane.toneId && tone.voice === lane.voice)?.name,
    list: () => structuredClone(tones),
    replace: (items) => { write(structuredClone(items)); onLibraryChange(); },
  };
}
