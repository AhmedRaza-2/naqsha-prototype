// Voice input: speech to text with a deep-learning model (OpenAI Whisper, the English-only "tiny.en" size), run in the
// visitor's browser with onnxruntime through transformers.js. The audio never leaves the device; only the model files
// (about 40 MB, kept in the browser cache after the first use) are downloaded, from the Hugging Face hub.
// English only for now. The text it returns is read by the same sentence reader as typed text (nlp.js).
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js';
const MODEL = 'Xenova/whisper-tiny.en';

let asrPromise = null;
/** Download (once) and start the speech model. onProgress(0..1) reports the download. */
export function loadSpeechModel(onProgress) {
  if (!asrPromise) {
    asrPromise = (async () => {
      const tf = await import(/* @vite-ignore */ TRANSFORMERS);
      tf.env.allowLocalModels = false;
      const files = new Map();
      return tf.pipeline('automatic-speech-recognition', MODEL, {
        dtype: 'q8', device: 'wasm',
        progress_callback: (e) => {
          if (e.status === 'progress' && e.total) {
            files.set(e.file, [e.loaded, e.total]);
            let l = 0, t = 0;
            for (const [a, b] of files.values()) { l += a; t += b; }
            onProgress?.(t ? l / t : 0);
          }
        },
      });
    })();
    asrPromise.catch(() => { asrPromise = null; });          // a failed download can be tried again
  }
  return asrPromise;
}

/** True when this browser can record from a microphone. */
export const canListen = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));

const WORKLET = `class Cap extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; }
}
registerProcessor('naqsha-cap', Cap);`;

/**
 * Start listening. Calls onLevel(0..1) while recording and onSilence() once the speaker has stopped (3.5 seconds of quiet after some speech). stop() ends it and returns { audio: Float32Array at 16 kHz, speechMs }.
 */
export async function startListening({ onLevel, onSilence } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const chunks = [];
  let samples = 0, speechMs = 0, quietMs = 0, floor = null, win = 0, winMs = 0, finished = false;
  const msOf = (n) => (n / ctx.sampleRate) * 1000;
  const onBlock = (block) => {
    chunks.push(block); samples += block.length;
    let s = 0;
    for (let i = 0; i < block.length; i++) s += block[i] * block[i];
    const ms = msOf(block.length);
    win += s; winMs += ms;
    const rms = Math.sqrt(s / block.length);
    onLevel?.(Math.min(1, rms * 12));
    if (winMs < 100) return;                                   // judged in 100 ms windows
    const wr = Math.sqrt(win / ((winMs / 1000) * ctx.sampleRate)); win = 0; const wms = winMs; winMs = 0;
    floor = floor == null ? wr : Math.min(wr, floor * 1.02 + 0.0005);   // the quietest the room has been so far, creeping up slowly
    const loud = wr > Math.max(0.006, floor * 2.2);            // speech is clearly above the room's quiet level
    if (loud) { speechMs += wms; quietMs = 0; } else if (speechMs > 0) quietMs += wms;
    // only a long pause (3.5 s) after some speech ends it by itself; pressing Stop works any time
    if (!finished && ((speechMs > 600 && quietMs > 3500) || msOf(samples) > 40000)) { finished = true; onSilence?.(); }
  };
  let node;
  try {
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    node = new AudioWorkletNode(ctx, 'naqsha-cap');
    node.port.onmessage = (e) => onBlock(e.data);
  } catch {                                                  // older browsers: the same thing with a script processor
    node = ctx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = (e) => onBlock(new Float32Array(e.inputBuffer.getChannelData(0)));
  }
  src.connect(node); node.connect(ctx.destination);          // the node writes no output, so nothing is played back
  return {
    stop() {
      finished = true;
      stream.getTracks().forEach((t) => t.stop());
      node.disconnect(); src.disconnect(); ctx.close().catch(() => {});
      const audio = new Float32Array(samples);
      let o = 0;
      for (const c of chunks) { audio.set(c, o); o += c.length; }
      return { audio, speechMs };
    },
  };
}

/** Speech (16 kHz mono) to text, or '' when nothing was said. */
export async function transcribe(audio, onProgress) {
  const asr = await loadSpeechModel(onProgress);
  const out = await asr(audio, { chunk_length_s: 30, stride_length_s: 5 });
  const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text) || '';
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();     // drop tags like [BLANK_AUDIO]
}

/** "yes" / "no" / null from a short spoken answer. */
export function readAnswer(text) {
  const t = ` ${text.toLowerCase().replace(/[^a-z ]/g, ' ')} `;
  if (/\b(no|nope|nah|wrong|change|again|cancel|stop|not right|incorrect)\b/.test(t)) return 'no';
  if (/\b(yes|yeah|yep|yup|ok|okay|sure|correct|right|go ahead|go on|do it|proceed|continue|looks good|that is right|that s right)\b/.test(t)) return 'yes';
  return null;
}
