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
    const bw = c.x1 - c.x0 + 1;
    const bh = c.y1 - c.y0 + 1;
    const areaFrac = (bw * bh) / N;
    if (areaFrac < 0.004 || areaFrac > 0.2 || bw < bh * 1.5) continue;
    // Boîte serrée sur les pixels d'origine (la dilatation ne sert qu'à regrouper les morceaux)
    const t = { x0: w, y0: h, x1: -1, y1: -1, hits: 0 };
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        if (!mask[y * w + x]) continue;
        t.hits++;
        if (x < t.x0) t.x0 = x;
        if (x > t.x1) t.x1 = x;
        if (y < t.y0) t.y0 = y;
        if (y > t.y1) t.y1 = y;
      }
    }
    if (t.hits && (!best || t.hits > best.hits)) best = t;
  }
  if (!best) return null;
  const x0 = Math.max(0, best.x0 - 1);
  const y0 = Math.max(0, best.y0 - 1);
  const x1 = Math.min(w - 1, best.x1 + 1);
  const y1 = Math.min(h - 1, best.y1 + 1);
  return [x0 / w, y0 / h, (x1 - x0 + 1) / w, (y1 - y0 + 1) / h];
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
