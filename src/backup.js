import { createReporter } from './notifications.js';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createPatchBackup, readPatchBackup } from './patches.js';
import { validPatterns } from './drum-machine.js';
import { validTones } from './drum-tones.js';
import { validateSavedLoops } from './looper.js';
import { validateSuperKnobPresets } from './superknob.js';

const paths = { patches: 'patches.zip', patterns: 'patterns.json', loops: 'loops.json', superknob: 'superknob.json' };
const maxBytes = 256 * 1024 * 1024;

export function setupBackup({ patches, drums, looper, superKnob }) {
  const dialog = document.querySelector('#backup-dialog');
  const section = document.querySelector('#backup-section');
  const status = createReporter('backups', 'backup-status');
  const result = createReporter('backups', 'backup-result');
  const fileInput = document.querySelector('#backup-file');
  const controls = [document.querySelector('#backup-import'), document.querySelector('#backup-export')];

  document.querySelector('#backup-open').addEventListener('click', () => {
    status('');
    result('');
    dialog.showModal();
  });
  document.querySelector('#backup-close').addEventListener('click', () => dialog.close());
  controls[0].addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  controls[1].addEventListener('click', async () => {
    controls.forEach((button) => { button.disabled = true; });
    try {
      const selected = section.value === 'all' ? Object.keys(paths) : [section.value];
      const files = {};
      if (selected.includes('patches')) {
        files[paths.patches] = new Uint8Array(await (await createPatchBackup(await patches.list())).arrayBuffer());
        files['patch-categories.json'] = strToU8(JSON.stringify(await patches.listCategories()));
      }
      if (selected.includes('patterns')) {
        files[paths.patterns] = strToU8(JSON.stringify(drums.listPatterns()));
        files['drum-tones.json'] = strToU8(JSON.stringify(drums.listTones()));
      }
      if (selected.includes('loops')) files[paths.loops] = strToU8(JSON.stringify(await looper.listSavedLoops()));
      if (selected.includes('superknob')) files[paths.superknob] = strToU8(JSON.stringify(superKnob.listPresets()));
      files['manifest.json'] = strToU8(JSON.stringify({
        format: 'refaceCS-backup', version: 1,
        sections: Object.fromEntries(selected.map((name) => [name, name === 'patterns' ? 2 : 1])),
      }));
      const blob = new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `refaceCS-${section.value}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      result('Backup exported. Browser preferences are not included.');
      dialog.close();
    } catch (error) {
      status(`Could not export backup: ${error.message || error}.`, 'error');
    } finally {
      controls.forEach((button) => { button.disabled = false; });
    }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    controls.forEach((button) => { button.disabled = true; });
    const applied = [];
    try {
      if (file.size > maxBytes) throw new Error('Backup exceeds the 256 MB size limit');
      let total = 0;
      const seen = new Set();
      const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter(entry) {
          total += entry.originalSize;
          if (seen.has(entry.name) || total > maxBytes) throw new Error('Duplicate files or expanded backup exceeds 256 MB');
          seen.add(entry.name);
          return true;
        },
      });
      if (!files['manifest.json'] && files['patches.json']) {
        const imported = await readPatchBackup(file);
        await patches.importPatches(imported);
        result('Imported legacy patch ZIP.');
        dialog.close();
        return;
      }
      if (!files['manifest.json']) throw new Error('Backup manifest is missing');
      const manifest = JSON.parse(strFromU8(files['manifest.json']));
      if (manifest?.format !== 'refaceCS-backup' || manifest.version !== 1
        || !manifest.sections || typeof manifest.sections !== 'object' || Array.isArray(manifest.sections)) {
        throw new Error('Unsupported backup format or version; update the app if this backup is newer');
      }
      const names = Object.keys(manifest.sections);
      if (!names.length || names.some((name) => !Object.hasOwn(paths, name)
        || !(name === 'patterns' ? [1, 2] : [1]).includes(manifest.sections[name]))) {
        throw new Error('Unsupported backup section or version; update the app');
      }
      const expected = new Set(['manifest.json', ...names.map((name) => paths[name])]);
      if (names.includes('patches') && files['patch-categories.json']) expected.add('patch-categories.json');
      if (manifest.sections.patterns === 2) expected.add('drum-tones.json');
      if (Object.keys(files).some((name) => !expected.has(name))
        || [...expected].some((name) => !files[name])) throw new Error('Backup files do not match its manifest');
      const data = {};
      if (names.includes('patches')) {
        data.patches = await readPatchBackup(new Blob([files[paths.patches]]));
        if (files['patch-categories.json']) {
          data.categories = JSON.parse(strFromU8(files['patch-categories.json']));
          if (!Array.isArray(data.categories) || !data.categories.every((value) => typeof value === 'string' && value.trim())) {
            throw new Error('Invalid patch categories');
          }
        }
      }
      if (names.includes('patterns')) {
        data.patterns = JSON.parse(strFromU8(files[paths.patterns]));
        if (!validPatterns(data.patterns)) throw new Error('Invalid groove patterns');
        if (manifest.sections.patterns === 2) {
          data.tones = JSON.parse(strFromU8(files['drum-tones.json']));
          if (!validTones(data.tones)) throw new Error('Invalid drum tones');
        }
      }
      if (names.includes('loops')) {
        data.loops = JSON.parse(strFromU8(files[paths.loops]));
        validateSavedLoops(data.loops);
      }
      if (names.includes('superknob')) {
        data.superknob = validateSuperKnobPresets(JSON.parse(strFromU8(files[paths.superknob])));
      }
      const options = { activateSingle: names.length === 1 };
      if (data.patches) {
        await patches.importPatches(data.patches, options);
        applied.push('patches');
        if (data.categories) await patches.importCategories(data.categories);
      }
      if (data.patterns) { await drums.importPatterns(data.patterns, options); applied.push('patterns'); }
      if (data.tones) { await drums.importTones(data.tones); applied.push('drum tones'); }
      if (data.loops) { await looper.importSavedLoops(data.loops, options); applied.push('loops'); }
      if (data.superknob) { await superKnob.importPresets(data.superknob); applied.push('SuperKnob presets'); }
      result(`Imported ${applied.join(', ')}. Existing items were kept unless replacement was confirmed.`);
      dialog.close();
    } catch (error) {
      status(`Could not import backup: ${error.message || error}.${applied.length ? ` Already imported: ${applied.join(', ')}.` : ''}`, 'error');
    } finally {
      controls.forEach((button) => { button.disabled = false; });
    }
  });
}
