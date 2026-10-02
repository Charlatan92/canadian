import { buildClubStats, buildLanding, buildPbp, buildRoster, buildSchedule } from '/demo/timeline.js';

// Fausse API LNH du mode démo, calée sur le faux stream (même scénario, même horloge).
export function createDemoApi(start) {
  return async (path) => {
    if (path.includes('/club-schedule/')) return { ok: true, data: buildSchedule(start) };
    if (path.includes('/play-by-play')) return { ok: true, data: buildPbp(start, Date.now()) };
    const roster = path.match(/\/roster\/([A-Z]{3})\//);
    if (roster) return { ok: true, data: buildRoster(roster[1]) };
    const club = path.match(/\/club-stats\/([A-Z]{3})\//);
    if (club) return { ok: true, data: buildClubStats(club[1]) };
    const player = path.match(/\/player\/(\d+)\//);
    if (player) return { ok: true, data: buildLanding(Number(player[1])) };
    return { ok: false, status: 404 };
  };
}

// Zones du tableau de score dessiné par le faux stream (1280x720)
export const DEMO_PROFILE = {
  id: 'demo',
  name: 'Démo',
  scorebug: [40 / 1280, 620 / 720, 420 / 1280, 56 / 720],
  clock: [358 / 1280, 626 / 720, 100 / 1280, 44 / 720],
  scoreTeam: [282 / 1280, 626 / 720, 36 / 1280, 44 / 720],
  scoreOpp: [142 / 1280, 626 / 720, 36 / 1280, 44 / 720],
  signature: null,
};
