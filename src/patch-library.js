import {
  createPatchBackup,
  PATCH_CONTROL_IDS,
  PatchStore,
  validatePatch,
} from './patches.js';
import { createAudioRecorder } from './audio-recording.js';
import { choose, confirmAction, exportDialog } from './dialogs.js';
import { resolveImport } from './import-conflicts.js';

const CONTROL_GROUPS = [
  ['LFO', ['lfo-assign', 'lfo-depth', 'lfo-speed']],
  ['OSC', ['portamento', 'osc-type', 'osc-texture', 'osc-mod']],
  ['FILTER', ['filter-cutoff', 'filter-resonance']],
  ['EG', ['eg-balance', 'eg-attack', 'eg-decay', 'eg-sustain', 'eg-release']],
  ['EFFECTS', ['effect-type', 'effect-depth', 'effect-rate']],
];

const CONTROL_LABELS = {
  'lfo-assign': 'Assign',
  'lfo-depth': 'Depth',
  'lfo-speed': 'Speed',
  portamento: 'Portamento',
  'osc-type': 'Type',
  'osc-texture': 'Texture',
  'osc-mod': 'Modulation',
  'filter-cutoff': 'Cutoff',
  'filter-resonance': 'Resonance',
  'eg-balance': 'Balance',
  'eg-attack': 'Attack',
  'eg-decay': 'Decay',
  'eg-sustain': 'Sustain',
  'eg-release': 'Release',
  'effect-type': 'Type',
  'effect-depth': 'Depth',
  'effect-rate': 'Rate',
};

const CONTROL_MAXIMUMS = Object.fromEntries(PATCH_CONTROL_IDS.map((id) => [
  id,
  ['lfo-assign', 'osc-type', 'effect-type'].includes(id) ? 4 : 127,
]));
const MAX_AUDIO_ATTACHMENTS = 3;

function button(label, className, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

function iconButton(label, icon, className, onClick) {
  const element = button('', `${className} patch-icon-button`, onClick);
  element.setAttribute('aria-label', label);
  element.title = label;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('patch-icon', `patch-icon-${icon}`);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', {
    play: 'M7 4L20 12L7 20Z',
    up: 'M4 17L12 5L20 17Z',
    down: 'M4 7L12 19L20 7Z',
    trash: 'M3 6H21M9 6V3H15V6M5 6L6 21H18L19 6M10 10V17M14 10V17',
    star: 'M12 2L15 8.5L22 9.5L17 14.5L18.2 21.5L12 18.2L5.8 21.5L7 14.5L2 9.5L9 8.5Z',
  }[icon]);
  svg.append(path);
  element.append(svg);
  return element;
}

function makeTag(text) {
  const tag = document.createElement('span');
  tag.className = 'patch-tag';
  tag.textContent = text;
  return tag;
}

export function createPatchLibrary({ root, panel, initialControls, getControls, applyControls }) {
  const store = new PatchStore();
  const status = document.querySelector('#patch-status');
  const cards = root.querySelector('#patch-cards');
  const favoritesOnly = document.querySelector('#patch-favorites-only');
  const categoryFilter = document.querySelector('#patch-category-filter');
  const tagFilter = document.querySelector('#patch-tag-filter');
  const nameFilter = document.querySelector('#patch-name-filter');
  const viewToggle = document.querySelector('#patch-view-toggle');
  const labelManager = document.querySelector('#patch-label-manager');
  const labelStatus = document.querySelector('#patch-label-status');
  const managedCategories = document.querySelector('#patch-managed-categories');
  const managedTags = document.querySelector('#patch-managed-tags');
  const saveButton = document.querySelector('#patch-save');
  const audioFile = document.querySelector('#patch-audio-file');
  const editor = document.querySelector('#patch-editor');
  const editorForm = document.querySelector('#patch-editor-form');
  const nameInput = document.querySelector('#patch-name');
  const descriptionInput = document.querySelector('#patch-description');
  const categoryInput = document.querySelector('#patch-category');
  const categoryOptions = document.querySelector('#patch-category-options');
  const tagsInput = document.querySelector('#patch-tags');
  const cancelEditor = document.querySelector('#patch-editor-cancel');
  const editorStatus = document.querySelector('#patch-editor-status');
  const display = panel.querySelector('#patch-display-screen');
  const displayName = panel.querySelector('#patch-display-name');
  const changedIndicator = panel.querySelector('#patch-changed-indicator');
  const previous = panel.querySelector('#patch-previous');
  const next = panel.querySelector('#patch-next');
  const newButton = panel.querySelector('#patch-new');
  const displaySaveButton = panel.querySelector('#patch-save-display');
  const preview = new Audio();
  const previewButton = iconButton('Play preview', 'play', 'patch-inline-play', () => {
    if (preview.src) {
      preview.play().then(() => {
        previewButton.hidden = true;
      }).catch(() => {
        status.textContent = 'Audio playback is still blocked. Use the track Play button to try again.';
      });
    }
  });
  let patches = [];
  let categories = [];
  const selectedCategories = new Set();
  const selectedTags = new Set();
  let editingPatch = null;
  let editorCompletion = null;
  let editorSaved = false;
  let editorAllowsReplacement = false;
  let savingEditor = false;
  let audioTargetPatchId = null;
  let selectedPatchId = null;
  let activePreviewUrl = null;
  let activePreviewAttachment = null;
  let draggingAudio = null;
  let savedControls = getControls();
  let activePatchId = null;
  let detachedPatch = null;
  let initialized = false;
  let loadingPatch = false;
  let displayedName = '';
  let nameAnimation;
  const recording = createAudioRecorder({
    onSave: async (patchId, data) => {
      const patch = patches.find((item) => item.id === patchId);
      if (!patch) throw new Error('The target patch no longer exists');
      if (patch.audio.length >= MAX_AUDIO_ATTACHMENTS) {
        throw new Error('This patch already has three MP3 attachments');
      }
      const now = new Date();
      const attachment = {
        id: crypto.randomUUID(),
        name: `${patch.name} - ${now.toISOString().replace(/[:.]/g, '-')}.mp3`,
        type: 'audio/mpeg',
        lastModified: now.getTime(),
        data,
      };
      if (!(await persist({
        ...patch,
        audio: [...patch.audio, attachment],
        updatedAt: now.toISOString(),
      }, `Recorded MP3 saved to ${patch.name}.`))) {
        throw new Error(status.textContent);
      }
    },
  });

  preview.preload = 'none';
  preview.addEventListener('ended', () => {
    status.textContent = 'Audio preview ended.';
  });
  preview.addEventListener('error', () => {
    status.textContent = 'The selected audio file could not be played.';
  });
  previewButton.hidden = true;
  status.after(previewButton);

  function setStatus(message) {
    status.textContent = message;
    previewButton.hidden = true;
  }

  function stopPreview() {
    preview.pause();
    preview.removeAttribute('src');
    preview.load();
    if (activePreviewUrl) URL.revokeObjectURL(activePreviewUrl);
    activePreviewUrl = null;
    activePreviewAttachment = null;
    previewButton.hidden = true;
  }

  function updateChips(container, values, selected) {
    for (const value of selected) {
      if (!values.includes(value)) selected.delete(value);
    }
    container.replaceChildren();
    for (const value of values) {
      const chip = button(value, 'patch-filter-chip', () => {
        if (selected.has(value)) selected.delete(value);
        else selected.add(value);
        render();
        [...container.children].find((element) => element.textContent === value)?.focus();
      });
      chip.setAttribute('aria-pressed', String(selected.has(value)));
      container.append(chip);
    }
    if (!values.length) container.textContent = 'None yet.';
  }

  function updateFilters() {
    categories = [...new Set([...categories, ...patches.map((patch) => patch.category)])]
      .sort((a, b) => a.localeCompare(b));
    const tags = [...new Set(patches.flatMap((patch) => patch.tags))]
      .sort((a, b) => a.localeCompare(b));
    updateChips(categoryFilter, categories, selectedCategories);
    updateChips(tagFilter, tags, selectedTags);
    const currentCategory = categoryInput.value;
    categoryOptions.replaceChildren();
    for (const category of categories) {
      const option = document.createElement('option');
      option.value = category;
      categoryOptions.append(option);
    }
    categoryInput.value = currentCategory;
    renderLabelManager(tags);
  }

  function renderLabelManager(tags) {
    managedCategories.replaceChildren();
    managedTags.replaceChildren();
    for (const category of categories) {
      const used = patches.filter((patch) => patch.category === category).length;
      const row = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = `${category} (${used})`;
      const remove = iconButton(`Delete category ${category}`, 'trash', 'patch-small-button', async () => {
        try {
          await store.deleteCategory(category);
          categories = categories.filter((value) => value !== category);
          selectedCategories.delete(category);
          render();
          labelStatus.textContent = `${category} deleted.`;
        } catch (error) {
          labelStatus.textContent = `Could not delete category: ${error.message || error}`;
        }
      });
      remove.disabled = used > 0;
      row.append(label, remove);
      managedCategories.append(row);
    }
    for (const tag of tags) {
      const row = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = tag;
      const remove = iconButton(`Delete tag ${tag}`, 'trash', 'patch-small-button', async () => {
        if (!await confirmAction('Delete tag', `Delete "${tag}" from every patch? This cannot be undone.`, 'Delete')) return;
        try {
          await store.deleteTag(tag);
          selectedTags.delete(tag);
          await reload();
          labelStatus.textContent = `${tag} removed from all patches.`;
        } catch (error) {
          labelStatus.textContent = `Could not delete tag: ${error.message || error}`;
        }
      });
      row.append(label, remove);
      managedTags.append(row);
    }
    if (!tags.length) managedTags.textContent = 'No tags.';
  }

  function makeControlsVisualization(controls) {
    if (viewToggle.getAttribute('aria-pressed') !== 'true') return makeFaderOutline(controls);
    const visualization = document.createElement('div');
    visualization.className = 'patch-controls';
    visualization.setAttribute('aria-label', 'Simplified sound control values');
    for (const [title, ids] of CONTROL_GROUPS) {
      const group = document.createElement('section');
      group.className = 'patch-control-group';
      const heading = document.createElement('h4');
      heading.textContent = title;
      group.append(heading);
      for (const id of ids) {
        const row = document.createElement('div');
        row.className = 'patch-control-row';
        const label = document.createElement('span');
        label.textContent = CONTROL_LABELS[id];
        const track = document.createElement('span');
        track.className = 'patch-control-track';
        const fill = document.createElement('span');
        fill.className = 'patch-control-fill';
        fill.style.width = `${controls[id] / CONTROL_MAXIMUMS[id] * 100}%`;
        track.append(fill);
        track.setAttribute('aria-label', `${CONTROL_LABELS[id]} ${controls[id]}`);
        row.append(label, track);
        group.append(row);
      }
      visualization.append(group);
    }
    return visualization;
  }

  function makeFaderOutline(controls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.classList.add('patch-fader-outline');
    svg.setAttribute('viewBox', '0 0 400 50');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Compact LFO through Effects fader positions');
    let index = 0;
    for (const [groupName, ids] of CONTROL_GROUPS) {
      for (const id of ids) {
        const x = 10 + index++ * 23;
        const y = 6 + (1 - controls[id] / CONTROL_MAXIMUMS[id]) * 27;
        const group = document.createElementNS(ns, 'g');
        group.dataset.control = id;
        const title = document.createElementNS(ns, 'title');
        title.textContent = `${groupName} ${CONTROL_LABELS[id]}: ${controls[id]}`;
        const track = document.createElementNS(ns, 'line');
        track.setAttribute('x1', x);
        track.setAttribute('x2', x);
        track.setAttribute('y1', '6');
        track.setAttribute('y2', '33');
        track.classList.add('patch-outline-track');
        const cap = document.createElementNS(ns, 'line');
        cap.setAttribute('x1', x - 7);
        cap.setAttribute('x2', x + 7);
        cap.setAttribute('y1', y);
        cap.setAttribute('y2', y);
        cap.classList.add('patch-outline-cap');
        group.append(title, track, cap);
        svg.append(group);
      }
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', 10 + (index - ids.length / 2 - 0.5) * 23);
      label.setAttribute('y', '46');
      label.textContent = groupName;
      svg.append(label);
    }
    return svg;
  }

  async function playAttachment(patch, attachment) {
    stopPreview();
    selectedPatchId = patch.id;
    render();
    activePreviewUrl = URL.createObjectURL(attachment.data);
    activePreviewAttachment = { patchId: patch.id, audioId: attachment.id };
    preview.src = activePreviewUrl;
    const requestedUrl = activePreviewUrl;
    try {
      await preview.play();
      if (activePreviewUrl !== requestedUrl) return;
      setStatus(`Playing ${attachment.name} from ${patch.name}.`);
    } catch {
      if (activePreviewUrl !== requestedUrl) return;
      status.textContent = `Audio playback was blocked for ${attachment.name}. Use the track's Play button to start it.`;
      previewButton.hidden = false;
      previewButton.setAttribute('aria-label', `Play preview for ${attachment.name}`);
      previewButton.title = `Play preview for ${attachment.name}`;
    }
  }

  async function selectPatch(patch) {
    selectedPatchId = patch.id;
    if (patch.audio.length) {
      await playAttachment(patch, patch.audio[0]);
    } else {
      stopPreview();
      render();
      setStatus(`${patch.name} selected. No audio preview is attached.`);
    }
  }

  function makeAudioList(patch) {
    const section = document.createElement('section');
    section.className = 'patch-audio-section';
    section.setAttribute('aria-label', `Audio attachments for ${patch.name}`);
    if (patch.audio.length) {
      const list = document.createElement('ol');
      list.className = 'patch-audio-list';
      for (const [index, attachment] of patch.audio.entries()) {
        const item = document.createElement('li');
        item.className = 'patch-audio-item';
        item.draggable = true;
        item.dataset.audioId = attachment.id;
        item.setAttribute('aria-label', `Drag to reorder ${attachment.name}`);
        const name = document.createElement('span');
        name.className = 'patch-audio-name';
        name.textContent = attachment.name;
        item.append(iconButton(`Play ${attachment.name}`, 'play', 'patch-small-button', () => playAttachment(patch, attachment)), name);
        item.append(iconButton(`Move ${attachment.name} earlier`, 'up', 'patch-small-button', () => moveAudio(patch.id, attachment.id, -1)));
        item.lastElementChild.disabled = index === 0;
        item.append(iconButton(`Move ${attachment.name} later`, 'down', 'patch-small-button', () => moveAudio(patch.id, attachment.id, 1)));
        item.lastElementChild.disabled = index === patch.audio.length - 1;
        const exportAudio = button('Export', 'patch-small-button', async () => {
          const result = await exportDialog(attachment.name.replace(/\.mp3$/i, ''),
            [{ id: 'mp3', label: 'MP3 audio', extension: '.mp3' }]);
          if (!result) return;
          download(attachment.data, result.filename);
          setStatus(`Exported ${attachment.name}.`);
        });
        exportAudio.setAttribute('aria-label', `Export ${attachment.name}`);
        item.append(exportAudio);
        item.append(iconButton(`Remove ${attachment.name}`, 'trash', 'patch-small-button', () => removeAudio(patch.id, attachment.id)));
        item.addEventListener('dragstart', (event) => {
          draggingAudio = { patchId: patch.id, audioId: attachment.id };
          event.dataTransfer?.setData('text/plain', attachment.id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', () => {
          draggingAudio = null;
        });
        item.addEventListener('dragover', (event) => {
          if (draggingAudio?.patchId === patch.id) event.preventDefault();
        });
        item.addEventListener('drop', (event) => {
          if (draggingAudio?.patchId !== patch.id) return;
          event.preventDefault();
          moveAudioTo(patch.id, draggingAudio.audioId, attachment.id);
          draggingAudio = null;
        });
        list.append(item);
      }
      section.append(list);
    }
    return section;
  }

  function makeCard(patch) {
    const card = document.createElement('article');
    card.className = 'patch-card';
    card.dataset.patchId = patch.id;
    card.classList.toggle('is-selected', patch.id === selectedPatchId);
    card.tabIndex = 0;
    card.setAttribute('aria-label', patch.name);
    card.addEventListener('click', (event) => {
      if (!event.target.closest('button, input, textarea, select, .patch-audio-item')) void selectPatch(patch);
    });
    card.addEventListener('keydown', (event) => {
      if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        void selectPatch(patch);
      }
    });

    const header = document.createElement('header');
    const title = document.createElement('h3');
    title.textContent = patch.name;
    const favorite = iconButton(
      `${patch.favorite ? 'Remove' : 'Add'} ${patch.name} ${patch.favorite ? 'from' : 'to'} favorites`,
      'star', 'patch-favorite', () => toggleFavorite(patch),
    );
    favorite.setAttribute('aria-pressed', String(patch.favorite));
    header.append(title, favorite, button('Load', 'patch-load', () => loadPatch(patch)));
    card.append(header);

    if (viewToggle.getAttribute('aria-pressed') === 'true') {
      const description = document.createElement('p');
      description.className = 'patch-description';
      description.textContent = patch.description || 'No description.';
      card.append(description);
    }

    const metadata = document.createElement('div');
    metadata.className = 'patch-metadata';
    const category = document.createElement('span');
    category.className = 'patch-category';
    category.textContent = patch.category;
    const tags = document.createElement('div');
    tags.className = 'patch-tags';
    patch.tags.forEach((tag) => tags.append(makeTag(tag)));
    metadata.append(category, tags);
    card.append(metadata, makeControlsVisualization(patch.controls));

    const actions = document.createElement('div');
    actions.className = 'patch-actions';
    const select = button('Preview', 'patch-select', () => selectPatch(patch));
    select.setAttribute('aria-pressed', String(patch.id === selectedPatchId));
    select.setAttribute('aria-label', `Preview ${patch.name}`);
    const addButton = button('Add MP3', 'patch-small-button', () => {
      audioTargetPatchId = patch.id;
      audioFile.value = '';
      audioFile.click();
    });
    addButton.disabled = patch.audio.length >= MAX_AUDIO_ATTACHMENTS;
    const recordButton = button('Record', 'patch-small-button', async () => {
      recordButton.disabled = true;
      stopPreview();
      try {
        if (await loadPatch(patch)) {
          await recording.open(patch);
        } else {
          setStatus(`${status.textContent} Recording blocked: successfully send all patch values over MIDI before recording.`);
        }
      } finally {
        recordButton.disabled = patch.audio.length >= MAX_AUDIO_ATTACHMENTS;
      }
    });
    recordButton.disabled = patch.audio.length >= MAX_AUDIO_ATTACHMENTS;
    actions.append(
      select,
      button('Edit', 'patch-edit', () => openEditor(patch)),
      button('Export', 'patch-export-one', () => exportPatch(patch)),
      iconButton(`Delete ${patch.name}`, 'trash', 'patch-delete', () => deletePatch(patch)),
      addButton,
      recordButton,
    );
    card.append(actions);
    if (patch.audio.length) card.append(makeAudioList(patch));
    return card;
  }

  function visiblePatches() {
    const query = nameFilter.value.trim().toLocaleLowerCase();
    return patches
      .filter((patch) => !favoritesOnly.checked || patch.favorite)
      .filter((patch) => !selectedCategories.size || selectedCategories.has(patch.category))
      .filter((patch) => !selectedTags.size || patch.tags.some((tag) => selectedTags.has(tag)))
      .filter((patch) => patch.name.toLocaleLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function controlsDiffer(a, b) {
    return PATCH_CONTROL_IDS.some((id) => a[id] !== b[id]);
  }

  function hasUnsavedControls() {
    return Boolean(detachedPatch) || controlsDiffer(getControls(), savedControls);
  }

  function updateDisplay() {
    const active = patches.find((patch) => patch.id === activePatchId) ?? detachedPatch;
    const name = active?.name ?? (initialized ? 'INIT' : 'No patch loaded');
    const changed = hasUnsavedControls();
    const description = `${name}${changed ? ' (unsaved changes)' : ''}`;
    display.setAttribute('aria-label', description);
    display.querySelector('title').textContent = description;
    changedIndicator.setAttribute('visibility', changed ? 'visible' : 'hidden');
    if (displayedName !== name) {
      displayedName = name;
      nameAnimation?.cancel();
      displayName.textContent = name;
      const overflow = Math.max(0, displayName.getComputedTextLength() - 132);
      if (overflow && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const duration = 5 + overflow / 20;
        nameAnimation = displayName.animate([
          { transform: 'translateX(0px)', offset: 0 },
          { transform: 'translateX(0px)', offset: 5 / duration },
          { transform: `translateX(-${overflow}px)`, offset: 1 },
        ], { duration: duration * 1000, iterations: Infinity });
      }
    }
    const visible = visiblePatches();
    const index = visible.findIndex((patch) => patch.id === activePatchId);
    previous.setAttribute('aria-disabled', String(!visible.length || index === 0));
    next.setAttribute('aria-disabled', String(!visible.length || index === visible.length - 1));
  }

  function render() {
    const restoreCardFocus = cards.contains(document.activeElement);
    updateFilters();
    const visible = visiblePatches();
    if (selectedPatchId && !visible.some((patch) => patch.id === selectedPatchId)) {
      selectedPatchId = null;
      stopPreview();
    }
    cards.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'patch-empty';
      empty.textContent = patches.length ? 'No patches match these filters.' : 'No patches saved yet.';
      cards.append(empty);
    } else {
      visible.forEach((patch) => cards.append(makeCard(patch)));
    }
    if (selectedPatchId && restoreCardFocus) {
      [...cards.children].find((card) => card.dataset.patchId === selectedPatchId)?.focus({ preventScroll: true });
    }
    updateDisplay();
  }

  async function reload() {
    const previousActive = patches.find((patch) => patch.id === activePatchId);
    patches = await store.list();
    categories = await store.listCategories();
    if (activePatchId) {
      const active = patches.find((patch) => patch.id === activePatchId);
      if (active) savedControls = { ...active.controls };
      else if (previousActive) {
        activePatchId = null;
        detachedPatch = previousActive;
      }
    }
    render();
  }

  async function persist(patch, successMessage) {
    try {
      const saved = await store.put(patch);
      const index = patches.findIndex((item) => item.id === saved.id);
      if (index >= 0) patches[index] = saved;
      else patches.push(saved);
      render();
      setStatus(successMessage);
      return true;
    } catch (error) {
      setStatus(`Could not save patch: ${error.message || error}`);
      return false;
    }
  }

  function openEditor(patch = null, copy = null) {
    editingPatch = patch;
    editorForm.reset();
    editorStatus.textContent = '';
    let copyName = copy ? `${copy.name} (copy)` : '';
    if (copy) {
      let suffix = 2;
      while (patches.some((item) => item.name.toLocaleLowerCase() === copyName.toLocaleLowerCase())) {
        copyName = `${copy.name} (copy ${suffix++})`;
      }
    }
    nameInput.value = patch?.name ?? copyName;
    descriptionInput.value = patch?.description ?? copy?.description ?? '';
    categoryInput.value = patch?.category ?? copy?.category ?? 'synth';
    tagsInput.value = (patch?.tags ?? copy?.tags ?? []).join(', ');
    editor.showModal();
    nameInput.focus();
  }

  function saveAsCopy({ allowReplacement = false } = {}) {
    return new Promise((resolve) => {
      editorCompletion = resolve;
      editorSaved = false;
      editorAllowsReplacement = allowReplacement;
      openEditor(null, patches.find((patch) => patch.id === activePatchId) ?? detachedPatch);
    });
  }

  async function audioForOverwrite(patch, controls) {
    if (!patch.audio.length || !controlsDiffer(controls, patch.controls)) return patch.audio;
    const action = await choose('Patch audio',
      `The sound controls have changed. Keep or delete the audio attached to "${patch.name}"?`,
      [['Cancel', 'cancel'], ['Keep audio', 'keep'], ['Delete audio', 'delete']]);
    if (action === null || action === 'cancel') return null;
    return action === 'delete' ? [] : patch.audio;
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (savingEditor) return;
    savingEditor = true;
    cancelEditor.disabled = true;
    try {
      await saveEditorForm();
    } finally {
      savingEditor = false;
      cancelEditor.disabled = false;
    }
  }

  async function saveEditorForm() {
    const now = new Date().toISOString();
    const tags = tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean);
    let candidate;
    try {
      candidate = validatePatch({
        ...(editingPatch ?? {
          id: crypto.randomUUID(),
          controls: getControls(),
          audio: [],
          favorite: false,
          createdAt: now,
        }),
        name: nameInput.value,
        description: descriptionInput.value,
        category: categoryInput.value,
        tags,
        updatedAt: now,
      });
    } catch (error) {
      editorStatus.textContent = `Patch details are invalid: ${error.message || error}`;
      return;
    }
    candidate.favorite = Boolean(editingPatch?.favorite);

    const conflict = patches.find((patch) => patch.id !== candidate.id
      && patch.name.toLocaleLowerCase() === candidate.name.toLocaleLowerCase());
    if (conflict) {
      if (editorCompletion && !editorAllowsReplacement) {
        editorStatus.textContent = 'A patch with that name already exists. Choose a different name.';
        return;
      }
      if (!await confirmAction('Replace patch', `Replace the existing "${conflict.name}" patch?`, 'Replace')) return;
      if (editingPatch) {
        try {
          await store.replace(editingPatch.id, { ...candidate, id: conflict.id });
          if (activePatchId === editingPatch.id) activePatchId = conflict.id;
        } catch (error) {
          editorStatus.textContent = `Could not replace patch: ${error.message || error}`;
          return;
        }
      } else {
        const audio = await audioForOverwrite(conflict, candidate.controls);
        if (!audio) return;
        candidate = {
          ...conflict,
          controls: candidate.controls,
          audio,
          updatedAt: now,
        };
        if (!(await persist(candidate, `${conflict.name} updated.`))) {
          editorStatus.textContent = status.textContent;
          return;
        }
        if (!audio.length && activePreviewAttachment?.patchId === conflict.id) stopPreview();
        savedControls = { ...candidate.controls };
        activePatchId = candidate.id;
        detachedPatch = null;
        initialized = false;
      }
      editingPatch = null;
      editorSaved = true;
      editor.close();
      await reload();
      setStatus(`${conflict.name} replaced.`);
      return;
    }

    if (await persist(candidate, `${candidate.name} saved.`)) {
      if (!editingPatch) {
        savedControls = { ...candidate.controls };
        activePatchId = candidate.id;
        detachedPatch = null;
        initialized = false;
      }
      editingPatch = null;
      editorSaved = true;
      editor.close();
      updateDisplay();
    } else {
      editorStatus.textContent = status.textContent;
    }
  }

  async function toggleFavorite(patch) {
    await persist({ ...patch, favorite: !patch.favorite, updatedAt: new Date().toISOString() },
      `${patch.name} ${patch.favorite ? 'removed from' : 'added to'} favorites.`);
  }

  async function deletePatch(patch) {
    if (!await confirmAction('Delete patch', `Delete "${patch.name}"? This cannot be undone.`, 'Delete')) return;
    try {
      await store.delete(patch.id);
      patches = patches.filter((item) => item.id !== patch.id);
      if (selectedPatchId === patch.id) {
        selectedPatchId = null;
        stopPreview();
      }
      if (activePatchId === patch.id) {
        activePatchId = null;
        detachedPatch = patch;
      }
      render();
      setStatus(`${patch.name} deleted.`);
    } catch (error) {
      setStatus(`Could not delete patch: ${error.message || error}`);
    }
  }

  async function overwriteActivePatch() {
    const active = patches.find((item) => item.id === activePatchId);
    if (!active) return false;
    const controls = getControls();
    const audio = await audioForOverwrite(active, controls);
    if (!audio) return false;
    const candidate = { ...active, controls, audio, updatedAt: new Date().toISOString() };
    if (!await persist(candidate, `${active.name} updated.`)) return false;
    if (!audio.length && activePreviewAttachment?.patchId === active.id) stopPreview();
    savedControls = { ...controls };
    updateDisplay();
    return true;
  }

  async function preserveUnsavedControls(nextAction) {
    while (hasUnsavedControls()) {
      const active = patches.find((item) => item.id === activePatchId);
      const choices = [
        ['Cancel', 'cancel'], [`Discard and ${nextAction}`, 'discard'],
        ...(active ? [[`Overwrite and ${nextAction}`, 'overwrite']] : []),
        [`Save as and ${nextAction}`, 'save-as'],
      ];
      const action = await choose('Unsaved sound', 'The current sound has unsaved changes.', choices);
      if (!action || action === 'cancel') return false;
      if (action === 'discard') return true;
      if (action === 'overwrite' && !await overwriteActivePatch()) return false;
      if (action === 'save-as' && !await saveAsCopy()) return false;
    }
    return true;
  }

  async function saveCurrentPatch() {
    if (loadingPatch) return;
    loadingPatch = true;
    try {
      const active = patches.find((item) => item.id === activePatchId);
      if (!active) {
        await saveAsCopy({ allowReplacement: true });
        return;
      }
      const action = await choose('Save patch', `Save the current sound over "${active.name}" or as a new patch?`,
        [['Cancel', 'cancel'], ['Overwrite', 'overwrite'], ['Save as', 'save-as']]);
      if (action === 'overwrite') await overwriteActivePatch();
      if (action === 'save-as') await saveAsCopy();
    } catch (error) {
      setStatus(`Could not save patch: ${error.message || error}`);
    } finally {
      loadingPatch = false;
    }
  }

  async function initializePatch() {
    if (loadingPatch) return;
    loadingPatch = true;
    try {
      if (!await preserveUnsavedControls('initialize')) return;
      const result = await applyControls(initialControls);
      savedControls = { ...initialControls };
      activePatchId = null;
      detachedPatch = null;
      initialized = true;
      updateDisplay();
      if (result.unavailable) {
        setStatus('INIT loaded in the app; MIDI output unavailable, so no values were sent to the synth.');
      } else if (result.failed || result.sent !== result.total) {
        setStatus(`INIT loaded in the app; ${result.sent} CC values sent, ${result.failed} failed. Synth state may be partial.`);
      } else {
        setStatus(`INIT loaded and ${result.sent} CC values sent. MIDI does not confirm hardware response.`);
      }
    } catch (error) {
      setStatus(`Could not initialize patch: ${error.message || error}`);
    } finally {
      loadingPatch = false;
    }
  }

  async function loadPatch(patch) {
    if (loadingPatch) return false;
    loadingPatch = true;
    try {
      if (!await preserveUnsavedControls('load')) return false;
      patch = patches.find((item) => item.id === patch.id) ?? patch;
      const result = await applyControls(patch.controls);
      savedControls = { ...patch.controls };
      activePatchId = patch.id;
      detachedPatch = null;
      initialized = false;
      updateDisplay();
      if (!result.unavailable && result.failed === 0
        && result.sent === result.total && result.sent === PATCH_CONTROL_IDS.length) {
        setStatus(`${patch.name} loaded and ${result.sent} CC values sent. MIDI does not confirm hardware response.`);
        return true;
      } else if (result.sent === 0) {
        setStatus(`${patch.name} loaded in the app; MIDI output unavailable, so no values were sent to the synth.`);
      } else {
        setStatus(`${patch.name} loaded in the app; ${result.sent} CC values sent, ${result.failed} failed. Synth state may be partial.`);
      }
    } catch (error) {
      setStatus(`Could not complete patch load: ${error.message || error}`);
    } finally {
      loadingPatch = false;
    }
    return false;
  }

  async function moveAudio(patchId, audioId, direction) {
    const patch = patches.find((item) => item.id === patchId);
    if (!patch) return;
    const index = patch.audio.findIndex((item) => item.id === audioId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= patch.audio.length) return;
    const audio = [...patch.audio];
    [audio[index], audio[target]] = [audio[target], audio[index]];
    await persist({ ...patch, audio, updatedAt: new Date().toISOString() }, 'Audio order updated.');
  }

  async function moveAudioTo(patchId, audioId, targetId) {
    const patch = patches.find((item) => item.id === patchId);
    if (!patch || audioId === targetId) return;
    const audio = [...patch.audio];
    const sourceIndex = audio.findIndex((item) => item.id === audioId);
    if (sourceIndex < 0) return;
    const targetIndexBeforeRemoval = audio.findIndex((item) => item.id === targetId);
    if (targetIndexBeforeRemoval < 0) return;
    const [item] = audio.splice(sourceIndex, 1);
    const targetIndex = audio.findIndex((entry) => entry.id === targetId);
    audio.splice(targetIndex + Number(sourceIndex < targetIndexBeforeRemoval), 0, item);
    await persist({ ...patch, audio, updatedAt: new Date().toISOString() }, 'Audio order updated.');
  }

  async function removeAudio(patchId, audioId) {
    const patch = patches.find((item) => item.id === patchId);
    const attachment = patch?.audio.find((item) => item.id === audioId);
    if (!patch || !attachment) return;
    if (!await confirmAction('Remove audio', `Remove "${attachment.name}" from "${patch.name}"?`, 'Remove')) return;
    const wasPlaying = activePreviewAttachment?.patchId === patch.id
      && activePreviewAttachment.audioId === attachment.id;
    if (wasPlaying) stopPreview();
    await persist({
      ...patch,
      audio: patch.audio.filter((item) => item.id !== audioId),
      updatedAt: new Date().toISOString(),
    }, `${attachment.name} removed.`);
  }

  async function addAudio(files) {
    const patch = patches.find((item) => item.id === audioTargetPatchId);
    if (!patch || !files.length) return;
    const remaining = MAX_AUDIO_ATTACHMENTS - patch.audio.length;
    if (files.length > remaining) {
      setStatus(`A patch can have up to ${MAX_AUDIO_ATTACHMENTS} MP3 attachments; ${remaining} slot(s) remain.`);
      return;
    }
    if (files.some((file) => !file.name.toLowerCase().endsWith('.mp3')
      && file.type.toLowerCase() !== 'audio/mpeg')) {
      setStatus('Only MP3 audio files can be attached.');
      return;
    }
    const additions = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      type: 'audio/mpeg',
      lastModified: file.lastModified,
      data: new Blob([file], { type: 'audio/mpeg' }),
    }));
    await persist({
      ...patch,
      audio: [...patch.audio, ...additions],
      updatedAt: new Date().toISOString(),
    }, `${additions.length} MP3 attachment(s) added to ${patch.name}.`);
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportPatch(patch) {
    let item = patch;
    const controls = getControls();
    if (patch.id === activePatchId && PATCH_CONTROL_IDS.some((id) => controls[id] !== savedControls[id])) {
      const dialog = document.querySelector('#patch-export-choice');
      const choice = await new Promise((resolve) => {
        const finish = (event) => {
          event.preventDefault();
          dialog.removeEventListener('click', click);
          dialog.removeEventListener('cancel', finish);
          dialog.close();
          resolve(event.type === 'cancel' ? 'cancel' : event.target.value);
        };
        const click = (event) => {
          if (event.target instanceof HTMLButtonElement) finish(event);
        };
        dialog.addEventListener('click', click);
        dialog.addEventListener('cancel', finish);
        dialog.showModal();
      });
      if (choice === 'cancel') return;
      if (choice === 'current') item = { ...patch, controls, updatedAt: new Date().toISOString() };
    }
    const result = await exportDialog(item.name, [{ id: 'zip', label: 'Patch ZIP', extension: '.zip' }]);
    if (result) await exportBackup([item], result.filename);
  }

  async function exportBackup(items, filename) {
    try {
      const blob = await createPatchBackup(items);
      download(blob, filename);
      setStatus(`Exported ${items.length} patch(es), including audio, to a ZIP backup.`);
    } catch (error) {
      setStatus(`Could not export patch backup: ${error.message || error}`);
    }
  }

  async function importPatches(imported, { activateSingle = true } = {}) {
    let saved = 0;
    let skipped = 0;
    let importedPatch;
    try {
      for (const patch of imported) {
        const resolution = await resolveImport(patch, patches, 'patch');
        if (resolution.action === 'ignore') {
          skipped++;
          continue;
        }
        if (resolution.action === 'identical') {
          importedPatch = resolution.item;
          skipped++;
          continue;
        }
        const savedPatch = await store.put({
          ...resolution.item,
          updatedAt: new Date().toISOString(),
        });
        const existingIndex = patches.findIndex((item) => item.id === savedPatch.id);
        if (existingIndex < 0) patches.push(savedPatch);
        else patches[existingIndex] = savedPatch;
        importedPatch = savedPatch;
        saved++;
      }
      await reload();
      setStatus(`Imported ${saved} patch(es); skipped ${skipped}.`);
      if (activateSingle && imported.length === 1 && importedPatch) {
        await loadPatch(importedPatch);
      }
      return saved;
    } catch (error) {
      await reload();
      setStatus(`Import stopped after ${saved} patch(es): ${error.message || error}`);
      throw new Error(`Patch import stopped after ${saved} patch(es): ${error.message || error}`);
    }
  }

  saveButton.addEventListener('click', () => { void saveCurrentPatch(); });
  audioFile.addEventListener('change', () => {
    void addAudio([...(audioFile.files ?? [])]);
  });
  favoritesOnly.addEventListener('change', render);
  nameFilter.addEventListener('input', render);
  viewToggle.addEventListener('click', () => {
    viewToggle.setAttribute('aria-pressed', String(viewToggle.getAttribute('aria-pressed') !== 'true'));
    render();
  });
  document.querySelector('#patch-clear-filters').addEventListener('click', () => {
    selectedCategories.clear();
    selectedTags.clear();
    favoritesOnly.checked = false;
    nameFilter.value = '';
    render();
  });
  document.querySelector('#patch-manage-labels').addEventListener('click', () => {
    labelStatus.textContent = '';
    labelManager.showModal();
  });
  document.querySelector('#patch-label-manager-close').addEventListener('click', () => labelManager.close());
  document.addEventListener('keydown', (event) => {
    if (!selectedPatchId || !['ArrowLeft', 'ArrowRight'].includes(event.key)
      || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || document.querySelector('dialog[open]') || !(event.target instanceof Element)
      || event.target.isContentEditable
      || event.target.closest('input, textarea, select, [contenteditable], #synth')) return;
    const visible = visiblePatches();
    const index = visible.findIndex((patch) => patch.id === selectedPatchId);
    if (index < 0) return;
    event.preventDefault();
    const next = visible[index + (event.key === 'ArrowRight' ? 1 : -1)];
    if (next) void selectPatch(next);
  });
  editorForm.addEventListener('submit', saveEditor);
  cancelEditor.addEventListener('click', () => editor.close());
  editor.addEventListener('cancel', (event) => {
    if (savingEditor) event.preventDefault();
  });
  editor.addEventListener('close', () => {
    if (editorCompletion) {
      const complete = editorCompletion;
      editorCompletion = null;
      complete(editorSaved);
    }
  });
  function bindPanelButton(control, action) {
    control.addEventListener('click', action);
    control.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
        event.preventDefault();
        action();
      }
    });
  }
  bindPanelButton(newButton, () => { void initializePatch(); });
  bindPanelButton(displaySaveButton, () => { void saveCurrentPatch(); });
  for (const [control, direction] of [[previous, -1], [next, 1]]) {
    const navigate = () => {
      if (control.getAttribute('aria-disabled') === 'true') return;
      const visible = visiblePatches();
      const index = visible.findIndex((patch) => patch.id === activePatchId);
      const target = index < 0 ? visible[direction < 0 ? visible.length - 1 : 0] : visible[index + direction];
      if (target) void loadPatch(target);
    };
    bindPanelButton(control, navigate);
  }
  window.addEventListener('pagehide', stopPreview);

  reload().then(() => setStatus('Patch library ready.'))
    .catch((error) => setStatus(`Patch library unavailable: ${error.message || error}`));
  return {
    list: () => store.list(),
    listCategories: () => store.listCategories(),
    async replaceAll(records, values) {
      await store.replaceAll(records, values);
      stopPreview();
      selectedPatchId = null;
      await reload();
    },
    async importCategories(categories) {
      await store.addCategories(categories);
      await reload();
    },
    importPatches,
    controlsChanged: updateDisplay,
    async captureWithProtection(capture) {
      if (loadingPatch) return false;
      loadingPatch = true;
      try {
        if (!await preserveUnsavedControls('capture')) return false;
        await capture();
        return true;
      } finally {
        loadingPatch = false;
      }
    },
  };
}
