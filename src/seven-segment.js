const svgNS = 'http://www.w3.org/2000/svg';
const shapes = {
  a: '2,0 9,0 8,1.5 3,1.5', b: '9,1 10.5,2 10.5,8 9,9 8,8 8,2',
  c: '9,10 10.5,11 10.5,17 9,18 8,17 8,11', d: '2,18 9,18 8,19.5 3,19.5',
  e: '1,10 2.5,11 2.5,17 1,18 0,17 0,11', f: '1,1 2.5,2 2.5,8 1,9 0,8 0,2',
  g: '2,9 3,8.2 8,8.2 9,9 8,9.8 3,9.8',
};
const characters = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
  5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  A: 'abcefg', F: 'aefg', L: 'def', O: 'abcdef', ' ': '',
};

export function createSevenSegment(container, count = 3) {
  const digits = Array.from({ length: count }, (_, index) => {
    const digit = document.createElementNS(svgNS, 'g');
    digit.setAttribute('transform', `translate(${index * 13} 0)`);
    const segments = new Map();
    for (const [name, points] of Object.entries(shapes)) {
      const segment = document.createElementNS(svgNS, 'polygon');
      segment.setAttribute('points', points);
      segment.setAttribute('class', 'arp-segment');
      digit.append(segment);
      segments.set(name, segment);
    }
    container.append(digit);
    return segments;
  });
  return (value) => {
    const text = String(value).padStart(count, ' ');
    digits.forEach((segments, index) => {
      const lit = characters[text[index]] || '';
      for (const [name, element] of segments) element.classList.toggle('is-lit', lit.includes(name));
    });
  };
}
