const $ = (sel) => document.querySelector(sel);

const REGIONS = [
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-south-1', 'eu-north-1',
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'sa-east-1', 'ca-central-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-south-1',
];

const TASK_CATEGORY = {
  PROVISIONING: 'deploying',
  PENDING: 'deploying',
  ACTIVATING: 'deploying',
  RUNNING: 'running',
  DEACTIVATING: 'stopping',
  STOPPING: 'stopping',
  DEPROVISIONING: 'stopping',
  STOPPED: 'stopped',
};

const CATEGORY_META = {
  deploying: { label: 'Desplegando', color: 'amber' },
  running: { label: 'Activas', color: 'green' },
  stopping: { label: 'Desactivando', color: 'orange' },
};

const NEW_BADGE_MS = 10 * 60 * 1000; // "nueva" durante 10 min
const MAX_EVENTS = 80;

let profiles = [];
let settings = {};
let favorites = [];
let state = null;
let lastError = null;
let timer = null;
let fetching = false;
let activeTab = 'clusters';

// Diff entre refrescos para detectar tareas creadas/destruidas
let prevTasks = null;
let prevKey = null;
let events = [];
const recentNew = new Map(); // arn -> timestamp

const openClusters = new Set();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const ctx = () => ({ profile: $('#profile').value, region: $('#region').value });

function categorize(task) {
  if (task.lastStatus === 'RUNNING' && task.desiredStatus === 'STOPPED') return 'stopping';
  return TASK_CATEGORY[task.lastStatus] || 'deploying';
}

function rolloutBadge(service) {
  if (service.rolloutState === 'IN_PROGRESS') return ['Desplegando', 'amber'];
  if (service.rolloutState === 'FAILED') return ['Fallido', 'red'];
  if (service.running < service.desired) return ['Degradado', 'orange'];
  if (service.desired === 0) return ['A cero', 'gray'];
  return ['Estable', 'green'];
}

// --- Favoritos ---

function favEq(a, b) {
  return a.profile === b.profile && a.region === b.region &&
    a.cluster === b.cluster && (a.service || null) === (b.service || null);
}

function isFav(cluster, service = null) {
  const target = { ...ctx(), cluster, service };
  return favorites.some((f) => favEq(f, target));
}

function toggleFav(cluster, service = null) {
  const target = { ...ctx(), cluster, service: service || null };
  const i = favorites.findIndex((f) => favEq(f, target));
  if (i >= 0) favorites.splice(i, 1);
  else favorites.push(target);
  persistSettings();
  renderAll();
}

function currentFavs() {
  const c = ctx();
  return favorites.filter((f) => f.profile === c.profile && f.region === c.region);
}

function inFavScope(cluster, service) {
  return currentFavs().some((f) => f.cluster === cluster && (!f.service || f.service === service));
}

function starBtn(cluster, service = null) {
  const active = isFav(cluster, service);
  const btn = el('button', `star${active ? ' active' : ''}`, active ? '★' : '☆');
  btn.title = active ? 'Quitar de favoritos' : 'Añadir a favoritos';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleFav(cluster, service);
  });
  return btn;
}

// --- Diff de tareas (creadas / destruidas) ---

function maybeNotify(title, body, cluster, service) {
  if (settings.notify === false) return;
  if (!currentFavs().length || !inFavScope(cluster, service)) return;
  new Notification(title, { body });
}

function diffState(newState) {
  const { profile, region } = ctx();
  const key = `${profile}|${region}`;
  const current = new Map();
  for (const c of newState.clusters) {
    for (const t of c.tasks) current.set(t.arn, { ...t, cluster: c.name });
  }

  if (prevKey === key && prevTasks) {
    for (const [arn, t] of current) {
      if (!prevTasks.has(arn) && t.lastStatus !== 'STOPPED') {
        events.unshift({
          time: Date.now(), kind: 'created',
          cluster: t.cluster, service: t.serviceName, id: t.id, detail: t.taskDef,
        });
        recentNew.set(arn, Date.now());
        maybeNotify('Nueva tarea ECS', `${t.cluster} / ${t.serviceName || t.group}: ${t.id} (${t.taskDef || ''})`, t.cluster, t.serviceName);
      }
    }
    for (const [arn, t] of prevTasks) {
      if (t.lastStatus === 'STOPPED') continue;
      const now = current.get(arn);
      if (!now || now.lastStatus === 'STOPPED') {
        const reason = now?.stoppedReason || null;
        events.unshift({
          time: Date.now(), kind: 'destroyed',
          cluster: t.cluster, service: t.serviceName, id: t.id,
          detail: reason || t.taskDef,
        });
        maybeNotify('Tarea ECS destruida', `${t.cluster} / ${t.serviceName || t.group}: ${t.id}${reason ? ` — ${reason}` : ''}`, t.cluster, t.serviceName);
      }
    }
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  }

  prevTasks = current;
  prevKey = key;
  const cutoff = Date.now() - NEW_BADGE_MS;
  for (const [arn, ts] of recentNew) if (ts < cutoff) recentNew.delete(arn);
}

function resetDiff() {
  prevTasks = null;
  prevKey = null;
  events = [];
  recentNew.clear();
}

// --- Renderizado de filas ---

function renderService(s, cluster, { noStar = false } = {}) {
  const row = el('div', 'row');
  const [label, color] = rolloutBadge(s);
  row.append(el('span', `dot ${color}`));
  const name = el('span', 'name', s.name);
  name.append(el('span', 'sub', s.taskDef || ''));
  row.append(name);
  row.append(el('span', 'counts', `${s.running}/${s.desired}${s.pending ? ` (+${s.pending} pend.)` : ''}`));
  row.append(el('span', `badge ${color}`, label));
  if (!noStar) row.append(starBtn(cluster, s.name));
  return row;
}

function renderTask(t) {
  const row = el('div', 'row');
  const cat = categorize(t);
  const color = cat === 'stopped' ? 'gray' : CATEGORY_META[cat]?.color || 'gray';
  row.append(el('span', `dot ${color}`));
  const name = el('span', 'name', `${t.id} · ${t.taskDef || t.group || ''}`);
  const ts = t.startedAt || t.createdAt;
  if (ts) name.append(el('span', 'sub', `inicio ${new Date(ts).toLocaleTimeString()}`));
  row.append(name);
  if (recentNew.has(t.arn)) row.append(el('span', 'badge new', 'nueva'));
  if (t.health && t.health !== 'UNKNOWN') {
    row.append(el('span', `badge ${t.health === 'HEALTHY' ? 'green' : 'red'}`, t.health.toLowerCase()));
  }
  row.append(el('span', 'badge gray', t.lastStatus.toLowerCase()));
  return row;
}

function renderInstance(i) {
  const row = el('div', 'row');
  const color = !i.agentConnected ? 'red' : i.status === 'ACTIVE' ? 'green' : i.status === 'DRAINING' ? 'orange' : 'gray';
  row.append(el('span', `dot ${color}`));
  const name = el('span', 'name', `${i.ec2InstanceId}${i.instanceType ? ` · ${i.instanceType}` : ''}`);
  if (i.memRegistered) {
    const usedMem = i.memRegistered - (i.memRemaining ?? 0);
    name.append(el('span', 'sub', `mem ${usedMem}/${i.memRegistered} MiB · cpu ${i.cpuRegistered - (i.cpuRemaining ?? 0)}/${i.cpuRegistered}`));
  }
  row.append(name);
  row.append(el('span', 'counts', `${i.runningTasks} tareas${i.pendingTasks ? ` (+${i.pendingTasks})` : ''}`));
  row.append(el('span', `badge ${color}`, i.agentConnected ? i.status.toLowerCase() : 'sin agente'));
  return row;
}

function renderTaskGroups(card, tasks, { stoppedLimit = 20 } = {}) {
  const groups = { deploying: [], running: [], stopping: [], stopped: [] };
  tasks.forEach((t) => groups[categorize(t)].push(t));

  for (const key of ['deploying', 'stopping', 'running']) {
    if (!groups[key].length) continue;
    card.append(el('div', 'section-title', `Tareas — ${CATEGORY_META[key].label} (${groups[key].length})`));
    groups[key]
      .sort((a, b) => (a.serviceName || '').localeCompare(b.serviceName || ''))
      .forEach((t) => card.append(renderTask(t)));
  }

  if (groups.stopped.length) {
    const details = el('details', 'stopped');
    details.append(el('summary', null, `Detenidas recientemente (${groups.stopped.length})`));
    groups.stopped
      .sort((a, b) => new Date(b.stoppedAt || 0) - new Date(a.stoppedAt || 0))
      .slice(0, stoppedLimit)
      .forEach((t) => {
        details.append(renderTask(t));
        if (t.stoppedReason) details.append(el('div', 'stopped-reason', t.stoppedReason));
      });
    card.append(details);
  }
}

function clusterMeta(cluster) {
  return `${cluster.runningTasks} activas · ${cluster.pendingTasks} pend. · ${cluster.activeServices} serv.`;
}

function renderClusterBody(card, cluster, { serviceFilter = null } = {}) {
  if (cluster.instances.length) {
    card.append(el('div', 'section-title', `Máquinas (${cluster.instances.length})`));
    cluster.instances.forEach((i) => card.append(renderInstance(i)));
  }
  const services = serviceFilter
    ? cluster.services.filter((s) => s.name.toLowerCase().includes(serviceFilter))
    : cluster.services;
  if (services.length) {
    card.append(el('div', 'section-title', `Servicios (${services.length})`));
    services.forEach((s) => card.append(renderService(s, cluster.name)));
  }
  renderTaskGroups(card, cluster.tasks);
}

// --- Pestaña Clusters ---

function renderClustersTab() {
  const root = $('#clusters-list');
  root.innerHTML = '';
  if (lastError) {
    root.append(el('p', 'error', `Error: ${lastError}`));
    return;
  }
  if (!state) {
    root.append(el('p', 'empty', 'Cargando estado…'));
    return;
  }
  if (!state.clusters.length) {
    root.append(el('p', 'empty', 'No hay clusters en esta región.'));
    return;
  }

  const filter = $('#filter').value.trim().toLowerCase();

  for (const cluster of state.clusters) {
    const clusterMatches = !filter || cluster.name.toLowerCase().includes(filter);
    const serviceMatches = filter && cluster.services.some((s) => s.name.toLowerCase().includes(filter));
    if (filter && !clusterMatches && !serviceMatches) continue;

    const det = el('details', 'cluster');
    if (openClusters.has(cluster.name) || (filter && serviceMatches && !clusterMatches)) det.open = true;
    det.addEventListener('toggle', () => {
      if (det.open) openClusters.add(cluster.name);
      else openClusters.delete(cluster.name);
    });

    const sum = el('summary', 'cluster-header');
    sum.append(el('span', 'name', cluster.name));
    sum.append(el('span', 'meta', clusterMeta(cluster)));
    sum.append(starBtn(cluster.name));
    det.append(sum);

    renderClusterBody(det, cluster, {
      serviceFilter: filter && !clusterMatches ? filter : null,
    });
    root.append(det);
  }

  if (!root.children.length) root.append(el('p', 'empty', 'Nada coincide con el filtro.'));
}

// --- Pestaña Favoritos ---

function renderFavoritesTab() {
  const root = $('#tab-favorites');
  root.innerHTML = '';

  if (lastError) root.append(el('p', 'error', `Error: ${lastError}`));

  const favs = currentFavs();
  if (!favs.length) {
    root.append(el('p', 'empty', 'Sin favoritos en este perfil/región.\nPulsa ☆ en un cluster o servicio de la pestaña Clusters para fijarlo aquí.'));
    return;
  }

  for (const f of favs) {
    const card = el('div', 'cluster fav');
    const header = el('div', 'cluster-header');
    header.append(el('span', 'name', f.service ? `${f.cluster} / ${f.service}` : f.cluster));
    const cluster = state?.clusters.find((c) => c.name === f.cluster);
    if (cluster && !f.service) header.append(el('span', 'meta', clusterMeta(cluster)));
    header.append(starBtn(f.cluster, f.service));
    card.append(header);

    if (!cluster) {
      card.append(el('p', 'empty small', state ? 'Cluster no encontrado en esta región.' : 'Cargando…'));
      root.append(card);
      continue;
    }

    if (f.service) {
      const svc = cluster.services.find((s) => s.name === f.service);
      if (svc) card.append(renderService(svc, f.cluster, { noStar: true }));
      else card.append(el('p', 'empty small', 'Servicio no encontrado.'));
      renderTaskGroups(card, cluster.tasks.filter((t) => t.serviceName === f.service), { stoppedLimit: 8 });
    } else {
      renderClusterBody(card, cluster);
    }
    root.append(card);
  }

  // Feed de actividad: tareas creadas/destruidas dentro del ámbito de favoritos
  const evs = events.filter((e) => inFavScope(e.cluster, e.service));
  const section = el('div', 'activity');
  section.append(el('div', 'section-title', 'Actividad — tareas creadas y destruidas'));
  const box = el('div', 'activity-box');
  if (!evs.length) {
    box.append(el('p', 'empty small', 'Sin cambios detectados todavía. Se comparan los refrescos entre sí.'));
  } else {
    evs.slice(0, 40).forEach((e) => {
      const row = el('div', 'row event');
      row.append(el('span', `dot ${e.kind === 'created' ? 'green' : 'red'}`));
      const name = el('span', 'name', `${e.kind === 'created' ? 'Creada' : 'Destruida'} ${e.id} · ${e.service || '—'}`);
      name.append(el('span', 'sub', `${e.cluster}${e.detail ? ` · ${e.detail}` : ''}`));
      row.append(name);
      row.append(el('span', 'counts', new Date(e.time).toLocaleTimeString()));
      box.append(row);
    });
  }
  section.append(box);
  root.append(section);
}

// --- Pestañas / render global ---

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-favorites').classList.toggle('hidden', tab !== 'favorites');
  $('#tab-clusters').classList.toggle('hidden', tab !== 'clusters');
  settings.activeTab = tab;
  persistSettings();
}

function renderAll() {
  renderClustersTab();
  renderFavoritesTab();
  updateTray();
}

function updateTray() {
  if (!state) {
    window.api.setTrayTitle(lastError ? '!' : '');
    return;
  }
  const favs = currentFavs();
  const scopeAll = !favs.length;
  let n = 0;
  for (const c of state.clusters) {
    for (const s of c.services) {
      if (s.rolloutState === 'IN_PROGRESS' && (scopeAll || inFavScope(c.name, s.name))) n++;
    }
    for (const t of c.tasks) {
      const cat = categorize(t);
      if ((cat === 'deploying' || cat === 'stopping') && (scopeAll || inFavScope(c.name, t.serviceName))) n++;
    }
  }
  window.api.setTrayTitle(n ? `⟳${n}` : '');
}

// --- Refresco ---

async function refresh() {
  if (fetching) return;
  const { profile, region } = ctx();
  if (!profile || !region) return;

  fetching = true;
  $('#spinner').classList.remove('hidden');
  try {
    const result = await window.api.fetchState({ profile, region });
    if (result.error) {
      lastError = result.error;
    } else {
      lastError = null;
      diffState(result);
      state = result;
      $('#last-updated').textContent = `${new Date().toLocaleTimeString()} · ${region}`;
    }
    renderAll();
  } finally {
    fetching = false;
    $('#spinner').classList.add('hidden');
  }
}

function scheduleRefresh() {
  if (timer) clearInterval(timer);
  const ms = Number($('#interval').value);
  if (ms > 0) timer = setInterval(refresh, ms);
}

async function persistSettings() {
  settings = {
    ...settings,
    profile: $('#profile').value,
    region: $('#region').value,
    interval: $('#interval').value,
    favorites,
  };
  await window.api.saveSettings(settings);
}

function updateNotifyBtn() {
  const on = settings.notify !== false;
  $('#notify').textContent = on ? '🔔' : '🔕';
  $('#notify').classList.toggle('off', !on);
}

// --- Init ---

async function init() {
  const [loaded, profileList] = await Promise.all([
    window.api.loadSettings(),
    window.api.listProfiles(),
  ]);
  settings = loaded || {};
  profiles = profileList;
  favorites = Array.isArray(settings.favorites) ? settings.favorites : [];

  const profileSel = $('#profile');
  profiles.forEach((p) => {
    const opt = el('option', null, p.name);
    opt.value = p.name;
    profileSel.append(opt);
  });
  if (settings.profile && profiles.some((p) => p.name === settings.profile)) {
    profileSel.value = settings.profile;
  }

  const regionSel = $('#region');
  REGIONS.forEach((r) => {
    const opt = el('option', null, r);
    opt.value = r;
    regionSel.append(opt);
  });
  const profileRegion = profiles.find((p) => p.name === profileSel.value)?.region;
  regionSel.value = settings.region || profileRegion || 'eu-west-1';
  if (settings.interval != null) $('#interval').value = settings.interval;
  updateNotifyBtn();

  profileSel.addEventListener('change', () => {
    const pr = profiles.find((p) => p.name === profileSel.value)?.region;
    if (pr) regionSel.value = pr;
    resetDiff();
    state = null;
    persistSettings();
    renderAll();
    refresh();
  });
  regionSel.addEventListener('change', () => {
    resetDiff();
    state = null;
    persistSettings();
    renderAll();
    refresh();
  });
  $('#interval').addEventListener('change', () => { persistSettings(); scheduleRefresh(); });
  $('#refresh').addEventListener('click', refresh);
  $('#notify').addEventListener('click', () => {
    settings.notify = settings.notify === false;
    updateNotifyBtn();
    persistSettings();
  });
  $('#quit').addEventListener('click', () => window.api.quit());
  $('#filter').addEventListener('input', renderClustersTab);
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.api.hideWindow();
  });
  window.api.onShown(refresh);

  window.api.getVersion().then((v) => { $('#version').textContent = `v${v}`; });

  setTab(settings.activeTab || (favorites.length ? 'favorites' : 'clusters'));
  scheduleRefresh();
  refresh();
}

init();
