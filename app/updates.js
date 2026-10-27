// App and firmware updates (RULEBOOK §6–§7, PLAN.md Part 2).
// Loaded after app.js and voice.js; uses their globals (addLog, onDeviceLine,
// onConnectionChange, typingJob, recorder, busy).

// --- App version and update banner ---

// minIntervalMs: at most one check per 5 min when the app comes back to the
// foreground. Exposed for tests.
const updateCheck = { minIntervalMs: 5 * 60 * 1000 };

const updateBanner    = document.getElementById('update-banner');
const btnUpdateReload = document.getElementById('btn-update-reload');
const appVersionEl    = document.getElementById('app-version');

let loadedAppVersion = null;   // version.json when the page loaded, 'dev' without one
let swRegistration   = null;
let updateReady      = false;
let lastUpdateCheck  = 0;
let bannerTimer      = null;

async function fetchAppVersion() {
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    if (!res.ok) return res.status === 404 ? 'dev' : null;
    return (await res.json()).version || 'dev';
  } catch {
    return null;   // offline: unknown, not "changed"
  }
}

// Never offer a reload in the middle of a dictation or a typing job (§7.1).
function appBusy() {
  return !!(typingJob || recorder || busy);
}

function showUpdateBanner() {
  clearTimeout(bannerTimer);
  if (!updateReady) return;
  if (appBusy()) {
    bannerTimer = setTimeout(showUpdateBanner, 2000);
    return;
  }
  updateBanner.hidden = false;
}

async function checkForUpdate() {
  if (Date.now() - lastUpdateCheck < updateCheck.minIntervalMs) return;
  lastUpdateCheck = Date.now();
  swRegistration?.update().catch(() => {});
  const latest = await fetchAppVersion();
  if (latest && latest !== 'dev' && loadedAppVersion && loadedAppVersion !== 'dev' && latest !== loadedAppVersion) {
    updateReady = true;
  }
  if (swRegistration?.waiting) updateReady = true;
  showUpdateBanner();
}

// The service worker calls skipWaiting() + clients.claim(), so a reload is
// all it takes to run the new version.
btnUpdateReload.addEventListener('click', () => location.reload());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});

if ('serviceWorker' in navigator) {
  // A controller that changes after load means a new worker took over.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) { updateReady = true; showUpdateBanner(); }
  });
  navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
    .then(reg => { swRegistration = reg; })
    .catch(e => addLog('! service worker: ' + e.message, '#facc15'));
}

fetchAppVersion().then(v => {
  loadedAppVersion = v;
  appVersionEl.textContent = v ?? 'unknown (offline)';
  lastUpdateCheck = Date.now();
});

// --- Firmware version and manifest ---

const VERSION_TIMEOUT_MS = 3000;   // old firmware never answers VERSION

const fwDeviceVersionEl = document.getElementById('fw-device-version');
const fwLatestVersionEl = document.getElementById('fw-latest-version');
const fwAvailableEl     = document.getElementById('fw-available');

let deviceFirmware = null;     // 'YYYY.MM.DD[.n]', 'old' (no VERSION reply) or null
let firmwareManifest = null;
let versionTimer = null;

// Compares YYYY.MM.DD[.n] numerically, part by part.
function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

function firmwareUpdateAvailable() {
  if (!firmwareManifest || !deviceFirmware) return false;
  return deviceFirmware === 'old' || compareVersions(firmwareManifest.version, deviceFirmware) > 0;
}

function renderFirmware() {
  fwDeviceVersionEl.textContent = deviceFirmware === 'old' ? 'unknown (older than 1.4)'
                                : deviceFirmware ?? 'connect to check';
  fwLatestVersionEl.textContent = firmwareManifest?.version ?? 'not published';
  fwAvailableEl.hidden = !firmwareUpdateAvailable();
}

async function loadFirmwareManifest() {
  try {
    const res = await fetch('firmware/manifest.json', { cache: 'no-store' });
    if (res.ok) firmwareManifest = await res.json();
  } catch { /* offline or not published (local checkout) */ }
  renderFirmware();
  return firmwareManifest;
}

onDeviceLine(line => {
  if (!line.startsWith('Version:')) return;
  clearTimeout(versionTimer);
  deviceFirmware = line.slice(8).trim();
  renderFirmware();
  if (firmwareUpdateAvailable()) addLog('— firmware update available: ' + firmwareManifest.version, '#facc15');
});

onConnectionChange(connected => {
  clearTimeout(versionTimer);
  if (connected) {
    versionTimer = setTimeout(() => {
      deviceFirmware = 'old';
      renderFirmware();
    }, VERSION_TIMEOUT_MS);
  } else {
    deviceFirmware = null;
    renderFirmware();
  }
});

loadFirmwareManifest();

// --- Firmware update over USB (Web Serial, PLAN Part 2 §4) ---

const btnFwUpdate   = document.getElementById('btn-fw-update');
const btnFwRetry    = document.getElementById('btn-fw-retry');
const fwSerialHint  = document.getElementById('fw-serial-hint');
const fwProgress    = document.getElementById('fw-progress');
const fwStatus      = document.getElementById('fw-status');

let usbUpdater = null;   // the session kept open for Retry

function setFwStatus(text, kind = '') {
  fwStatus.textContent = text;
  fwStatus.className = kind;
}

// files: [{path, state}], state = unchanged | pending | writing | verified | failed
function renderFwProgress(files) {
  fwProgress.innerHTML = '';
  for (const f of files) {
    const li = document.createElement('li');
    li.className = f.state;
    const name = document.createElement('span');
    name.textContent = f.path;
    const state = document.createElement('span');
    state.textContent = f.state;
    li.append(name, state);
    fwProgress.appendChild(li);
  }
}

async function runUsbUpdate() {
  btnFwUpdate.disabled = true;
  btnFwRetry.hidden = true;
  try {
    const result = await usbUpdater.run();
    usbUpdater = null;
    setFwStatus(result.changed
      ? `Updated to ${result.version}. Reconnect over Bluetooth.`
      : `Already up to date (${result.version}). Reconnect over Bluetooth.`, 'ok');
    addLog('— firmware ' + result.version + ' installed over USB');
  } catch (e) {
    setFwStatus(e.message, 'error');
    addLog('! firmware update: ' + e.message, '#f87171');
    btnFwRetry.hidden = !usbUpdater?.portOpen;
  } finally {
    btnFwUpdate.disabled = false;
  }
}

if (navigator.serial) {
  btnFwUpdate.hidden = false;
  btnFwUpdate.addEventListener('click', async () => {
    let port;
    try {
      port = await navigator.serial.requestPort();
    } catch {
      return;   // picker dismissed
    }
    if (usbUpdater) await usbUpdater.close();
    setFwStatus('Loading the firmware…');
    const manifest = await loadFirmwareManifest();
    if (!manifest) { setFwStatus('No published firmware found (firmware/manifest.json).', 'error'); return; }
    // Loaded on demand, so the phone never downloads the updater.
    const { UsbUpdater } = await import('./updater.js');
    usbUpdater = new UsbUpdater(port, manifest, {
      onStatus: text => setFwStatus(text),
      onProgress: renderFwProgress,
    });
    await runUsbUpdate();
  });
  btnFwRetry.addEventListener('click', runUsbUpdate);
} else {
  fwSerialHint.hidden = false;
}

// For tests
Object.assign(window, { updateCheck, checkForUpdate, compareVersions });
