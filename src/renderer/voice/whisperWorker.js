// Worker de reconnaissance vocale : Whisper (transformers.js + ONNX Runtime), sur la carte graphique
// (WebGPU) si possible, sinon sur le processeur (WebAssembly). Tout tourne sur l'ordinateur : le
// modèle est téléchargé une seule fois via l'app (proxy habs://app/hf/ avec cache disque).
import { env, pipeline } from '/vendor/transformers/transformers.min.js';

const here = self.location.href;
const HF = 'https://huggingface.co/';
env.allowLocalModels = false;
env.allowRemoteModels = true;
// On garde l'adresse officielle (transformers.js ne vérifie l'existence des fichiers que sur http(s))
// mais chaque requête passe par le proxy de l'app, qui télécharge une fois et garde sur le disque.
env.remoteHost = HF;
env.fetch = (url, init) => fetch(String(url).startsWith(HF) ? new URL(`/hf/${String(url).slice(HF.length)}`, here).href : url, init);
env.useBrowserCache = false;
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('/vendor/ort/ort-wasm-simd-threaded.asyncify.mjs', here).href,
  wasm: new URL('/vendor/ort/ort-wasm-simd-threaded.asyncify.wasm', here).href,
};

let asr = null;
let loadedKey = null;
let failures = 0; // transcriptions ratées d'affilée

async function hasWebGPU() {
  try {
    return !!(self.navigator?.gpu && (await self.navigator.gpu.requestAdapter()));
  } catch {
    return false;
  }
}

function progress(p) {
  if (p?.status === 'progress' || p?.status === 'done') {
    self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0, done: p.status === 'done' });
  }
}

async function create(model, device) {
  const options =
    device === 'webgpu'
      ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } }
      : { device: 'wasm', dtype: 'q8' };
  return pipeline('automatic-speech-recognition', model, { ...options, progress_callback: progress });
}

async function release() {
  try {
    await asr?.dispose?.();
  } catch {}
  asr = null;
}

async function load({ model, device }) {
  const wantGpu = device === 'webgpu' || (device === 'auto' && (await hasWebGPU()));
  const key = `${model}|${wantGpu ? 'webgpu' : 'wasm'}`;
  if (asr && loadedKey === key) return loadedKey.split('|')[1];
  await release();
  failures = 0;
  try {
    asr = await create(model, wantGpu ? 'webgpu' : 'wasm');
    loadedKey = key;
  } catch (err) {
    if (!wantGpu) throw err;
    // La carte graphique a refusé (pilote, opération non gérée) : on repasse sur le processeur
    self.postMessage({ type: 'log', message: `WebGPU indisponible (${err.message}), passage au processeur` });
    asr = await create(model, 'wasm');
    loadedKey = `${model}|wasm`;
  }
  return loadedKey.split('|')[1];
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'load') {
    try {
      const device = await load(m);
      self.postMessage({ type: 'ready', device });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message ?? err) });
    }
  } else if (m.type === 'transcribe') {
    if (!asr) return self.postMessage({ type: 'result', id: m.id, error: 'modèle non chargé' });
    const t0 = performance.now();
    try {
      const out = await asr(m.audio, { language: m.language, task: 'transcribe', max_new_tokens: 48 });
      failures = 0;
      self.postMessage({ type: 'result', id: m.id, text: String(out?.text ?? '').trim(), ms: performance.now() - t0 });
    } catch (err) {
      const message = String(err?.message ?? err);
      const [model, device] = (loadedKey ?? '').split('|');
      // La carte graphique a chargé le modèle mais échoue au calcul : on repasse sur le processeur
      if (device === 'webgpu' && ++failures >= 2) {
        self.postMessage({ type: 'log', message: `WebGPU en échec (${message}), passage au processeur` });
        await release();
        try {
          asr = await create(model, 'wasm');
          loadedKey = `${model}|wasm`;
          failures = 0;
          self.postMessage({ type: 'ready', device: 'wasm' });
        } catch (e) {
          self.postMessage({ type: 'error', message: String(e?.message ?? e) });
        }
      }
      self.postMessage({ type: 'result', id: m.id, error: message, ms: performance.now() - t0 });
    }
  }
};
