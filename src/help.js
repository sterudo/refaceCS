import { helpContent } from './help-content.js';

let nextZIndex = 1000;
let nextDialogId = 0;
const openHelpWindows = [];

function appendListItem(list, item) {
  const entry = document.createElement('li');
  if (typeof item === 'string') {
    entry.textContent = item;
  } else if (item.href) {
    const anchor = document.createElement('a');
    anchor.href = item.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = item.label;
    entry.append(anchor);
  } else {
    const strong = document.createElement('strong');
    strong.textContent = `${item.label}: `;
    entry.append(strong, document.createTextNode(item.text));
  }
  list.append(entry);
}

function appendBlocks(container, blocks) {
  for (const block of blocks) {
    let element;
    if (block.type === 'p') {
      element = document.createElement('p');
      element.textContent = block.text;
    } else if (block.type === 'h3') {
      element = document.createElement('h3');
      element.textContent = block.text;
    } else if (block.type === 'ul') {
      element = document.createElement('ul');
      block.items.forEach((item) => appendListItem(element, item));
    } else if (block.type === 'details') {
      element = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = block.summary;
      const content = document.createElement('div');
      appendBlocks(content, block.blocks);
      element.append(summary, content);
    } else {
      throw new Error(`Unknown help content block type: ${block.type}`);
    }
    container.append(element);
  }
}

export function clampPosition(dialog, left, top) {
  const bounds = dialog.getBoundingClientRect();
  return {
    left: Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8)),
    top: Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8)),
  };
}

export function trackPointer(handle, event, move) {
  handle.setPointerCapture(event.pointerId);
  const stop = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', stop);
    handle.removeEventListener('pointercancel', stop);
    handle.removeEventListener('lostpointercapture', stop);
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
}

function openHelp(key, trigger, event) {
  const content = helpContent[key];
  if (!content) throw new Error(`Unknown help target: ${key}`);
  if (!event?.altKey) {
    for (const window of [...openHelpWindows]) window.close(false);
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'help-window';
  dialog.classList.toggle('help-window-wide', content.wide === true);
  dialog.setAttribute('aria-labelledby', `help-title-${++nextDialogId}`);

  const header = document.createElement('div');
  header.className = 'help-window-header';
  const title = document.createElement('h2');
  title.id = dialog.getAttribute('aria-labelledby');
  title.textContent = content.title;
  const close = document.createElement('button');
  close.className = 'help-window-close';
  close.type = 'button';
  close.setAttribute('aria-label', `Close ${content.title} help`);
  close.title = 'Close help window (Escape)';
  close.textContent = 'X';
  header.append(title, close);

  const body = document.createElement('div');
  body.className = 'help-window-content';
  appendBlocks(body, content.blocks);
  const resize = document.createElement('button');
  resize.className = 'help-window-resize';
  resize.type = 'button';
  resize.setAttribute('aria-label', `Resize ${content.title} help`);
  resize.title = 'Drag to resize; use arrow keys when focused';
  dialog.append(header, body, resize);
  document.body.append(dialog);

  const previousFocus = trigger;
  const keepInView = () => {
    const bounds = dialog.getBoundingClientRect();
    const position = clampPosition(dialog, bounds.left, bounds.top);
    dialog.style.left = `${position.left}px`;
    dialog.style.top = `${position.top}px`;
  };
  const sizeObserver = new ResizeObserver(keepInView);
  const highlightTarget = (hovered) => {
    helpWindow.hovered = hovered;
    trigger.classList.toggle('help-target-active',
      openHelpWindows.some((window) => window.trigger === trigger && window.hovered));
  };
  const bringToFront = () => {
    const originZIndex = Number(getComputedStyle(trigger.closest('dialog') ?? trigger).zIndex) || 0;
    nextZIndex = Math.max(nextZIndex, originZIndex) + 1;
    dialog.style.zIndex = String(nextZIndex);
    const index = openHelpWindows.findIndex((window) => window.dialog === dialog);
    if (index !== -1) openHelpWindows.splice(index, 1);
    openHelpWindows.push(helpWindow);
  };
  const closeDialog = (restoreFocus = true) => {
    sizeObserver.disconnect();
    window.removeEventListener('resize', keepInView);
    dialog.close();
    dialog.remove();
    const index = openHelpWindows.findIndex((window) => window.dialog === dialog);
    if (index !== -1) openHelpWindows.splice(index, 1);
    highlightTarget(false);
    if (restoreFocus && previousFocus.isConnected && 'focus' in previousFocus) {
      previousFocus.focus({ preventScroll: true });
    }
  };
  const helpWindow = { dialog, trigger, hovered: false, close: closeDialog };

  dialog.addEventListener('pointerdown', bringToFront);
  dialog.addEventListener('focusin', bringToFront);
  dialog.addEventListener('pointerenter', () => highlightTarget(true));
  dialog.addEventListener('pointerleave', () => highlightTarget(false));
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog();
  });
  close.addEventListener('click', () => closeDialog());
  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    bringToFront();
    const rect = dialog.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    trackPointer(header, event, (moveEvent) => {
      const position = clampPosition(dialog, moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
      dialog.style.left = `${position.left}px`;
      dialog.style.top = `${position.top}px`;
    });
  });

  const resizeTo = (width, height) => {
    const bounds = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    dialog.style.width = `${Math.min(window.innerWidth - bounds.left - 8, Math.max(parseFloat(style.minWidth), width))}px`;
    dialog.style.height = `${Math.min(window.innerHeight * 0.9, window.innerHeight - bounds.top - 8, Math.max(parseFloat(style.minHeight), height))}px`;
  };
  resize.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const bounds = dialog.getBoundingClientRect();
    trackPointer(resize, event, (moveEvent) => {
      resizeTo(bounds.width + moveEvent.clientX - event.clientX, bounds.height + moveEvent.clientY - event.clientY);
    });
  });
  resize.addEventListener('keydown', (event) => {
    const directions = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const bounds = dialog.getBoundingClientRect();
    resizeTo(bounds.width + direction[0], bounds.height + direction[1]);
  });

  let backgroundOpacity = 1;
  dialog.addEventListener('wheel', (event) => {
    if (!event.altKey || !event.deltaY) return;
    event.preventDefault();
    event.stopPropagation();
    backgroundOpacity = Math.max(0.2, Math.min(1, backgroundOpacity - Math.sign(event.deltaY) * 0.05));
    dialog.style.setProperty('--help-background-opacity', String(backgroundOpacity));
  }, { passive: false });

  dialog.show();
  const target = trigger.getBoundingClientRect();
  const x = event?.detail ? event.clientX : target.left + target.width / 2;
  const y = event?.detail ? event.clientY : target.bottom;
  const bounds = dialog.getBoundingClientRect();
  const top = y + 12 + bounds.height <= window.innerHeight - 8 ? y + 12 : y - bounds.height - 12;
  const position = clampPosition(dialog, x + 12, top);
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!openHelpWindows.some(({ dialog: other }) => {
      const rect = other.getBoundingClientRect();
      return Math.abs(rect.left - position.left) < 12 && Math.abs(rect.top - position.top) < 12;
    })) break;
    Object.assign(position, clampPosition(dialog, position.left + 28, position.top + 28));
  }
  dialog.style.left = `${position.left}px`;
  dialog.style.top = `${position.top}px`;
  sizeObserver.observe(dialog);
  window.addEventListener('resize', keepInView);
  bringToFront();
  close.focus({ preventScroll: true });
}

export function setupHelp(panel) {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog:modal')) return;
    const topWindow = openHelpWindows.at(-1);
    if (!topWindow) return;
    event.preventDefault();
    event.stopPropagation();
    topWindow.close();
  });

  const triggers = [
    ...panel.querySelectorAll('[data-help-target]'),
    document.querySelector('#version-open'),
    document.querySelector('#help-open'),
    document.querySelector('#groove-help-open'),
    document.querySelector('#patch-help-open'),
  ];

  for (const trigger of triggers) {
    if (trigger) setupHelpTrigger(trigger);
  }
}

export function setupHelpTrigger(trigger) {
  const key = trigger.dataset.helpTarget;
  const title = helpContent[key]?.title;
  if (!title) throw new Error(`Missing help content for target: ${key}`);
  trigger.classList.add('help-target');
  trigger.setAttribute('role', 'button');
  trigger.setAttribute('tabindex', '0');
  trigger.setAttribute('aria-label', `Open ${title} help`);

  trigger.addEventListener('click', (event) => openHelp(key, trigger, event));
  trigger.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) openHelp(key, trigger, event);
  });
}
