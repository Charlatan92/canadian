import { APP_NAME } from '../../shared/brand.js';
import { t } from '../../shared/i18n.js';
import { teamLabel } from '../../shared/nhl.js';
import { PROVIDERS, providerOf } from '../../shared/providers.js';
import { applyTeamTheme, esc, icon, logoMarkHtml } from '../util.js';
import { teamGridHtml } from './teamPicker.js';

// Accueil du premier lancement, en trois étapes : équipe, façon de regarder, mode d'emploi.
export class Welcome {
  constructor(el, { getConfig, saveConfig, displays }) {
    Object.assign(this, { el, getConfig, saveConfig, displays });
    el.addEventListener('click', (e) => this.#onClick(e));
    el.addEventListener('change', (e) => {
      if (e.target.id === 'wl-display') this.draft.display = e.target.value === 'null' ? null : e.target.value;
    });
  }

  get open() {
    return !this.el.hidden;
  }

  async show() {
    const cfg = this.getConfig();
    this.step = 0;
    this.draft = { team: cfg.team, source: cfg.source, provider: cfg.overlay.provider, display: cfg.overlay.display };
    this.screens = (await this.displays?.().catch(() => [])) ?? [];
    this.el.hidden = false;
    this.render();
  }

  close() {
    this.el.hidden = true;
    this.el.innerHTML = '';
    applyTeamTheme(this.getConfig().team);
  }

  render() {
    const d = this.draft;
    const logos = this.getConfig().ui.logos;
    const steps = [
      {
        title: t('Bienvenue dans {app}', { app: APP_NAME }),
        lede: t('La régie télé de vos matchs : fil des actions, célébrations des buts, stats pendant les pubs, son baissé pendant les pauses. Quelle équipe suivez-vous ?'),
        body: teamGridHtml(d.team, { logos }),
      },
      {
        title: t('Comment regardez-vous les matchs ?'),
        lede: t('Vous pourrez changer à tout moment dans Réglages › Général.'),
        body: `<div class="choice-grid">
            <button class="choice" data-source="overlay" aria-pressed="${d.source === 'overlay'}">${icon('cast')}<b>${t('Avec mon abonnement télé')}</b>
              <span>${t("RDS, TVA Sports, Sportsnet, TSN… dans votre navigateur ou l'appli de votre fournisseur. {app} se pose par-dessus, en transparence.", { app: APP_NAME })}</span></button>
            <button class="choice" data-source="web" aria-pressed="${d.source === 'web'}">${icon('globe')}<b>${t('Sur un site web, dans {app}', { app: APP_NAME })}</b>
              <span>${t("Le site s'ouvre dans l'app (OnHockey.tv par défaut) : choix du stream, pop-ups bloquées, bascule si le stream tombe.")}</span></button>
          </div>
          ${d.source === 'overlay' ? `<div class="wl-subtitle">${t('Votre diffuseur')}</div>
            <div class="chips">${PROVIDERS.map((p) => `<button class="chip-opt" data-provider="${p.id}" aria-pressed="${p.id === d.provider}">${esc(p.name)}</button>`).join('')}</div>
            <div class="wl-subtitle">${t('Écran où vous mettez le match en plein écran')}</div>
            <select class="select" id="wl-display" style="min-width:320px">
              <option value="null" ${d.display == null ? 'selected' : ''}>${t('Écran principal')}</option>
              ${this.screens.filter((s) => s.id != null).map((s) => `<option value="${esc(s.id)}" ${String(s.id) === String(d.display) ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>` : ''}`,
      },
      {
        title: t("C'est prêt !"),
        lede: d.source === 'overlay' ? t("Lancez le match sur {where}, en plein écran : {app} s'occupe du reste.", { where: providerOf(d.provider).url ? providerOf(d.provider).name : t("l'appli de votre fournisseur"), app: APP_NAME }) : t('{app} cherche le match des {team} et lance le meilleur stream au début du match.', { app: APP_NAME, team: teamLabel(d.team) }),
        body: `<div class="tips">
            <div class="tip">${icon('scan')}<div><b>${t('Tableau de score trouvé tout seul')}</b>${t("Pendant le jeu, la régie trouve le tableau et son horloge : détection des pubs et synchro sans divulgâcheur. Pour ajuster : touche <kbd>C</kbd>.")}</div></div>
            <div class="tip">${icon('info')}<div><b>${t('Survolez les (i)')}</b>${t('Chaque réglage est expliqué dans une bulle. Réglages : touche <kbd>S</kbd>.')}</div></div>
            <div class="tip">${icon('music')}<div><b>${t('Klaxon et chanson')}</b>${t("Réglages › Son : chaque équipe a son klaxon ; importez le vrai klaxon et la chanson de but de votre équipe.")}</div></div>
            ${d.source === 'overlay' ? `<div class="tip">${icon('keyboard')}<div><b>${t('Raccourcis partout')}</b>${t('<kbd>Ctrl+Alt+H</kbd> masque les graphiques, <kbd>Ctrl+Alt+R</kbd> ouvre le panneau.')}</div></div>` : `<div class="tip">${icon('maximize')}<div><b>${t('Plein écran')}</b>${t('Touche <kbd>F</kbd> : le lecteur seul, avec les graphiques par-dessus.')}</div></div>`}
          </div>`,
      },
    ];
    const s = steps[this.step];
    // La boîte reste en place d'une étape à l'autre (pas de nouvelle animation d'ouverture)
    let box = this.el.querySelector('.dlg-welcome');
    if (!box) {
      this.el.innerHTML = '<section class="dialog dlg-welcome" role="dialog" aria-modal="true" aria-labelledby="wl-title" tabindex="-1"></section>';
      box = this.el.querySelector('.dlg-welcome');
    }
    box.innerHTML = `
        <header class="wl-head"><div class="wl-steps">${steps.map((_, i) => `<span class="${i <= this.step ? 'on' : ''}"></span>`).join('')}</div>
          <div style="display:flex;align-items:center;gap:14px">${logoMarkHtml('logo-mark')}<h2 id="wl-title">${esc(s.title)}</h2></div><p>${esc(s.lede)}</p></header>
        <div class="wl-body">${s.body}</div>
        <footer class="wl-foot">
          ${this.step > 0 ? `<button class="btn btn-ghost" data-act="back">${icon('arrow-left', 'ic-sm')}${t('Retour')}</button>` : ''}
          <div class="spacer"></div>
          <span class="muted">${this.step + 1} / ${steps.length}</span>
          <button class="btn btn-primary btn-lg" data-act="${this.step === steps.length - 1 ? 'finish' : 'next'}">${this.step === steps.length - 1 ? t('Commencer') : t('Continuer')}${icon('arrow-right', 'ic-sm')}</button>
        </footer>`;
    box.focus();
  }

  async #onClick(e) {
    const t = e.target;
    const team = t.closest('.team-opt[data-team]');
    if (team) {
      this.draft.team = team.dataset.team;
      applyTeamTheme(this.draft.team); // aperçu immédiat de la direction artistique
      return this.render();
    }
    const src = t.closest('[data-source]');
    if (src) {
      this.draft.source = src.dataset.source;
      return this.render();
    }
    const prov = t.closest('[data-provider]');
    if (prov) {
      this.draft.provider = prov.dataset.provider;
      return this.render();
    }
    const b = t.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'next') this.step++;
    else if (b.dataset.act === 'back') this.step--;
    else if (b.dataset.act === 'finish') {
      const cfg = structuredClone(this.getConfig());
      const d = this.draft;
      cfg.team = d.team;
      cfg.source = d.source;
      cfg.overlay.provider = d.provider;
      cfg.overlay.display = d.display;
      cfg.onboarded = true;
      this.el.hidden = true;
      this.el.innerHTML = '';
      await this.saveConfig(cfg);
      return;
    }
    this.render();
  }
}
