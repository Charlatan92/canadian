import { EVENT_LABELS, penaltyLabel, periodName, formatClock, teamColor } from '../shared/nhl.js';
import { $, esc, initials, ordinalFr, photoHtml } from './util.js';

const POS_FR = { C: 'Centre', L: 'Ailier G.', R: 'Ailier D.', D: 'Défenseur', G: 'Gardien' };

// ---------------------------------------------------------------- Carte du joueur (style FIFA)

export class PlayerCard {
  constructor(el) {
    this.el = el;
    this.hideTimer = null;
    this.shownAt = 0;
    this.queued = null;
  }

  show({ player, play, stats, durationSec = 5 }) {
    // Pas plus d'un changement de carte toutes les 1,2 s : sinon ça clignote
    const wait = 1200 - (Date.now() - this.shownAt);
    if (wait > 0) {
      this.queued = { player, play, stats, durationSec };
      clearTimeout(this.queueTimer);
      this.queueTimer = setTimeout(() => {
        const q = this.queued;
        this.queued = null;
        if (q) this.show(q);
      }, wait);
      return;
    }
    this.shownAt = Date.now();
    const s = stats ?? {};
    const action = play.type === 'penalty' ? penaltyLabel(play.details?.descKey) : EVENT_LABELS[play.type] ?? play.type;
    const pts = (s.g ?? 0) + (s.a1 ?? 0) + (s.a2 ?? 0);
    const statLine =
      player.pos === 'G'
        ? ''
        : `<span><b>${s.g ?? 0}</b>B</span><span><b>${(s.a1 ?? 0) + (s.a2 ?? 0)}</b>A</span><span><b>${s.sog ?? 0}</b>TIRS</span><span><b>${s.hits ?? 0}</b>MÉ</span>`;
    this.el.style.setProperty('--team', teamColor(player.teamAbbrev));
    this.el.innerHTML = `
      <div class="pc-photo">${photoHtml(player.headshot, initials(player))}</div>
      <div class="pc-body">
        <div class="pc-num">${esc(player.number ?? '')}</div>
        <div class="pc-first">${esc(player.first)} · ${esc(player.teamAbbrev ?? '')}</div>
        <div class="pc-last">${esc(player.last)}</div>
        <div class="pc-meta">
          <span class="pc-chip">${esc(action)}</span>
          <span class="pc-chip ghost">${esc(POS_FR[player.pos] ?? player.pos)}</span>
          ${pts >= 2 ? '<span class="pc-chip ghost">En feu</span>' : ''}
        </div>
        <div class="pc-stats">${statLine}</div>
      </div>`;
    this.el.classList.remove('show');
    void this.el.offsetWidth; // relance l'animation d'entrée
    this.el.classList.add('show');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), durationSec * 1000);
  }

  hide() {
    clearTimeout(this.hideTimer);
    this.el.classList.remove('show');
  }
}

// ---------------------------------------------------------------- Bandeau bas de l'écran

export class Banner {
  constructor(el) {
    this.el = el;
    this.timer = null;
  }

  show({ tag, title, sub = '', color = '#5b8def', durationSec = 7 }) {
    this.el.style.setProperty('--team', color);
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

  start({ player, play, game, durationSec = 9, confetti = true }) {
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
    if (play) lines.push(`${periodName(play.period, game?.gameType)} période · ${formatClock(play.tip)}`);
    const scorer = player
      ? `<div class="cel-scorer">
           <div class="cel-photo">${photoHtml(player.headshot, initials(player))}</div>
           <div><div class="cel-name">${esc(player.first)} ${esc(player.last)} <span style="opacity:.7">#${esc(player.number ?? '')}</span></div>
           ${lines.filter(Boolean).map((l) => `<div class="cel-line">${esc(l)}</div>`).join('')}</div>
         </div>`
      : `<div class="cel-scorer"><div><div class="cel-name">But des Canadiens !</div><div class="cel-line">Go Habs Go !</div></div></div>`;
    this.el.querySelectorAll('.cel-flash, .cel-word, .cel-scorer').forEach((n) => n.remove());
    this.el.insertAdjacentHTML('beforeend', `<div class="cel-flash"></div><div class="cel-word">BUT !</div>${scorer}`);
    this.el.classList.add('show');
    if (confetti) this.#confetti(durationSec);
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

  // Confettis bleu-blanc-rouge, ~180 particules, arrêt automatique
  #confetti(durationSec) {
    const c = this.canvas;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const ctx = c.getContext('2d');
    const colors = ['#af1e2d', '#ffffff', '#192168', '#e5484d', '#dfe6ff'];
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

// ---------------------------------------------------------------- Toasts

export class Toasts {
  constructor(el) {
    this.el = el;
  }

  show(text, { kind = '', ms = 4500, actions = [] } = {}) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    const span = document.createElement('span');
    span.textContent = text;
    t.append(span);
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        a.fn();
        t.remove();
      });
      t.append(b);
    }
    this.el.append(t);
    while (this.el.children.length > 4) this.el.firstElementChild.remove();
    setTimeout(() => t.remove(), ms);
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
