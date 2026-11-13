export const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const chordTypes = [
  { suffix: '', quality: 'major', intervals: [0, 4, 7] },
  { suffix: 'm', quality: 'minor', intervals: [0, 3, 7] },
  { suffix: 'aug', intervals: [0, 4, 8] },
  { suffix: 'dim', intervals: [0, 3, 6] },
  { suffix: '7', intervals: [0, 4, 7, 10], optionalFifth: true },
  { suffix: 'maj7', quality: 'major', intervals: [0, 4, 7, 11], optionalFifth: true },
  { suffix: 'm7', quality: 'minor', intervals: [0, 3, 7, 10], optionalFifth: true },
  { suffix: '9', intervals: [0, 2, 4, 7, 10], optionalFifth: true },
  { suffix: 'maj9', quality: 'major', intervals: [0, 2, 4, 7, 11], optionalFifth: true },
  { suffix: 'm9', quality: 'minor', intervals: [0, 2, 3, 7, 10], optionalFifth: true },
  { suffix: '11', intervals: [0, 2, 4, 5, 7, 10], optionalFifth: true },
  { suffix: 'maj11', quality: 'major', intervals: [0, 2, 4, 5, 7, 11], optionalFifth: true },
  { suffix: 'm11', quality: 'minor', intervals: [0, 2, 3, 5, 7, 10], optionalFifth: true },
];

export function detectChord(notes) {
  if (!notes.length) return null;
  const pitchClasses = new Set(notes.map((note) => note % 12));
  const bass = Math.min(...notes) % 12;
  const roots = [bass, ...noteNames.map((_, index) => index).filter((root) => root !== bass)];
  for (const root of roots) {
    const intervals = new Set([...pitchClasses].map((pitch) => (pitch - root + 12) % 12));
    for (const type of chordTypes) {
      const required = type.intervals.filter((interval) => !type.optionalFifth || interval !== 7);
      if (required.every((interval) => intervals.has(interval))
        && [...intervals].every((interval) => type.intervals.includes(interval))) {
        return { name: noteNames[root] + type.suffix, quality: type.quality };
      }
    }
  }
  return null;
}
