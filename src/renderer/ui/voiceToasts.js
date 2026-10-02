// Téléchargement unique du modèle vocal, puis état de la reconnaissance, en notifications
export function watchVoice(voice, notify, getConfig) {
  const shown = { state: null, progress: 0, slowHint: false };
  voice.on('status', (st) => {
    if (st.state === 'ready' && st.device === 'wasm' && st.ms > 3500 && !shown.slowHint && getConfig().voice.model !== 'tiny') {
      shown.slowHint = true;
      notify('Voix du commentateur lente sur le processeur : choisissez le modèle « Rapide » dans Réglages › Voix du commentateur.', { kind: 'warn', ms: 9000 });
    }
    if (st.state === 'loading' && st.progress != null && st.progress - shown.progress >= 20) {
      shown.progress = st.progress;
      notify(`Modèle de reconnaissance vocale : ${st.progress} % (téléchargé une seule fois)`, { ms: 3000, key: 'voice-progress' });
    }
    if (st.state !== shown.state) {
      if (st.state === 'ready') notify(`Voix du commentateur prête (${st.device === 'webgpu' ? 'carte graphique' : 'processeur'})`, { kind: 'ok', ms: 4000 });
      if (st.state === 'error') {
        notify(
          st.offline
            ? 'Voix du commentateur : modèle pas encore téléchargé (huggingface.co injoignable). Nouvel essai automatique ; les cartes joueur continuent avec les données LNH.'
            : `Reconnaissance vocale indisponible : ${st.error}`,
          { kind: 'warn', ms: 8000 },
        );
      }
      if (st.state === 'loading') shown.progress = 0;
      shown.state = st.state;
    }
  });
}
