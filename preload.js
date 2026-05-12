const { contextBridge, ipcRenderer } = require('electron');

function toAssetUrl(absPath) {
  if (!absPath) return '';
  const forward = absPath.replace(/\\/g, '/');
  return 'file:///' + encodeURI(forward).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

contextBridge.exposeInMainWorld('api', {
  state: {
    get:   ()       => ipcRenderer.invoke('state:get'),
    set:   (s)      => ipcRenderer.invoke('state:set', s),
    mergeSeries: (name, patch) => ipcRenderer.invoke('state:merge-series', name, patch),
  },
  library: {
    scan:     (root) => ipcRenderer.invoke('library:scan', root),
    pickRoot: ()     => ipcRenderer.invoke('library:pick-root'),
  },
  chapters: {
    scan: (p) => ipcRenderer.invoke('chapters:scan', p),
  },
  window: {
    minimize:         () => ipcRenderer.invoke('window:minimize'),
    maximize:         () => ipcRenderer.invoke('window:maximize'),
    close:            () => ipcRenderer.invoke('window:close'),
    toggleAOT:        () => ipcRenderer.invoke('window:toggle-aot'),
    isAOT:            () => ipcRenderer.invoke('window:is-aot'),
    toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
    isFullscreen:     () => ipcRenderer.invoke('window:is-fullscreen'),
    openPip:          (info) => ipcRenderer.invoke('window:open-pip', info),
    closePip:         () => ipcRenderer.invoke('window:close-pip'),
    isPipOpen:        () => ipcRenderer.invoke('window:is-pip'),
  },
  toAssetUrl,
});
