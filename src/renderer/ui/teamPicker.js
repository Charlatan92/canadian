import { DIVISIONS, TEAMS } from '../../shared/nhl.js';
import { esc, teamLogoHtml } from '../util.js';

// Grille des 32 équipes, rangées par division. Chaque bouton porte data-team="MTL".
export function teamGridHtml(current, { logos = true } = {}) {
  return `<div class="team-grid" role="group" aria-label="Choisir l'équipe">${DIVISIONS.map(
    (d) => `<div class="div-col"><h5>${esc(d)}</h5>${Object.entries(TEAMS)
      .filter(([, t]) => t.division === d)
      .sort((a, b) => a[1].name.localeCompare(b[1].name, 'fr'))
      .map(
        ([code, t]) => `<button type="button" class="team-opt" data-team="${code}" aria-pressed="${code === current}" style="--opt-color:${t.color}" title="${esc(t.label)}">
          ${teamLogoHtml(code, { logos })}<span>${esc(t.name)}</span></button>`,
      )
      .join('')}</div>`,
  ).join('')}</div>`;
}
