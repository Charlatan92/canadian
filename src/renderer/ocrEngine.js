import Tesseract from '/vendor/tesseract/tesseract.esm.min.js';
import { prepareForOcr } from '../shared/vision.js';

// OCR hors ligne (Tesseract en WebAssembly, dans un worker) pour lire l'horloge et le score.
// Une seule lecture à la fois ; si une nouvelle vignette du même type arrive, l'ancienne est abandonnée.
export class OcrEngine {
  constructor() {
    this.worker = null;
    this.starting = null;
    this.busy = false;
    this.jobs = new Map();
    this.stats = { done: 0, ms: 0 };
  }

  async #ensure() {
    if (this.worker) return this.worker;
    this.starting ??= (async () => {
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: '/vendor/tesseract/worker.min.js',
        corePath: '/vendor/tesseract-core/',
        langPath: '/vendor/lang',
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: true,
      });
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789:.',
        tessedit_pageseg_mode: '7', // une seule ligne de texte
      });
      this.worker = worker;
      return worker;
    })();
    return this.starting;
  }

  // crop : { w, h, gray } -> Promise<string|null>
  read(kind, crop) {
    return new Promise((resolve) => {
      this.jobs.get(kind)?.resolve(null);
      this.jobs.set(kind, { crop, resolve });
      this.#pump();
    });
  }

  async #pump() {
    if (this.busy || !this.jobs.size) return;
    const [kind, job] = this.jobs.entries().next().value;
    this.jobs.delete(kind);
    this.busy = true;
    const t0 = performance.now();
    try {
      const worker = await this.#ensure();
      const img = prepareForOcr(job.crop.gray, job.crop.w, job.crop.h, 2);
      const canvas = new OffscreenCanvas(img.width, img.height);
      canvas.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
      const { data } = await worker.recognize(canvas);
      job.resolve(data.text ?? '');
      this.stats.done++;
      this.stats.ms = performance.now() - t0;
    } catch (err) {
      console.warn('[ocr]', err);
      job.resolve(null);
    } finally {
      this.busy = false;
      this.#pump();
    }
  }
}
