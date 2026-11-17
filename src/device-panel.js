import { createSevenSegment } from './seven-segment.js';
import { createReporter } from './notifications.js';

const svgNS = 'http://www.w3.org/2000/svg';
const defaults = { 'midi-transmit': 0, 'midi-receive': 16, 'local-control': 1, 'speaker-output': 1 };
const labels = {
  'midi-transmit': 'Transmit channel', 'midi-receive': 'Receive channel',
  'local-control': 'Local Control', 'speaker-output': 'Speaker output',
};

export function createDevicePanel(change) {
  const layer = document.querySelector('#device-menu-layer');
  const report = createReporter('reface', 'device-panel-status');
  const state = new Map();
  const controls = new Map();
  let busy = false;
  let connected = false;
  let openButton;

  function closeMenu(focus = false) {
    if (!openButton) return;
    const button = openButton;
    openButton = undefined;
    button.setAttribute('aria-expanded', 'false');
    layer.replaceChildren();
    if (focus) button.focus();
  }

  function render(id) {
    const { button, renderDigits } = controls.get(id);
    const { value, confidence } = state.get(id);
    const channel = id.startsWith('midi-');
    const display = channel ? value === 127 ? 'OFF' : value === 16 ? 'ALL' : String(value + 1)
      : value ? 'On' : 'Off';
    const disabled = busy || !connected;
    button.setAttribute('aria-disabled', String(disabled));
    button.setAttribute('aria-label', `${labels[id]}: ${display}, ${confidence}`);
    button.dataset.value = String(value);
    button.dataset.confidence = confidence;
    button.classList.toggle('device-panel-confirmed', confidence === 'confirmed');
    button.querySelector('title').textContent = `${labels[id]}: ${display} (${confidence}).${channel ? ' Click to increment; right-click for channels.' : ' Click to toggle.'}`;
    if (channel) renderDigits(display);
    else button.setAttribute('aria-pressed', String(Boolean(value)));
  }

  function activate(element, callback) {
    element.addEventListener('click', callback);
    element.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
        event.preventDefault();
        callback(event);
      }
    });
  }

  function showMenu(id) {
    if (busy || !connected) return;
    closeMenu();
    const button = controls.get(id).button;
    openButton = button;
    button.setAttribute('aria-expanded', 'true');
    const options = [...Array.from({ length: 16 }, (_, value) => ({ value, label: String(value + 1) })),
      { value: id === 'midi-transmit' ? 127 : 16, label: id === 'midi-transmit' ? 'Off' : 'All' }];
    const menu = document.createElementNS(svgNS, 'g');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `${labels[id]} choices`);
    const display = button.querySelector('rect:nth-of-type(2)');
    const origin = new DOMPoint(Number(display.getAttribute('x')), 32).matrixTransform(button.getScreenCTM())
      .matrixTransform(layer.getScreenCTM().inverse());
    menu.setAttribute('transform', `translate(${origin.x} ${origin.y})`);
    const background = document.createElementNS(svgNS, 'rect');
    background.setAttribute('class', 'arp-menu-background');
    background.setAttribute('width', '132');
    background.setAttribute('height', '222');
    background.setAttribute('rx', '4');
    menu.append(background);
    const items = options.map((option, index) => {
      const item = document.createElementNS(svgNS, 'g');
      item.setAttribute('class', 'arp-menu-item');
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(option.value === state.get(id).value));
      item.setAttribute('tabindex', '-1');
      const x = 3 + Math.floor(index / 9) * 63;
      const y = 3 + index % 9 * 24;
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', '60');
      rect.setAttribute('height', '24');
      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', String(x + 7));
      text.setAttribute('y', String(y + 16));
      text.textContent = option.label;
      item.append(rect, text);
      activate(item, (event) => {
        closeMenu(event.type === 'keydown');
        void change(id, option.value);
      });
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMenu(true);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        }
      });
      menu.append(item);
      return item;
    });
    layer.append(menu);
    (items.find((item) => item.getAttribute('aria-checked') === 'true') || items[0]).focus();
  }

  for (const [id, value] of Object.entries(defaults)) {
    const button = document.querySelector(`#device-${id}`);
    const channel = id.startsWith('midi-');
    controls.set(id, { button, renderDigits: channel ? createSevenSegment(button.querySelector('.device-digits')) : null });
    state.set(id, { value, confidence: 'assumed' });
    activate(button, () => {
      if (busy || !connected) return;
      const current = state.get(id).value;
      const next = channel ? current === 127 || current === 16 ? 0
        : current === 15 ? (id === 'midi-transmit' ? 127 : 16) : current + 1 : 1 - current;
      void change(id, next);
    });
    if (channel) {
      button.addEventListener('contextmenu', (event) => { event.preventDefault(); showMenu(id); });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10') || event.key === 'ArrowDown') {
          event.preventDefault();
          showMenu(id);
        }
      });
    }
    render(id);
  }
  document.addEventListener('pointerdown', (event) => {
    if (openButton && !layer.contains(event.target) && !openButton.contains(event.target)) closeMenu();
  });
  window.addEventListener('blur', () => closeMenu());

  return {
    update(id, value, confidence) {
      if (!state.has(id)) return;
      if (value === null) {
        const previous = state.get(id);
        if (previous.confidence !== 'assumed') state.set(id, { ...previous, confidence: 'unconfirmed' });
        render(id);
        return;
      }
      state.set(id, { value, confidence });
      render(id);
    },
    connectionChanged(available) {
      connected = available;
      closeMenu();
      for (const [id, value] of Object.entries(defaults)) {
        state.set(id, { value, confidence: 'assumed' });
        render(id);
      }
    },
    setBusy(value) {
      busy = value;
      if (value) closeMenu();
      for (const id of state.keys()) render(id);
    },
    status(message, severity = 'normal') {
      report(message, severity);
    },
  };
}
