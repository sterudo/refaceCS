import { tempoRange } from './synth-midi.js';

const maxNotes = 2000;
const maxBeats = 1200;
const exportDivision = 9600;
const marker = new TextEncoder().encode('refaceCS-loop-v1');

class Reader {
  constructor(bytes, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.offset = start;
    this.end = end;
  }

  take(length) {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.end) {
      throw new Error('The MIDI file is truncated.');
    }
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  byte() { return this.take(1)[0]; }
  u16() { const b = this.take(2); return b[0] * 256 + b[1]; }
  u32() { const b = this.take(4); return b[0] * 16777216 + b[1] * 65536 + b[2] * 256 + b[3]; }
  name() { return String.fromCharCode(...this.take(4)); }

  variable() {
    let value = 0;
    for (let count = 0; count < 4; count++) {
      const byte = this.byte();
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('The MIDI file contains an invalid variable-length value.');
  }
}

function dataByte(reader) {
  const value = reader.byte();
  if (value > 127) throw new Error('The MIDI file contains an invalid MIDI data byte.');
  return value;
}

export function readMidi(bytes, currentMeter) {
  const reader = new Reader(bytes);
  if (reader.name() !== 'MThd') throw new Error('This is not a standard MIDI file.');
  const headerLength = reader.u32();
  if (headerLength < 6) throw new Error('The MIDI header is invalid.');
  const header = new Reader(reader.take(headerLength));
  const format = header.u16();
  const trackCount = header.u16();
  const division = header.u16();
  if (format === 2) throw new Error('MIDI type 2 contains independent sequences and is not supported.');
  if (format > 2 || !trackCount || (format === 0 && trackCount !== 1)) throw new Error('The MIDI file format or track count is invalid.');
  if (division & 0x8000) throw new Error('SMPTE-based MIDI timing is not supported.');
  if (!division) throw new Error('The MIDI beat resolution is invalid.');

  const events = [];
  const tempos = [];
  const meters = [];
  let savedLength;
  let ignoredEvents = 0;
  let noteOns = 0;
  let order = 0;
  for (let trackIndex = 0; trackIndex < trackCount;) {
    const name = reader.name();
    const size = reader.u32();
    const data = reader.take(size);
    if (name !== 'MTrk') continue;
    trackIndex++;
    const track = new Reader(data);
    let tick = 0;
    let running;
    let ended = false;
    while (track.offset < track.end) {
      tick += track.variable();
      if (!Number.isSafeInteger(tick)) throw new Error('The MIDI timing is too large.');
      let status = track.byte();
      let first;
      if (status < 0x80) {
        if (running === undefined) throw new Error('The MIDI file has invalid running status.');
        first = status;
        status = running;
      }
      if (status >= 0x80 && status <= 0xef) {
        running = status;
        const type = status & 0xf0;
        const channel = status & 0x0f;
        const a = first ?? dataByte(track);
        const b = type === 0xc0 || type === 0xd0 ? undefined : dataByte(track);
        if (type === 0x80 || type === 0x90) {
          const on = type === 0x90 && b !== 0;
          if (on && ++noteOns > maxNotes) throw new Error('The MIDI file exceeds the 2,000-note limit.');
          events.push({ tick, order: order++, channel, pitch: a, velocity: b, on });
        } else {
          ignoredEvents++;
        }
      } else if (status === 0xff) {
        running = undefined;
        const type = track.byte();
        const payload = track.take(track.variable());
        if (type === 0x2f) {
          if (payload.length || track.offset !== track.end) throw new Error('The MIDI end-of-track event is invalid.');
          ended = true;
          break;
        }
        if (type === 0x51) {
          if (payload.length !== 3) throw new Error('The MIDI tempo event is invalid.');
          const micros = payload[0] * 65536 + payload[1] * 256 + payload[2];
          if (!micros) throw new Error('The MIDI tempo event is invalid.');
          tempos.push({ tick, order: order++, micros });
        } else if (type === 0x58) {
          if (payload.length !== 4) throw new Error('The MIDI time signature event is invalid.');
          meters.push({ tick, order: order++, numerator: payload[0], denominator: payload[1] });
        } else if (type === 0x7f && payload.length >= marker.length &&
          marker.every((value, index) => payload[index] === value)) {
          if (tick !== 0 || payload.length !== marker.length + 8 || savedLength !== undefined) {
            throw new Error('The saved looper length metadata is invalid.');
          }
          savedLength = new DataView(payload.buffer, payload.byteOffset + marker.length, 8).getFloat64(0);
          if (!Number.isFinite(savedLength) || savedLength <= 0) throw new Error('The saved looper length metadata is invalid.');
        }
      } else if (status === 0xf0 || status === 0xf7) {
        running = undefined;
        track.take(track.variable());
        ignoredEvents++;
      } else {
        throw new Error('The MIDI file contains an unsupported system event.');
      }
    }
    if (!ended) throw new Error('A MIDI track is missing its end-of-track event.');
  }

  const byTime = (a, b) => a.tick - b.tick || a.order - b.order;
  events.sort(byTime);
  tempos.sort(byTime);
  meters.sort(byTime);
  const warnings = [];
  const bpm = tempos.length ? 60000000 / tempos[0].micros : undefined;
  const tempo = bpm >= tempoRange.min && bpm <= tempoRange.max ? Math.round(bpm) : undefined;
  if (bpm !== undefined && tempo === undefined) warnings.push('File tempo is outside 40–240 BPM; current tempo retained.');
  if (tempos.some((event) => event.micros !== tempos[0].micros)) warnings.push('Later tempo changes ignored.');
  let meter = currentMeter;
  if (meters.length) {
    const first = meters[0];
    if ((first.numerator === 3 || first.numerator === 4) && first.denominator === 2) meter = first.numerator;
    else warnings.push(`Unsupported time signature; current ${currentMeter}/4 retained.`);
    if (meters.some((event) => event.numerator !== first.numerator || event.denominator !== first.denominator)) {
      warnings.push('Later time signature changes ignored.');
    }
  }
  if (ignoredEvents) warnings.push(`Ignored ${ignoredEvents} non-note MIDI event${ignoredEvents === 1 ? '' : 's'}.`);

  const pending = new Map();
  const notes = [];
  let lastEnd = 0;
  let zeroDuration = false;
  for (const event of events) {
    const key = `${event.channel}:${event.pitch}`;
    if (event.on) {
      const queue = pending.get(key) || [];
      queue.push(event);
      pending.set(key, queue);
    } else {
      const queue = pending.get(key);
      if (!queue?.length) throw new Error('The MIDI file contains a note-off without a matching note-on.');
      const start = queue.shift();
      if (!queue.length) pending.delete(key);
      const end = Math.max(start.tick + 1, event.tick);
      if (end !== event.tick) zeroDuration = true;
      lastEnd = Math.max(lastEnd, end);
      notes.push({ start: start.tick / division, duration: (end - start.tick) / division,
        channel: start.channel, pitch: start.pitch, velocity: start.velocity, order: start.order });
    }
  }
  if (pending.size) throw new Error('The MIDI file contains notes without matching note-offs.');
  if (!notes.length) throw new Error('The MIDI file contains no notes.');
  if (zeroDuration) warnings.push('Zero-length notes extended to one MIDI tick.');
  const length = savedLength ?? Math.ceil(lastEnd / (division * meter)) * meter;
  if (!length || length > maxBeats) throw new Error('The MIDI file exceeds the 1,200-beat loop limit.');
  const lengthTicks = Math.max(1, Math.round(length * division));
  if (savedLength !== undefined && notes.some((note) =>
    Math.round(note.start * division) >= lengthTicks || Math.round(note.duration * division) > lengthTicks)) {
    throw new Error('The saved looper length does not match the MIDI notes.');
  }
  notes.sort((a, b) => a.start - b.start || a.order - b.order);
  return { notes, length, meter, tempo, warnings };
}

function variable(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) throw new Error('MIDI event timing is out of range.');
  const bytes = [value & 0x7f];
  while ((value = Math.floor(value / 128))) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

function u32(value) {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

export function writeMidi(notes, length, tempo, meter) {
  if (!notes.length || !Number.isFinite(length) || length <= 0 || length > maxBeats) {
    throw new Error('There is no valid loop to save.');
  }
  const lengthTicks = Math.max(1, Math.round(length * exportDivision));
  const exactLength = new Uint8Array(8);
  new DataView(exactLength.buffer).setFloat64(0, length);
  const micros = Math.round(60000000 / tempo);
  const events = [
    { tick: 0, priority: 0, data: [0xff, 0x51, 3, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255] },
    { tick: 0, priority: 0, data: [0xff, 0x58, 4, meter, 2, 24, 8] },
    { tick: 0, priority: 0, data: [0xff, 0x7f, marker.length + exactLength.length, ...marker, ...exactLength] },
  ];
  for (const note of notes) {
    const start = Math.min(lengthTicks - 1, Math.max(0, Math.round(note.start * exportDivision)));
    const duration = Math.max(1, Math.min(lengthTicks, Math.round(note.playDuration * exportDivision)));
    events.push({ tick: start, priority: 2, data: [0x90 | note.channel, note.pitch, note.velocity] });
    events.push({ tick: start + duration, priority: 1, data: [0x80 | note.channel, note.pitch, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.priority - b.priority);
  const track = [];
  let previous = 0;
  for (const event of events) {
    track.push(...variable(event.tick - previous), ...event.data);
    previous = event.tick;
  }
  track.push(...variable(Math.max(lengthTicks, previous) - previous), 0xff, 0x2f, 0);
  return new Uint8Array([
    ...[...`MThd`].map((character) => character.charCodeAt(0)), ...u32(6), 0, 0, 0, 1,
    exportDivision >> 8, exportDivision & 255,
    ...[...`MTrk`].map((character) => character.charCodeAt(0)), ...u32(track.length), ...track,
  ]);
}
