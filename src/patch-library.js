import { createReporter } from './notifications.js';
import {
  createPatchBackup,
  PATCH_CONTROL_IDS,
  PatchStore,
  validatePatch,
} from './patches.js';
import { createAudioRecorder } from './audio-recording.js';
import { choose, confirmAction, exportDialog } from './dialogs.js';
import { resolveImport } from './import-conflicts.js';
import { getPreference, setPreference } from './preferences.js';

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

export function createPatchLibrary({
  root, panel, initialControls, getControls, applyControls, getAppSetting, superKnob,
  getType = () => 'hardware', changeType = async () => true,
}) {
  const store = new PatchStore();
  const status = createReporter('patches', 'patch-status');
  const cards = root.querySelector('#patch-cards');
  const typeFilter = document.querySelector('#patch-type-filter');
  const authorFilter = document.querySelector('#patch-author-filter');
  const showHidden = document.querySelector('#patch-show-hidden');
  const favoritesOnly = document.querySelector('#patch-favorites-only');
  const categoryFilter = document.querySelector('#patch-category-filter');
  const tagFilter = document.querySelector('#patch-tag-filter');
  const nameFilter = document.querySelector('#patch-name-filter');
  const viewToggle = document.querySelector('#patch-view-toggle');
  const labelManager = document.querySelector('#patch-label-manager');
  const labelStatus = createReporter('patches', 'patch-label-status');
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
  const includeSuperKnob = document.querySelector('#patch-include-superknob');
  const authorOutput = document.querySelector('#patch-author');
  const cancelEditor = document.querySelector('#patch-editor-cancel');
  const editorStatus = document.querySelector('#patch-editor-status');
  const display = panel.querySelector('#patch-display-screen');
  const displayName = panel.querySelector('#patch-display-name');
  const changedIndicator = panel.querySelector('#patch-changed-indicator');
  const previous = panel.querySelector('#patch-previous');
  const next = panel.querySelector('#patch-next');
  const newButton = panel.querySelector('#patch-new');
  const displaySaveButton = panel.querySelector('#patch-save-display');
  const displayMenu = document.createElement('div');
  displayMenu.id = 'patch-display-menu';
  displayMenu.className = 'patch-display-menu';
  displayMenu.setAttribute('popover', 'auto');
  displayMenu.setAttribute('role', 'menu');
  displayMenu.setAttribute('aria-label', 'Load filtered patch');
  displayMenu.tabIndex = -1;
  document.body.append(displayMenu);
  const preview = new Audio();
  const previewButton = iconButton('Play preview', 'play', 'patch-inline-play', () => {
    if (preview.src) {
      preview.play().then(() => {
        previewButton.hidden = true;
      }).catch(() => {
        status('Audio playback is still blocked. Use the track Play button to try again.', 'error');
      });
    }
  });
  let patches = [];
  let categories = [];
  const selectedCategories = new Set();
  const selectedTags = new Set();
  const expandedAudio = new Set();
  let editingPatch = null;
  let editingCopy = null;
  let editorCompletion = null;
  let editorSaved = false;
  let editorAllowsReplacement = false;
  let savingEditor = false;
  let audioTargetPatchId = null;
  let selectedPatchId = null;
  let activePreviewUrl = null;
  let activePreviewAttachment = null;
  let ready = Promise.resolve();
  let draggingAudio = null;
  let savedControls = getControls();
  let savedSuperKnob = superKnob.getPatchDefinition();
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
        throw new Error(status.message);
      }
    },
  });

  preview.preload = 'none';
  preview.addEventListener('ended', () => {
    status('Audio preview ended.');
  });
  preview.addEventListener('error', () => {
    status('The selected audio file could not be played.', 'error');
  });
  previewButton.hidden = true;
  cards.before(previewButton);

  function setStatus(message, severity = 'normal') {
    status(message, severity);
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
          labelStatus(`${category} deleted.`);
        } catch (error) {
          labelStatus(`Could not delete category: ${error.message || error}`, 'error');
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
          labelStatus(`${tag} removed from all patches.`);
        } catch (error) {
          labelStatus(`Could not delete tag: ${error.message || error}`, 'error');
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
      status(`Audio playback was blocked for ${attachment.name}. Use the track's Play button to start it.`, 'error');
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
    header.append(title);
    if (patch.author !== 'System') {
      const favorite = iconButton(
        `${patch.favorite ? 'Remove' : 'Add'} ${patch.name} ${patch.favorite ? 'from' : 'to'} favorites`,
        'star', 'patch-favorite', () => toggleFavorite(patch),
      );
      favorite.setAttribute('aria-pressed', String(patch.favorite));
      header.append(favorite);
    }
    header.append(button('Load', 'patch-load', () => loadPatch(patch)));
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
    const type = document.createElement('span');
    type.className = 'patch-type';
    type.textContent = patch.type === 'soft-synth' ? 'Simple Soft Synth' : 'Reface CS';
    const author = document.createElement('span');
    author.className = 'patch-author';
    author.textContent = `Author: ${patch.author}`;
    const tags = document.createElement('div');
    tags.className = 'patch-tags';
    patch.tags.forEach((tag) => tags.append(makeTag(tag)));
    metadata.append(type, author, category, tags);
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
          setStatus(`${status.message} Recording blocked: the patch could not be loaded completely.`, 'error');
        }
      } finally {
        recordButton.disabled = patch.audio.length >= MAX_AUDIO_ATTACHMENTS;
      }
    });
    recordButton.disabled = patch.audio.length >= MAX_AUDIO_ATTACHMENTS;
    if (patch.author === 'System') {
      actions.append(
        select,
        button('Save as', 'patch-save-as', async () => {
          if (await loadPatch(patch)) await saveAsCopy();
        }),
        button('Export', 'patch-export-one', () => exportPatch(patch)),
        button(patch.hidden ? 'Show' : 'Hide', 'patch-hide', () => toggleSystemVisibility(patch)),
      );
    } else {
      actions.append(
        select,
        button('Edit', 'patch-edit', () => openEditor(patch)),
        button('Export', 'patch-export-one', () => exportPatch(patch)),
        iconButton(`Delete ${patch.name}`, 'trash', 'patch-delete', () => deletePatch(patch)),
        addButton,
        recordButton,
      );
    }
    if (patch.audio.length) {
      const audioSection = makeAudioList(patch);
      if (getAppSetting('hidePatchAudio')) {
        audioSection.id = `patch-audio-${patch.id}`;
        const toggle = iconButton('', 'down', 'patch-audio-toggle', () => {
          if (expandedAudio.has(patch.id)) expandedAudio.delete(patch.id);
          else expandedAudio.add(patch.id);
          updateToggle();
        });
        toggle.setAttribute('aria-controls', audioSection.id);
        function updateToggle() {
          const expanded = expandedAudio.has(patch.id);
          const label = `${expanded ? 'Hide' : 'Show'} audio for ${patch.name}`;
          audioSection.hidden = !expanded;
          toggle.setAttribute('aria-expanded', String(expanded));
          toggle.setAttribute('aria-label', label);
          toggle.title = label;
        }
        updateToggle();
        actions.append(toggle);
      }
      card.append(actions, audioSection);
    } else {
      card.append(actions);
    }
    return card;
  }

  function visiblePatches() {
    const query = nameFilter.value.trim().toLocaleLowerCase();
    return patches
      .filter((patch) => typeFilter.value === 'all' || patch.type === typeFilter.value)
      .filter((patch) => authorFilter.value === 'all' || patch.author === authorFilter.value)
      .filter((patch) => showHidden.checked || !patch.hidden)
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
    return Boolean(detachedPatch) || controlsDiffer(getControls(), savedControls)
      || JSON.stringify(superKnob.getPatchDefinition()) !== JSON.stringify(savedSuperKnob);
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
    closeDisplayMenu();
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
      if (active) {
        savedControls = { ...active.controls };
        savedSuperKnob = active.superKnob;
      }
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
      setStatus(`Could not save patch: ${error.message || error}`, 'error');
      return false;
    }
  }

  async function toggleSystemVisibility(patch) {
    try {
      await store.setHidden(patch.id, !patch.hidden);
      await reload();
      setStatus(`${patch.name} ${patch.hidden ? 'shown' : 'hidden'}.`);
    } catch (error) {
      setStatus(`Could not change factory patch visibility: ${error.message || error}`, 'error');
    }
  }

  function openEditor(patch = null, copy = null) {
    editingPatch = patch;
    editingCopy = copy;
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
    authorOutput.value = authorOutput.textContent = 'User';
    includeSuperKnob.checked = patch ? patch.superKnob !== undefined : superKnob.getPatchDefinition() !== undefined;
    includeSuperKnob.disabled = Boolean(patch);
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
          type: editingCopy?.type ?? getType(),
          author: 'User',
          superKnob: includeSuperKnob.checked ? superKnob.getDefinition() : undefined,
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
    editorStatus.textContent = '';
    candidate.favorite = Boolean(editingPatch?.favorite);

    const conflict = patches.find((patch) => patch.id !== candidate.id
      && patch.name.toLocaleLowerCase() === candidate.name.toLocaleLowerCase());
    if (conflict) {
      if (conflict.author === 'System') {
        editorStatus.textContent = 'Factory patch names are reserved. Choose a different name.';
        return;
      }
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
          status(`Could not replace patch: ${error.message || error}`, 'error');
          return;
        }
      } else {
        const audio = await audioForOverwrite(conflict, candidate.controls);
        if (!audio) return;
        candidate = {
          ...conflict,
          controls: candidate.controls,
          superKnob: candidate.superKnob,
          audio,
          updatedAt: now,
        };
        if (!(await persist(candidate, `${conflict.name} updated.`))) {
          return;
        }
        if (!audio.length && activePreviewAttachment?.patchId === conflict.id) stopPreview();
        savedControls = { ...candidate.controls };
        savedSuperKnob = candidate.superKnob;
        superKnob.setInclude(candidate.superKnob !== undefined);
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
        savedSuperKnob = candidate.superKnob;
        superKnob.setInclude(candidate.superKnob !== undefined);
        activePatchId = candidate.id;
        detachedPatch = null;
        initialized = false;
      }
      editingPatch = null;
      editorSaved = true;
      editor.close();
      updateDisplay();
    }
  }

  async function toggleFavorite(patch) {
    await persist({ ...patch, favorite: !patch.favorite, updatedAt: new Date().toISOString() },
      `${patch.name} ${patch.favorite ? 'removed from' : 'added to'} favorites.`);
  }

  async function deletePatch(patch) {
    if (patch.author === 'System') {
      setStatus('Factory patches cannot be deleted; hide them instead.', 'error');
      return;
    }
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
      setStatus(`Could not delete patch: ${error.message || error}`, 'error');
    }
  }

  async function overwriteActivePatch() {
    const active = patches.find((item) => item.id === activePatchId);
    if (!active || active.author === 'System') return false;
    const controls = getControls();
    const audio = await audioForOverwrite(active, controls);
    if (!audio) return false;
    const candidate = { ...active, controls, superKnob: superKnob.getPatchDefinition(), audio, updatedAt: new Date().toISOString() };
    if (!await persist(candidate, `${active.name} updated.`)) return false;
    if (!audio.length && activePreviewAttachment?.patchId === active.id) stopPreview();
    savedControls = { ...controls };
    savedSuperKnob = candidate.superKnob;
    updateDisplay();
    return true;
  }

  async function preserveUnsavedControls(nextAction) {
    while (hasUnsavedControls()) {
      const active = patches.find((item) => item.id === activePatchId);
      const choices = [
        ['Cancel', 'cancel'], [`Discard and ${nextAction}`, 'discard'],
        ...(active && active.author !== 'System' ? [[`Overwrite and ${nextAction}`, 'overwrite']] : []),
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
    superKnob.stop();
    loadingPatch = true;
    try {
      const active = patches.find((item) => item.id === activePatchId);
      if (!active) {
        await saveAsCopy({ allowReplacement: true });
        return;
      }
      if (active.author === 'System') {
        const action = await choose('Save factory patch',
          `Factory patch "${active.name}" is protected. Save a user copy instead?`,
          [['Cancel', 'cancel'], ['Save as', 'save-as']]);
        if (action === 'save-as') await saveAsCopy();
        return;
      }
      const action = await choose('Save patch', `Save the current sound over "${active.name}" or as a new patch?`,
        [['Cancel', 'cancel'], ['Overwrite', 'overwrite'], ['Save as', 'save-as']]);
      if (action === 'overwrite') await overwriteActivePatch();
      if (action === 'save-as') await saveAsCopy();
    } catch (error) {
      setStatus(`Could not save patch: ${error.message || error}`, 'error');
    } finally {
      loadingPatch = false;
    }
  }

  async function initializePatch(canContinue = () => true) {
    if (loadingPatch) return false;
    superKnob.stop();
    loadingPatch = true;
    try {
      if (!await preserveUnsavedControls('initialize')) return false;
      if (!canContinue()) return false;
      const result = await applyControls(initialControls, getType());
      superKnob.loadPatchDefinition(undefined);
      savedControls = { ...initialControls };
      savedSuperKnob = undefined;
      activePatchId = null;
      detachedPatch = null;
      initialized = true;
      updateDisplay();
      if (result.unavailable) {
        setStatus('INIT loaded in the app; MIDI output unavailable, so no values were sent to the synth.', 'error');
        return false;
      } else if (result.failed || result.sent !== result.total) {
        setStatus(`INIT loaded in the app; ${result.sent} CC values sent, ${result.failed} failed. Synth state may be partial.`, 'error');
        return false;
      } else if (getType() === 'soft-synth') {
        setStatus('INIT loaded in Simple Soft Synth.');
        return true;
      } else {
        setStatus(`INIT loaded and ${result.sent} CC values sent. MIDI does not confirm hardware response.`);
        return true;
      }
    } catch (error) {
      setStatus(`Could not initialize patch: ${error.message || error}`, 'error');
      return false;
    } finally {
      loadingPatch = false;
    }
  }

  async function loadPatch(patch, canContinue = () => true) {
    if (loadingPatch) return false;
    superKnob.stop();
    loadingPatch = true;
    try {
      if (!getAppSetting('ignoreUnsavedSynthOnLoad') && !await preserveUnsavedControls('load')) return false;
      if (!canContinue()) return false;
      patch = patches.find((item) => item.id === patch.id) ?? patch;
      if (!await changeType(patch.type)) return false;
      const result = await applyControls(patch.controls, patch.type);
      superKnob.loadPatchDefinition(patch.superKnob);
      savedControls = { ...patch.controls };
      savedSuperKnob = patch.superKnob;
      activePatchId = patch.id;
      setPreference('lastLoadedPatchId', patch.id);
      detachedPatch = null;
      initialized = false;
      updateDisplay();
      if (!result.unavailable && result.failed === 0
        && result.sent === result.total && result.sent === PATCH_CONTROL_IDS.length) {
        setStatus(patch.type === 'soft-synth'
          ? `${patch.name} loaded in Simple Soft Synth.`
          : `${patch.name} loaded and ${result.sent} CC values sent. MIDI does not confirm hardware response.`);
        return true;
      } else if (result.sent === 0) {
        setStatus(`${patch.name} loaded in the app; MIDI output unavailable, so no values were sent to the synth.`, 'error');
      } else {
        setStatus(`${patch.name} loaded in the app; ${result.sent} CC values sent, ${result.failed} failed. Synth state may be partial.`, 'error');
      }
    } catch (error) {
      setStatus(`Could not complete patch load: ${error.message || error}`, 'error');
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
    if (patch.id === activePatchId) superKnob.stop();
    let item = patch;
    const controls = getControls();
    if (patch.id === activePatchId && hasUnsavedControls()) {
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
      if (choice === 'current') item = { ...patch, controls, superKnob: superKnob.getPatchDefinition(), updatedAt: new Date().toISOString() };
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
      setStatus(`Could not export patch backup: ${error.message || error}`, 'error');
    }
  }

  async function importPatches(imported, { activateSingle = true } = {}) {
    let saved = 0;
    let skipped = 0;
    let importedPatch;
    try {
      for (const source of imported) {
        let patch = validatePatch(source);
        if (patch.author === 'System') {
          const factory = patches.find((item) => item.author === 'System' && item.id === patch.id);
          if (factory) {
            importedPatch = factory;
            skipped++;
            continue;
          }
          patch = { ...patch, id: crypto.randomUUID(), author: 'User', hidden: false };
        }
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
      setStatus(`Import stopped after ${saved} patch(es): ${error.message || error}`, 'error');
      throw new Error(`Patch import stopped after ${saved} patch(es): ${error.message || error}`);
    }
  }

  saveButton.addEventListener('click', () => { void saveCurrentPatch(); });
  audioFile.addEventListener('change', () => {
    void addAudio([...(audioFile.files ?? [])]);
  });
  favoritesOnly.addEventListener('change', render);
  typeFilter.addEventListener('change', render);
  authorFilter.addEventListener('change', render);
  showHidden.addEventListener('change', render);
  nameFilter.addEventListener('input', render);
  viewToggle.addEventListener('click', () => {
    viewToggle.setAttribute('aria-pressed', String(viewToggle.getAttribute('aria-pressed') !== 'true'));
    render();
  });
  document.querySelector('#patch-clear-filters').addEventListener('click', () => {
    selectedCategories.clear();
    selectedTags.clear();
    typeFilter.value = 'all';
    authorFilter.value = 'all';
    showHidden.checked = false;
    favoritesOnly.checked = false;
    nameFilter.value = '';
    render();
  });
  document.querySelector('#patch-manage-labels').addEventListener('click', () => {
    labelStatus('');
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
  function closeDisplayMenu(restoreFocus = false) {
    if (!displayMenu.matches(':popover-open')) return;
    displayMenu.hidePopover();
    display.setAttribute('aria-expanded', 'false');
    if (restoreFocus) display.focus({ preventScroll: true });
  }

  function openDisplayMenu(event) {
    event.preventDefault();
    closeDisplayMenu();
    displayMenu.replaceChildren();
    const visible = visiblePatches();
    for (const patch of visible) {
      const item = button(patch.name, 'patch-display-menu-item', () => {
        closeDisplayMenu(true);
        void loadPatch(patch);
      });
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(patch.id === activePatchId));
      item.tabIndex = -1;
      displayMenu.append(item);
    }
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.textContent = patches.length ? 'No patches match these filters.' : 'No patches saved yet.';
      displayMenu.append(empty);
    }
    const anchor = display.querySelector('rect').getBoundingClientRect();
    displayMenu.showPopover();
    display.setAttribute('aria-expanded', 'true');
    const bounds = displayMenu.getBoundingClientRect();
    const x = event.type === 'contextmenu' && event.button === 2 ? event.clientX : anchor.left;
    const y = event.type === 'contextmenu' && event.button === 2 ? event.clientY : anchor.bottom;
    displayMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - bounds.width - 8))}px`;
    displayMenu.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
    const focused = displayMenu.querySelector('button[aria-checked="true"]')
      ?? displayMenu.querySelector('button') ?? displayMenu;
    focused.focus();
  }

  display.addEventListener('contextmenu', openDisplayMenu);
  display.addEventListener('keydown', (event) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openDisplayMenu(event);
  });
  displayMenu.addEventListener('toggle', () => {
    display.setAttribute('aria-expanded', String(displayMenu.matches(':popover-open')));
  });
  displayMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      closeDisplayMenu(true);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = [...displayMenu.querySelectorAll('button')];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[target].focus();
  });
  for (const event of ['blur', 'resize']) window.addEventListener(event, () => closeDisplayMenu());
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

  ready = reload().then(() => setStatus('Patch Manager ready.'))
    .catch((error) => setStatus(`Patch Manager unavailable: ${error.message || error}`, 'error'));
  return {
    async list() {
      await ready;
      return store.list();
    },
    initializePatch,
    loadPatch,
    modeChanged(type) {
      const active = patches.find((patch) => patch.id === activePatchId) ?? detachedPatch;
      const changed = Boolean(active) || initialized || controlsDiffer(getControls(), savedControls)
        || JSON.stringify(superKnob.getPatchDefinition()) !== JSON.stringify(savedSuperKnob);
      detachedPatch = changed ? {
        ...(active ?? {}),
        name: active?.name ?? (initialized ? 'INIT' : 'Untitled'),
        type,
        controls: getControls(),
        superKnob: superKnob.getPatchDefinition(),
        audio: active?.audio ?? [],
        favorite: false,
        author: 'User',
      } : null;
      activePatchId = null;
      initialized = false;
      savedControls = getControls();
      savedSuperKnob = superKnob.getPatchDefinition();
      updateDisplay();
      this.setModeFilter(type);
    },
    setModeFilter(type) {
      typeFilter.value = type;
      render();
    },
    refreshAudioVisibility: render,
    async loadLastSelectedPatch(canContinue = () => true) {
      await ready;
      const id = getPreference('lastLoadedPatchId', (value) => typeof value === 'string', '');
      const patch = id ? patches.find((item) => item.id === id) : null;
      if (!patch) {
        setStatus(id ? 'The last selected patch is no longer available.' : 'No previously selected patch is available to load.', 'error');
        return false;
      }
      return loadPatch(patch, canContinue);
    },
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
      superKnob.stop();
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
