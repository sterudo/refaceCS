import { setPreference } from './preferences.js';

const categories = {
  midi: 'MIDI', reface: 'reface', groove: 'Groove Studio', looper: 'Looper',
  arp: 'Arpeggiator', patches: 'Patches', backups: 'Backups', app: 'App',
};
const pending = [];
let append;

export function createReporter(category, source) {
  let message = '';
  const report = (text, severity = 'normal') => {
    message = text;
    if (!text.trim()) return;
    const entry = { category, source, message: text, severity, time: new Date() };
    if (append) append(entry);
    else pending.push(entry);
  };
  Object.defineProperty(report, 'message', { get: () => message });
  return report;
}

export function setupNotifications() {
  const header = document.querySelector('.toolbar');
  const controls = document.querySelector('.midi-ports');
  const slot = document.querySelector('#message-slot');
  const center = document.querySelector('#message-center');
  const filters = document.querySelector('#message-filters');
  const log = document.querySelector('#message-log');
  const empty = document.querySelector('#message-empty');
  const open = document.querySelector('#messages-open');
  const close = document.querySelector('#messages-close');
  const resize = document.querySelector('#message-resize');
  const selected = new Set();
  const buttons = new Map();
  const rows = [];
  let following = true;
  let lastScrollTop = 0;
  let glowTimer;
  let modalStack = [];
  let height = 100;
  let savedScrollTop = 0;
  let resizing;

  function matches(category) {
    return !selected.size || selected.has(category);
  }

  function updateEmpty() {
    empty.hidden = rows.some((row) => !row.hidden);
  }

  function applyFilters() {
    for (const [key, element] of buttons) {
      element.setAttribute('aria-pressed', String(key === 'all' ? !selected.size : selected.has(key)));
    }
    for (const row of rows) row.hidden = !matches(row.dataset.category);
    updateEmpty();
    following = true;
    log.scrollTop = log.scrollHeight;
  }

  function setVisible(visible, save = true) {
    if (!visible) savedScrollTop = log.scrollTop;
    center.hidden = slot.hidden = !visible;
    header.classList.toggle('messages-dismissed', !visible);
    open.hidden = visible;
    open.setAttribute('aria-expanded', String(visible));
    if (save) setPreference('messagesVisible', visible);
    syncModalHost();
    if (visible) {
      measure();
      log.scrollTop = following ? log.scrollHeight : savedScrollTop;
      lastScrollTop = log.scrollTop;
    }
  }

  close.addEventListener('click', () => {
    const dialog = center.closest('dialog:modal');
    setVisible(false);
    (dialog || open).focus({ preventScroll: true });
  });
  open.addEventListener('click', () => {
    setVisible(true);
    log.focus({ preventScroll: true });
  });

  for (const [category, label] of [['all', 'All'], ...Object.entries(categories)]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(category === 'all'));
    button.addEventListener('click', () => {
      if (category === 'all') selected.clear();
      else if (selected.has(category)) selected.delete(category);
      else selected.add(category);
      applyFilters();
    });
    buttons.set(category, button);
    filters.append(button);
  }

  log.addEventListener('scroll', () => {
    if (center.hidden) return;
    if (log.scrollHeight - log.clientHeight - log.scrollTop <= 4) following = true;
    else if (log.scrollTop < lastScrollTop) following = false;
    lastScrollTop = log.scrollTop;
  }, { passive: true });

  append = ({ category, source, message, severity, time }) => {
    const row = document.createElement('div');
    row.className = 'message-entry';
    row.dataset.category = category;
    row.dataset.source = source;
    row.dataset.severity = severity;
    row.hidden = !matches(category);
    const timestamp = document.createElement('time');
    timestamp.dateTime = time.toISOString();
    timestamp.textContent = time.toLocaleTimeString([], { hour12: false });
    const label = document.createElement('span');
    label.className = 'message-category';
    label.textContent = categories[category];
    const text = document.createElement('span');
    text.className = 'message-text';
    text.textContent = message;
    row.append(timestamp, label, text);
    rows.push(row);
    log.append(row);
    empty.hidden = empty.hidden || !row.hidden;
    if (center.hidden && severity === 'error') {
      selected.clear();
      applyFilters();
      setVisible(true);
    }
    if (following && !row.hidden) log.scrollTop = log.scrollHeight;
    center.classList.add('has-new-message');
    clearTimeout(glowTimer);
    glowTimer = setTimeout(() => center.classList.remove('has-new-message'), 1100);
  };
  function positionCenter() {
    if (!center.classList.contains('message-center-modal')) return;
    const rect = slot.getBoundingClientRect();
    center.style.left = `${rect.left}px`;
    center.style.top = `${Math.max(0, rect.top)}px`;
    center.style.width = `${rect.width}px`;
    center.style.height = `${rect.height}px`;
    center.parentElement.style.setProperty('--message-bottom',
      `${Math.max(0, rect.top) + rect.height + 8}px`);
  }

  function measure() {
    if (center.hidden) return;
    slot.style.height = `${Math.max(75, Math.min(height, maxHeight()))}px`;
    if (following) log.scrollTop = log.scrollHeight;
    positionCenter();
  }
  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(header);
  resizeObserver.observe(controls);
  resizeObserver.observe(slot);
  measure();
  window.addEventListener('scroll', positionCenter, { passive: true });
  window.addEventListener('resize', measure);

  function resizeTo(value) {
    height = Math.max(75, Math.min(Math.round(value), maxHeight()));
    measure();
  }
  function maxHeight() {
    // Leave room for dialog content and actions below the log.
    const reserve = modalStack.length ? 160 : 16;
    return Math.max(75, window.innerHeight - slot.getBoundingClientRect().top - reserve);
  }
  resize.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resize.focus({ preventScroll: true });
    resizing = { pointerId: event.pointerId, y: event.clientY, height: center.getBoundingClientRect().height };
    resize.setPointerCapture(event.pointerId);
  });
  resize.addEventListener('pointermove', (event) => {
    if (resizing?.pointerId === event.pointerId) resizeTo(resizing.height + event.clientY - resizing.y);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    resize.addEventListener(type, () => { resizing = undefined; });
  }
  resize.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    resizeTo(event.key === 'Home' ? 75 : center.getBoundingClientRect().height + (event.key === 'ArrowUp' ? -10 : 10));
  });

  // Keep the one log interactive above native modal backdrops, at its header position.
  function syncModalHost() {
    const modals = [...document.querySelectorAll('dialog:modal')];
    modalStack = modalStack.filter((dialog) => modals.includes(dialog));
    for (const dialog of modals) if (!modalStack.includes(dialog)) modalStack.push(dialog);
    const host = (!center.hidden && modalStack.at(-1)) || slot;
    if (center.parentElement === host) return;
    const scrollTop = log.scrollTop;
    center.parentElement.classList.remove('message-dialog-host');
    center.parentElement.style.removeProperty('--message-bottom');
    center.classList.toggle('message-center-modal', host !== slot);
    host.append(center);
    if (host === slot) center.removeAttribute('style');
    else {
      host.classList.add('message-dialog-host');
    }
    measure();
    log.scrollTop = scrollTop;
  }
  const modalObserver = new MutationObserver((records) => {
    if (!records.some((record) => record.type === 'attributes' ? record.target.localName === 'dialog'
      : [...record.addedNodes, ...record.removedNodes].some((node) =>
        node.nodeType === Node.ELEMENT_NODE && (node.localName === 'dialog' || node.querySelector('dialog'))))) return;
    syncModalHost();
  });
  modalObserver.observe(document.body, { subtree: true, childList: true,
    attributes: true, attributeFilter: ['open'] });
  pending.splice(0).forEach(append);
  return {
    setVisible,
    isVisible: () => !center.hidden,
  };
}
