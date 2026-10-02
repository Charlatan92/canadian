// Pont entre l'interface (fenêtre principale et fenêtre de surcouche, isolées) et le process principal.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set([
  'nav-blocked',
  'popup-blocked',
  'popup-redirected',
  'guest-fullscreen',
  'media-failure',
  'config-changed',
  'overlay-status',
  'overlay-toast',
  'overlay-cmd',
  'overlay-request',
]);

contextBridge.exposeInMainWorld('rondelle', {
  info: () => ipcRenderer.invoke('app:info'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  nhl: (path) => ipcRenderer.invoke('nhl:get', path),
  news: (q, lang) => ipcRenderer.invoke('news:get', { q, lang }),
  fetchPage: (url) => ipcRenderer.invoke('page:fetch', url),
  allowNavigation: (opts) => ipcRenderer.invoke('nav:allow', opts),
  fullscreen: (value) => ipcRenderer.invoke('win:fullscreen', value),
  pickAudioFile: () => ipcRenderer.invoke('dialog:openAudio'),
  readAudio: (which) => ipcRenderer.invoke('file:readAudio', which),
  captureGuest: (id, opts) => ipcRenderer.invoke('capture:guest', id, opts),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  diagnostics: () => ipcRenderer.invoke('diag:main'),
  adblockTemporary: (host, on) => ipcRenderer.invoke('adblock:temporary', host, on),
  saveHead: (key, png) => ipcRenderer.invoke('heads:save', key, png),
  exportHeads: (opts) => ipcRenderer.invoke('heads:export', opts),
  openHeadsFolder: (folder) => ipcRenderer.invoke('heads:open-folder', folder),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  displays: () => ipcRenderer.invoke('displays:list'),
  // Mode surcouche
  duck: (opts) => ipcRenderer.invoke('audio:duck', opts),
  overlayState: () => ipcRenderer.invoke('overlay:state'),
  overlayCommand: (cmd) => ipcRenderer.send('overlay:command', cmd),
  overlayRequest: (type, args) => ipcRenderer.invoke('overlay:request', type, args),
  overlayStatus: (status) => ipcRenderer.send('overlay:status', status),
  overlayToast: (toast) => ipcRenderer.send('overlay:toast', toast),
  overlayReply: (id, result) => ipcRenderer.send('overlay:reply', id, result),
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) throw new Error(`Événement inconnu : ${channel}`);
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
