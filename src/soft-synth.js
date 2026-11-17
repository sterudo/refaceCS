const controlByCc = new Map([
  [76, 'lfo-speed'],
  [77, 'lfo-depth'],
  [78, 'lfo-assign'],
  [80, 'osc-type'],
  [81, 'osc-texture'],
  [74, 'filter-cutoff'],
  [71, 'filter-resonance'],
  [73, 'eg-attack'],
  [75, 'eg-decay'],
  [79, 'eg-sustain'],
  [72, 'eg-release'],
]);

const supportedControls = new Set([
  'lfo-assign', 'lfo-speed', 'lfo-depth', 'osc-type', 'osc-texture',
  'filter-cutoff', 'filter-resonance', 'eg-attack', 'eg-decay', 'eg-sustain', 'eg-release',
]);

function selectorPosition(value) {
  return value <= 25 ? 0 : value <= 51 ? 1 : value <= 76 ? 2 : value <= 102 ? 3 : 4;
}

function attackSeconds(value) {
  return 0.005 + (value / 127) ** 2 * 3.5;
}

function decaySeconds(value) {
  return 0.015 + (value / 127) ** 2 * 3;
}

function releaseSeconds(value) {
  return 0.02 + (value / 127) ** 2 * 5;
}

function cutoffFrequency(value) {
  return 60 * (18000 / 60) ** (value / 127);
}

function lfoFrequency(value) {
  return 0.08 * (12 / 0.08) ** (value / 127);
}

export function createSoftSynth(onError = () => {}) {
  let context;
  let output;
  let masterGain;
  let settings = {
    'lfo-assign': 0,
    'lfo-speed': 0,
    'lfo-depth': 0,
    'osc-type': 0,
    'osc-texture': 64,
    'filter-cutoff': 127,
    'filter-resonance': 0,
    'eg-attack': 0,
    'eg-decay': 127,
    'eg-sustain': 127,
    'eg-release': 0,
  };
  let expression = 127;
  let volume = 127;
  let muted = false;
  let pitchRange = 2;
  const bends = new Map();
  const sustain = new Set();
  const heldByNote = new Map();
  const voices = new Set();
  const pulseWaves = new Map();

  function report(error) {
    onError(error instanceof Error ? error.message : String(error));
  }

  function ensureContext() {
    if (context) return context;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) throw new Error('Web Audio is not available in this browser.');
    context = new AudioContext();
    output = context.createGain();
    masterGain = context.createGain();
    output.connect(masterGain);
    masterGain.connect(context.destination);
    output.gain.value = 0.2;
    updateMasterGain();
    return context;
  }

  function resume() {
    try {
      const audio = ensureContext();
      return audio.state === 'suspended'
        ? audio.resume().catch((error) => { report(error); return false; }).then(() => true)
        : Promise.resolve(true);
    } catch (error) {
      report(error);
      return Promise.resolve(false);
    }
  }

  function updateMasterGain() {
    if (masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : expression / 127 * volume / 127, context.currentTime, 0.015);
  }

  function pulseWave(width) {
    const key = String(Math.round(width * 1000));
    if (pulseWaves.has(key)) return pulseWaves.get(key);
    const real = new Float32Array(65);
    const imag = new Float32Array(65);
    for (let harmonic = 1; harmonic < real.length; harmonic++) {
      const phase = 2 * Math.PI * harmonic * width;
      real[harmonic] = 2 * Math.sin(phase) / (Math.PI * harmonic);
      imag[harmonic] = 2 * (1 - Math.cos(phase)) / (Math.PI * harmonic);
    }
    const wave = context.createPeriodicWave(real, imag, { disableNormalization: false });
    pulseWaves.set(key, wave);
    return wave;
  }

  function applyOscillator(voice, time) {
    const pulse = settings['osc-type'] === 1;
    voice.subOscillator.type = 'sawtooth';
    if (pulse) {
      const width = 0.5 + settings['osc-texture'] / 127 * 0.4;
      voice.oscillator.setPeriodicWave(pulseWave(width));
    } else {
      voice.oscillator.type = 'sawtooth';
    }
    const bend = (bends.get(voice.channel) || 0) * pitchRange * 100;
    voice.oscillator.detune.setTargetAtTime(bend, time, 0.01);
    voice.subOscillator.detune.setTargetAtTime(bend, time, 0.01);
    voice.subGain.gain.setTargetAtTime(pulse ? 0 : settings['osc-texture'] / 127, time, 0.015);
  }

  function applyFilter(voice, time) {
    voice.filter.frequency.setTargetAtTime(cutoffFrequency(settings['filter-cutoff']), time, 0.015);
    voice.filter.Q.setTargetAtTime(0.5 + settings['filter-resonance'] / 127 * 18, time, 0.015);
  }

  function updateVoice(voice, time = context.currentTime) {
    applyOscillator(voice, time);
    applyFilter(voice, time);
    voice.lfo.frequency.setTargetAtTime(lfoFrequency(settings['lfo-speed']), time, 0.02);
    const amplitudeDepth = settings['lfo-assign'] === 1 ? settings['lfo-depth'] / 127 * 0.9 : 0;
    voice.lfoGain.gain.setTargetAtTime(amplitudeDepth, time, 0.02);
  }

  function setControl(id, value) {
    if (!supportedControls.has(id) || !Number.isFinite(value)) return false;
    const max = id === 'osc-type' || id === 'lfo-assign' ? 4 : 127;
    settings[id] = Math.max(0, Math.min(max, Math.round(value)));
    if (context) {
      for (const voice of voices) updateVoice(voice);
    }
    return true;
  }

  function setControls(controls) {
    for (const [id, value] of Object.entries(controls)) setControl(id, value);
  }

  function eventTime(timestamp) {
    if (!Number.isFinite(timestamp) || !globalThis.performance) return context.currentTime;
    return Math.max(context.currentTime, context.currentTime + (timestamp - performance.now()) / 1000);
  }

  function noteKey(channel, note) {
    return `${channel}:${note}`;
  }

  function noteOn(channel, note, velocity, timestamp, owner) {
    const audio = ensureContext();
    if (audio.state === 'suspended') void resume();
    const time = eventTime(timestamp);
    const oscillator = audio.createOscillator();
    const subOscillator = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const ampGain = audio.createGain();
    const subGain = audio.createGain();
    const lfo = audio.createOscillator();
    const lfoGain = audio.createGain();
    const voice = {
      channel, note, owner, oscillator, subOscillator, subGain, filter, gain, ampGain, lfo, lfoGain,
      releasing: false, sustained: false,
    };
    const frequency = 440 * 2 ** ((note - 69) / 12);
    oscillator.frequency.setValueAtTime(frequency, time);
    subOscillator.frequency.setValueAtTime(frequency / 2, time);
    filter.type = 'lowpass';
    oscillator.connect(filter);
    subOscillator.connect(subGain);
    subGain.connect(filter);
    filter.connect(gain);
    gain.connect(ampGain);
    ampGain.connect(output);
    ampGain.gain.setValueAtTime(1, time);
    lfo.type = 'sine';
    lfo.connect(lfoGain);
    lfoGain.connect(ampGain.gain);
    updateVoice(voice, time);
    const attack = attackSeconds(settings['eg-attack']);
    const decay = decaySeconds(settings['eg-decay']);
    const sustainLevel = settings['eg-sustain'] / 127;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(velocity / 127, time + attack);
    gain.gain.linearRampToValueAtTime(velocity / 127 * sustainLevel, time + attack + decay);
    oscillator.start(time);
    subOscillator.start(time);
    lfo.start(time);
    voices.add(voice);
    const key = noteKey(channel, note);
    const noteVoices = heldByNote.get(key) || [];
    noteVoices.push(voice);
    heldByNote.set(key, noteVoices);
    while (voices.size > 24) {
      const oldest = voices.values().next().value;
      stopVoice(oldest);
    }
  }

  function removeVoice(voice) {
    clearTimeout(voice.cleanupTimer);
    voices.delete(voice);
    const key = noteKey(voice.channel, voice.note);
    const noteVoices = heldByNote.get(key);
    if (noteVoices) {
      const index = noteVoices.indexOf(voice);
      if (index >= 0) noteVoices.splice(index, 1);
      if (!noteVoices.length) heldByNote.delete(key);
    }
    try { voice.oscillator.disconnect(); } catch {}
    try { voice.subOscillator.disconnect(); } catch {}
    try { voice.subGain.disconnect(); } catch {}
    try { voice.filter.disconnect(); } catch {}
    try { voice.gain.disconnect(); } catch {}
    try { voice.ampGain.disconnect(); } catch {}
    try { voice.lfo.disconnect(); } catch {}
    try { voice.lfoGain.disconnect(); } catch {}
  }

  function stopVoice(voice) {
    voice.oscillator.stop(context.currentTime);
    voice.subOscillator.stop(context.currentTime);
    voice.lfo.stop(context.currentTime);
    removeVoice(voice);
  }

  function cancelNotes(owner) {
    for (const voice of voices) {
      if (owner === undefined || voice.owner === owner) stopVoice(voice);
    }
  }

  function releaseVoice(voice, time = context.currentTime, immediate = false) {
    if (!voice || (voice.releasing && !immediate)) return;
    if (sustain.has(voice.channel) && !immediate) {
      voice.sustained = true;
      return;
    }
    voice.releasing = true;
    voice.sustained = false;
    const duration = immediate ? 0.015 : releaseSeconds(settings['eg-release']);
    const parameter = voice.gain.gain;
    if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(time);
    else {
      parameter.cancelScheduledValues(time);
      parameter.setValueAtTime(Math.max(0.0001, parameter.value), time);
    }
    parameter.linearRampToValueAtTime(0, time + duration);
    voice.oscillator.stop(time + duration + 0.04);
    voice.subOscillator.stop(time + duration + 0.04);
    voice.lfo.stop(time + duration + 0.04);
    clearTimeout(voice.cleanupTimer);
    voice.cleanupTimer = setTimeout(() => removeVoice(voice),
      (Math.max(0, time - context.currentTime) + duration + 0.1) * 1000);
  }

  function noteOff(channel, note, timestamp) {
    const noteVoices = heldByNote.get(noteKey(channel, note));
    const voice = noteVoices?.find((item) => !item.releasing);
    if (voice) releaseVoice(voice, eventTime(timestamp));
  }

  function releaseChannel(channel, timestamp, immediate = false) {
    const time = eventTime(timestamp);
    for (const voice of voices) {
      if (voice.channel === channel) releaseVoice(voice, time, immediate);
    }
  }

  function handleControlChange(channel, controller, value, timestamp) {
    if (controller === 64) {
      if (value >= 64) sustain.add(channel);
      else {
        sustain.delete(channel);
        for (const voice of voices) {
          if (voice.channel === channel && voice.sustained) releaseVoice(voice, eventTime(timestamp));
        }
      }
    } else if (controller === 11) {
      expression = value;
      updateMasterGain();
    } else if (controller === 7) {
      volume = value;
      updateMasterGain();
    } else if (controller === 120 || controller === 123) {
      releaseChannel(channel, timestamp, true);
    } else if (controller === 121) {
      sustain.delete(channel);
      bends.set(channel, 0);
      for (const voice of voices) updateVoice(voice);
    } else {
      const id = controlByCc.get(controller);
      if (id) setControl(id, id === 'osc-type' || id === 'lfo-assign' ? selectorPosition(value) : value);
    }
  }

  function handleMessage(message, timestamp, owner) {
    if (!message || message.length !== 3 || message.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      return false;
    }
    const status = message[0] & 0xf0;
    const channel = message[0] & 0x0f;
    if ((status === 0x80 || status === 0x90) && message[1] < 128 && message[2] < 128) {
      if (status === 0x90 && message[2] > 0) noteOn(channel, message[1], message[2], timestamp, owner);
      else noteOff(channel, message[1], timestamp);
    } else if (status === 0xb0 && message[1] < 128 && message[2] < 128) {
      handleControlChange(channel, message[1], message[2], timestamp);
    } else if (status === 0xe0 && message[1] < 128 && message[2] < 128) {
      const bend = message[1] + (message[2] << 7);
      bends.set(channel, (bend - 8192) / 8192);
      for (const voice of voices) if (voice.channel === channel) updateVoice(voice);
    }
    return true;
  }

  function allNotesOff() {
    if (!context) return;
    sustain.clear();
    cancelNotes();
  }

  function setMuted(value) {
    muted = Boolean(value);
    updateMasterGain();
    if (muted) allNotesOff();
  }

  function setPitchRange(value) {
    if (!Number.isFinite(value)) return;
    pitchRange = Math.max(0, Math.min(24, Math.abs(value)));
    if (context) for (const voice of voices) updateVoice(voice);
  }

  return {
    handleMessage,
    setControl,
    setControls,
    setMuted,
    setPitchRange,
    allNotesOff,
    cancelNotes,
    resume,
    get activeVoiceCount() { return voices.size; },
  };
}
