const { app, Tray, BrowserWindow, Menu, ipcMain, nativeImage, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const ecs = require('./ecs');

let tray = null;
let win = null;
let settingsWin = null;

const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+E';
const REPO_URL = 'https://github.com/elrincondeisma/desktop-monitor-ecs';
let updateCache = { checkedAt: 0, result: null };

const WIN_WIDTH = 440;
const WIN_HEIGHT = 580;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

// Mergea sobre lo que hay en disco para que dos ventanas (panel y Ajustes)
// no se pisen al guardar claves distintas. Avisa al panel para que recargue.
function saveSettings(patch) {
  const merged = { ...loadSettings(), ...patch };
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2));
  if (win && !win.isDestroyed()) win.webContents.send('settings:changed', merged);
  return merged;
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    minWidth: 400,
    minHeight: 420,
    show: false,
    frame: false,
    backgroundColor: '#1e1f24', // evita el flash blanco al mostrar la ventana
    resizable: true,
    fullscreenable: false,
    skipTaskbar: true,
    movable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('blur', () => {
    if (win.webContents.isDevToolsOpened()) return;
    // No ocultar el panel mientras la ventana de Ajustes tiene el foco
    if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) return;
    win.hide();
  });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 380,
    height: 500,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    title: 'Ajustes',
    skipTaskbar: true,
    backgroundColor: '#1e1f24',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function positionWindow() {
  const trayBounds = tray.getBounds();
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - WIN_WIDTH / 2);
  const y = Math.round(trayBounds.y + trayBounds.height + 4);
  win.setPosition(x, y, false);
}

function toggleWindow() {
  if (win.isVisible()) {
    win.hide();
  } else {
    positionWindow();
    win.show();
    win.focus();
    win.webContents.send('window:shown');
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'iconTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Monitor ECS');
  tray.on('click', toggleWindow);
  tray.on('right-click', () => {
    tray.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: `Abrir/cerrar (${(loadSettings().shortcut || DEFAULT_SHORTCUT).replace('CommandOrControl', '⌘').replace('Shift', '⇧').replace(/\+/g, '')})`, click: toggleWindow },
        { type: 'separator' },
        { label: 'Ajustes…', click: openSettings },
        { label: 'Acerca de ECS Monitor', click: () => app.showAboutPanel() },
        { type: 'separator' },
        { label: 'Salir', click: () => app.quit() },
      ])
    );
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock.hide();
    app.setAboutPanelOptions({
      applicationName: 'ECS Monitor',
      applicationVersion: app.getVersion(),
      copyright: '© 2026 Ismael Catala',
      credits: 'Creado por Ismael Catala',
    });
    createWindow();
    createTray();
    registerShortcut();
  });
}

// Atajo global para abrir/cerrar el panel. Editable desde Ajustes
// (clave "shortcut", formato de aceleradores de Electron).
function registerShortcut() {
  const shortcut = loadSettings().shortcut || DEFAULT_SHORTCUT;
  try {
    const ok = globalShortcut.register(shortcut, toggleWindow);
    if (!ok) console.warn(`Atajo ${shortcut} ya está en uso por otra app`);
  } catch (err) {
    console.warn(`Atajo ${shortcut} inválido: ${err.message}`);
  }
}

// Cambia el atajo desde Ajustes: registra el nuevo, y si falla revierte al
// anterior. Solo persiste si el registro tuvo éxito.
function setShortcut(accel) {
  const next = accel || DEFAULT_SHORTCUT;
  const prev = loadSettings().shortcut || DEFAULT_SHORTCUT;
  globalShortcut.unregisterAll();
  try {
    if (!globalShortcut.register(next, toggleWindow)) {
      globalShortcut.register(prev, toggleWindow);
      return { ok: false, error: 'El atajo ya está en uso por otra app' };
    }
    saveSettings({ shortcut: next });
    return { ok: true, shortcut: next };
  } catch (err) {
    try { globalShortcut.register(prev, toggleWindow); } catch { /* noop */ }
    return { ok: false, error: `Atajo inválido: ${err.message}` };
  }
}

app.on('will-quit', () => globalShortcut.unregisterAll());

function isNewerVersion(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

async function checkUpdate() {
  // Cache de 1h: el endpoint sin auth tiene límite de 60 peticiones/h por IP
  if (Date.now() - updateCache.checkedAt < 60 * 60 * 1000) return updateCache.result;
  try {
    const res = await fetch(
      'https://api.github.com/repos/elrincondeisma/desktop-monitor-ecs/releases/latest',
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const release = await res.json();
    const latest = (release.tag_name || '').replace(/^v/, '');
    const current = app.getVersion();
    updateCache = {
      checkedAt: Date.now(),
      result: latest && isNewerVersion(latest, current)
        ? { latest, current, url: release.html_url }
        : null,
    };
  } catch {
    // Sin red o rate limit: no molestar, se reintenta en la próxima ventana
    updateCache = { checkedAt: Date.now(), result: null };
  }
  return updateCache.result;
}

app.on('window-all-closed', (e) => e.preventDefault());

// --- IPC ---
ipcMain.handle('aws:listProfiles', () => ecs.listProfiles());
ipcMain.handle('aws:fetchState', async (_e, opts) => {
  try {
    return await ecs.fetchState(opts);
  } catch (err) {
    return { error: err.message || String(err) };
  }
});
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:checkUpdate', () => checkUpdate());
ipcMain.on('app:openExternal', (_e, url) => {
  if (typeof url === 'string' && url.startsWith(REPO_URL)) shell.openExternal(url);
});
ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_e, settings) => saveSettings(settings));
ipcMain.on('settings:open', openSettings);
ipcMain.handle('shortcut:set', (_e, accel) => setShortcut(accel));
ipcMain.handle('shortcut:default', () => DEFAULT_SHORTCUT);
ipcMain.handle('loginItem:get', () => ({
  // En desarrollo registraría el binario de Electron, no la app
  enabled: app.isPackaged,
  openAtLogin: app.getLoginItemSettings().openAtLogin,
}));
ipcMain.handle('loginItem:set', (_e, value) => {
  app.setLoginItemSettings({ openAtLogin: !!value });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.on('tray:title', (_e, title) => {
  if (tray) tray.setTitle(title || '', { fontType: 'monospacedDigit' });
});
ipcMain.on('window:hide', () => win && win.hide());
ipcMain.on('app:quit', () => app.quit());
