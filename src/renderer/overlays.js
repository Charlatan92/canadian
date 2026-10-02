import { onColor } from '../shared/color.js';
import { EVENT_LABELS, penaltyLabel, periodName, formatClock, teamColor } from '../shared/nhl.js';
import { teamTheme } from '../shared/theme.js';
import { $, esc, icon, initials, ordinalFr, photoHtml, teamLogoHtml } from './util.js';

const POS_FR = { C: 'Centre', L: 'Ailier G.', R: 'Ailier D.', D: 'Défenseur', G: 'Gardien' };

// ---------------------------------------------------------------- Carte du joueur (style FIFA)

export class PlayerCard {
  constructor(el) {
    this.el = el;
    this.hideTimer = null;
    this.shownAt = 0;
    this.queued = null;
    this.current = null;
  }

  // style : 'card' (photo + nom) | 'name' (nom seulement) | 'emoji' (tête émoji)
  // play : action LNH (ou null quand c'est le commentateur qui nomme le joueur) ; label : texte forcé
  show(opts) {
    // Pas plus d'un changement de carte toutes les 1,2 s : sinon ça clignote
    const wait = 1200 - (Date.now() - this.shownAt);
    if (wait > 0) {
      this.queued = opts;
      clearTimeout(this.queueTimer);
      this.queueTimer = setTimeout(() => {
        const q = this.queued;
        this.queued = null;
        if (q) this.show(q);
      }, wait);
      return;
    }
    const { player, play = null, stats, durationSec = 5, style = 'card', label = null, emojiUrl = null } = opts;
    this.shownAt = Date.now();
    this.current = player.id;
    const action = label ?? (play?.type === 'penalty' ? penaltyLabel(play.details?.descKey) : EVENT_LABELS[play?.type] ?? '');
    this.el.className = `player-card style-${style}`;
    const color = teamColor(player.teamAbbrev);
    this.el.style.setProperty('--team', color);
    this.el.style.setProperty('--team-on', onColor(color));
    if (style === 'name') this.el.innerHTML = nameplateHtml(player, action);
    else if (style === 'emoji') this.el.innerHTML = emojiHtml(player, action, emojiUrl);
    else this.el.innerHTML = cardHtml(player, action, stats);
    void this.el.offsetWidth; // relance l'animation d'entrée
    this.el.classList.add('show');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), durationSec * 1000);
  }

  // La tête émoji est arrivée après coup (première génération) : on l'affiche si c'est toujours lui
  updateEmoji(playerId, url) {
    if (this.current !== playerId || !this.el.classList.contains('style-emoji')) return;
    const box = this.el.querySelector('.pe-head');
    if (box) box.outerHTML = `<img class="pe-head" src="${esc(url)}" alt="">`;
  }

  hide() {
    clearTimeout(this.hideTimer);
    this.el.classList.remove('show');
    this.current = null;
  }
}

function cardHtml(player, action, stats) {
  const s = stats ?? {};
  const pts = (s.g ?? 0) + (s.a1 ?? 0) + (s.a2 ?? 0);
  const statLine =
    player.pos === 'G'
      ? ''
      : `<span><b>${s.g ?? 0}</b>B</span><span><b>${(s.a1 ?? 0) + (s.a2 ?? 0)}</b>A</span><span><b>${s.sog ?? 0}</b>TIRS</span><span><b>${s.hits ?? 0}</b>MÉ</span>`;
  return `
      <div class="pc-photo">${photoHtml(player.headshot, initials(player))}</div>
      <div class="pc-body">
        <div class="pc-num">${esc(player.number ?? '')}</div>
        <div class="pc-first">${esc(player.first)} · ${esc(player.teamAbbrev ?? '')}</div>
        <div class="pc-last">${esc(player.last)}</div>
        <div class="pc-meta">
          ${action ? `<span class="pc-chip">${esc(action)}</span>` : ''}
          <span class="pc-chip ghost">${esc(POS_FR[player.pos] ?? player.pos)}</span>
          ${pts >= 2 ? '<span class="pc-chip ghost">En feu</span>' : ''}
        </div>
        <div class="pc-stats">${statLine}</div>
      </div>`;
}

// Plaque façon FIFA : numéro dans la couleur de l'équipe, nom en grand
function nameplateHtml(player, action) {
  return `
      <div class="pn-num">${esc(player.number ?? '')}</div>
      <div class="pn-body">
        <div class="pn-first">${esc(player.first)}</div>
        <div class="pn-last">${esc(player.last)}</div>
        ${action ? `<div class="pn-action">${esc(action)}</div>` : ''}
      </div>`;
}

function emojiHtml(player, action, url) {
  const head = url ? `<img class="pe-head" src="${esc(url)}" alt="">` : `<div class="pe-head pe-wait">${esc(player.number ?? initials(player))}</div>`;
  return `${head}${action ? `<div class="pe-action">${esc(action)}</div>` : ''}`;
}

// ---------------------------------------------------------------- Bandeau bas de l'écran

export class Banner {
  constructor(el) {
    this.el = el;
    this.timer = null;
  }

  show({ tag, title, sub = '', color = '#5b8def', durationSec = 7 }) {
    this.el.style.setProperty('--team', color);
    this.el.style.setProperty('--team-on', onColor(color));
    this.el.innerHTML = `<div class="bn-tag">${esc(tag)}</div><div class="bn-text"><div class="bn-title">${esc(title)}</div><div class="bn-sub">${esc(sub)}</div></div>`;
    this.el.classList.add('show');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.el.classList.remove('show'), durationSec * 1000);
  }
}

// ---------------------------------------------------------------- Effet de pression

export class TensionFx {
  constructor(el) {
    this.el = el;
    this.last = -1;
  }

  set(value, intensity = 0.7) {
    const v = Math.round(Math.max(0, value - 0.35) * 100) / 65; // rien sous 0,35
    const op = Math.min(1, v * intensity * 1.3);
    if (Math.abs(op - this.last) < 0.02) return;
    this.last = op;
    this.el.style.opacity = op.toFixed(2);
    this.el.classList.toggle('beat', op > 0.55);
  }
}

// ---------------------------------------------------------------- Célébration

export class Celebration {
  constructor(el, canvas) {
    this.el = el;
    this.canvas = canvas;
    this.timer = null;
    this.raf = null;
    this.active = false;
  }

  start({ player, play, game, durationSec = 9, confetti = true, emojiUrl = null, logos = true }) {
    this.stop();
    this.active = true;
    const d = play?.details ?? {};
    const assists = [d.assist1PlayerId, d.assist2PlayerId]
      .map((id) => game?.players.get(id))
      .filter(Boolean)
      .map((p) => p.last);
    const lines = [];
    if (d.scoringPlayerTotal) lines.push(`Son ${ordinalFr(d.scoringPlayerTotal)} but de la saison`);
    lines.push(assists.length ? `Aides : ${assists.join(', ')}` : player ? 'Sans aide' : '');
    if (play) lines.push(`${periodName(play.period, game?.gameType)}${play.period <= 3 ? ' période' : ''} · ${formatClock(play.tip)}`);
    const scorer = player
      ? `<div class="cel-scorer">
           <div class="cel-photo${emojiUrl ? ' cel-emoji' : ''}">${emojiUrl ? `<img src="${esc(emojiUrl)}" alt="">` : photoHtml(player.headshot, initials(player))}</div>
           <div><div class="cel-name">${esc(player.first)} ${esc(player.last)} <span style="opacity:.7">#${esc(player.number ?? '')}</span></div>
           ${lines.filter(Boolean).map((l) => `<div class="cel-line">${esc(l)}</div>`).join('')}</div>
         </div>`
      : `<div class="cel-scorer">${game?.team?.abbrev ? teamLogoHtml(game.team.abbrev, { cls: 'cel-logo', logos }) : ''}<div><div class="cel-name">But des ${esc(game?.team?.name ?? 'vôtres')} !</div><div class="cel-line">${esc(chant(game?.team?.abbrev, game?.team?.name))}</div></div></div>`;
    this.el.querySelectorAll('.cel-flash, .cel-word, .cel-scorer').forEach((n) => n.remove());
    this.el.insertAdjacentHTML('beforeend', `<div class="cel-flash"></div><div class="cel-word">BUT !</div>${scorer}`);
    this.el.classList.add('show');
    if (confetti) this.#confetti(durationSec, teamTheme(game?.team?.abbrev).confetti);
    this.timer = setTimeout(() => this.stop(), durationSec * 1000);
  }

  stop() {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    this.active = false;
    this.el.classList.remove('show');
    this.el.querySelectorAll('.cel-flash, .cel-word, .cel-scorer').forEach((n) => n.remove());
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Confettis aux couleurs de l'équipe, ~180 particules, arrêt automatique
  #confetti(durationSec, colors) {
    const c = this.canvas;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const ctx = c.getContext('2d');
    const parts = Array.from({ length: 180 }, () => ({
      x: Math.random() * c.width,
      y: -Math.random() * c.height * 0.6,
      vx: (Math.random() - 0.5) * 3 * dpr,
      vy: (2 + Math.random() * 3.5) * dpr,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: (6 + Math.random() * 8) * dpr,
      h: (3 + Math.random() * 5) * dpr,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const end = performance.now() + Math.max(2000, durationSec * 1000 - 1500);
    const frame = (now) => {
      ctx.clearRect(0, 0, c.width, c.height);
      const fading = now > end;
      let alive = 0;
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.03 * dpr;
        p.r += p.vr;
        if (p.y > c.height + 20) {
          if (fading) continue;
          p.y = -20;
          p.vy = (2 + Math.random() * 3) * dpr;
        }
        alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        ctx.restore();
      }
      if (alive) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
}

// Cri de ralliement des partisans (sinon un « Allez les … ! » générique)
const CHANTS = { MTL: 'Go Habs Go !', TOR: 'Go Leafs Go !', OTT: 'Go Sens Go !', BOS: "Let's go Bruins !", EDM: "Let's go Oilers !", VAN: 'Go Canucks Go !', WPG: 'Go Jets Go !', CGY: 'Go Flames Go !' };
function chant(abbrev, name) {
  return CHANTS[abbrev] ?? (name ? `Allez les ${name} !` : 'Quel but !');
}

// ---------------------------------------------------------------- Notifications

const KIND_ICON = { '': 'info', ok: 'circle-check', warn: 'triangle-alert', bad: 'circle-x' };

export class Toasts {
  constructor(el) {
    this.el = el;
  }

  // kind : '' | 'ok' | 'warn' | 'bad' ; un même message n'est jamais affiché deux fois
  show(text, { kind = '', ms = 4500, actions = [], key = null } = {}) {
    if (!this.el) return null;
    const id = key ?? text;
    for (const old of this.el.children) if (old.dataset.key === id) old.remove();
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.dataset.key = id;
    t.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    t.innerHTML = `${icon(KIND_ICON[kind] ?? 'info')}<div class="toast-msg"></div>
      <button class="icon-btn icon-btn-sm toast-close" aria-label="Fermer">${icon('x', 'ic-sm')}</button>
      <i class="toast-timer" style="animation-duration:${Math.max(1000, ms)}ms"></i>`;
    t.querySelector('.toast-msg').textContent = text;
    const close = () => {
      if (t.classList.contains('leaving')) return;
      t.classList.add('leaving');
      setTimeout(() => t.remove(), 220);
    };
    if (actions.length) {
      const row = document.createElement('div');
      row.className = 'toast-actions';
      actions.forEach((a, i) => {
        const b = document.createElement('button');
        b.className = `btn btn-sm ${i === 0 ? 'btn-primary' : ''}`;
        b.textContent = a.label;
        b.addEventListener('click', () => {
          a.fn();
          close();
        });
        row.append(b);
      });
      t.append(row);
    }
    t.querySelector('.toast-close').addEventListener('click', close);
    // Le minuteur s'arrête au survol : la notification reste tant qu'on la lit
    t.querySelector('.toast-timer').addEventListener('animationend', close);
    this.el.append(t);
    while (this.el.children.length > 4) this.el.firstElementChild.remove();
    return t;
  }
}

// ---------------------------------------------------------------- Moniteur technique

export class Hud {
  constructor(el) {
    this.el = el;
  }

  set(visible, text) {
    this.el.classList.toggle('show', visible);
    if (visible) this.el.textContent = text;
  }
}

export const overlayRefs = () => ({
  card: new PlayerCard($('#player-card')),
  banner: new Banner($('#banner')),
  tension: new TensionFx($('#fx-tension')),
  celebration: new Celebration($('#celebration'), $('#confetti')),
  toasts: new Toasts($('#toasts')),
  hud: new Hud($('#hud')),
});
