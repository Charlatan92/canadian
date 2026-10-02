// Transformation d'une photo officielle (détourée) en "tête émoji" : recadrage sur la tête,
// effet grosse tête, aplats de couleur façon dessin animé, contours encrés, bordure autocollant.
// Fonctions pures sur des images RGBA { data: Uint8ClampedArray, width, height }.

export function makeImage(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

function sampleBilinear(img, x, y, out, o) {
  const { width: w, height: h, data } = img;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 4; c++) {
    const a = data[(y0 * w + x0) * 4 + c];
    const b = data[(y0 * w + x1) * 4 + c];
    const d = data[(y1 * w + x0) * 4 + c];
    const e = data[(y1 * w + x1) * 4 + c];
    out[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
}

// Boîte englobante des pixels visibles (alpha > seuil)
export function alphaBox(img, threshold = 24) {
  const { width: w, height: h, data } = img;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export function isCutout(img) {
  const { data } = img;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 16) transparent++;
  return transparent > (data.length / 4) * 0.1;
}

// Carré centré sur la tête. Photos LNH : buste détouré, tête en haut au centre.
export function headSquare(img) {
  const { width: w, height: h } = img;
  const box = isCutout(img) ? alphaBox(img) : null;
  if (!box) {
    const side = Math.round(Math.min(w, h) * 0.72);
    return { x: Math.round((w - side) / 2), y: Math.round(h * 0.02), side };
  }
  // Largeur de la tête ~ largeur des 30 % supérieurs de la silhouette
  const { data } = img;
  const top = box.y0;
  const scanTo = top + Math.round((box.y1 - box.y0) * 0.3);
  let hx0 = w;
  let hx1 = -1;
  for (let y = top; y <= scanTo; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      if (data[(y * w + x) * 4 + 3] > 24) {
        if (x < hx0) hx0 = x;
        if (x > hx1) hx1 = x;
      }
    }
  }
  const headW = Math.max(8, hx1 - hx0 + 1);
  const side = Math.min(Math.round(headW * 1.38), w, h);
  const cx = (hx0 + hx1) / 2;
  const x = Math.round(Math.max(0, Math.min(w - side, cx - side / 2)));
  const y = Math.round(Math.max(0, Math.min(h - side, top - side * 0.05)));
  return { x, y, side };
}

export function cropResize(img, { x, y, side }, size) {
  const out = makeImage(size, size);
  const k = side / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) sampleBilinear(img, x + (i + 0.5) * k - 0.5, y + (j + 0.5) * k - 0.5, out.data, (j * size + i) * 4);
  }
  return out;
}

// Effet "grosse tête" : le centre (le visage) est agrandi, les bords ne bougent pas
export function bulge(img, strength = 0.28, centerY = 0.46) {
  const { width: w, height: h } = img;
  const out = makeImage(w, h);
  const cx = w / 2;
  const cy = h * centerY;
  const R = Math.min(w, h) * 0.55;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy) / R;
      let sx = x;
      let sy = y;
      if (r < 1 && r > 0) {
        // On va chercher le pixel plus près du centre : le centre est agrandi
        const scale = 1 - strength + strength * r;
        sx = cx + dx * scale;
        sy = cy + dy * scale;
      }
      sampleBilinear(img, sx, sy, out.data, (y * w + x) * 4);
    }
  }
  return out;
}

// Lissage qui préserve les contours (bilatéral approché) : peau et maillot deviennent des aplats
export function smoothEdges(img, iterations = 2, radius = 2, sigma = 28) {
  let cur = img;
  const inv = 1 / (2 * sigma * sigma);
  for (let it = 0; it < iterations; it++) {
    const { width: w, height: h, data } = cur;
    const out = makeImage(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const r0 = data[o];
        const g0 = data[o + 1];
        const b0 = data[o + 2];
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let sw = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const p = (yy * w + xx) * 4;
            if (data[p + 3] < 16) continue;
            const dr = data[p] - r0;
            const dg = data[p + 1] - g0;
            const db = data[p + 2] - b0;
            const wgt = Math.exp(-(dr * dr + dg * dg + db * db) * inv);
            sr += data[p] * wgt;
            sg += data[p + 1] * wgt;
            sb += data[p + 2] * wgt;
            sw += wgt;
          }
        }
        if (sw > 0) {
          out.data[o] = sr / sw;
          out.data[o + 1] = sg / sw;
          out.data[o + 2] = sb / sw;
        }
        out.data[o + 3] = data[o + 3];
      }
    }
    cur = out;
  }
  return cur;
}

// Aplats : la luminosité est ramenée à quelques paliers, la couleur est gardée (un peu plus vive)
export function celShade(img, levels = 5, saturation = 1.18, keep = 0.35) {
  const out = makeImage(img.width, img.height);
  const { data } = img;
  const step = 255 / (levels - 1);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const Y = 0.299 * r + 0.587 * g + 0.114 * b;
    const Cb = (b - Y) * saturation;
    const Cr = (r - Y) * saturation;
    // Paliers doux : on garde une part de la luminosité d'origine pour éviter l'effet "poster"
    const Yq = Math.round(Y / step) * step * (1 - keep) + Y * keep;
    const R = Yq + Cr;
    const B = Yq + Cb;
    const G = (Yq - 0.299 * R - 0.114 * B) / 0.587;
    out.data[i] = R;
    out.data[i + 1] = G;
    out.data[i + 2] = B;
    out.data[i + 3] = data[i + 3];
  }
  return out;
}

// Contours encrés (Sobel sur la luminosité) dessinés par-dessus
export function inkEdges(img, threshold = 70, ink = [38, 22, 18], maxAlpha = 0.85) {
  const { width: w, height: h, data } = img;
  const Y = new Float32Array(w * h);
  for (let i = 0, j = 0; j < Y.length; i += 4, j++) Y[j] = data[i + 3] < 16 ? 0 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const out = { data: new Uint8ClampedArray(data), width: w, height: h };
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      const gx = -Y[k - w - 1] - 2 * Y[k - 1] - Y[k + w - 1] + Y[k - w + 1] + 2 * Y[k + 1] + Y[k + w + 1];
      const gy = -Y[k - w - 1] - 2 * Y[k - w] - Y[k - w + 1] + Y[k + w - 1] + 2 * Y[k + w] + Y[k + w + 1];
      const mag = Math.hypot(gx, gy);
      if (mag < threshold || data[k * 4 + 3] < 16) continue;
      const a = Math.min(1, (mag - threshold) / 120) * maxAlpha;
      const o = k * 4;
      out.data[o] = out.data[o] * (1 - a) + ink[0] * a;
      out.data[o + 1] = out.data[o + 1] * (1 - a) + ink[1] * a;
      out.data[o + 2] = out.data[o + 2] * (1 - a) + ink[2] * a;
    }
  }
  return out;
}

// Bordure blanche d'autocollant + liseré sombre, autour de la silhouette
export function stickerBorder(img, border = 7, line = 2) {
  const { width: w, height: h, data } = img;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < solid.length; i++) solid[i] = data[i * 4 + 3] > 96 ? 1 : 0;
  const dist = distanceToSolid(solid, w, h, border + line + 1);
  const out = makeImage(w, h);
  for (let k = 0; k < solid.length; k++) {
    const o = k * 4;
    const a = data[o + 3] / 255;
    const d = dist[k];
    let br = 0;
    let bg = 0;
    let bb = 0;
    let ba = 0;
    if (d <= border) {
      br = bg = bb = 255;
      ba = 1;
    } else if (d <= border + line) {
      br = 30;
      bg = 26;
      bb = 34;
      ba = 0.9;
    }
    // Photo par-dessus la bordure
    const oa = a + ba * (1 - a);
    if (oa <= 0) continue;
    out.data[o] = (data[o] * a + br * ba * (1 - a)) / oa;
    out.data[o + 1] = (data[o + 1] * a + bg * ba * (1 - a)) / oa;
    out.data[o + 2] = (data[o + 2] * a + bb * ba * (1 - a)) / oa;
    out.data[o + 3] = oa * 255;
  }
  return out;
}

// Distance (en pixels, approx. chanfrein) au pixel plein le plus proche, plafonnée à max
function distanceToSolid(solid, w, h, max) {
  const INF = 1e6;
  const d = new Float32Array(w * h).fill(INF);
  for (let i = 0; i < d.length; i++) if (solid[i]) d[i] = 0;
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (x > 0) d[k] = Math.min(d[k], d[k - 1] + D1);
      if (y > 0) {
        d[k] = Math.min(d[k], d[k - w] + D1);
        if (x > 0) d[k] = Math.min(d[k], d[k - w - 1] + D2);
        if (x < w - 1) d[k] = Math.min(d[k], d[k - w + 1] + D2);
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const k = y * w + x;
      if (x < w - 1) d[k] = Math.min(d[k], d[k + 1] + D1);
      if (y < h - 1) {
        d[k] = Math.min(d[k], d[k + w] + D1);
        if (x < w - 1) d[k] = Math.min(d[k], d[k + w + 1] + D2);
        if (x > 0) d[k] = Math.min(d[k], d[k + w - 1] + D2);
      }
    }
  }
  for (let i = 0; i < d.length; i++) if (d[i] > max) d[i] = INF;
  return d;
}

// Photo non détourée : on garde un disque (avec un fondu) pour faire une silhouette ronde
export function roundMask(img, feather = 0.06, radius = 0.47) {
  const { width: w, height: h } = img;
  const out = { data: new Uint8ClampedArray(img.data), width: w, height: h };
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * radius;
  const f = Math.min(w, h) * feather;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.hypot(x - cx, y - cy);
      const a = r <= R - f ? 1 : r >= R ? 0 : (R - r) / f;
      out.data[(y * w + x) * 4 + 3] *= a;
    }
  }
  return out;
}

// Chaîne complète : photo -> tête émoji (size x size)
export function emojiFromPhoto(photo, { size = 256, margin = 14 } = {}) {
  const inner = size - margin * 2;
  let img = cropResize(photo, headSquare(photo), inner);
  // Photo pleine : disque. Photo détourée : on arrondit seulement le bas (épaules)
  img = isCutout(photo) ? roundMask(img, 0.1, 0.56) : roundMask(img);
  img = bulge(img, 0.26);
  img = smoothEdges(img, 3, 2, 20);
  // Contours calculés sur l'image lissée, avant les aplats : moins de traits parasites
  const inked = inkEdges(img, 115, [40, 24, 20], 0.7);
  img = celShade(inked, 7, 1.25, 0.55);
  // Marge pour la bordure d'autocollant
  const framed = makeImage(size, size);
  for (let y = 0; y < inner; y++) {
    framed.data.set(img.data.subarray(y * inner * 4, (y + 1) * inner * 4), ((y + margin) * size + margin) * 4);
  }
  return stickerBorder(framed, 7, 2);
}
