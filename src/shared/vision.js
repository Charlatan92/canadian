// Petites routines de vision, en JS pur, sur des images en niveaux de gris (Uint8Array w*h).
// Elles tournent sur des vignettes minuscules (quelques milliers de pixels) : coût négligeable.

export function rgbaToGray(rgba, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return out;
}

export function meanLuma(gray) {
  let s = 0;
  for (let i = 0; i < gray.length; i++) s += gray[i];
  return gray.length ? s / gray.length : 0;
}

export function meanAbsDiff(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

export function sobel(gray, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

// Signature d'un tableau de score : carte de contours (intérieur seulement), centrée et normalisée.
// Les contours résistent mieux que les pixels bruts aux fonds semi-transparents.
export function signature(gray, w, h) {
  const e = sobel(gray, w, h);
  const out = new Float32Array(Math.max(0, (w - 2) * (h - 2)));
  let k = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) out[k++] = e[y * w + x];
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i];
  mean /= out.length || 1;
  let norm = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] -= mean;
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm);
  if (norm < 1e-6) return out; // image uniforme : signature nulle
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// Corrélation entre deux signatures (-1..1)
export function correlate(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function scorebugSimilarity(gray, w, h, refSignature) {
  if (!refSignature) return null;
  return Math.max(0, correlate(signature(gray, w, h), refSignature));
}

// --- OCR : préparation des vignettes (horloge, score) ---

export function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = i;
    }
  }
  return thr;
}

// Binarise en texte noir sur fond blanc (ce que Tesseract préfère), agrandi `scale` fois.
export function prepareForOcr(gray, w, h, scale = 3) {
  const thr = otsuThreshold(gray);
  let above = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] > thr) above++;
  // Le texte est minoritaire : si les pixels clairs sont minoritaires, le texte est clair -> on inverse
  const textIsLight = above < gray.length / 2;
  const W = w * scale + 16;
  const H = h * scale + 16;
  const out = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < h * scale; y++) {
    for (let x = 0; x < w * scale; x++) {
      const v = gray[Math.floor(y / scale) * w + Math.floor(x / scale)];
      const ink = textIsLight ? v > thr : v <= thr;
      const o = ((y + 8) * W + (x + 8)) * 4;
      const c = ink ? 0 : 255;
      out[o] = out[o + 1] = out[o + 2] = c;
    }
  }
  return { data: out, width: W, height: H };
}

// --- Détection automatique du tableau de score ---
// Sur ~30 images prises pendant le jeu, le tableau de score est la plus grande zone
// à la fois riche en contours et immobile, alors que la caméra bouge sans arrêt.
export function autoDetectScorebug(frames, w, h) {
  if (!frames || frames.length < 8) return null;
  const n = frames.length;
  const N = w * h;
  const meanEdge = new Float32Array(N);
  const mean = new Float32Array(N);
  const sq = new Float32Array(N);
  for (const f of frames) {
    const e = sobel(f, w, h);
    for (let i = 0; i < N; i++) {
      meanEdge[i] += e[i] / n;
      mean[i] += f[i] / n;
      sq[i] += (f[i] * f[i]) / n;
    }
  }
  let movingPixels = 0;
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const sd = Math.sqrt(Math.max(0, sq[i] - mean[i] * mean[i]));
    if (sd > 20) movingPixels++;
    if (meanEdge[i] > 60 && sd < 14) mask[i] = 1;
  }
  if (movingPixels < N * 0.15) return null; // pas assez de mouvement pour distinguer l'incrustation

  const grown = dilate(dilate(dilate(mask, w, h), w, h), w, h);
  const comps = components(grown, w, h);
  let best = null;
  for (const c of comps) {
    // Boîte serrée sur les pixels d'origine, en ne gardant que les lignes et colonnes denses :
    // une fine ligne fixe collée au tableau (bande, logo) ne doit pas étirer la boîte.
    const t = denseBox(mask, w, c);
    if (!t) continue;
    const bw = t.x1 - t.x0 + 1;
    const bh = t.y1 - t.y0 + 1;
    const areaFrac = (bw * bh) / N;
    if (areaFrac < 0.004 || areaFrac > 0.2 || bw < bh * 1.5) continue;
    if (!best || t.hits > best.hits) best = t;
  }
  if (!best) return null;
  const x0 = Math.max(0, best.x0 - 1);
  const y0 = Math.max(0, best.y0 - 1);
  const x1 = Math.min(w - 1, best.x1 + 1);
  const y1 = Math.min(h - 1, best.y1 + 1);
  return [x0 / w, y0 / h, (x1 - x0 + 1) / w, (y1 - y0 + 1) / h];
}

// --- Détection automatique de l'horloge, dans le tableau de score ---
// Sur une rafale du tableau (une image toutes les ~0,5 s), les chiffres des secondes changent
// environ une fois par seconde, alors que le reste du tableau est fixe (noms, score) et qu'une
// animation change tout le temps. La zone qui change « au rythme d'une horloge » est prolongée vers
// la gauche (minutes, deux-points) d'après la hauteur des chiffres. Retourne [x, y, w, h] (0..1,
// relatif au tableau) ou null.
export function autoDetectClock(frames, w, h) {
  if (!frames || frames.length < 6) return null;
  const N = w * h;
  const pairs = frames.length - 1;
  const changes = new Uint16Array(N);
  for (let k = 1; k < frames.length; k++) {
    const a = frames[k - 1];
    const b = frames[k];
    for (let i = 0; i < N; i++) if (Math.abs(a[i] - b[i]) > 45) changes[i]++;
  }
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = changes[i] / pairs;
    if (r >= 0.1 && r <= 0.8) mask[i] = 1;
  }
  const comps = components(dilate(dilate(mask, w, h), w, h), w, h);
  let best = null;
  for (const c of comps) {
    const ch = c.y1 - c.y0 + 1;
    const cw = c.x1 - c.x0 + 1;
    if (ch < h * 0.2 || ch > h * 0.98 || cw > w * 0.6 || c.size < 12) continue;
    // La plus grande zone ; à taille égale, la plus à droite (les secondes sont à droite de l'horloge)
    const score = c.size + c.x1 * 0.5;
    if (!best || score > best.score) best = { ...c, score };
  }
  if (!best) return null;
  const digitH = Math.max(3, best.y1 - best.y0 - 1); // sans la dilatation
  const x1 = Math.min(w - 1, best.x1 + 1);
  const x0 = Math.max(0, Math.round(x1 - digitH * 3.6));
  const y0 = Math.max(0, Math.round(best.y0 - digitH * 0.1));
  const y1 = Math.min(h - 1, Math.round(best.y1 + digitH * 0.1));
  return [x0 / w, y0 / h, (x1 - x0 + 1) / w, (y1 - y0 + 1) / h];
}

// Zone relative au tableau -> zone relative à l'image entière
export function subRect(outer, inner) {
  const [ox, oy, ow, oh] = outer;
  const [ix, iy, iw, ih] = inner;
  return [ox + ix * ow, oy + iy * oh, iw * ow, ih * oh];
}

function denseRange(counts, ratio = 0.25) {
  let peak = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[peak]) peak = i;
  if (!counts[peak]) return null;
  const min = counts[peak] * ratio;
  let a = peak;
  let b = peak;
  while (a > 0 && (counts[a - 1] >= min || (a > 1 && counts[a - 2] >= min))) a--;
  while (b < counts.length - 1 && (counts[b + 1] >= min || (b < counts.length - 2 && counts[b + 2] >= min))) b++;
  return [a, b];
}

function denseBox(mask, w, c) {
  const rows = new Array(c.y1 - c.y0 + 1).fill(0);
  for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) rows[y - c.y0] += mask[y * w + x];
  const ry = denseRange(rows);
  if (!ry) return null;
  const y0 = c.y0 + ry[0];
  const y1 = c.y0 + ry[1];
  const cols = new Array(c.x1 - c.x0 + 1).fill(0);
  for (let y = y0; y <= y1; y++) for (let x = c.x0; x <= c.x1; x++) cols[x - c.x0] += mask[y * w + x];
  const rx = denseRange(cols, 0.15);
  if (!rx) return null;
  let hits = 0;
  for (let y = y0; y <= y1; y++) for (let x = c.x0 + rx[0]; x <= c.x0 + rx[1]; x++) hits += mask[y * w + x];
  return { x0: c.x0 + rx[0], x1: c.x0 + rx[1], y0, y1, hits };
}

function dilate(m, w, h) {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

function components(m, w, h) {
  const seen = new Uint8Array(m.length);
  const out = [];
  const stack = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || seen[i]) continue;
    const c = { x0: w, y0: h, x1: 0, y1: 0, size: 0 };
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      const x = j % w;
      const y = (j - x) / w;
      c.size++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (const k of [j - 1, j + 1, j - w, j + w]) {
        if (k < 0 || k >= m.length || seen[k] || !m[k]) continue;
        if ((k === j - 1 || k === j + 1) && Math.floor(k / w) !== y) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    out.push(c);
  }
  return out;
}
