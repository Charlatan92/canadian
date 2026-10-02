// Rapport de diagnostic copiable : ce que l'app a vu de la page du stream.
// Utile quand un lecteur refuse de démarrer sur un site qu'on ne peut pas tester soi-même.

const AGENT_EVENTS = ['popup', 'overlay-removed', 'audio-attached', 'audio-failed', 'audio-silent', 'vision', 'player-error', 'drm'];

export class Diagnostics {
  constructor({ webview, bridge, streams, director, getConfig }) {
    Object.assign(this, { webview, bridge, streams, director, getConfig });
    this.console = [];
    this.agent = [];
    webview.addEventListener('console-message', (e) => {
      const level = typeof e.level === 'number' ? e.level : { warning: 2, error: 3 }[e.level] ?? 0;
      if (level < 2) return;
      this.console.push({ t: Date.now(), message: String(e.message ?? '').slice(0, 300), source: String(e.sourceId ?? '').slice(0, 150) });
      if (this.console.length > 30) this.console.shift();
    });
    for (const type of AGENT_EVENTS) {
      bridge.on(type, (m) => {
        const { frameKey, isPrimary, ...rest } = m ?? {};
        this.agent.push({ t: Date.now(), type, primary: !!isPrimary, ...rest });
        if (this.agent.length > 60) this.agent.shift();
      });
    }
  }

  async collect() {
    const cfg = this.getConfig();
    const s = this.streams;
    const d = this.director;
    return {
      quand: new Date().toISOString(),
      app: await window.rondelle.diagnostics(),
      stream: {
        courant: s.current,
        etat: s.health,
        dejaJoue: s.playedOnce,
        lancePar: s.launchedBy,
        reprise: s.recovery,
        echecsFlux: s.mediaFailures.slice(-10),
        liste: s.streams.map(({ label, host, lang, source }) => ({ label, host, lang, source })),
      },
      frames: [...this.bridge.frames.values()].map((f) => ({
        url: f.url,
        principale: f.key === this.bridge.primaryKey,
        video: f.status?.video ?? null,
        son: f.status?.audio ?? null,
      })),
      agent: this.agent.slice(-40),
      console: this.console.slice(-20),
      regie: {
        pub: d.adState,
        sync: d.clockInfo ? { source: d.clockInfo.source, retard: d.clockInfo.delaySec } : null,
        match: d.game ? { id: d.game.id, etat: d.game.state, equipes: `${d.game.away?.abbrev} @ ${d.game.home?.abbrev}` } : null,
        voix: d.voice?.status ?? null,
      },
      reglages: {
        equipe: cfg.team,
        bloqueur: cfg.stream.adblock,
        exceptionsBloqueur: cfg.stream.adblockExceptions,
        antiPopups: cfg.stream.blockPopups,
        theatre: cfg.stream.theatreMode,
        son: cfg.audio.mode,
        affichage: cfg.regie.playerStyle,
        voix: cfg.voice,
      },
    };
  }

  async copy() {
    const text = JSON.stringify(await this.collect(), null, 2);
    await navigator.clipboard.writeText(text);
    return text;
  }
}
