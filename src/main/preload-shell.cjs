// Pont entre l'interface (renderer isolé) et le process principal.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['nav-blocked', 'popup-blocked', 'popup-redirected', 'guest-fullscreen']);

contextBridge.exposeInMainWorld('habs', {
  info: () => ipcRenderer.invoke('app:info'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  nhl: (path) => ipcRenderer.invoke('nhl:get', path),
  fetchPage: (url) => ipcRenderer.invoke('page:fetch', url),
  allowNavigation: (opts) => ipcRenderer.invoke('nav:allow', opts),
  fullscreen: (value) => ipcRenderer.invoke('win:fullscreen', value),
  pickAudioFile: () => ipcRenderer.invoke('dialog:openAudio'),
  readAudio: (which) => ipcRenderer.invoke('file:readAudio', which),
  captureGuest: (id, opts) => ipcRenderer.invoke('capture:guest', id, opts),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  diagnostics: () => ipcRenderer.invoke('diag:main'),
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) throw new Error(`Événement inconnu : ${channel}`);
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
