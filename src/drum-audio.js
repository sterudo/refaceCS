export const DRUM_VOICES = [
  { id: 'kick', name: 'Kick', note: 36, frequency: 52, decay: 0.45, tone: 35 },
  { id: 'snare', name: 'Snare', note: 38, frequency: 180, decay: 0.2, tone: 65 },
  { id: 'closed-hat', name: 'Closed hi-hat', note: 42, frequency: 7000, decay: 0.055, tone: 75 },
  { id: 'open-hat', name: 'Open hi-hat', note: 46, frequency: 7000, decay: 0.4, tone: 75 },
  { id: 'low-tom', name: 'Low tom', note: 45, frequency: 95, decay: 0.35, tone: 20 },
  { id: 'mid-tom', name: 'Mid tom', note: 47, frequency: 135, decay: 0.3, tone: 20 },
  { id: 'high-tom', name: 'High tom', note: 50, frequency: 190, decay: 0.25, tone: 20 },
  { id: 'shaker', name: 'Shaker', note: 70, frequency: 6000, decay: 0.09, tone: 65 },
  { id: 'clap', name: 'Clap', note: 39, frequency: 1300, decay: 0.18, tone: 60 },
];

export function defaultDrumLane(voice) {
  return { voice: voice.id, steps: Array(16).fill(0), level: 75, tuning: 0, decay: voice.decay, tone: voice.tone,
    solo: false, muted: false };
}

export function createDrumAudio(clock, onError) {
  let context;
  let master;
  let noise;
  const hits = new Set();

  function cancelHit(hit, at) {
    if (at >= hit.end) return;
    hit.end = at;
    for (const gain of hit.gains) {
      if (at <= hit.start) {
        gain.gain.cancelScheduledValues(at);
        gain.gain.setValueAtTime(0, at);
      } else {
        gain.gain.cancelAndHoldAtTime(at);
        gain.gain.setTargetAtTime(0, at, 0.002);
      }
    }
    for (const source of hit.sources) source.stop(at <= hit.start ? at : at + 0.012);
  }

  function stop() {
    if (!context) return;
    for (const hit of hits) cancelHit(hit, context.currentTime);
  }

  async function enable() {
    if (!window.AudioContext) throw new Error('Web Audio is not supported in this browser.');
    if (!context) {
      context = new AudioContext({ latencyHint: 'interactive' });
      master = context.createGain();
      master.gain.value = 0.6;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 4;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.08;
      master.connect(limiter).connect(context.destination);
      noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      context.addEventListener('statechange', () => {
        if (context.state !== 'running') {
          stop();
          clock.notify('suspended');
          onError('Drum audio was suspended. Press Enable audio to resume.');
        }
      });
    }
    await context.resume();
    if (context.state !== 'running') throw new Error('Audio could not start. Enable audio from a click or tap.');
    clock.attachAudio(context);
  }

  function trigger(lane, velocity, audibleTime = performance.now(), sequenced = false) {
    if (!clock.enabled) throw new Error('Enable drum audio before triggering MIDI drums.');
    const voice = DRUM_VOICES.find((item) => item.id === lane.voice);
    if (!voice) throw new Error(`Unknown drum voice: ${lane.voice}`);
    const start = Math.max(context.currentTime + 0.001, clock.audioTime(audibleTime));
    const hit = { voice: voice.id, start, end: start + lane.decay + 0.06, sources: [], gains: [], remaining: 0, sequenced };
    let chokeAt = Infinity;
    for (const previous of hits) {
      if (previous.end <= context.currentTime) hits.delete(previous);
    }
    if (voice.id === 'closed-hat') {
      for (const previous of hits) {
        if (previous.voice === 'open-hat' && previous.start <= start && previous.end > start) cancelHit(previous, start);
      }
    } else if (voice.id === 'open-hat') {
      const nextClosed = [...hits].filter((item) => item.voice === 'closed-hat' && item.start >= start)
        .reduce((next, item) => Math.min(next, item.start), Infinity);
      chokeAt = nextClosed;
    }
    hits.add(hit);
    const amplitude = velocity / 127 * lane.level / 100;
    const frequency = voice.frequency * 2 ** (lane.tuning / 12);
    const tone = lane.tone / 100;
    const oscillator = (frequencyStart, frequencyEnd, amount, duration) => {
      const source = context.createOscillator();
      source.type = 'sine';
      source.frequency.setValueAtTime(frequencyStart, start);
      source.frequency.exponentialRampToValueAtTime(Math.max(20, frequencyEnd), start + Math.min(duration, 0.08));
      envelope(source, amount, duration);
    };
    const envelope = (source, amount, duration, delay = 0, input = source) => {
      const at = start + delay;
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, amplitude * amount), at + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration + 0.003);
      input.connect(gain).connect(master);
      hit.gains.push(gain);
      hit.sources.push(source);
      hit.remaining++;
      source.start(at);
      source.stop(at + duration + 0.02);
      source.addEventListener('ended', () => {
        source.disconnect();
        gain.disconnect();
        if (--hit.remaining === 0) hits.delete(hit);
      });
    };
    const filteredNoise = (type, cutoff, amount, duration, delay = 0) => {
      const source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = Math.max(40, Math.min(context.sampleRate * 0.45, cutoff));
      filter.Q.value = 0.7;
      source.connect(filter);
      envelope(source, amount, duration, delay, filter);
      source.addEventListener('ended', () => filter.disconnect());
    };

    if (voice.id === 'kick') {
      oscillator(frequency * (2 + tone * 5), frequency, 1.25, lane.decay);
      filteredNoise('lowpass', 1500 + tone * 6000, tone * 0.3, 0.012);
    } else if (voice.id.endsWith('tom')) {
      oscillator(frequency * 1.7, frequency, 1, lane.decay);
      filteredNoise('lowpass', 1200 + tone * 2500, tone * 0.35, lane.decay * 0.5);
    } else if (voice.id === 'snare') {
      oscillator(frequency, frequency * 0.85, 0.7 * (1 - tone), lane.decay * 0.6);
      filteredNoise('highpass', 500 + tone * 2000, 0.6 + tone * 0.5, lane.decay);
    } else if (voice.id === 'clap') {
      for (const delay of [0, 0.012, 0.024]) {
        filteredNoise('bandpass', frequency * (0.6 + tone), 0.8, delay === 0.024 ? lane.decay : 0.009, delay);
      }
    } else {
      filteredNoise('highpass', frequency * (0.5 + tone * 0.6), 0.8, lane.decay);
    }
    if (chokeAt < hit.end) cancelHit(hit, chokeAt);
  }

  return {
    enable,
    trigger,
    stop,
    silenceVoice(voice) {
      if (!context) return;
      for (const hit of hits) {
        if (hit.voice === voice) cancelHit(hit, context.currentTime);
      }
    },
    cancelFuture() {
      if (!context) return;
      for (const hit of hits) {
        if (hit.sequenced && hit.start > context.currentTime) cancelHit(hit, context.currentTime);
      }
    },
    get context() { return context; },
    setVolume(value) {
      if (master) master.gain.setTargetAtTime(value / 100 * 0.6, context.currentTime, 0.01);
    },
    async setOutput(deviceId) {
      if (!context?.setSinkId) throw new Error('Audio output selection is not supported in this browser.');
      await context.setSinkId(deviceId);
      clock.notify('output');
    },
  };
}
