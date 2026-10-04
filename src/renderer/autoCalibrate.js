import { parseClockText } from '../shared/ocr.js';
import { autoDetectClock, autoDetectScorebug, subRect } from '../shared/vision.js';

// Calibration automatique, sans rien demander : pendant le jeu, on cherche le tableau de score
// (zone fixe et riche en contours alors que la caméra bouge), puis son horloge (la zone qui change
// au rythme d'une seconde), et on vérifie l'horloge en la lisant. Sans horloge lisible, on ne garde
// rien : un mauvais tableau fausserait la détection des pubs.
// expectedRemaining : temps restant selon l'API (aide à choisir entre plusieurs lectures), ou null
export async function autoCalibrate({ bridge, ocr, expectedRemaining = null }) {
  const W = 192;
  const H = 108;
  const frames = await bridge.burst({ w: W, h: H, count: 28, intervalMs: 400 });
  if (!frames?.length) return { error: "pas d'image" };
  const scorebug = autoDetectScorebug(
    frames.map((f) => f.gray),
    W,
    H,
  );
  if (!scorebug) return { error: 'tableau de score introuvable' };

  // Rafale du tableau seul, en meilleure définition (image 16:9 supposée pour les proportions)
  const bw = 320;
  const aspect = (scorebug[2] * 16) / (scorebug[3] * 9);
  const bh = Math.max(12, Math.min(120, Math.round(bw / aspect)));
  const crops = await bridge.burst({ w: bw, h: bh, count: 12, intervalMs: 500, rect: scorebug });
  const inner = autoDetectClock(
    crops.map((f) => f.gray),
    bw,
    bh,
  );
  if (!inner) return { scorebug, error: 'horloge introuvable' };

  // Vérification : on lit l'horloge sur des images de la rafale (prises pendant le jeu ; une image
  // prise après coup pourrait tomber sur un ralenti sans tableau), avec plusieurs cadrages autour de
  // la zone trouvée. On garde la lecture qui ressemble à une horloge, la plus proche de l'API si connue.
  const [ix, iy, iw, ih] = inner;
  const right = ix + iw;
  const tries = [];
  let best = null;
  const samples = [crops[Math.floor(crops.length / 2)], crops.at(-2), crops[1]].filter(Boolean);
  outer: for (const frame of samples) {
    for (const widthFactor of [1, 1.25, 0.8, 1.55]) {
      for (const pad of [0.1, 0.3]) {
        const w = Math.min(right, iw * widthFactor);
        const y = Math.max(0, iy - ih * pad);
        const h = Math.min(1 - y, ih * (1 + 2 * pad));
        const local = [right - w, y, w, h];
        const text = ((await ocr.read('auto-clock', cropFrame(frame.gray, bw, bh, local))) ?? '').trim();
        const remaining = parseClockText(text);
        tries.push({ text, ok: remaining != null });
        if (remaining == null || remaining > 1200) continue;
        const err = expectedRemaining != null ? Math.abs(remaining - expectedRemaining) : 0;
        if (!best || err < best.err) best = { rect: subRect(scorebug, local), text, err };
        if (best.err < 5) break outer;
      }
    }
  }
  if (!best) return { scorebug, error: 'horloge illisible', tries: tries.slice(0, 8) };
  return { scorebug, clock: best.rect.map((v) => Math.round(v * 10000) / 10000), reading: best.text };
}

// Zone d'une image de la rafale (niveaux de gris), remise à 36 px de haut pour la lecture
function cropFrame(gray, w, h, [x, y, cw, ch], outH = 36) {
  const sx = x * w;
  const sy = y * h;
  const sw = Math.max(1, cw * w);
  const sh = Math.max(1, ch * h);
  const ow = Math.max(8, Math.min(320, Math.round((outH * sw) / sh)));
  const out = new Uint8Array(ow * outH);
  for (let j = 0; j < outH; j++) {
    const yy = Math.min(h - 1, Math.floor(sy + ((j + 0.5) * sh) / outH));
    for (let i = 0; i < ow; i++) {
      const xx = Math.min(w - 1, Math.floor(sx + ((i + 0.5) * sw) / ow));
      out[j * ow + i] = gray[yy * w + xx];
    }
  }
  return { w: ow, h: outH, gray: out };
}
