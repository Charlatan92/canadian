// Copie dans vendor/ le moteur de reconnaissance vocale pour navigateur (transformers.js) et le
// binaire WebAssembly d'ONNX Runtime. Lancé après « npm install » et avant la création du paquet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  ['node_modules/@huggingface/transformers/dist/transformers.min.js', 'vendor/transformers/transformers.min.js'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', 'vendor/ort/ort-wasm-simd-threaded.asyncify.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', 'vendor/ort/ort-wasm-simd-threaded.asyncify.wasm'],
];

for (const [from, to] of FILES) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) {
    // Pas bloquant : seule la reconnaissance vocale sera indisponible
    console.warn(`[vendor] fichier absent : ${from}`);
    continue;
  }
  const dest = path.join(root, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
