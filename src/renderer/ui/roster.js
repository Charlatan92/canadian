import { TEAMS, teamLabel } from '../../shared/nhl.js';
import { headshotProxyUrl, seasonLabel } from '../emojiHeads.js';
import { esc, icon, initials, teamLogoHtml } from '../util.js';

const GROUPS = [
  ['Attaquants', (p) => ['C', 'L', 'R'].includes(p.pos)],
  ['Défenseurs', (p) => p.pos === 'D'],
  ['Gardiens', (p) => p.pos === 'G'],
];

// Rubrique « Effectifs & émojis » : l'effectif actuel de n'importe quelle équipe (API LNH) et
// la création des têtes émoji, pour une équipe ou les 32 d'un coup.
export class RosterPanel {
  constructor({ heads, nhl, getConfig, toast }) {
    Object.assign(this, { heads, nhl, getConfig, toast });
    this.team = null;
    this.players = null;
    this.loadedTeam = null;
    this.error = null;
    this.emoji = new Map(); // id -> url
    this.job = null; // { label, done, total, abort }
  }

  mount(el) {
    if (!el) return;
    this.el = el;
    this.team ??= this.getConfig().team;
    el.onclick = (e) => this.#onClick(e);
    el.onchange = (e) => {
      if (e.target.id === 'roster-team') {
        this.team = e.target.value;
        this.load();
      }
    };
    this.render();
    if (this.loadedTeam !== this.team) this.load();
  }

  get mounted() {
    return !!this.el?.isConnected;
  }

  async load() {
    const team = this.team;
    this.players = null;
    this.error = null;
    this.render();
    try {
      const list = await this.heads.roster(this.nhl, team);
      if (team !== this.team) return;
      this.players = list;
      this.loadedTeam = team;
      this.render();
      for (const p of list) {
        const url = await this.heads.peek(p);
        if (url) this.#setEmoji(p, url);
      }
    } catch (err) {
      if (team !== this.team) return;
      this.error = err.message;
      this.render();
    }
  }

  #setEmoji(p, url) {
    this.emoji.set(p.id, url);
    const ph = this.mounted && this.el.querySelector(`.player-tile[data-id="${p.id}"] .ph`);
    if (ph) {
      ph.className = 'ph emoji';
      ph.innerHTML = `<img src="${esc(url)}" alt="">`;
    }
  }

  render() {
    if (!this.mounted) return;
    const logos = this.getConfig().ui.logos;
    const job = this.job;
    const options = Object.entries(TEAMS)
      .sort((a, b) => a[1].label.localeCompare(b[1].label, 'fr'))
      .map(([code, t]) => `<option value="${code}" ${code === this.team ? 'selected' : ''}>${esc(t.label)}</option>`)
      .join('');
    const head = `<div class="roster-bar">
        ${teamLogoHtml(this.team, { logos })}
        <select class="select" id="roster-team" aria-label="Équipe">${options}</select>
        <span class="badge">Saison ${seasonLabel()}</span>
        <div class="spacer"></div>
        <button class="btn btn-sm btn-primary" data-act="gen-team" ${job ? 'disabled' : ''}>${icon('wand-sparkles', 'ic-sm')}Créer les émojis de l'équipe</button>
        <button class="btn btn-sm" data-act="gen-all" ${job ? 'disabled' : ''} data-tip="Environ 800 joueurs : comptez quelques minutes. Une tête à la fois, pour ne pas ralentir l'ordinateur.">Les 32 équipes</button>
        <button class="icon-btn" data-act="open-folder" aria-label="Ouvrir le dossier" data-tip="Ouvrir le dossier des PNG (Images › Rondelle)">${icon('folder-open')}</button>
      </div>
      ${job ? `<div class="card" style="padding:12px 16px;margin-bottom:16px;display:grid;gap:8px">
          <div style="display:flex;align-items:center;gap:8px">${icon('loader-circle', 'ic-sm')}<span class="grow">${esc(job.label)}</span><span class="muted num">${job.done}/${job.total}</span><button class="btn btn-sm btn-ghost" data-act="gen-stop">Annuler</button></div>
          <div class="progress"><i style="--p:${job.total ? Math.round((100 * job.done) / job.total) : 0}%"></i></div></div>` : ''}`;
    let body;
    if (this.error) body = `<div class="empty">${icon('circle-alert', 'ic-sm')} Effectif indisponible : ${/net::|fetch|réseau|ENOTFOUND|TIMED_OUT/i.test(this.error) ? 'pas de connexion aux serveurs de la LNH' : esc(this.error)}. Réessayez dans un moment.</div>`;
    else if (!this.players) body = '<div class="empty">Chargement de l\'effectif…</div>';
    else
      body = GROUPS.map(([title, test]) => {
        const list = this.players.filter(test).sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
        if (!list.length) return '';
        return `<section class="roster-section"><h5>${title} · ${list.length}</h5><div class="roster-grid">${list.map((p) => this.#tile(p)).join('')}</div></section>`;
      }).join('');
    this.el.innerHTML = head + body;
  }

  #tile(p) {
    const url = this.emoji.get(p.id);
    const photo = headshotProxyUrl(p.headshot);
    const ph = url
      ? `<div class="ph emoji"><img src="${esc(url)}" alt=""></div>`
      : `<div class="ph">${photo ? `<img src="${esc(photo)}" alt="" data-fallback="${esc(initials(p))}">` : `<span class="pc-initials">${esc(initials(p))}</span>`}</div>`;
    return `<div class="player-tile" data-id="${p.id}" style="--tile-color:${TEAMS[p.teamAbbrev]?.color ?? '#555'}">
      <span class="no">${p.number != null ? `#${esc(p.number)}` : ''}</span>${ph}<div class="nm" title="${esc(p.name)}">${esc(p.first?.[0] ?? '')}. ${esc(p.last)}</div></div>`;
  }

  async #run(teams) {
    const ctrl = new AbortController();
    this.job = { label: '', done: 0, total: 0, abort: () => ctrl.abort() };
    let exported = 0;
    let lastFolder = null;
    try {
      for (let i = 0; i < teams.length; i++) {
        const team = teams[i];
        const prefix = teams.length > 1 ? `Équipe ${i + 1}/${teams.length} · ` : '';
        this.job.label = `${prefix}${teamLabel(team)} : création des têtes…`;
        this.render();
        const res = await this.heads.generateRoster({
          nhl: this.nhl,
          team,
          signal: ctrl.signal,
          open: false,
          onProgress: (done, total, p) => {
            Object.assign(this.job, { done, total });
            if (team === this.team) this.heads.peek(p).then((url) => url && this.#setEmoji(p, url));
            const bar = this.mounted && this.el.querySelector('.progress i');
            if (bar) bar.style.setProperty('--p', `${Math.round((100 * done) / total)}%`);
            const count = this.mounted && this.el.querySelector('.card .num');
            if (count) count.textContent = `${done}/${total}`;
          },
        });
        exported += res?.copied ?? 0;
        lastFolder = res?.folder ?? lastFolder;
      }
      this.toast(`${exported} têtes émoji enregistrées${teams.length === 1 && lastFolder ? ` dans ${lastFolder}` : ' dans Images › Rondelle'}.`, {
        kind: 'ok',
        ms: 9000,
        actions: [{ label: 'Ouvrir le dossier', fn: () => window.rondelle.openHeadsFolder(teams.length === 1 ? lastFolder : null) }],
      });
    } catch (err) {
      if (err.message !== 'annulé') this.toast(`Impossible de créer les têtes : ${err.message}`, { kind: 'bad', ms: 8000 });
    } finally {
      this.job = null;
      this.render();
    }
  }

  #onClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'gen-team':
        return this.#run([this.team]);
      case 'gen-all':
        return this.#run([this.team, ...Object.keys(TEAMS).filter((t) => t !== this.team)]);
      case 'gen-stop':
        return this.job?.abort();
      case 'open-folder':
        return window.rondelle.openHeadsFolder(null);
      default:
    }
  }
}
