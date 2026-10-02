// Worker : stylisation des photos en têtes émoji, hors du fil de l'interface (pas de saccade).
import { emojiFromPhoto } from '../shared/emoji.js';

self.onmessage = (e) => {
  const { id, data, width, height, size } = e.data;
  try {
    const out = emojiFromPhoto({ data: new Uint8ClampedArray(data), width, height }, { size });
    self.postMessage({ id, data: out.data.buffer, width: out.width, height: out.height }, [out.data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
