const $ = (sel) => document.querySelector(sel);

let settings = {};
let defaultShortcut = '';
let recording = false;

function notifyEventEnabled(kind) {
  const ev = settings.notifyEvents || {};
  return ev[kind] !== false;
}

// Accelerator de Electron -> símbolos legibles (⌘⇧E)
function fmtAccel(accel) {
  return (accel || '')
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Control', '⌃')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧')
    .replace(/\+/g, '');
}

async function save(patch) {
  settings = (await window.api.saveSettings(patch)) || settings;
}

// Tecla del evento -> nombre en formato accelerator de Electron
function keyName(e) {
  const k = e.key;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(k)) return null;
  if (k === ' ') return 'Space';
  if (k.length === 1) return k.toUpperCase();
  return k.charAt(0).toUpperCase() + k.slice(1); // F1..F12, ArrowUp, etc.
}

function renderNotify() {
  const on = settings.notify !== false;
  $('#notify-all').checked = on;
  $('#notify-events').classList.toggle('disabled', !on);
  document.querySelectorAll('#notify-events input[data-event]').forEach((cb) => {
    cb.checked = notifyEventEnabled(cb.dataset.event);
    cb.disabled = !on;
  });
}

function renderShortcut() {
  $('#shortcut').textContent = fmtAccel(settings.shortcut || defaultShortcut);
}

function stopRecording() {
  recording = false;
  $('#shortcut').classList.remove('recording');
  renderShortcut();
}

async function init() {
  settings = (await window.api.loadSettings()) || {};
  defaultShortcut = await window.api.defaultShortcut();
  const login = await window.api.getLoginItem();

  // --- Intervalo de refresco ---
  const interval = $('#interval');
  interval.value = String(settings.interval ?? 30000);
  interval.addEventListener('change', () => save({ interval: Number(interval.value) }));

  // --- Atajo global ---
  renderShortcut();
  $('#shortcut').addEventListener('click', () => {
    recording = !recording;
    $('#shortcut').classList.toggle('recording', recording);
    $('#shortcut-hint').textContent = '';
    if (recording) $('#shortcut').textContent = 'Pulsa la combinación…';
    else renderShortcut();
  });
  $('#shortcut-reset').addEventListener('click', async () => {
    const res = await window.api.setShortcut(defaultShortcut);
    if (res.ok) settings.shortcut = res.shortcut;
    $('#shortcut-hint').textContent = res.ok ? '' : res.error;
    renderShortcut();
  });

  // --- Arranque al iniciar sesión ---
  const loginCb = $('#login-item');
  loginCb.checked = login.openAtLogin;
  loginCb.disabled = !login.enabled;
  if (!login.enabled) $('#login-hint').classList.remove('hidden');
  loginCb.addEventListener('change', async () => {
    loginCb.checked = await window.api.setLoginItem(loginCb.checked);
  });

  // --- Notificaciones ---
  renderNotify();
  $('#notify-all').addEventListener('change', async (e) => {
    await save({ notify: e.target.checked });
    renderNotify();
  });
  document.querySelectorAll('#notify-events input[data-event]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await save({ notifyEvents: { ...(settings.notifyEvents || {}), [cb.dataset.event]: cb.checked } });
    });
  });

  // --- Teclado: grabar atajo / cerrar con Escape ---
  document.addEventListener('keydown', async (e) => {
    if (recording) {
      e.preventDefault();
      if (e.key === 'Escape') { stopRecording(); return; }
      const key = keyName(e);
      if (!key) return; // aún sin tecla principal, espera
      const parts = [];
      if (e.metaKey) parts.push('CommandOrControl');
      if (e.ctrlKey && !e.metaKey) parts.push('Control');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      parts.push(key);
      stopRecording();
      const res = await window.api.setShortcut(parts.join('+'));
      if (res.ok) settings.shortcut = res.shortcut;
      $('#shortcut-hint').textContent = res.ok ? '' : res.error;
      renderShortcut();
      return;
    }
    if (e.key === 'Escape') window.close();
  });
}

init();
