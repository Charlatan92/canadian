import { goalAnalysis, playerFacts, pregameTotals, pressAbout, pressForShow, pressQuery, seasonSeries, timeAgo } from '../shared/insights.js';
import { TEAMS, computeGameStats, formatClock, momentumSeries, periodName, periodStart, shotMap, teamLabel, topPerformers } from '../shared/nhl.js';
import { matchupColors } from '../shared/theme.js';
import { esc, initials, photoHtml } from './util.js';

// "Émission" de la régie pendant les pauses publicitaires : une suite de séquences animées
// (chiffres du match, analyse des buts, joueurs des deux équipes, anecdotes, revue de presse...)
// qui recouvre la pub. Tout est calculé à partir de ce que le stream a déjà montré, les fiches des
// joueurs sont ramenées à « avant ce match » et la presse s'arrête à la mise en jeu : aucun divulgâcheur.

// Couleurs des deux équipes (accent lisible sur fond sombre), mises à jour à chaque séquence
let RED = '#e5484d'; // équipe suivie
let BLUE = '#5b8def'; // adversaire

export class AdShow {
  constructor(el, { getData, nhl, getConfig }) {
    this.el = el;
    this.getData = getData;
    this.nhl = nhl;
    this.getConfig = getConfig;
    this.timer = null;
    this.active = false;
    this.sceneIndex = 0;
    this.spotlight = 0;
    this.factsIndex = 0;
    this.goalIndex = 0;
  }

  async start() {
    if (this.active) return;
    this.active = true;
    this.gen = (this.gen ?? 0) + 1;
    this.sceneIndex = 0;
    const cfg = this.getConfig();
    this.el.style.setProperty('--adshow-opacity', cfg.ads.showOpacity);
    this.el.innerHTML = `
      <div class="as-head">
        <span class="as-live">Rondelle</span>
        <div><div class="as-title">Pendant la pause</div><div class="as-sub">Analyse du match, calculée sur ce que vous avez déjà vu</div></div>
        <div class="as-score"></div>
      </div>
      <div class="as-scene"></div>
      <div class="as-foot"><div class="as-dots"></div><div class="as-progress"><i></i></div></div>`;
    this.el.classList.add('show');
    await this.#next(this.gen);
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.el.classList.remove('show');
    this.el.innerHTML = '';
  }

  // gen : une séquence encore en préparation (requêtes) quand la pause se termine puis reprend
  // ne doit pas lancer une deuxième boucle
  async #next(gen) {
    if (!this.active || gen !== this.gen) return;
    const cfg = this.getConfig();
    const data = this.getData();
    if (data.colors) ({ team: RED, opp: BLUE } = data.colors);
    const builders = SCENES.filter((sc) => !sc.when || sc.when(cfg.ads)).map((sc) => sc.build);
    let html = null;
    let tries = 0;
    let index = this.sceneIndex;
    while (!html && tries < builders.length) {
      try {
        html = await builders[index % builders.length].call(this, data);
      } catch (err) {
        console.warn('[pause] séquence', err);
      }
      index++;
      tries++;
    }
    if (!this.active || gen !== this.gen) return;
    this.sceneIndex = index;
    html ??= sceneIdle(data);
    const scene = this.el.querySelector('.as-scene');
    scene.innerHTML = `<div class="scene">${html}</div>`;
    const s = data.score;
    this.el.querySelector('.as-score').textContent = data.game
      ? `${data.game.team.abbrev} ${s.team} – ${s.opp} ${data.game.opp.abbrev}${data.clock?.period ? ` · ${periodName(data.clock.period, data.game.gameType)} ${formatClock(data.clock.remaining)}` : ''}`
      : '';
    this.el.querySelector('.as-dots').innerHTML = builders.map((_, i) => `<span class="${i === (index - 1) % builders.length ? 'on' : ''}"></span>`).join('');
    const bar = this.el.querySelector('.as-progress i');
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = `progress ${cfg.ads.sceneSec}s linear both`;
    this.timer = setTimeout(() => this.#next(gen), cfg.ads.sceneSec * 1000);
  }
}

// ---------------------------------------------------------------- Séquences

function legend(game) {
  return `<div class="legend"><span><i style="background:${RED}"></i>${esc(game.team.abbrev)}</span><span><i style="background:${BLUE}"></i>${esc(game.opp.abbrev)}</span></div>`;
}

function sceneCompare({ game, stats }) {
  if (!game || !stats) return null;
  const a = stats.teams.get(game.team.id);
  const b = stats.teams.get(game.opp.id);
  if (!a || !b || a.attempts + b.attempts < 3) return null;
  const pct = (w, l) => (w + l ? Math.round((100 * w) / (w + l)) : 0);
  const rows = [
    ['Tirs au but', a.sog, b.sog],
    ['Tentatives de tir', a.attempts, b.attempts],
    ['Mises en jeu %', pct(a.fow, a.fol), pct(b.fow, b.fol)],
    ['Mises en échec', a.hits, b.hits],
    ['Tirs bloqués', a.blocks, b.blocks],
    ['Récupérations', a.takeaways, b.takeaways],
    ['Revirements', a.giveaways, b.giveaways],
    ['Minutes de pénalité', a.pim, b.pim],
  ];
  const lede =
    a.attempts > b.attempts * 1.25
      ? `Les ${esc(game.team.name)} contrôlent le jeu : ${a.attempts} tentatives de tir contre ${b.attempts}.`
      : b.attempts > a.attempts * 1.25
        ? `Les ${esc(game.opp.name)} mettent de la pression : ${b.attempts} tentatives contre ${a.attempts}.`
        : `Match serré : ${a.attempts} tentatives de tir de chaque côté ou presque.`;
  return `
    <h2>Le match en chiffres</h2>
    <p class="lede">${lede}</p>
    ${legend(game)}
    <div class="cmp">
      ${rows
        .map(([label, x, y], i) => {
          const max = Math.max(x, y, 1);
          return `<div class="v l">${x}</div>
            <div class="bar l"><i style="width:${(x / max) * 100}%;animation-delay:${i * 60}ms"></i></div>
            <div class="lbl">${label}</div>
            <div class="bar r"><i style="width:${(y / max) * 100}%;animation-delay:${i * 60}ms"></i></div>
            <div class="v">${y}</div>`;
        })
        .join('')}
    </div>`;
}

function rinkSvg(inner, viewBox = '-101 -44 202 88') {
  return `<svg viewBox="${viewBox}" role="img" aria-label="Patinoire">
    <rect x="-100" y="-42.5" width="200" height="85" rx="28" fill="#121a26" stroke="#3a475c" stroke-width="0.6"/>
    <line x1="0" y1="-42.5" x2="0" y2="42.5" stroke="#7a2a33" stroke-width="0.8"/>
    <line x1="-25" y1="-42.5" x2="-25" y2="42.5" stroke="#2c3f7a" stroke-width="0.8"/>
    <line x1="25" y1="-42.5" x2="25" y2="42.5" stroke="#2c3f7a" stroke-width="0.8"/>
    <line x1="-89" y1="-39" x2="-89" y2="39" stroke="#7a2a33" stroke-width="0.4"/>
    <line x1="89" y1="-39" x2="89" y2="39" stroke="#7a2a33" stroke-width="0.4"/>
    <circle cx="0" cy="0" r="15" fill="none" stroke="#2f3b4f" stroke-width="0.4"/>
    ${[-69, 69].flatMap((x) => [-22, 22].map((y) => `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="#2f3b4f" stroke-width="0.4"/>`)).join('')}
    <path d="M89 -6 A6 6 0 0 0 89 6 Z" fill="#1d3a66" stroke="#2c4f8a" stroke-width="0.3"/>
    <path d="M-89 -6 A6 6 0 0 1 -89 6 Z" fill="#1d3a66" stroke="#2c4f8a" stroke-width="0.3"/>
    ${inner}
  </svg>`;
}

function sceneShotMap({ game, gt }) {
  if (!game) return null;
  const shots = shotMap(game, gt);
  if (shots.length < 4) return null;
  const marks = shots
    .map((s) => {
      const c = s.ours ? RED : BLUE;
      if (s.kind === 'goal') return `<circle cx="${s.x}" cy="${-s.y}" r="2.6" fill="${c}" stroke="#fff" stroke-width="0.7"/>`;
      if (s.kind === 'sog') return `<circle cx="${s.x}" cy="${-s.y}" r="1.5" fill="${c}" stroke="#121a26" stroke-width="0.4"/>`;
      return `<circle cx="${s.x}" cy="${-s.y}" r="1.3" fill="none" stroke="${c}" stroke-width="0.5" opacity="0.75"/>`;
    })
    .join('');
  const count = (ours, kinds) => shots.filter((s) => s.ours === ours && kinds.includes(s.kind)).length;
  const inSlot = (ours) => shots.filter((s) => s.ours === ours && Math.hypot(89 - Math.abs(s.x), s.y) < 25).length;
  return `
    <h2>Carte des tirs</h2>
    <p class="lede">${esc(game.team.abbrev)} : ${count(true, ['sog', 'goal'])} tirs cadrés dont ${inSlot(true)} tentatives dans l'enclave ·
      ${esc(game.opp.abbrev)} : ${count(false, ['sog', 'goal'])} tirs cadrés dont ${inSlot(false)} dans l'enclave.</p>
    <div class="legend"><span><i style="background:${RED}"></i>${esc(game.team.abbrev)} attaque →</span><span><i style="background:${BLUE}"></i>← ${esc(game.opp.abbrev)} attaque</span>
      <span>● cadré &nbsp; ○ raté / bloqué &nbsp; ◉ but</span></div>
    <div class="svgbox">${rinkSvg(marks)}</div>`;
}

function sceneMomentum({ game, gt }) {
  if (!game || gt == null) return null;
  const series = momentumSeries(game, gt);
  if (series.length < 6) return null;
  const W = 1000;
  const H = 300;
  const pad = { l: 40, r: 110, t: 16, b: 30 };
  const maxGt = Math.max(gt, 1200);
  const maxAbs = Math.max(4, ...series.map((p) => Math.abs(p.diff)));
  const x = (v) => pad.l + (v / maxGt) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((maxAbs - v) / (2 * maxAbs)) * (H - pad.t - pad.b);
  let d = `M${x(0)},${y(0)}`;
  for (const p of series) d += ` H${x(p.gt)} V${y(p.diff)}`;
  d += ` H${x(gt)}`;
  const area = `${d} V${y(0)} H${x(0)} Z`;
  const last = series.at(-1).diff;
  const periods = [];
  for (let p = 2; periodStart(p, game.gameType) < maxGt; p++) periods.push(periodStart(p, game.gameType));
  const goals = series.filter((p) => p.goal);
  return `
    <h2>Le momentum</h2>
    <p class="lede">Écart cumulé des tentatives de tir. Au-dessus de la ligne : ${esc(game.team.abbrev)} pousse. En dessous : ${esc(game.opp.abbrev)}.</p>
    ${legend(game)}
    <div class="svgbox"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Momentum">
      <defs>
        <clipPath id="above"><rect x="0" y="0" width="${W}" height="${y(0)}"/></clipPath>
        <clipPath id="below"><rect x="0" y="${y(0)}" width="${W}" height="${H}"/></clipPath>
      </defs>
      ${periods.map((g) => `<line x1="${x(g)}" x2="${x(g)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#243041" stroke-width="1"/>`).join('')}
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="#5a6678" stroke-width="1"/>
      <path d="${area}" fill="${RED}" opacity="0.14" clip-path="url(#above)"/>
      <path d="${area}" fill="${BLUE}" opacity="0.14" clip-path="url(#below)"/>
      <path d="${d}" fill="none" stroke="#e8ecf3" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${goals.map((p) => `<circle cx="${x(p.gt)}" cy="${y(p.diff)}" r="6" fill="${p.ours ? RED : BLUE}" stroke="#0f141c" stroke-width="2"/>`).join('')}
      <circle cx="${x(gt)}" cy="${y(last)}" r="5" fill="#e8ecf3" stroke="#0f141c" stroke-width="2"/>
      <text x="${x(gt) + 10}" y="${y(last) + 5}" fill="#f2f4f8" font-size="16" font-weight="700">${last > 0 ? `+${last} ${esc(game.team.abbrev)}` : last < 0 ? `+${-last} ${esc(game.opp.abbrev)}` : 'Égalité'}</text>
      ${[1, 2, 3].map((p) => (periodStart(p) < maxGt ? `<text x="${x(periodStart(p) + 600)}" y="${H - 8}" fill="#7d8899" font-size="13" text-anchor="middle">${periodName(p)} période</text>` : '')).join('')}
      <text x="${pad.l - 8}" y="${y(maxAbs) + 4}" fill="#7d8899" font-size="12" text-anchor="end">+${maxAbs}</text>
      <text x="${pad.l - 8}" y="${y(-maxAbs) + 4}" fill="#7d8899" font-size="12" text-anchor="end">−${maxAbs}</text>
    </svg></div>`;
}

// Cadre photo aux couleurs de l'équipe du joueur (équipe suivie ou adversaire)
function phHtml(p, color = null) {
  const style = color ? ` style="background:radial-gradient(circle at 50% 35%, color-mix(in srgb, ${color} 75%, #fff 15%), ${color} 55%, #0b0f16)"` : '';
  const inner = p.headshot ? photoHtml(p.headshot, initials(p)) : p.number != null && p.number !== '' ? `<div class="num">${esc(p.number)}</div>` : photoHtml(null, initials(p));
  return `<div class="ph"${style}>${inner}</div>`;
}

// --- Face à face : votre équipe à gauche, l'adversaire à droite ----------------------------

// Deux colonnes et un « VS » au milieu ; une seule colonne si l'adversaire est masqué
function versus(left, right, middle = null) {
  if (!right) return `<div class="vs vs-single">${left}</div>`;
  return `<div class="vs">${left}<div class="vs-mid">${middle ?? '<span class="vs-badge">VS</span>'}</div>${right}</div>`;
}

function vsCard({ player, color, side, title, sub = '', body = '' }) {
  const p = player ?? {};
  return `<div class="vs-card vs-${side}" style="--col:${color}">
    <div class="vs-top">${phHtml(p, color)}<div class="vs-id"><span class="vs-kicker">${esc(title)}</span><b>${esc(p.last ?? '—')}</b><span>${esc(sub)}</span></div></div>
    ${body}</div>`;
}

function miniTiles(list) {
  return `<div class="vs-tiles">${list.map(([k, n]) => `<div><b>${esc(n)}</b><span>${esc(k)}</span></div>`).join('')}</div>`;
}

const sideColor = (side) => (side === 'team' ? RED : BLUE);
const clubOf = (game, side) => (side === 'team' ? game.team : game.opp);

// Les joueurs du match jusqu'ici, un par équipe
async function sceneStars({ game, stats }, sides) {
  if (!game || !stats) return null;
  const cards = {};
  for (const side of sides) {
    const club = clubOf(game, side);
    const [top] = topPerformers(game, stats, club.id, 1);
    if (!top || top.score <= 0.05) continue;
    const p = top.player;
    const st = top.stats;
    const landing = await withTimeout(this.nhl.playerLanding(p.id), 1500);
    const season = pregameTotals(landing, game.id).season;
    const fo = st.fow + st.fol;
    cards[side] = vsCard({
      player: p,
      color: sideColor(side),
      side,
      title: club.name,
      sub: `#${p.number ?? ''} · ${p.first}`,
      body: `${miniTiles([
        ['Buts', st.g],
        ['Aides', st.a1 + st.a2],
        ['Tirs', st.sog],
        ['Mises en échec', st.hits],
        ...(fo >= 4 ? [['Mises en jeu', `${Math.round((100 * st.fow) / fo)} %`]] : [['Tirs bloqués', st.blk]]),
      ])}${season?.gamesPlayed ? `<div class="vs-foot">Saison avant ce match : ${season.goals ?? 0} B · ${season.assists ?? 0} A · ${season.points ?? 0} PTS en ${season.gamesPlayed} PJ</div>` : ''}`,
    });
  }
  if (!cards.team && !cards.opp) return null;
  return `<h2>Les joueurs du match</h2><p class="lede">Le plus influent de chaque équipe jusqu'ici, selon l'indice d'impact de la régie.</p>
    ${versus(cards.team ?? emptyCard('team', game), sides.includes('opp') ? (cards.opp ?? emptyCard('opp', game)) : null)}`;
}

function emptyCard(side, game) {
  return `<div class="vs-card vs-${side} vs-empty" style="--col:${sideColor(side)}"><span>${esc(clubOf(game, side).name)} : rien de marquant pour l'instant</span></div>`;
}

// Duel : un des meilleurs pointeurs de chaque équipe, saisons comparées ligne par ligne
async function sceneDuel({ game }, sides) {
  if (!game) return null;
  const turn = this.spotlight++;
  const pick = async (side) => {
    const club = await this.nhl.clubStats(clubOf(game, side).abbrev);
    const skaters = (club?.skaters ?? []).filter((x) => x.gamesPlayed > 0).sort((a, b) => b.points - a.points);
    if (!skaters.length) return null;
    const line = skaters[turn % Math.min(4, skaters.length)];
    const landing = await withTimeout(this.nhl.playerLanding(line.playerId), 1500);
    const pre = pregameTotals(landing, game.id);
    const st = pre.season?.gamesPlayed ? { ...line, ...pre.season } : line;
    const l5 = pre.last5.length ? pre.last5 : (landing?.last5Games ?? []);
    return { side, line, st, form: l5.reduce((n, g) => n + (g.points ?? 0), 0), formN: l5.length, player: { headshot: line.headshot, first: line.firstName?.default ?? '', last: line.lastName?.default ?? '', number: line.sweaterNumber } };
  };
  const a = await pick('team');
  const b = sides.includes('opp') ? await pick('opp') : null;
  if (!a) return null;
  const card = (x) =>
    vsCard({ player: x.player, color: sideColor(x.side), side: x.side, title: x.side === 'team' ? 'Sous la loupe' : 'À surveiller', sub: `${clubOf(game, x.side).name} · saison avant ce match`, body: x.formN ? `<div class="vs-foot">${x.form} point${x.form > 1 ? 's' : ''} à ses ${x.formN} derniers matchs</div>` : '' });
  const rows = [
    ['Buts', (x) => x.st.goals ?? 0],
    ['Aides', (x) => x.st.assists ?? 0],
    ['Points', (x) => x.st.points ?? 0],
    ['Points / match', (x) => (x.st.gamesPlayed ? (x.st.points / x.st.gamesPlayed).toFixed(2).replace('.', ',') : '0')],
    ['+/-', (x) => `${(x.st.plusMinus ?? 0) > 0 ? '+' : ''}${x.st.plusMinus ?? 0}`],
    ['Buts en avantage', (x) => x.st.powerPlayGoals ?? 0],
  ];
  const middle = b
    ? `<div class="vs-rows">${rows
        .map(([label, f]) => {
          const va = f(a);
          const vb = f(b);
          const na = Number(String(va).replace(',', '.'));
          const nb = Number(String(vb).replace(',', '.'));
          const max = Math.max(Math.abs(na), Math.abs(nb), 0.01);
          return `<div class="vs-row"><b class="${na > nb ? 'lead' : ''}">${esc(va)}</b><i style="--w:${(Math.max(0, na) / max) * 100}%;--c:${RED}"></i><span>${esc(label)}</span><i class="r" style="--w:${(Math.max(0, nb) / max) * 100}%;--c:${BLUE}"></i><b class="${nb > na ? 'lead' : ''}">${esc(vb)}</b></div>`;
        })
        .join('')}</div>`
    : null;
  return `<h2>Face à face</h2><p class="lede">Deux des meilleurs pointeurs de chaque équipe, saison avant ce match.</p>${versus(card(a), b ? card(b) : null, middle)}`;
}

async function sceneGoalies({ game, stats }, sides) {
  if (!game || !stats || !stats.goalies.size) return null;
  const [clubA, clubB] = await Promise.all([this.nhl.clubStats(game.team.abbrev), this.nhl.clubStats(game.opp.abbrev)]);
  const cards = {};
  for (const [id, g] of stats.goalies) {
    const p = game.players.get(id);
    if (!p || !g.sa) continue;
    const side = p.teamId === game.team.id ? 'team' : 'opp';
    if (cards[side]) continue;
    const season = (side === 'team' ? clubA : clubB)?.goalies?.find((x) => x.playerId === id);
    const sv = ((g.sa - g.ga) / g.sa).toFixed(3).replace(/^0/, '');
    cards[side] = vsCard({
      player: p,
      color: sideColor(side),
      side,
      title: clubOf(game, side).name,
      sub: `#${p.number ?? ''} · gardien`,
      body: `${miniTiles([
        ['Arrêts', g.sa - g.ga],
        ['Tirs reçus', g.sa],
        ['Efficacité', sv],
      ])}${season ? `<div class="vs-foot">Saison : ${(season.savePercentage ?? 0).toFixed(3).replace(/^0/, '')} · ${(season.goalsAgainstAverage ?? 0).toFixed(2)} de moyenne</div>` : ''}`,
    });
  }
  if (!cards.team && !cards.opp) return null;
  return `<h2>Devant le filet</h2><p class="lede">Les gardiens jusqu'ici.</p>${versus(cards.team ?? emptyCard('team', game), sides.includes('opp') ? (cards.opp ?? emptyCard('opp', game)) : null)}`;
}

function sceneGoals({ game, stats }) {
  if (!game || !stats?.goals.length) return null;
  const items = stats.goals.map((p) => {
    const d = p.details;
    const scorer = game.players.get(d.scoringPlayerId);
    const assists = [d.assist1PlayerId, d.assist2PlayerId].map((id) => game.players.get(id)?.last).filter(Boolean);
    const ours = p.teamId === game.team.id;
    const a = goalAnalysis(game, p);
    return `<li><span class="when">${periodName(p.period, game.gameType)} · ${formatClock(p.tip)}</span>
      <span class="sw" style="background:${ours ? RED : BLUE}"></span>
      <span><b>${esc(scorer?.name ?? 'But')}</b>${d.scoringPlayerTotal ? ` (${d.scoringPlayerTotal})` : ''} <span class="muted">${assists.length ? `aides : ${esc(assists.join(', '))}` : 'sans aide'}</span>
        ${a?.chips.length ? `<span class="chips">${a.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</span>` : ''}</span>
      <span>${esc(ours ? game.team.abbrev : game.opp.abbrev)}</span></li>`;
  });
  return `<h2>Les buts</h2><p class="lede">Tous les buts vus jusqu'à maintenant.</p><ul class="goals-list">${items.join('')}</ul>`;
}

// Le but à la loupe : position sur la patinoire et analyse façon commentateur
function sceneGoalStory({ game, stats }) {
  if (!game || !stats?.goals.length) return null;
  const goals = stats.goals;
  // Le plus récent d'abord, puis on remonte les buts d'une pause à l'autre
  const goal = goals[(goals.length - 1 - (this.goalIndex++ % goals.length) + goals.length) % goals.length];
  const a = goalAnalysis(game, goal);
  if (!a) return null;
  const ours = a.team === game.team.abbrev;
  const color = ours ? RED : BLUE;
  // Patinoire normalisée : l'équipe qui marque attaque vers la droite
  let mark = '';
  if (a.x != null && a.y != null) {
    const x = Math.abs(a.x);
    const y = a.x < 0 ? -a.y : a.y;
    mark = `<line x1="${x}" y1="${-y}" x2="89" y2="0" stroke="${color}" stroke-width="0.8" stroke-dasharray="2 1.5" opacity="0.9"/>
      <circle cx="${x}" cy="${-y}" r="3.2" fill="${color}" stroke="#fff" stroke-width="0.8"/>
      <circle cx="${x}" cy="${-y}" r="6" fill="none" stroke="${color}" stroke-width="0.5" opacity="0.6"><animate attributeName="r" values="3;9;3" dur="2s" repeatCount="indefinite"/></circle>`;
  }
  const scorer = game.players.get(goal.details.scoringPlayerId);
  return `
    <div class="story">
      <div class="svgbox">${rinkSvg(mark, '-3 -44 105 88')}</div>
      <div>
        <h2>Le but à la loupe</h2>
        <p class="lede">${esc(periodName(goal.period, game.gameType))} période · ${formatClock(goal.tip)} · ${esc(a.team ?? '')}</p>
        <div class="story-who" style="--story-color:${color}">${scorer?.headshot ? photoHtml(scorer.headshot, initials(scorer)) : `<span class="num">${esc(scorer?.number ?? '')}</span>`}<b>${esc(a.title)}</b></div>
        <p class="story-text">${esc(a.text)}</p>
        ${a.chips.length ? `<div class="chips">${a.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
}

// Le saviez-vous ? Anecdotes sur un joueur de ce soir (les deux équipes, en alternance)
// Le saviez-vous ? Un joueur de chaque équipe, quelques anecdotes chacun, face à face
async function sceneFacts({ game, stats }, sides) {
  if (!game) return null;
  const turn = this.factsIndex++;
  const cfg = this.getConfig();
  const lang = cfg.stream.languagePriority?.[0] === 'en' ? 'en' : 'fr';
  const before = game.startTimeUTC ? Date.parse(game.startTimeUTC) : null;
  const one = async (side) => {
    const club = clubOf(game, side);
    const tops = stats ? topPerformers(game, stats, club.id, 3).map((t) => t.player) : [];
    const pool = [...tops, ...[...game.players.values()].filter((p) => p.teamId === club.id && !tops.includes(p))].slice(0, 8);
    for (let k = 0; k < Math.min(3, pool.length); k++) {
      const p = pool[(turn + k) % pool.length];
      const landing = await withTimeout(this.nhl.playerLanding(p.id), 1500);
      const { facts } = playerFacts(landing, { gameId: game.id, seen: stats?.players.get(p.id) ?? null });
      if (facts.length < 2) continue;
      // Ce que les médias en disaient avant le match (un titre qui le nomme)
      let quote = '';
      if (cfg.ads.press && before) {
        const items = await withTimeout(this.nhl.news(pressQuery({ player: p.name, lang }), lang), 1500);
        const [it] = pressAbout(items, p.last, { before });
        if (it) quote = `<blockquote class="quote">« ${esc(it.title)} »<cite>${esc(it.source ?? 'Presse')} · ${esc(timeAgo(it.published, before))} avant le match</cite></blockquote>`;
      }
      return vsCard({ player: p, color: sideColor(side), side, title: club.name, sub: `#${p.number ?? ''} · ${p.first}`, body: `<ul class="insights">${facts.slice(0, quote ? 3 : 4).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${quote}` });
    }
    return null;
  };
  const left = await one('team');
  const right = sides.includes('opp') ? await one('opp') : null;
  if (!left && !right) return null;
  return `<h2>Le saviez-vous ?</h2><p class="lede">Un joueur de chaque équipe, à connaître ce soir.</p>${versus(left ?? emptyCard('team', game), sides.includes('opp') ? (right ?? emptyCard('opp', game)) : null)}`;
}

// Les meneurs des deux équipes, saison avant ce match + ce qu'ils ont fait ce soir (déjà vu)
async function sceneLeaders({ game, stats }) {
  if (!game) return null;
  const cols = [];
  for (const [club, color] of [[game.team, RED], [game.opp, BLUE]]) {
    const cs = await this.nhl.clubStats(club.abbrev);
    const top = (cs?.skaters ?? []).filter((s) => s.gamesPlayed > 0).sort((a, b) => b.points - a.points).slice(0, 3);
    const rows = await Promise.all(
      top.map(async (line) => {
        const landing = await withTimeout(this.nhl.playerLanding(line.playerId), 1500);
        const pre = pregameTotals(landing, game.id).season;
        const s = pre?.gamesPlayed ? pre : line;
        const tonight = stats?.players.get(line.playerId);
        const tn = tonight ? [tonight.g && `${tonight.g} B`, tonight.a1 + tonight.a2 && `${tonight.a1 + tonight.a2} A`, tonight.sog && `${tonight.sog} tir${tonight.sog > 1 ? 's' : ''}`].filter(Boolean).join(' · ') : '';
        return `<li><b>${esc(line.lastName?.default ?? '')}</b><span class="num">${s.goals ?? 0}-${s.assists ?? 0}-<b>${s.points ?? 0}</b></span><span class="muted">${tn ? `Ce soir : ${esc(tn)}` : 'Ce soir : —'}</span></li>`;
      }),
    );
    if (rows.length) cols.push(`<div class="leaders-col" style="--col:${color}"><h3>${esc(club.name)}</h3><ul>${rows.join('')}</ul></div>`);
  }
  if (cols.length < 2) return null;
  return `<h2>Duel des meneurs</h2><p class="lede">Buts-aides-points cette saison, avant ce match, et ce qu'ils ont fait ce soir jusqu'ici.</p><div class="leaders">${cols.join('')}</div>`;
}

// Revue de presse : les titres des médias avant la mise en jeu (rien sur le match en cours)
async function scenePress({ game }) {
  if (!game?.startTimeUTC) return null;
  const cfg = this.getConfig();
  const lang = cfg.stream.languagePriority?.[0] === 'en' ? 'en' : 'fr';
  const query = (abbrev) => pressQuery({ name: TEAMS[abbrev]?.name ?? abbrev, city: TEAMS[abbrev]?.city ?? '', lang });
  const before = Date.parse(game.startTimeUTC);
  const [a, b] = await Promise.all([withTimeout(this.nhl.news(query(game.team.abbrev), lang), 2500), withTimeout(this.nhl.news(query(game.opp.abbrev), lang), 2500)]);
  const items = pressForShow([...(a ?? []), ...(b ?? [])], { before, max: 5 });
  if (items.length < 2) return null;
  return `<h2>Revue de presse</h2><p class="lede">Ce que les médias disaient avant la mise en jeu. Titres publiés avant le match : aucun résultat de ce soir.</p>
    <ul class="press">${items.map((it) => `<li><span class="src">${esc(it.source ?? 'Presse')}</span><span class="ttl">« ${esc(it.title)} »</span><span class="muted">${esc(timeAgo(it.published, before))} avant le match</span></li>`).join('')}</ul>`;
}

// Face-à-face : les matchs déjà joués entre les deux équipes cette saison
async function sceneSeries({ game }) {
  if (!game) return null;
  const rail = await withTimeout(this.nhl.rightRail(game.id), 1500);
  const list = seasonSeries(rail, game.id);
  if (!list.length) return null;
  let wins = 0;
  const rows = list.map((g) => {
    const teamHome = g.home === game.team.abbrev;
    const mine = teamHome ? g.homeScore : g.awayScore;
    const theirs = teamHome ? g.awayScore : g.homeScore;
    const won = mine > theirs;
    if (won) wins++;
    const date = g.date ? new Date(`${g.date}T12:00:00Z`).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' }) : '';
    return `<li><span class="when">${esc(date)}</span><span class="sw" style="background:${won ? RED : BLUE}"></span>
      <span><b>${esc(g.away)} ${g.awayScore ?? '–'}</b> à <b>${esc(g.home)} ${g.homeScore ?? '–'}</b>${g.lastPeriod && g.lastPeriod !== 'REG' ? ` <span class="muted">(${g.lastPeriod === 'OT' ? 'prolongation' : 'tirs de barrage'})</span>` : ''}</span>
      <span>${won ? 'Victoire' : 'Défaite'}</span></li>`;
  });
  return `<h2>Face-à-face cette saison</h2><p class="lede">${esc(game.team.name)} : ${wins} victoire${wins > 1 ? 's' : ''} en ${list.length} match${list.length > 1 ? 's' : ''} contre les ${esc(game.opp.name)} avant ce soir.</p><ul class="goals-list">${rows.join('')}</ul>`;
}

function sceneIdle({ game }) {
  return `<h2>Pause publicitaire</h2><p class="lede">${
    game ? `${esc(game.team.name)} contre ${esc(game.opp.name)} — on revient au match dès la fin de la pause.` : 'Retour au match dans un instant.'
  }</p>`;
}

// Ordre de l'émission ; when(cfg.ads) : séquence optionnelle. Chaque séquence est appelée avec
// l'émission pour « this » et rend null quand elle n'a rien à montrer (elle est alors sautée).
const sidesOf = (show) => (show.getConfig().ads.oppPlayers ? ['team', 'opp'] : ['team']);
const SCENES = [
  { build: sceneCompare },
  { build: sceneGoalStory },
  { build: function sceneStarsBoth(d) { return sceneStars.call(this, d, sidesOf(this)); } },
  { build: function sceneFactsBoth(d) { return sceneFacts.call(this, d, sidesOf(this)); }, when: (a) => a.facts },
  { build: sceneShotMap },
  { build: sceneLeaders, when: (a) => a.oppPlayers },
  { build: scenePress, when: (a) => a.press },
  { build: sceneMomentum },
  { build: function sceneDuelBoth(d) { return sceneDuel.call(this, d, sidesOf(this)); } },
  { build: function sceneGoaliesBoth(d) { return sceneGoalies.call(this, d, sidesOf(this)); } },
  { build: sceneSeries, when: (a) => a.oppPlayers },
  { build: sceneGoals },
];

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);
}

// Utilisé par la Régie pour préparer les données de l'émission
export function adShowData(game, gt, score, clock) {
  const colors = game ? matchupColors(game.team.abbrev, game.opp.abbrev) : null;
  return { game, gt, score, clock, colors, stats: game ? computeGameStats(game, gt ?? Infinity) : null };
}
