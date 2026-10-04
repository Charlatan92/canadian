import { buildClubStats, buildLanding, buildNews, buildPbp, buildRightRail, buildRoster, buildSchedule } from '/demo/timeline.js';

// Fausse API LNH du mode démo, calée sur le faux stream (même scénario, même horloge).
export function createDemoApi(start, lead = undefined) {
  return async (path) => {
    if (path.includes('/club-schedule/')) return { ok: true, data: buildSchedule(start) };
    if (path.includes('/play-by-play')) return { ok: true, data: buildPbp(start, Date.now(), lead ?? undefined) };
    const roster = path.match(/\/roster\/([A-Z]{3})\//);
    if (roster) return { ok: true, data: buildRoster(roster[1]) };
    const club = path.match(/\/club-stats\/([A-Z]{3})\//);
    if (club) return { ok: true, data: buildClubStats(club[1]) };
    if (path.includes('/right-rail')) return { ok: true, data: buildRightRail(start) };
    const player = path.match(/\/player\/(\d+)\//);
    if (player) return { ok: true, data: buildLanding(Number(player[1])) };
    return { ok: false, status: 404 };
  };
}

// Fausse revue de presse (articles fictifs, publiés avant la mise en jeu de la démo)
export function createDemoNews(start) {
  return async () => ({ ok: true, items: buildNews(start) });
}

export { DEMO_PROFILE } from '../shared/demoProfile.js';
