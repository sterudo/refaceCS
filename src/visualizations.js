const svgNS = 'http://www.w3.org/2000/svg';

function matchLuminance(color, reference) {
  const linearRGB = (hex) => hex.slice(1).match(/../g).map((part) => {
    const channel = parseInt(part, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const source = linearRGB(color);
  const sourceY = luminance(source);
  const targetY = luminance(linearRGB(reference));
  // Mix toward white or black in linear RGB to preserve relative luminance.
  const adjusted = sourceY < targetY
    ? source.map((channel) => channel + (1 - channel) * (targetY - sourceY) / (1 - sourceY))
    : source.map((channel) => channel * targetY / sourceY);
  return `color(srgb-linear ${adjusted.join(' ')})`;
}

export function createVisualizations(root, panel, selections, onResetSection) {
  const controls = new Map([...panel.querySelectorAll('.fader')].map((fader) => [fader.id, fader]));
  const value = (id) => Number(controls.get(id).dataset.value);
  const unit = (id) => value(id) / 127;
  const cards = new Map();

  for (const [id, title, section] of [
    ['lfo', 'LFO', 'lfo'],
    ['filter', 'FILTER', 'filter'],
    ['amp-eg', 'AMP ADSR', 'eg'],
    ['filter-eg', 'FILTER ADSR', 'eg'],
    ['effect', 'EFFECT', 'effect'],
  ]) {
    const card = document.createElement('article');
    card.id = `preview-${id}`;
    card.className = 'visualization-card';
    card.dataset.section = section;
    const sectionColor = panel.querySelector(`#focus-${section}`).getAttribute('fill');
    for (const [part, reference] of Object.entries({
      line: '#71edec', fill: '#57dfe1', glow: '#44dfd7', marker: '#93ffff',
    })) {
      card.style.setProperty(`--section-${part}`, matchLuminance(sectionColor, reference));
    }
    card.innerHTML = `
      <header>
        <h2 style="padding-left:8px">${title} <span class="graph-context" style="letter-spacing: 0px;  font-weight: normal;  font-size: 10px;"></span></h2>   
        <button class="section-reset" type="button" aria-label="Reset ${title} section to defaults">reset</button>
      </header>
      <svg viewBox="0 0 300 150" role="img" aria-labelledby="${id}-graph-title ${id}-graph-description">
        <title id="${id}-graph-title">${title} preview</title>
        <desc id="${id}-graph-description"></desc>
        <defs>
          <pattern id="${id}-grid" width="12" height="12" patternUnits="userSpaceOnUse">
            <circle cx="6" cy="6" r="0.7" fill="#43555c"/>
          </pattern>
        </defs>
        <rect x="6" y="6" width="288" height="120" rx="3" fill="url(#${id}-grid)"/>
        <path class="graph-axis" d="M12 14V122H288"/>
        <path class="graph-fill"/>
        <path class="graph-reference"/>
        <path class="graph-curve"/>
        <g class="graph-markers"></g>
        <text class="graph-axis-label" x="12" y="144"></text>
        <text class="graph-axis-label graph-end-label" x="288" y="144" text-anchor="end"></text>
      </svg>
      <p>
      <span class="graph-values" style="margin-left:8px"></span>
      </p>
      `;
    card.querySelector('.section-reset').addEventListener('click', () => onResetSection(section));
    root.append(card);
    cards.set(id, card);
  }

  function setReadout(element, text) {
    element.replaceChildren(...text.split(/(\b\d+(?:\.\d+)?%?)/).map((part, index) => {
      if (index % 2 === 0) return document.createTextNode(part);
      const number = document.createElement('span');
      number.className = 'graph-number';
      number.textContent = part;
      return number;
    }));
  }

  function draw(id, path, details, context, axis, reference = '') {
    const card = cards.get(id);
    card.querySelector('.graph-curve').setAttribute('d', path);
    card.querySelector('.graph-fill').setAttribute('d', `${path} L288 122H12Z`);
    card.querySelector('.graph-reference').setAttribute('d', reference);
    setReadout(card.querySelector('.graph-values'), details);
    setReadout(card.querySelector('.graph-context'), context);
    card.querySelector('.graph-axis-label').textContent = axis;
    card.querySelector('desc').textContent = `${details}. ${context}. Schematic, not a measured hardware response.`;
  }

  function sampled(yAt) {
    return Array.from({ length: 139 }, (_, index) => {
      const t = index / 138;
      return `${index ? 'L' : 'M'}${12 + index * 2} ${yAt(t).toFixed(2)}`;
    }).join(' ');
  }

  function filter() {
    const openness = unit('filter-cutoff');
    const cutoff = 0.06 + openness * 0.88;
    const edgeFade = Math.min(1, (1 - openness) / 0.1);
    const resonance = unit('filter-resonance');
    const path = sampled((t) => 68 + edgeFade * (
      54 / (1 + Math.exp(-20 * (t - cutoff)))
      - resonance * 43 * Math.exp(-((t - cutoff + 0.055) ** 2) / 0.0012)));
    draw('filter', path,
      `Cutoff ${value('filter-cutoff')} / Resonance ${value('filter-resonance')}`,
      '24 dB/oct', 'Low frequency');
    cards.get('filter').querySelector('.graph-end-label').textContent = 'High frequency';
  }

  function envelopes() {
    const balance = unit('eg-balance');
    const attack = 18 + 62 * unit('eg-attack');
    const decay = attack + 62 * unit('eg-decay');
    const noteOff = 282 - 62 * unit('eg-release');
    const sustain = unit('eg-sustain');
    const details = `A ${value('eg-attack')} / D ${value('eg-decay')} / S ${value('eg-sustain')} / R ${value('eg-release')}`;

    // Linear influence is an illustration, not a verified Yamaha depth law.
    for (const [id, depth, amp] of [['amp-eg', 1 - balance, true], ['filter-eg', balance, false]]) {
      const levelY = (level) => 122 - 98 * ((amp ? 1 - depth : 0) + level * depth);
      const points = [[12, 122], [18, 122], [18, levelY(0)], [attack, levelY(1)],
        [decay, levelY(sustain)], [noteOff, levelY(sustain)], [282, levelY(0)], [282, 122], [288, 122]];
      const path = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
      const context = depth === 0
        ? amp ? 'Note gate remains' : 'No filter'
        : `${amp ? 'AEG' : 'FEG'} ${(depth * 100).toFixed(0)}%`;
      draw(id, path, details, context, 'Relative time');
      const markers = cards.get(id).querySelector('.graph-markers');
      markers.replaceChildren();
      cards.get(id).querySelector('.graph-end-label').textContent = 'R: key off';
      if (depth === 0) continue;
      for (const [label, x, y] of [['A', attack, levelY(1)], ['D/S', decay, levelY(sustain)],
        ['R', noteOff, levelY(sustain)]]) {
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', x);
        dot.setAttribute('cy', y);
        dot.setAttribute('r', '2.5');
        const text = document.createElementNS(svgNS, 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', label === 'D/S' ? Math.min(114, y + 15) : Math.max(14, y - 9));
        text.setAttribute('text-anchor', 'middle');
        text.textContent = label;
        markers.append(dot, text);
      }
    }
  }

  function lfo() {
    const assign = value('lfo-assign');
    const depth = assign === 0 ? 0 : unit('lfo-depth');
    const cycles = 0.6 + 7.4 * unit('lfo-speed');
    const path = sampled((t) => 68 - 43 * depth * Math.sin(t * Math.PI * 2 * cycles));
    const oscillatorDestinations = ['Saw pitch (not sub)', 'Pulse width', 'OSC2 pitch', 'OSC2 pitch', 'FM amount'];
    const destination = assign === 4
      ? oscillatorDestinations[value('osc-type')]
      : selections['lfo-assign'][assign];
    draw('lfo', path, `Depth ${value('lfo-depth')} / Speed ${value('lfo-speed')}`,
      assign === 0 ? 'Off' : `${destination}`, 'Relative time');
  }

  function effect() {
    const type = value('effect-type');
    const depth = unit('effect-depth');
    const rate = unit('effect-rate');
    const cycles = 1 + rate * 5;
    const dry = sampled((t) => 68 - 30 * Math.sin(t * Math.PI * 4));
    let path;
    let reference = '';
    let axis = 'Relative time';
    if (type === 0) {
      path = 'M12 68H288';
    } else if (type === 1) {
      // Discrete echo spacing represents relative delay, without claiming milliseconds.
      path = 'M12 122 L24 122 L24 28 L26 122';
      const spacing = 26 + 42 * rate;
      for (let echo = 1; echo <= 9; echo++) {
        const x = 24 + spacing * echo;
        if (x > 286) break;
        const height = 94 * (depth * 0.75) ** echo;
        path += ` L${x} 122 L${x} ${122 - height} L${x + 2} 122`;
      }
      path += ' L288 122';
    } else if (type === 2) {
      axis = 'Relative modulation time';
      path = sampled((t) => 68 - 40 * depth * Math.sin(t * Math.PI * 2 * cycles));
    } else if (type === 3) {
      axis = 'Relative modulation time';
      reference = sampled((t) => 68 - 27 * depth * Math.sin(t * Math.PI * 2 * cycles));
      path = sampled((t) => 68 - 40 * depth * Math.sin(t * Math.PI * 2 * cycles + depth * 1.2));
    } else {
      reference = dry;
      path = sampled((t) => {
        const wave = Math.sin(t * Math.PI * 4);
        const clipped = Math.tanh((1 + depth * 8) * wave) / Math.tanh(1 + depth * 8);
        const toneMix = depth * (0.2 + 0.8 * rate);
        return 68 - 30 * ((1 - toneMix) * wave + toneMix * clipped);
      });
    }
    const rateName = type === 4 ? 'Tone' : type === 1 ? 'Delay time' : 'Rate';
    draw('effect', path, `Depth ${value('effect-depth')} / ${rateName} ${value('effect-rate')}`,
      type === 0 ? 'Off' : selections['effect-type'][type],
      axis, reference);
  }

  function update(id) {
    if (!id || id.startsWith('filter-')) filter();
    if (!id || id.startsWith('eg-')) envelopes();
    if (!id || id.startsWith('lfo-') || id === 'osc-type') lfo();
    if (!id || id.startsWith('effect-')) effect();
  }

  update();
  return update;
}
