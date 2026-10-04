import { onColor } from '../shared/color.js';
import { formatClock, penaltyLabel, periodName, teamColor } from '../shared/nhl.js';
import { N_, t } from '../shared/i18n.js';
import { teamTheme } from '../shared/theme.js';
import { $, esc, icon, initials, ordinalFr, photoHtml, teamLogoHtml } from './util.js';

// ---------------------------------------------------------------- Fil des actions (« kill feed »)

// Une ligne par action, en petit, comme le fil des éliminations d'un jeu vidéo :
// [tête] Caufield  (icône) tir  Woll
const FEED = {
  faceoff: { icon: 'arrow-left-right', verb: N_('mise en jeu'), actor: 'winningPlayerId', target: 'losingPlayerId' },
  'shot-on-goal': { icon: 'target', verb: N_('tir'), actor: 'shootingPlayerId', target: 'goalieInNetId' },
  'missed-shot': { icon: 'move-up-right', verb: N_('tir raté'), actor: 'shootingPlayerId' },
  'blocked-shot': { icon: 'shield', verb: N_('bloque'), actor: 'blockingPlayerId', target: 'shootingPlayerId' },
  hit: { icon: 'zap', verb: N_('mise en échec'), actor: 'hittingPlayerId', target: 'hitteePlayerId' },
  takeaway: { icon: 'hand-grab', verb: N_('vole la rondelle'), actor: 'playerId' },
  giveaway: { icon: 'circle-slash', verb: N_('perd la rondelle'), actor: 'playerId' },
};

export const FEED_TYPES = new Set(Object.keys(FEED));

export class FeedBoard {
  constructor(el) {
    this.el = el;
    this.max = 6;
  }

  // style : 'photo' | 'name' | 'emoji' ; heads(player) -> url d'une tête émoji déjà prête (ou null)
  push(play, game, { style = 'photo', durationSec = 8, heads = null } = {}) {
    const f = FEED[play.type];
    if (!f || !game) return false;
    const d = play.details ?? {};
    const actor = game.players.get(d[f.actor] ?? play.playerId);
    if (!actor) return false;
    const target = f.target ? game.players.get(d[f.target]) : null;
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.style.setProperty('--team', teamColor(actor.teamAbbrev));
    row.style.setProperty('--opp', target ? teamColor(target.teamAbbrev) : 'transparent');
    row.dataset.player = actor.id;
    row.innerHTML = `${style === 'name' ? '' : headHtml(actor, style, heads)}<b class="feed-name">${esc(actor.last)}</b>
      <span class="feed-act">${icon(f.icon, 'ic-sm')}<span>${esc(t(f.verb))}</span></span>
      ${target ? `<span class="feed-target">${esc(target.last)}</span>` : ''}`;
    this.el.prepend(row);
    while (this.el.children.length > this.max) this.el.lastElementChild.remove();
    setTimeout(() => {
      row.classList.add('leaving');
      setTimeout(() => row.remove(), 400);
    }, durationSec * 1000);
    return true;
  }

  // La tête émoji est arrivée après coup (première génération)
  updateEmoji(playerId, url) {
    for (const h of this.el.querySelectorAll(`.feed-row[data-player="${playerId}"] .feed-head`)) h.outerHTML = `<img class="feed-head emoji" src="${esc(url)}" alt="">`;
  }

  clear() {
    this.el.innerHTML = '';
  }
}

function headHtml(player, style, heads) {
  if (style === 'emoji') {
    const url = heads?.(player);
    return url ? `<img class="feed-head emoji" src="${esc(url)}" alt="">` : `<span class="feed-head num">${esc(player.number ?? '')}</span>`;
  }
  return player.headshot ? `<span class="feed-head">${photoHtml(player.headshot, initials(player))}</span>` : `<span class="feed-head num">${esc(player.number ?? '')}</span>`;
}

// ---------------------------------------------------------------- Prison des pénalités

// À chaque pénalité : le joueur fautif derrière les barreaux (4,5 s), puis une petite « cellule »
// reste affichée avec le temps de punition qui reste, compté sur le temps de jeu de VOTRE stream.
export class PenaltyBox {
  constructor(el, cells) {
    this.el = el;
    this.cells = cells;
    this.timer = null;
  }

  jail({ player, play, game, emojiUrl = null, durationSec = 4.5 }) {
    const d = play?.details ?? {};
    const color = teamColor(player?.teamAbbrev ?? game?.opp?.abbrev);
    this.el.style.setProperty('--team', color);
    this.el.style.setProperty('--team-on', onColor(color));
    const face = emojiUrl ? `<img class="jail-emoji" src="${esc(emojiUrl)}" alt="">` : player?.headshot ? photoHtml(player.headshot, initials(player)) : '';
    this.el.innerHTML = `
      <div class="jail-cell">
        <div class="jail-face">${face || `<span class="jail-num">${esc(player?.number ?? '?')}</span>`}</div>
        <div class="jail-bars">${'<i></i>'.repeat(7)}</div>
      </div>
      <div class="jail-text">
        <div class="jail-stamp">${t('Au cachot !')}</div>
        <div class="jail-name">${esc(player?.name ?? t('Pénalité'))}${player?.teamAbbrev ? ` <span>${esc(player.teamAbbrev)}</span>` : ''}</div>
        <div class="jail-why">${icon('lock', 'ic-sm')}${esc(penaltyLabel(d.descKey))} · ${esc(String(d.duration ?? 2))} min</div>
      </div>`;
    this.el.classList.remove('show');
    void this.el.offsetWidth;
    this.el.classList.add('show');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.el.classList.remove('show'), durationSec * 1000);
  }

  // list : [{ id, player, remaining (s) }] — les punitions en cours sur le stream
  render(list, { style = 'photo', heads = null } = {}) {
    const key = list.map((p) => `${p.id}:${Math.ceil(p.remaining)}`).join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (!list.length) {
      this.cells.classList.remove('show');
      this.cells.innerHTML = '';
      return;
    }
    this.cells.classList.add('show');
    this.cells.innerHTML = `<div class="cells-head">${icon('lock', 'ic-sm')}${t('Prison')}</div>${list
      .map((p) => {
        const pl = p.player;
        const head = style === 'name' || !pl ? '' : headHtml(pl, style, heads);
        return `<div class="cell-row" style="--team:${teamColor(pl?.teamAbbrev)}">${head}<b>${esc(pl?.last ?? '—')}</b><span class="cell-time">${formatClock(p.remaining)}</span></div>`;
      })
      .join('')}`;
  }
}

// ---------------------------------------------------------------- But adverse (version triste)

// L'inverse de la célébration : l'image se ternit, la pluie tombe aux couleurs de l'adversaire,
// le mot « but » s'affaisse. Le son (trombone triste) est joué par le klaxon.
export class SadGoal {
  constructor(el, canvas) {
    this.el = el;
    this.canvas = canvas;
    this.timer = null;
    this.raf = null;
    this.active = false;
  }

  start({ player, play, game, score, durationSec = 6 }) {
    this.stop();
    this.active = true;
    const d = play?.details ?? {};
    const opp = game?.opp;
    this.el.style.setProperty('--opp', teamColor(opp?.abbrev));
    const line = [player ? `${player.name}${d.scoringPlayerTotal ? ` · ${t('{n} but de la saison', { n: ordinalFr(d.scoringPlayerTotal) })}` : ''}` : opp ? t('Les {team}', { team: opp.name }) : '', score && game ? `${game.team.abbrev} ${score.team} – ${score.opp} ${opp?.abbrev ?? ''}` : ''].filter(Boolean);
    this.el.querySelectorAll('.sad-veil, .sad-word, .sad-info').forEach((n) => n.remove());
    this.el.insertAdjacentHTML(
      'beforeend',
      `<div class="sad-veil"></div><div class="sad-word">${icon('heart-crack')}<span>${t('But')}</span></div>
       <div class="sad-info"><div class="sad-team">${esc(opp?.name ? t('But des {team}', { team: opp.name }) : t('But adverse'))}</div>${line.map((l) => `<div class="sad-line">${esc(l)}</div>`).join('')}</div>`,
    );
    this.el.classList.add('show');
    this.#rain(durationSec, teamColor(opp?.abbrev));
    this.timer = setTimeout(() => this.stop(), durationSec * 1000);
  }

  stop() {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    this.active = false;
    this.el.classList.remove('show');
    this.el.querySelectorAll('.sad-veil, .sad-word, .sad-info').forEach((n) => n.remove());
    this.canvas.getContext('2d').clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Pluie fine et oblique, quelques gouttes aux couleurs de l'adversaire
  #rain(durationSec, color) {
    const c = this.canvas;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const ctx = c.getContext('2d');
    const drops = Array.from({ length: 220 }, () => ({
      x: Math.random() * c.width * 1.2,
      y: Math.random() * -c.height,
      v: (9 + Math.random() * 8) * dpr,
      l: (14 + Math.random() * 22) * dpr,
      tinted: Math.random() < 0.18,
    }));
    const end = performance.now() + Math.max(1500, durationSec * 1000 - 1200);
    const frame = (now) => {
      ctx.clearRect(0, 0, c.width, c.height);
      const fading = now > end;
      let alive = 0;
      ctx.lineWidth = 1.4 * dpr;
      for (const p of drops) {
        p.y += p.v;
        p.x -= p.v * 0.18;
        if (p.y > c.height) {
          if (fading) continue;
          p.y = -p.l;
          p.x = Math.random() * c.width * 1.2;
        }
        alive++;
        ctx.strokeStyle = p.tinted ? color : 'rgba(190, 205, 225, 0.55)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.l * 0.18, p.y - p.l);
        ctx.stroke();
      }
      if (alive) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
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
    this.logos = logos;
    const scorer = this.#scorerHtml({ player, play, game, emojiUrl, logos });
    this.el.querySelectorAll('.cel-flash, .cel-word, .cel-scorer').forEach((n) => n.remove());
    this.el.insertAdjacentHTML('beforeend', `<div class="cel-flash"></div><div class="cel-word">${t('BUT !')}</div>${scorer}`);
    this.el.classList.add('show');
    if (confetti) this.#confetti(durationSec, teamTheme(game?.team?.abbrev).confetti);
    this.timer = setTimeout(() => this.stop(), durationSec * 1000);
  }

  // Le but a été vu à l'écran avant que l'API le publie : on complète avec le marqueur dès qu'il est connu
  updateScorer(player, play, game, emojiUrl = null) {
    if (!this.active || !player) return;
    const box = this.el.querySelector('.cel-scorer');
    if (box) box.outerHTML = this.#scorerHtml({ player, play, game, emojiUrl, logos: this.logos });
  }

  #scorerHtml({ player, play, game, emojiUrl, logos }) {
    const d = play?.details ?? {};
    const assists = [d.assist1PlayerId, d.assist2PlayerId]
      .map((id) => game?.players.get(id))
      .filter(Boolean)
      .map((p) => p.last);
    const lines = [];
    if (d.scoringPlayerTotal) lines.push(t('Son {n} but de la saison', { n: ordinalFr(d.scoringPlayerTotal) }));
    lines.push(assists.length ? t('Aides : {list}', { list: assists.join(', ') }) : player ? t('Sans aide') : '');
    if (play) lines.push(`${play.period <= 3 ? t('{p} période', { p: periodName(play.period, game?.gameType) }) : periodName(play.period, game?.gameType)} · ${formatClock(play.tip)}`);
    const scorer = player
      ? `<div class="cel-scorer">
           <div class="cel-photo${emojiUrl ? ' cel-emoji' : ''}">${emojiUrl ? `<img src="${esc(emojiUrl)}" alt="">` : photoHtml(player.headshot, initials(player))}</div>
           <div><div class="cel-name">${esc(player.first)} ${esc(player.last)} <span style="opacity:.7">#${esc(player.number ?? '')}</span></div>
           ${lines.filter(Boolean).map((l) => `<div class="cel-line">${esc(l)}</div>`).join('')}</div>
         </div>`
      : `<div class="cel-scorer">${game?.team?.abbrev ? teamLogoHtml(game.team.abbrev, { cls: 'cel-logo', logos }) : ''}<div><div class="cel-name">${esc(t('But des {team} !', { team: game?.team?.name ?? t('vôtres') }))}</div><div class="cel-line">${esc(chant(game?.team?.abbrev, game?.team?.name))}</div></div></div>`;
    return scorer;
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
  return CHANTS[abbrev] ?? (name ? t('Allez les {team} !', { team: name }) : t('Quel but !'));
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
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.dataset.key = id;
    node.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    node.innerHTML = `${icon(KIND_ICON[kind] ?? 'info')}<div class="toast-msg"></div>
      <button class="icon-btn icon-btn-sm toast-close" aria-label="${t('Fermer')}">${icon('x', 'ic-sm')}</button>
      <i class="toast-timer" style="animation-duration:${Math.max(1000, ms)}ms"></i>`;
    node.querySelector('.toast-msg').textContent = text;
    const close = () => {
      if (node.classList.contains('leaving')) return;
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 220);
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
      node.append(row);
    }
    node.querySelector('.toast-close').addEventListener('click', close);
    // Le minuteur s'arrête au survol : la notification reste tant qu'on la lit
    node.querySelector('.toast-timer').addEventListener('animationend', close);
    this.el.append(node);
    while (this.el.children.length > 4) this.el.firstElementChild.remove();
    return node;
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
  feed: new FeedBoard($('#feed')),
  jail: new PenaltyBox($('#jail'), $('#jail-cells')),
  sad: new SadGoal($('#sad-goal'), $('#rain')),
  banner: new Banner($('#banner')),
  tension: new TensionFx($('#fx-tension')),
  celebration: new Celebration($('#celebration'), $('#confetti')),
  toasts: new Toasts($('#toasts')),
  hud: new Hud($('#hud')),
});
