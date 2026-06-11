const { app, Tray, BrowserWindow, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const ecs = require('./ecs');

let tray = null;
let win = null;

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

function saveSettings(settings) {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    minWidth: 400,
    minHeight: 420,
    show: false,
    frame: false,
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
    if (!win.webContents.isDevToolsOpened()) win.hide();
  });
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
        { label: 'Abrir/cerrar', click: toggleWindow },
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
    createWindow();
    createTray();
  });
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
ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_e, settings) => saveSettings(settings));
ipcMain.on('tray:title', (_e, title) => {
  if (tray) tray.setTitle(title || '', { fontType: 'monospacedDigit' });
});
ipcMain.on('window:hide', () => win && win.hide());
ipcMain.on('app:quit', () => app.quit());
