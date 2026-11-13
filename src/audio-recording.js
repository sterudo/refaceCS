const MAX_RECORDING_SECONDS = 10;
const MP3_BITRATE_KBPS = 256;
const AUDIO_INPUT_KEY = 'refaceCS-recording-input';

async function encodeMp3(recording) {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const context = new AudioContext({ sampleRate: 44100 });
  try {
    const audio = await context.decodeAudioData(await recording.arrayBuffer());
    const length = Math.min(audio.length, audio.sampleRate * MAX_RECORDING_SECONDS);
    if (!length) throw new Error('The recording contains no audio.');
    const channels = Math.min(audio.numberOfChannels, 2);
    const pcm = Array.from({ length: channels }, (_, channel) => {
      const samples = audio.getChannelData(channel);
      return Int16Array.from(samples.subarray(0, length), (sample) => {
        const value = Math.max(-1, Math.min(1, sample));
        return Math.round(value * (value < 0 ? 32768 : 32767));
      });
    });
    const encoder = new Mp3Encoder(channels, audio.sampleRate, MP3_BITRATE_KBPS);
    const chunks = [];
    for (let offset = 0; offset < length; offset += 1152) {
      const chunk = encoder.encodeBuffer(
        pcm[0].subarray(offset, offset + 1152),
        pcm[1]?.subarray(offset, offset + 1152),
      );
      if (chunk.length) chunks.push(new Uint8Array(chunk));
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));
    return new Blob(chunks, { type: 'audio/mpeg' });
  } finally {
    await context.close();
  }
}

export function createAudioRecorder({ onSave }) {
  const dialog = document.querySelector('#patch-recorder');
  const title = dialog.querySelector('h2');
  const input = dialog.querySelector('#patch-record-input');
  const status = dialog.querySelector('#patch-record-status');
  const warning = dialog.querySelector('#patch-record-warning');
  const start = dialog.querySelector('#patch-record-start');
  const stop = dialog.querySelector('#patch-record-stop');
  const save = dialog.querySelector('#patch-record-save');
  const discard = dialog.querySelector('#patch-record-discard');
  const preview = dialog.querySelector('audio');
  let session = 0;
  let state = 'closed';
  let target = null;
  let stream = null;
  let streamInput = null;
  let recorder = null;
  let timer = null;
  let ticker = null;
  let mp3 = null;
  let previewUrl = null;
  let lastSelectedInput = 'default';
  let inputPreferenceRead = false;

  function showWarning(message) {
    warning.textContent = [warning.textContent, message].filter(Boolean).join(' ');
    warning.hidden = false;
  }

  function setState(next, message) {
    state = next;
    status.textContent = message;
    input.disabled = next !== 'ready';
    start.disabled = next !== 'ready';
    stop.disabled = next !== 'recording';
    save.disabled = next !== 'review';
    discard.disabled = next === 'saving';
  }

  function releaseInput() {
    clearTimeout(timer);
    clearInterval(ticker);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    streamInput = null;
  }

  function cleanup() {
    session++;
    state = 'closed';
    if (recorder?.state === 'recording') recorder.stop();
    recorder = null;
    releaseInput();
    preview.pause();
    preview.removeAttribute('src');
    preview.load();
    preview.hidden = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    mp3 = null;
    target = null;
  }

  function fail(error) {
    setState('error', `Could not record audio: ${error.message || error}. Discard to close and try again.`);
    if (recorder?.state === 'recording') recorder.stop();
    releaseInput();
  }

  async function requestInput(deviceId, run) {
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    if (run !== session) {
      acquired.getTracks().forEach((track) => track.stop());
      return null;
    }
    acquired.getAudioTracks().forEach((track) => track.addEventListener('ended', () => {
      if (run === session && ['ready', 'starting', 'recording'].includes(state)) {
        fail(new Error('The audio input was disconnected'));
      }
    }));
    return acquired;
  }

  async function open(patch) {
    cleanup();
    const run = session;
    target = { id: patch.id, name: patch.name };
    title.textContent = `Record audio for ${patch.name}`;
    warning.textContent = '';
    warning.hidden = true;
    input.replaceChildren(new Option('Default audio input', 'default'));
    setState('opening', 'Requesting audio-input permission...');
    dialog.showModal();
    if (!window.isSecureContext) {
      fail(new Error('Audio recording requires HTTPS or localhost'));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext) {
      fail(new Error('Audio recording is not supported in this browser'));
      return;
    }
    try {
      if (!inputPreferenceRead) {
        inputPreferenceRead = true;
        try {
          lastSelectedInput = localStorage.getItem(AUDIO_INPUT_KEY) || lastSelectedInput;
        } catch (error) {
          showWarning(`Could not restore the saved audio input: ${error.message || error}. Using this session's selection.`);
        }
      }
      const acquired = await requestInput('default', run);
      if (run !== session) return;
      stream = acquired;
      streamInput = 'default';
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (run !== session || state === 'error') return;
      for (const device of devices.filter((item) => item.kind === 'audioinput' && item.deviceId !== 'default')) {
        input.append(new Option(device.label || `Audio input ${input.options.length}`, device.deviceId));
      }
      if ([...input.options].some((option) => option.value === lastSelectedInput)) {
        input.value = lastSelectedInput;
      } else {
        showWarning('The previously selected audio input is unavailable. Default audio input is selected; check the input before recording.');
      }
      setState('ready', 'Choose an input, then Start recording. Stops automatically after 10 seconds.');
    } catch (error) {
      if (run === session) {
        if (error.name === 'NotAllowedError') {
          fail(new Error('Audio-input permission was denied. Allow microphone access in your browser'));
        } else {
          fail(error);
        }
      }
    }
  }

  async function startRecording() {
    const run = session;
    setState('starting', 'Starting recording...');
    try {
      if (input.value !== streamInput) {
        releaseInput();
        const acquired = await requestInput(input.value, run);
        if (run !== session) return;
        stream = acquired;
      }
      if (run !== session || state === 'error') return;
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: MP3_BITRATE_KBPS * 1000,
      });
      recorder = capture;
      const chunks = [];
      capture.addEventListener('dataavailable', (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      capture.addEventListener('error', (event) => {
        if (run === session) fail(event.error || new Error('The audio capture failed'));
      });
      capture.addEventListener('stop', async () => {
        if (run !== session || state === 'error' || state === 'closed') return;
        if (state !== 'encoding') {
          fail(new Error('Audio capture stopped unexpectedly'));
          return;
        }
        try {
          if (!chunks.length) throw new Error('No audio was captured');
          const encoded = await encodeMp3(new Blob(chunks, { type: capture.mimeType }));
          if (run !== session) return;
          mp3 = encoded;
          previewUrl = URL.createObjectURL(mp3);
          preview.src = previewUrl;
          preview.hidden = false;
          setState('review', 'Preview your recording, then Save MP3 or Discard.');
        } catch (error) {
          if (run === session) fail(error);
        }
      });
      capture.start();
      const started = performance.now();
      setState('recording', 'Recording 0.0 / 10 seconds.');
      timer = setTimeout(stopRecording, MAX_RECORDING_SECONDS * 1000);
      ticker = setInterval(() => {
        const elapsed = Math.min(MAX_RECORDING_SECONDS, (performance.now() - started) / 1000);
        status.textContent = `Recording ${elapsed.toFixed(1)} / 10 seconds.`;
      }, 100);
    } catch (error) {
      if (run === session) fail(error);
    }
  }

  function stopRecording() {
    if (state !== 'recording') return;
    if (recorder.state !== 'recording') {
      fail(new Error('Audio capture stopped unexpectedly'));
      return;
    }
    setState('encoding', 'Encoding MP3 locally...');
    recorder.stop();
    releaseInput();
  }

  input.addEventListener('change', () => {
    lastSelectedInput = input.value;
    try {
      localStorage.setItem(AUDIO_INPUT_KEY, lastSelectedInput);
    } catch (error) {
      showWarning(`Could not remember the audio input: ${error.message || error}. It will only be remembered while this page is open.`);
    }
  });
  start.addEventListener('click', startRecording);
  stop.addEventListener('click', stopRecording);
  save.addEventListener('click', async () => {
    const run = session;
    setState('saving', 'Saving MP3 attachment...');
    try {
      await onSave(target.id, mp3);
      if (run === session) dialog.close();
    } catch (error) {
      if (run === session) {
        setState('review', `Could not save recording: ${error.message || error}. Retry Save MP3 or Discard.`);
      }
    }
  });
  discard.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (event) => {
    if (state === 'saving') event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    if (!dialog.open) cleanup();
  });
  preview.addEventListener('error', () => {
    if (state === 'review') {
      status.textContent = 'The recorded MP3 preview could not be played. Discard to try another recording.';
    }
  });
  window.addEventListener('pagehide', cleanup);
  return { open };
}
