import { computeGameStats, formatClock, momentumSeries, periodName, periodStart, shotMap, topPerformers } from '../shared/nhl.js';
import { matchupColors } from '../shared/theme.js';
import { esc, initials, photoHtml } from './util.js';

// "Émission" de la régie pendant les pauses publicitaires : une suite de séquences animées
// (chiffres du match, carte des tirs, momentum, joueur en vedette...) qui recouvre la pub.
// Tout est calculé à partir de ce que le stream a déjà montré : aucun divulgâcheur.

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
  }

  async start() {
    if (this.active) return;
    this.active = true;
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
    await this.#next();
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.el.classList.remove('show');
    this.el.innerHTML = '';
  }

  async #next() {
    if (!this.active) return;
    const cfg = this.getConfig();
    const data = this.getData();
    if (data.colors) ({ team: RED, opp: BLUE } = data.colors);
    const builders = [sceneCompare, sceneShotMap, sceneMomentum, sceneStar, sceneSpotlight, sceneGoalies, sceneGoals];
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
    if (!this.active) return;
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
    this.timer = setTimeout(() => this.#next(), cfg.ads.sceneSec * 1000);
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

function rinkSvg(inner) {
  return `<svg viewBox="-101 -44 202 88" role="img" aria-label="Patinoire">
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

function tiles(list) {
  return `<div class="tiles">${list.map(([k, n]) => `<div class="tile"><div class="k">${esc(k)}</div><div class="n">${esc(n)}</div></div>`).join('')}</div>`;
}

function seasonLine(club, id) {
  return club?.skaters?.find((s) => s.playerId === id) ?? null;
}

function last5Html(landing) {
  const games = landing?.last5Games;
  if (!games?.length) return '';
  const max = Math.max(3, ...games.map((g) => g.points ?? 0));
  return `<div class="legend" style="margin-top:6px">Forme récente (points, 5 derniers matchs)</div>
    <svg viewBox="0 0 300 80" style="width:300px;height:80px" role="img" aria-label="Forme récente">
      ${games
        .slice()
        .reverse()
        .map((g, i) => {
          const h = ((g.points ?? 0) / max) * 56;
          return `<rect x="${i * 58 + 8}" y="${62 - h}" width="24" height="${Math.max(h, 1)}" rx="4" fill="${RED}"/>
            <text x="${i * 58 + 20}" y="${58 - h}" fill="#f2f4f8" font-size="12" text-anchor="middle">${g.points ?? 0}</text>
            <text x="${i * 58 + 20}" y="77" fill="#7d8899" font-size="10" text-anchor="middle">${esc(g.opponentAbbrev ?? '')}</text>`;
        })
        .join('')}
    </svg>`;
}

async function sceneStar({ game, stats }) {
  if (!game || !stats) return null;
  const [top] = topPerformers(game, stats, game.team.id, 1);
  if (!top || top.score <= 0.05) return null;
  const p = top.player;
  const s = top.stats;
  const [club, landing] = await Promise.all([this.nhl.clubStats(game.team.abbrev), withTimeout(this.nhl.playerLanding(p.id), 1500)]);
  const season = seasonLine(club, p.id);
  const fo = s.fow + s.fol;
  return `
    <div class="feature">
      <div class="ph">${p.headshot ? photoHtml(p.headshot, initials(p)) : `<div class="num">${esc(p.number ?? '')}</div>`}</div>
      <div>
        <h2>Joueur du match (jusqu'ici)</h2>
        <p class="lede">${esc(p.first)} ${esc(p.last)} · #${esc(p.number ?? '')} · selon l'indice d'impact de la régie</p>
        ${tiles([
          ['Buts', s.g],
          ['Aides', s.a1 + s.a2],
          ['Tirs', s.sog],
          ['Mises en échec', s.hits],
          ['Tirs bloqués', s.blk],
          ...(fo >= 4 ? [['Mises en jeu', `${Math.round((100 * s.fow) / fo)} %`]] : []),
        ])}
        ${season ? `<div class="legend">Saison : ${season.gamesPlayed} PJ · ${season.goals} B · ${season.assists} A · ${season.points} PTS · ${season.plusMinus > 0 ? '+' : ''}${season.plusMinus}</div>` : ''}
        ${last5Html(landing)}
      </div>
    </div>`;
}

async function sceneSpotlight({ game }) {
  const abbrev = game?.team?.abbrev ?? this.getConfig().team;
  const club = await this.nhl.clubStats(abbrev);
  const skaters = (club?.skaters ?? []).filter((s) => s.gamesPlayed > 0).sort((a, b) => b.points - a.points);
  if (!skaters.length) return null;
  const s = skaters[this.spotlight++ % Math.min(5, skaters.length)];
  const landing = await withTimeout(this.nhl.playerLanding(s.playerId), 1500);
  const first = s.firstName?.default ?? '';
  const last = s.lastName?.default ?? '';
  const insights = [];
  insights.push(`${s.points} points en ${s.gamesPlayed} matchs, soit ${(s.points / s.gamesPlayed).toFixed(2)} par match.`);
  if (s.shots) insights.push(`Taux de réussite de ${((100 * s.goals) / s.shots).toFixed(1)} % sur ${s.shots} tirs.`);
  if (s.powerPlayGoals) insights.push(`${s.powerPlayGoals} but${s.powerPlayGoals > 1 ? 's' : ''} en avantage numérique.`);
  if (s.avgTimeOnIcePerGame) insights.push(`${formatToi(s.avgTimeOnIcePerGame)} de temps de glace moyen par match.`);
  const l5 = landing?.last5Games;
  if (l5?.length) {
    const pts = l5.reduce((n, g) => n + (g.points ?? 0), 0);
    insights.push(pts >= 5 ? `En feu : ${pts} points à ses 5 derniers matchs.` : `${pts} point${pts > 1 ? 's' : ''} à ses 5 derniers matchs.`);
  }
  return `
    <div class="feature">
      <div class="ph">${photoHtml(s.headshot, `${first[0] ?? ''}${last[0] ?? ''}`)}</div>
      <div>
        <h2>Sous la loupe : ${esc(last)}</h2>
        <p class="lede">${esc(first)} ${esc(last)} · saison en cours</p>
        ${tiles([
          ['Matchs', s.gamesPlayed],
          ['Buts', s.goals],
          ['Aides', s.assists],
          ['Points', s.points],
          ['+/-', `${s.plusMinus > 0 ? '+' : ''}${s.plusMinus}`],
        ])}
        <ul class="insights">${insights.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </div>
    </div>`;
}

async function sceneGoalies({ game, stats }) {
  if (!game || !stats || !stats.goalies.size) return null;
  const [clubA, clubB] = await Promise.all([this.nhl.clubStats(game.team.abbrev), this.nhl.clubStats(game.opp.abbrev)]);
  const cards = [];
  for (const [id, g] of stats.goalies) {
    const p = game.players.get(id);
    if (!p || !g.sa) continue;
    const ours = p.teamId === game.team.id;
    const season = (ours ? clubA : clubB)?.goalies?.find((x) => x.playerId === id);
    const sv = ((g.sa - g.ga) / g.sa).toFixed(3).replace(/^0/, '');
    cards.push(`<div class="tile" style="border-left:4px solid ${ours ? RED : BLUE}">
      <div class="k">${esc(p.teamAbbrev)} · #${esc(p.number ?? '')}</div>
      <div class="n">${esc(p.last)}</div>
      <div class="legend" style="margin:6px 0 0">Ce soir : ${g.sa - g.ga} arrêts sur ${g.sa} tirs (${sv})</div>
      ${season ? `<div class="legend" style="margin:2px 0 0">Saison : ${(season.savePercentage ?? 0).toFixed(3).replace(/^0/, '')} · ${(season.goalsAgainstAverage ?? 0).toFixed(2)} MPM</div>` : ''}
    </div>`);
  }
  if (!cards.length) return null;
  return `<h2>Devant le filet</h2><p class="lede">Les gardiens jusqu'ici.</p><div class="tiles" style="grid-template-columns:repeat(2,minmax(260px,420px))">${cards.join('')}</div>`;
}

function sceneGoals({ game, stats }) {
  if (!game || !stats?.goals.length) return null;
  const items = stats.goals.map((p) => {
    const d = p.details;
    const scorer = game.players.get(d.scoringPlayerId);
    const assists = [d.assist1PlayerId, d.assist2PlayerId].map((id) => game.players.get(id)?.last).filter(Boolean);
    const ours = p.teamId === game.team.id;
    return `<li><span class="when">${periodName(p.period, game.gameType)} · ${formatClock(p.tip)}</span>
      <span class="sw" style="background:${ours ? RED : BLUE}"></span>
      <span><b>${esc(scorer?.name ?? 'But')}</b>${d.scoringPlayerTotal ? ` (${d.scoringPlayerTotal})` : ''} <span class="muted">${assists.length ? `aides : ${esc(assists.join(', '))}` : 'sans aide'}</span></span>
      <span>${esc(ours ? game.team.abbrev : game.opp.abbrev)}</span></li>`;
  });
  return `<h2>Les buts</h2><p class="lede">Tous les buts vus jusqu'à maintenant.</p><ul class="goals-list">${items.join('')}</ul>`;
}

function sceneIdle({ game }) {
  return `<h2>Pause publicitaire</h2><p class="lede">${
    game ? `${esc(game.team.name)} contre ${esc(game.opp.name)} — on revient au match dès la fin de la pause.` : 'Retour au match dans un instant.'
  }</p>`;
}

function formatToi(s) {
  const sec = Math.round(Number(s) || 0);
  return `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s`;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);
}

// Utilisé par la Régie pour préparer les données de l'émission
export function adShowData(game, gt, score, clock) {
  const colors = game ? matchupColors(game.team.abbrev, game.opp.abbrev) : null;
  return { game, gt, score, clock, colors, stats: game ? computeGameStats(game, gt ?? Infinity) : null };
}
