const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  openExternal: (url) => ipcRenderer.send('app:openExternal', url),
  listProfiles: () => ipcRenderer.invoke('aws:listProfiles'),
  fetchState: (opts) => ipcRenderer.invoke('aws:fetchState', opts),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  setTrayTitle: (title) => ipcRenderer.send('tray:title', title),
  hideWindow: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  onShown: (cb) => ipcRenderer.on('window:shown', cb),
});
