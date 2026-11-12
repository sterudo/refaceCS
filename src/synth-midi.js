const positions = [0, 32, 64, 95, 127];
const controls = [
  ['lfo-assign', 78, 0x02, positions],
  ['lfo-depth', 77, 0x03],
  ['lfo-speed', 76, 0x04],
  ['portamento', 20, 0x05],
  ['osc-type', 80, 0x06, positions],
  ['osc-texture', 81, 0x07],
  ['osc-mod', 82, 0x08],
  ['filter-cutoff', 74, 0x09],
  ['filter-resonance', 71, 0x0a],
  ['eg-balance', 83, 0x0b],
  ['eg-attack', 73, 0x0c],
  ['eg-decay', 75, 0x0d],
  ['eg-sustain', 79, 0x0e],
  ['eg-release', 72, 0x0f],
  ['effect-type', 17, 0x10, [...positions].reverse()],
  ['effect-depth', 18, 0x11],
  ['effect-rate', 19, 0x12],
].map(([id, cc, address, values]) => ({ id, cc, address, values }));

export const captureParameters = [
  { id: 'midi-control', address: [0, 0, 0x0e], size: 1 },
  { id: 'transpose', address: [0, 0, 0x07], size: 1 },
  { id: 'tempo', address: [0, 0, 0x08], size: 2 },
  { id: 'pitch-range', address: [0, 0, 0x0f], size: 1 },
  ...controls.map(({ id, address }) => ({ id, address: [0x30, 0, address], size: 1 })),
];

export function controlNumber(id) {
  return controls.find((item) => item.id === id)?.cc;
}

export function encodeControl(id, value) {
  const control = controls.find((item) => item.id === id);
  if (control) return [0xb0, control.cc, control.values ? control.values[value] : value];
  if (id === 'pitch-bend') {
    const bend = value <= 64 ? value * 128 : 8192 + Math.round((value - 64) * 8191 / 63);
    return [0xe0, bend & 0x7f, bend >> 7];
  }
  return null;
}

export function decodeControl(data) {
  if (data.length !== 3) return null;
  const type = data[0] & 0xf0;
  if (type === 0xe0 && data[1] < 128 && data[2] < 128) {
    const bend = data[1] + (data[2] << 7);
    return { id: 'pitch-bend', value: bend <= 8192
      ? Math.round(bend / 128) : 64 + Math.round((bend - 8192) * 63 / 8191) };
  }
  if (type !== 0xb0 || data[2] > 127) return null;
  const control = controls.find((item) => item.cc === data[1]);
  if (!control) return null;
  let value = data[2];
  if (control.values) {
    const position = value <= 25 ? 0 : value <= 51 ? 1 : value <= 76 ? 2 : value <= 102 ? 3 : 4;
    value = control.id === 'effect-type' ? 4 - position : position;
  }
  return { id: control.id, value };
}

export function encodeParameter(id, value) {
  if (id === 'transpose') return { address: [0, 0, 7], data: [64 + value] };
  if (id === 'pitch-range') return { address: [0, 0, 15], data: [64 + value] };
  if (id === 'tempo') {
    const bpm = Math.round(30 + value * 270 / 127);
    return { address: [0, 0, 8], data: [bpm >> 7, bpm & 0x7f] };
  }
  return null;
}

export function parameterMessage(address, data) {
  return [0xf0, 0x43, 0x10, 0x7f, 0x1c, 0x03, ...address, ...data, 0xf7];
}

export function requestMessage(address) {
  return [0xf0, 0x43, 0x30, 0x7f, 0x1c, 0x03, ...address, 0xf7];
}

export function decodeParameter(address, data) {
  const parameter = captureParameters.find((item) =>
    item.address.every((part, index) => part === address[index]) && item.size === data.length);
  if (!parameter || data.some((byte) => byte > 127)) return null;
  let value = data[0];
  if (parameter.id === 'transpose') value -= 64;
  else if (parameter.id === 'pitch-range') value -= 64;
  else if (parameter.id === 'tempo') {
    const bpm = (data[0] << 7) + data[1];
    if (bpm < 30 || bpm > 300) return null;
    value = Math.round((bpm - 30) * 127 / 270);
  } else if (parameter.id === 'midi-control' && value > 1) return null;
  else if (parameter.id === 'effect-type') {
    if (value > 4) return null;
    value = 4 - value;
  } else if ((parameter.id === 'osc-type' || parameter.id === 'lfo-assign') && value > 4) return null;
  if (parameter.id === 'transpose' && (value < -12 || value > 12)) return null;
  if (parameter.id === 'pitch-range' && (value < 0 || value > 24)) return null;
  return { id: parameter.id, value };
}
