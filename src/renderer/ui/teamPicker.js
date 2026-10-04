import { lang, t } from '../../shared/i18n.js';
import { DIVISIONS, TEAMS, divisionLabel, teamLabel, teamName } from '../../shared/nhl.js';
import { esc, teamLogoHtml } from '../util.js';

// Grille des 32 équipes, rangées par division. Chaque bouton porte data-team="MTL".
export function teamGridHtml(current, { logos = true } = {}) {
  return `<div class="team-grid" role="group" aria-label="${t("Choisir l'équipe")}">${DIVISIONS.map(
    (d) => `<div class="div-col"><h5>${esc(divisionLabel(d))}</h5>${Object.entries(TEAMS)
      .filter(([, tm]) => tm.division === d)
      .sort((a, b) => teamName(a[0]).localeCompare(teamName(b[0]), lang()))
      .map(
        ([code, tm]) => `<button type="button" class="team-opt" data-team="${code}" aria-pressed="${code === current}" style="--opt-color:${tm.color}" title="${esc(teamLabel(code))}">
          ${teamLogoHtml(code, { logos })}<span>${esc(teamName(code))}</span></button>`,
      )
      .join('')}</div>`,
  ).join('')}</div>`;
}
