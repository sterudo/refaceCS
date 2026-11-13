export function createGrooveClock() {
  const listeners = new Set();
  const players = new Set();
  let context;
  let tempo = 120;
  let origin = 0;
  let originBeat = 0;
  let offset = 0;
  let meter = 4;

  const clock = {
    get enabled() { return context?.state === 'running'; },
    get tempo() { return tempo; },
    get meter() { return meter; },
    get offset() { return offset; },
    get drumsPlaying() { return players.has('drums'); },
    get lead() {
      return Math.max(150, ((context?.baseLatency || 0) + (context?.outputLatency || 0)) * 1000 + 60,
        -offset + 60);
    },
    beatAt(time = performance.now()) {
      return originBeat + (time - origin) * tempo / 60000;
    },
    timeAt(beat) {
      return origin + (beat - originBeat) * 60000 / tempo;
    },
    start(player, requestedTime, beat = 0) {
      const earliest = performance.now() + clock.lead;
      if (!players.size) {
        origin = earliest;
        originBeat = beat;
      }
      const time = requestedTime ?? (players.size
        ? clock.timeAt(Math.ceil((clock.beatAt(earliest) - 1e-8) / meter) * meter) : earliest);
      players.add(player);
      return time;
    },
    stop(player) { players.delete(player); },
    setTempo(value) {
      if (value === tempo) return;
      const now = performance.now();
      originBeat = clock.beatAt(now);
      origin = now;
      tempo = value;
      clock.notify('tempo');
    },
    setMeter(value) {
      if (value === meter) return;
      meter = value;
      clock.notify('meter');
    },
    setOffset(value) {
      offset = value;
      clock.notify('offset');
    },
    attachAudio(value) {
      context = value;
      clock.notify('audio');
    },
    audioTime(audibleTime) {
      const stamp = context.getOutputTimestamp?.();
      if (stamp?.contextTime > 0 && stamp.performanceTime > 0) {
        return stamp.contextTime + (audibleTime - stamp.performanceTime) / 1000;
      }
      return context.currentTime + (audibleTime - performance.now()) / 1000
        - ((context.baseLatency || 0) + (context.outputLatency || 0));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify(reason) {
      for (const listener of listeners) listener(reason);
    },
  };
  return clock;
}
