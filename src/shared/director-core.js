// Cœur de la Régie, sans DOM : quelles actions de l'API peut-on montrer maintenant,
// et quels buts faut-il célébrer (sans doublon entre l'API et la lecture du score à l'écran).

// Une mise en jeu a lieu horloge arrêtée, au même temps de jeu que l'arrêt qui la précède
// (but, dégagement...) : on attend que l'horloge reparte, sinon elle sortirait avant la reprise.
function reached(play, streamGt) {
  return play.type === 'faceoff' ? play.gt < streamGt - 1.5 : play.gt <= streamGt + 0.25;
}

export class EventScheduler {
  constructor() {
    this.reset();
  }

  reset() {
    this.seen = new Set();
    this.pending = [];
    this.released = [];
    this.primed = false;
    this.ingested = false;
  }

  // plays : liste complète normalisée (nhl.normalizeGame). Gère aussi les actions retirées
  // par la LNH (but annulé après contestation) : `removed` (pas encore montrées) et
  // `retracted` (buts déjà montrés puis retirés).
  ingest(plays) {
    this.ingested = true;
    const ids = new Set();
    for (const p of plays) {
      ids.add(p.id);
      if (this.seen.has(p.id) || p.periodType === 'SO') continue;
      this.seen.add(p.id);
      this.pending.push(p);
    }
    const removed = this.pending.filter((p) => !ids.has(p.id));
    if (removed.length) this.pending = this.pending.filter((p) => ids.has(p.id));
    const retracted = plays.length ? this.released.filter((p) => p.type === 'goal' && !ids.has(p.id)) : [];
    if (retracted.length) this.released = this.released.filter((p) => !retracted.includes(p));
    this.pending.sort((a, b) => a.gt - b.gt || a.sort - b.sort);
    return { removed, retracted };
  }

  // Libère les actions que le stream a atteintes.
  // Au premier appel (app lancée en cours de match), le passé est classé sans rien afficher.
  release(streamGt, { maxLateSec = 45 } = {}) {
    const res = { fresh: [], late: [], history: [] };
    if (streamGt == null || !this.ingested) return res;
    let cut = 0;
    while (cut < this.pending.length && reached(this.pending[cut], streamGt)) cut++;
    if (!cut) {
      this.primed = true;
      return res;
    }
    const out = this.pending.splice(0, cut);
    for (const p of out) {
      const lateBy = streamGt - p.gt;
      if (!this.primed && lateBy > 5) res.history.push(p);
      else if (lateBy > maxLateSec) res.late.push(p);
      else res.fresh.push(p);
    }
    this.primed = true;
    this.released.push(...out);
    return res;
  }

  // Un but de ce camp, avec ce score, est-il annoncé par l'API mais pas encore montré ?
  hasPendingGoal(game, side, value) {
    return this.pending.some((p) => {
      if (p.type !== 'goal') return false;
      const d = p.details ?? {};
      const ours = p.teamId === game?.team?.id;
      if ((side === 'team') !== ours) return false;
      const team = game.teamSide === 'away' ? d.awayScore : d.homeScore;
      const opp = game.teamSide === 'away' ? d.homeScore : d.awayScore;
      return (side === 'team' ? team : opp) === value;
    });
  }

  recent(streamGt, windowSec) {
    const out = [];
    for (let i = this.released.length - 1; i >= 0; i--) {
      const p = this.released[i];
      if (p.gt < streamGt - windowSec) break;
      out.unshift(p);
    }
    return out;
  }

  lastReleased() {
    return this.released.at(-1) ?? null;
  }
}

const SAME_GOAL_MS = 120_000;

export class GoalTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.score = { team: 0, opp: 0 };
    this.known = false; // score de départ connu (API ou première lecture à l'écran)
    this.marks = new Map(); // "team:3" -> horodatage de la dernière détection
  }

  setScore(team, opp) {
    this.score = { team, opp };
    this.known = true;
  }

  // But retiré par la LNH après coup (contestation) : on enlève ce but du score
  retract(play, game) {
    const d = play.details ?? {};
    const side = play.teamId === game.team?.id ? 'team' : 'opp';
    const value = (side === 'team') === (game.teamSide !== 'away') ? d.homeScore : d.awayScore;
    this.marks.delete(`${side}:${value}`);
    this.score[side] = Math.max(0, this.score[side] - 1);
    return side;
  }

  #seen(side, value, t) {
    const prev = this.marks.get(`${side}:${value}`);
    return prev != null && t - prev < SAME_GOAL_MS;
  }

  // À appeler quand un but est effectivement célébré / annoncé
  mark(side, value, t) {
    const duplicate = this.#seen(side, value, t);
    this.marks.set(`${side}:${value}`, t);
    return duplicate;
  }

  // But annoncé par l'API (déjà synchronisé sur le stream)
  fromPlay(play, game, t) {
    const d = play.details ?? {};
    const home = d.homeScore;
    const away = d.awayScore;
    if (home == null || away == null) return null;
    const team = game.teamSide === 'away' ? away : home;
    const opp = game.teamSide === 'away' ? home : away;
    const side = play.teamId === game.team?.id ? 'team' : 'opp';
    const duplicate = this.mark(side, side === 'team' ? team : opp, t);
    this.setScore(team, opp);
    return { side, team, opp, duplicate, play };
  }

  // Score lu à l'écran (déjà stabilisé). Détecte +1 pour un camp.
  // Une baisse est ignorée : le tableau du diffuseur se met souvent à jour après l'API.
  // Ne marque rien : la Régie appelle mark() seulement si elle célèbre vraiment ce but.
  fromScreen(team, opp, t) {
    const events = [];
    if (team == null || opp == null) return events;
    if (!this.known) {
      // App lancée en plein match : la première lecture sert de point de départ
      this.setScore(team, opp);
      return events;
    }
    for (const side of ['team', 'opp']) {
      const now = side === 'team' ? team : opp;
      const before = this.score[side];
      if (now === before + 1) events.push({ side, team, opp, value: now, duplicate: this.#seen(side, now, t), play: null });
      // Saut incohérent (+2, lecture d'un autre match...) : on se recale sans rien célébrer
      if (now > before) this.score[side] = now;
    }
    return events;
  }
}
