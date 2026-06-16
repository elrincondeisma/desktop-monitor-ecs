const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  openExternal: (url) => ipcRenderer.send('app:openExternal', url),
  listProfiles: () => ipcRenderer.invoke('aws:listProfiles'),
  fetchState: (opts) => ipcRenderer.invoke('aws:fetchState', opts),
  s3ListBuckets: (opts) => ipcRenderer.invoke('s3:listBuckets', opts),
  s3ListObjects: (opts) => ipcRenderer.invoke('s3:listObjects', opts),
  s3GetObject: (opts) => ipcRenderer.invoke('s3:getObject', opts),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  openSettings: () => ipcRenderer.send('settings:open'),
  setShortcut: (accel) => ipcRenderer.invoke('shortcut:set', accel),
  defaultShortcut: () => ipcRenderer.invoke('shortcut:default'),
  getLoginItem: () => ipcRenderer.invoke('loginItem:get'),
  setLoginItem: (value) => ipcRenderer.invoke('loginItem:set', value),
  setTrayTitle: (title) => ipcRenderer.send('tray:title', title),
  hideWindow: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  onShown: (cb) => ipcRenderer.on('window:shown', cb),
});
