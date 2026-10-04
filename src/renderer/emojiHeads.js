import { t } from '../shared/i18n.js';
import { TEAMS, teamColor, teamLabel } from '../shared/nhl.js';

// Têtes émoji des joueurs : générées sur votre ordinateur à partir des photos officielles de la
// LNH (jamais redistribuées), gardées en cache, et exportables en PNG dans le dossier Images.

const SIZE = 256;

export function headshotProxyUrl(url) {
  const m = String(url || '').match(/^https:\/\/assets\.nhle\.com\/(.+)$/);
  return m ? `/nhl-img/${m[1]}` : null;
}

export function seasonLabel(date = new Date()) {
  const y = date.getFullYear();
  const start = date.getMonth() >= 6 ? y : y - 1; // la saison commence à l'automne
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// Joueur au format de l'API "roster" -> format interne (comme normalizeGame)
export function rosterPlayers(roster, teamAbbrev) {
  const name = (v) => (typeof v === 'string' ? v : v?.fr ?? v?.default ?? '');
  return ['forwards', 'defensemen', 'goalies']
    .flatMap((k) => roster?.[k] ?? [])
    .map((r) => ({
      id: r.id ?? r.playerId,
      first: name(r.firstName),
      last: name(r.lastName),
      name: `${name(r.firstName)} ${name(r.lastName)}`.trim(),
      number: r.sweaterNumber ?? null,
      pos: r.positionCode ?? '',
      teamAbbrev,
      headshot: r.headshot ?? null,
    }))
    .filter((p) => p.id);
}

export class EmojiHeads {
  constructor() {
    this.urls = new Map();
    this.jobs = new Map();
    this.chain = Promise.resolve(); // une génération à la fois : jamais de pic de CPU pendant le match
    this.worker = null;
    this.seq = 0;
    this.waiters = new Map();
  }

  key(player) {
    return `p${player.id}`;
  }

  cachedUrl(player) {
    return this.urls.get(this.key(player)) ?? null;
  }

  get(player) {
    const key = this.key(player);
    if (this.urls.has(key)) return Promise.resolve(this.urls.get(key));
    if (!this.jobs.has(key)) {
      const job = (this.chain = this.chain.catch(() => {}).then(() => this.#load(player, key)));
      this.jobs.set(key, job);
      job.catch(() => {}).finally(() => this.jobs.delete(key));
    }
    return this.jobs.get(key);
  }

  // Tête déjà créée (mémoire ou disque) sans en générer une nouvelle
  async peek(player) {
    const key = this.key(player);
    if (this.urls.has(key)) return this.urls.get(key);
    const res = await fetch(`/heads/${key}.png`).catch(() => null);
    return res?.status === 200 ? this.#remember(key, await res.blob()) : null;
  }

  // Préparation en arrière-plan (joueurs en uniforme ce soir)
  prefetch(players) {
    for (const p of players) this.get(p).catch(() => {});
  }

  async #load(player, key) {
    const cached = await fetch(`/heads/${key}.png`).catch(() => null);
    if (cached?.status === 200) return this.#remember(key, await cached.blob());
    const blob = await this.#render(player);
    await window.rondelle.saveHead(key, await blob.arrayBuffer());
    return this.#remember(key, blob);
  }

  #remember(key, blob) {
    const url = URL.createObjectURL(blob);
    this.urls.set(key, url);
    return url;
  }

  #stylize(img) {
    this.worker ??= this.#startWorker();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      this.worker.postMessage({ id, data: img.data.buffer, width: img.width, height: img.height, size: SIZE }, [img.data.buffer]);
    });
  }

  #startWorker() {
    const w = new Worker(new URL('./emojiWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const p = this.waiters.get(e.data.id);
      if (!p) return;
      this.waiters.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
    return w;
  }

  async #render(player) {
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    let sticker = null;
    const src = headshotProxyUrl(player.headshot);
    if (src) {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`photo ${res.status}`);
        const bmp = await createImageBitmap(await res.blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0);
        const out = await this.#stylize(cx.getImageData(0, 0, bmp.width, bmp.height));
        sticker = new OffscreenCanvas(out.width, out.height);
        sticker.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
      } catch (err) {
        console.warn('[têtes émoji]', player.name, err.message);
      }
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    if (sticker) ctx.drawImage(sticker, 0, 0);
    else drawHelmet(ctx, player);
    ctx.restore();
    drawNumberBadge(ctx, player);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  // Effectif actuel d'une équipe (API LNH), gardé 30 minutes
  async roster(nhl, team) {
    this.rosters ??= new Map();
    const hit = this.rosters.get(team);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.players;
    const res = await nhl.api(`/v1/roster/${team}/current`);
    if (!res?.ok) throw new Error(res?.error ?? t('effectif indisponible ({why})', { why: res?.status ?? t('réseau') }));
    const players = rosterPlayers(res.data, team);
    if (!players.length) throw new Error('effectif vide');
    this.rosters.set(team, { at: Date.now(), players });
    return players;
  }

  // "Créer les têtes" d'une équipe : génération (une à la fois), puis export PNG dans
  // Images/Rondelle/Têtes <équipe> <saison>
  async generateRoster({ nhl, team, onProgress, signal, open = true }) {
    const players = await this.roster(nhl, team);
    let done = 0;
    for (const p of players) {
      if (signal?.aborted) throw new Error('annulé');
      await this.get(p).catch(() => {});
      onProgress?.(++done, players.length, p);
    }
    const files = players.map((p) => ({
      key: this.key(p),
      name: `${p.number != null ? String(p.number).padStart(2, '0') : '--'} ${p.first} ${p.last}`,
    }));
    return window.rondelle.exportHeads({ folder: t('Têtes {team} {season}', { team: teamLabel(team), season: seasonLabel() }), files, open });
  }
}

// Avatar de secours (pas de photo officielle) : casque aux couleurs de l'équipe, visière, numéro
function drawHelmet(ctx, player) {
  const color = teamColor(player.teamAbbrev);
  const alt = TEAMS[player.teamAbbrev]?.alt ?? '#ffffff';
  const c = SIZE / 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(c, c + 6, 104, 0, Math.PI * 2);
  ctx.fill();
  // Coque du casque
  const g = ctx.createLinearGradient(0, 40, 0, 220);
  g.addColorStop(0, shade(color, 0.25));
  g.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c + 6, 94, Math.PI * 0.98, Math.PI * 2.02);
  ctx.lineTo(c + 94, c + 40);
  ctx.quadraticCurveTo(c, c + 100, c - 94, c + 40);
  ctx.closePath();
  ctx.fill();
  // Bande
  ctx.fillStyle = alt;
  ctx.fillRect(c - 94, c - 22, 188, 12);
  // Visière fumée
  const v = ctx.createLinearGradient(0, c, 0, c + 46);
  v.addColorStop(0, 'rgba(20, 28, 44, 0.95)');
  v.addColorStop(1, 'rgba(70, 90, 120, 0.85)');
  ctx.fillStyle = v;
  roundRect(ctx, c - 70, c + 2, 140, 44, 20);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  roundRect(ctx, c - 58, c + 8, 60, 8, 4);
  ctx.fill();
  // Numéro sur le casque
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px Bahnschrift, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(player.number != null ? String(player.number) : '?', c, c - 50);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1e1a22';
  ctx.beginPath();
  ctx.arc(c, c + 6, 104, 0, Math.PI * 2);
  ctx.stroke();
}

function drawNumberBadge(ctx, player) {
  if (player.number == null) return;
  const x = SIZE - 44;
  const y = SIZE - 44;
  ctx.fillStyle = teamColor(player.teamAbbrev);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px Bahnschrift, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(player.number), x, y + 1);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amount > 0 ? (255 - v) * amount : v * amount))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}
