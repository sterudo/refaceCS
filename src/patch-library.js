import {
  createPatchBackup,
  PATCH_CONTROL_IDS,
  PatchStore,
  readPatchBackup,
  validatePatch,
} from './patches.js';
import { createAudioRecorder } from './audio-recording.js';

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

export function createPatchLibrary({ root, getControls, applyControls }) {
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
  const exportButton = document.querySelector('#patch-export');
  const importButton = document.querySelector('#patch-import');
  const importFile = document.querySelector('#patch-import-file');
  const audioFile = document.querySelector('#patch-audio-file');
  const editor = document.querySelector('#patch-editor');
  const editorForm = document.querySelector('#patch-editor-form');
  const nameInput = document.querySelector('#patch-name');
  const descriptionInput = document.querySelector('#patch-description');
  const categoryInput = document.querySelector('#patch-category');
  const categoryOptions = document.querySelector('#patch-category-options');
  const tagsInput = document.querySelector('#patch-tags');
  const cancelEditor = document.querySelector('#patch-editor-cancel');
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
  let audioTargetPatchId = null;
  let selectedPatchId = null;
  let activePreviewUrl = null;
  let activePreviewAttachment = null;
  let draggingAudio = null;
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
        if (!window.confirm(`Delete "${tag}" from every patch? This cannot be undone.`)) return;
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
    exportButton.disabled = patches.length === 0;
    if (selectedPatchId && restoreCardFocus) {
      [...cards.children].find((card) => card.dataset.patchId === selectedPatchId)?.focus({ preventScroll: true });
    }
  }

  async function reload() {
    patches = await store.list();
    categories = await store.listCategories();
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

  function openEditor(patch = null) {
    editingPatch = patch;
    editorForm.reset();
    nameInput.value = patch?.name ?? '';
    descriptionInput.value = patch?.description ?? '';
    categoryInput.value = patch?.category ?? 'synth';
    tagsInput.value = patch?.tags.join(', ') ?? '';
    editor.showModal();
    nameInput.focus();
  }

  async function saveEditor(event) {
    event.preventDefault();
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
      setStatus(`Patch details are invalid: ${error.message || error}`);
      return;
    }
    candidate.favorite = Boolean(editingPatch?.favorite);

    const conflict = patches.find((patch) => patch.id !== candidate.id
      && patch.name.toLocaleLowerCase() === candidate.name.toLocaleLowerCase());
    if (conflict) {
      if (!window.confirm(`Replace the existing "${conflict.name}" patch?`)) return;
      if (editingPatch) {
        try {
          await store.replace(editingPatch.id, { ...candidate, id: conflict.id });
        } catch (error) {
          setStatus(`Could not replace patch: ${error.message || error}`);
          return;
        }
      } else {
        candidate = {
          ...conflict,
          controls: candidate.controls,
          updatedAt: now,
        };
        if (!(await persist(candidate, `${conflict.name} updated.`))) return;
      }
      editingPatch = null;
      editor.close();
      await reload();
      setStatus(`${conflict.name} replaced.`);
      return;
    }

    if (await persist(candidate, `${candidate.name} saved.`)) {
      editingPatch = null;
      editor.close();
    }
  }

  async function toggleFavorite(patch) {
    await persist({ ...patch, favorite: !patch.favorite, updatedAt: new Date().toISOString() },
      `${patch.name} ${patch.favorite ? 'removed from' : 'added to'} favorites.`);
  }

  async function deletePatch(patch) {
    if (!window.confirm(`Delete "${patch.name}"? This cannot be undone.`)) return;
    try {
      await store.delete(patch.id);
      patches = patches.filter((item) => item.id !== patch.id);
      if (selectedPatchId === patch.id) {
        selectedPatchId = null;
        stopPreview();
      }
      render();
      setStatus(`${patch.name} deleted.`);
    } catch (error) {
      setStatus(`Could not delete patch: ${error.message || error}`);
    }
  }

  async function loadPatch(patch) {
    try {
      const result = await applyControls(patch.controls);
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
      setStatus(`Patch loaded in the app, but MIDI recall failed: ${error.message || error}`);
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
    if (!window.confirm(`Remove "${attachment.name}" from "${patch.name}"?`)) return;
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

  async function exportBackup() {
    try {
      const blob = await createPatchBackup(patches);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'refaceCS-patches.zip';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Exported ${patches.length} patch(es), including audio, to a ZIP backup.`);
    } catch (error) {
      setStatus(`Could not export patch backup: ${error.message || error}`);
    }
  }

  async function importBackup(file) {
    let imported;
    try {
      imported = await readPatchBackup(file);
    } catch (error) {
      setStatus(`Could not import patch backup: ${error.message || error}`);
      return;
    }

    let saved = 0;
    let skipped = 0;
    try {
      for (const patch of imported) {
        const conflict = patches.find((item) => item.name.toLocaleLowerCase() === patch.name.toLocaleLowerCase());
        if (conflict && !window.confirm(`Replace the existing "${conflict.name}" patch?`)) {
          skipped++;
          continue;
        }
        const idConflict = patches.find((item) => item.id === patch.id);
        const savedPatch = await store.put({
          ...patch,
          id: conflict?.id ?? (idConflict ? crypto.randomUUID() : patch.id),
          favorite: patch.favorite,
          updatedAt: new Date().toISOString(),
        });
        const existingIndex = patches.findIndex((item) => item.id === savedPatch.id);
        if (existingIndex < 0) patches.push(savedPatch);
        else patches[existingIndex] = savedPatch;
        saved++;
      }
      await reload();
      setStatus(`Imported ${saved} patch(es); skipped ${skipped}.`);
    } catch (error) {
      await reload();
      setStatus(`Import stopped after ${saved} patch(es): ${error.message || error}`);
    }
  }

  saveButton.addEventListener('click', () => openEditor());
  exportButton.addEventListener('click', exportBackup);
  importButton.addEventListener('click', () => {
    importFile.value = '';
    importFile.click();
  });
  importFile.addEventListener('change', () => {
    const file = importFile.files?.[0];
    if (file) void importBackup(file);
  });
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
  window.addEventListener('pagehide', stopPreview);

  reload().then(() => setStatus('Patch library ready.'))
    .catch((error) => setStatus(`Patch library unavailable: ${error.message || error}`));
}
