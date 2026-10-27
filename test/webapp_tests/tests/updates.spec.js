const path = require('path');
const zlib = require('zlib');
const { test, expect } = require('../fixtures');

const BLE_MOCK    = path.resolve(__dirname, '../mocks/bluetooth-mock.js');
const SERIAL_MOCK = path.resolve(__dirname, '../mocks/serial-mock.js');

// A small published firmware, routed instead of the real app/firmware/.
const FILES = {
  'boot.py': 'print("boot")\n',
  'code.py': 'VERSION = "2026.10.27"\n' + '# padding\n'.repeat(40),
  'lib/adafruit_hid/mouse.mpy': 'mouse-v2',
  'lib/keyboard_layout_win_it.mpy': 'layout-it',
};
const crcHex = s => zlib.crc32(Buffer.from(s)).toString(16).padStart(8, '0');
const MANIFEST = {
  version: '2026.10.27',
  files: Object.entries(FILES).map(([p, s]) => ({ path: p, size: Buffer.byteLength(s), crc32: crcHex(s) })),
};
const b64 = s => Buffer.from(s).toString('base64');

async function routeRelease(page, { version = 'v1', manifest = MANIFEST } = {}) {
  await page.route('**/version.json', route => (version
    ? route.fulfill({ json: { version, commit: 'abc', built: '2026-10-27T00:00:00Z' } })
    : route.fulfill({ status: 404, body: 'not found' })));
  await page.route('**/firmware/**', route => {
    const p = new URL(route.request().url()).pathname.split('/firmware/')[1];
    if (p === 'manifest.json') return manifest ? route.fulfill({ json: manifest }) : route.fulfill({ status: 404 });
    return FILES[p] !== undefined ? route.fulfill({ body: FILES[p] }) : route.fulfill({ status: 404 });
  });
}

async function setupPage(page, { serial = true, ...release } = {}) {
  await page.addInitScript({ path: BLE_MOCK });
  if (serial) await page.addInitScript({ path: SERIAL_MOCK });
  else await page.addInitScript(() => Object.defineProperty(navigator, 'serial', { value: undefined, configurable: true }));
  await routeRelease(page, release);
  await page.goto('/');
  await page.waitForSelector('#btn-connect');
}

async function connectMock(page) {
  await page.click('#btn-connect');
  await page.waitForSelector('#status-dot.connected');
}

const openSettings = page => page.click('.tab-btn[data-tab="settings"]');

test.describe('App version and update banner', () => {

  test('shows the deployed app version in Settings', async ({ page }) => {
    await setupPage(page, { version: '2026.10.27-abc1234' });
    await openSettings(page);
    await expect(page.locator('#app-version')).toHaveText('2026.10.27-abc1234');
  });

  test('a checkout without version.json shows dev', async ({ page }) => {
    await setupPage(page, { version: null });
    await expect(page.locator('#app-version')).toHaveText('dev');
  });

  test('coming back to the foreground with a new version shows the banner', async ({ page }) => {
    await setupPage(page, { version: 'v1' });
    await expect(page.locator('#app-version')).toHaveText('v1');
    await expect(page.locator('#update-banner')).toBeHidden();

    await page.unroute('**/version.json');
    await page.route('**/version.json', route => route.fulfill({ json: { version: 'v2' } }));
    await page.evaluate(() => { updateCheck.minIntervalMs = 0; });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('#update-banner')).toBeVisible();
    await expect(page.locator('#btn-update-reload')).toHaveText('Reload');
  });

  test('no banner when the version is unchanged', async ({ page }) => {
    await setupPage(page, { version: 'v1' });
    await expect(page.locator('#app-version')).toHaveText('v1');
    await page.evaluate(async () => { updateCheck.minIntervalMs = 0; await checkForUpdate(); });
    await expect(page.locator('#update-banner')).toBeHidden();
  });

  test('checks are throttled to one per interval', async ({ page }) => {
    await setupPage(page, { version: 'v1' });
    await expect(page.locator('#app-version')).toHaveText('v1');
    let hits = 0;
    await page.unroute('**/version.json');
    await page.route('**/version.json', route => { hits++; route.fulfill({ json: { version: 'v2' } }); });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(200);
    expect(hits).toBe(0);
    await expect(page.locator('#update-banner')).toBeHidden();
  });

  test('the banner waits until a typing job is over', async ({ page }) => {
    await setupPage(page, { version: 'v1' });
    await expect(page.locator('#app-version')).toHaveText('v1');
    await page.unroute('**/version.json');
    await page.route('**/version.json', route => route.fulfill({ json: { version: 'v2' } }));
    await page.evaluate('typingJob = { cancelled: false }');
    await page.evaluate(async () => { updateCheck.minIntervalMs = 0; await checkForUpdate(); });
    await page.waitForTimeout(300);
    await expect(page.locator('#update-banner')).toBeHidden();
    await page.evaluate('typingJob = null');
    await expect(page.locator('#update-banner')).toBeVisible({ timeout: 4000 });
  });

  test('compareVersions orders release dates numerically', async ({ page }) => {
    await setupPage(page);
    const r = await page.evaluate(() => [
      compareVersions('2026.10.27', '2026.10.25'),
      compareVersions('2026.10.27', '2026.10.27'),
      compareVersions('2026.10.27', '2026.10.27.1'),
      compareVersions('2026.9.30', '2026.10.01'),
    ]);
    expect(r).toEqual([1, 0, -1, -1]);
  });

});

test.describe('Firmware version', () => {

  test('sends VERSION on connect', async ({ page }) => {
    await setupPage(page);
    await connectMock(page);
    await expect.poll(() => page.evaluate(() => window.__bluetoothMock.commands)).toContain('VERSION\n');
  });

  test('shows the latest published version', async ({ page }) => {
    await setupPage(page);
    await openSettings(page);
    await expect(page.locator('#fw-latest-version')).toHaveText('2026.10.27');
    await expect(page.locator('#fw-device-version')).toHaveText('connect to check');
  });

  test('an older dongle shows "Firmware update available"', async ({ page }) => {
    await setupPage(page);
    await connectMock(page);
    await page.evaluate(() => window.__bluetoothMock.sendDeviceResponse('Version: 2026.10.01\n'));
    await openSettings(page);
    await expect(page.locator('#fw-device-version')).toHaveText('2026.10.01');
    await expect(page.locator('#fw-available')).toBeVisible();
    expect(await page.textContent('#log')).toContain('firmware update available: 2026.10.27');
  });

  test('a current dongle shows no update', async ({ page }) => {
    await setupPage(page);
    await connectMock(page);
    await page.evaluate(() => window.__bluetoothMock.sendDeviceResponse('Version: 2026.10.27\n'));
    await openSettings(page);
    await expect(page.locator('#fw-device-version')).toHaveText('2026.10.27');
    await expect(page.locator('#fw-available')).toBeHidden();
  });

  test('firmware that never answers VERSION is shown as older than 1.4', async ({ page }) => {
    await setupPage(page);
    await connectMock(page);
    await openSettings(page);
    await expect(page.locator('#fw-device-version')).toHaveText('unknown (older than 1.4)', { timeout: 5000 });
    await expect(page.locator('#fw-available')).toBeVisible();
  });

  test('disconnecting clears the device version', async ({ page }) => {
    await setupPage(page);
    await connectMock(page);
    await page.evaluate(() => window.__bluetoothMock.sendDeviceResponse('Version: 2026.10.01\n'));
    await page.click('#btn-connect');
    await openSettings(page);
    await expect(page.locator('#fw-device-version')).toHaveText('connect to check');
    await expect(page.locator('#fw-available')).toBeHidden();
  });

  test('no published manifest: latest shows "not published"', async ({ page }) => {
    await setupPage(page, { manifest: null });
    await openSettings(page);
    await expect(page.locator('#fw-latest-version')).toHaveText('not published');
  });

});

test.describe('Firmware update over USB', () => {

  // On the device: an old code.py and mouse.mpy, the same boot.py, no IT layout.
  async function seedDevice(page, overrides = {}) {
    await page.evaluate(files => window.__serialMock.setFiles(files), {
      'boot.py': b64(FILES['boot.py']),
      'code.py': b64('VERSION = "2026.10.01"\n'),
      'lib/adafruit_hid/mouse.mpy': b64('mouse-v1'),
      'secret.txt': b64('hunter2'),
      ...overrides,
    });
  }

  test('without Web Serial the card shows the PC hint and no button', async ({ page }) => {
    await setupPage(page, { serial: false });
    await openSettings(page);
    await expect(page.locator('#fw-serial-hint')).toBeVisible();
    await expect(page.locator('#btn-fw-update')).toBeHidden();
  });

  test('sends only the changed files, code.py last, then resets', async ({ page }) => {
    await setupPage(page);
    await seedDevice(page);
    await openSettings(page);
    await page.click('#btn-fw-update');
    await expect(page.locator('#fw-status')).toHaveText('Updated to 2026.10.27. Reconnect over Bluetooth.', { timeout: 10000 });

    const mock = await page.evaluate(() => ({
      written: window.__serialMock.written(),
      paths: window.__serialMock.paths(),
      resets: window.__serialMock.resets,
      writable: window.__serialMock.writable,
      code: window.__serialMock.file('code.py'),
      bak: window.__serialMock.file('code.bak'),
      it: window.__serialMock.file('lib/keyboard_layout_win_it.mpy'),
      secret: window.__serialMock.file('secret.txt'),
    }));
    expect(mock.written).toEqual(['lib/adafruit_hid/mouse.mpy', 'lib/keyboard_layout_win_it.mpy', 'code.py']);
    expect(mock.code).toBe(FILES['code.py']);
    expect(mock.bak).toBe('VERSION = "2026.10.01"\n');
    expect(mock.it).toBe('layout-it');
    expect(mock.secret).toBe('hunter2');
    expect(mock.paths.some(p => p.endsWith('.new'))).toBe(false);
    expect(mock.resets).toBe(1);
    expect(mock.writable).toBe(false);

    await expect(page.locator('#fw-progress li.unchanged')).toHaveCount(1);
    await expect(page.locator('#fw-progress li.verified')).toHaveCount(3);
    await expect(page.locator('#btn-fw-retry')).toBeHidden();
  });

  test('a dongle that is already current is only reset', async ({ page }) => {
    await setupPage(page);
    await seedDevice(page, Object.fromEntries(Object.entries(FILES).map(([p, s]) => [p, b64(s)])));
    await openSettings(page);
    await page.click('#btn-fw-update');
    await expect(page.locator('#fw-status')).toHaveText('Already up to date (2026.10.27). Reconnect over Bluetooth.', { timeout: 10000 });
    expect(await page.evaluate(() => window.__serialMock.written())).toEqual([]);
    expect(await page.evaluate(() => window.__serialMock.resets)).toBe(1);
  });

  test('maintenance mode: explains that the drive is mounted', async ({ page }) => {
    await setupPage(page);
    await seedDevice(page);
    await page.evaluate(() => { window.__serialMock.driveMounted = true; });
    await openSettings(page);
    await page.click('#btn-fw-update');
    await expect(page.locator('#fw-status')).toContainText('The drive is mounted (maintenance mode)', { timeout: 10000 });
    await expect(page.locator('#fw-status')).toHaveClass(/error/);
    expect(await page.evaluate(() => window.__serialMock.written())).toEqual([]);
    expect(await page.evaluate(() => window.__serialMock.resets)).toBe(0);
  });

  test('a failed write cleans up, keeps the old code.py, and Retry finishes', async ({ page }) => {
    await setupPage(page);
    await seedDevice(page);
    await page.evaluate(() => { window.__serialMock.failWriteOn = 'code.py'; });
    await openSettings(page);
    await page.click('#btn-fw-update');
    await expect(page.locator('#fw-status')).toContainText('No space left on device', { timeout: 10000 });
    await expect(page.locator('#fw-progress li.failed')).toHaveText(/code\.py/);
    const after = await page.evaluate(() => ({
      paths: window.__serialMock.paths(),
      code: window.__serialMock.file('code.py'),
      resets: window.__serialMock.resets,
    }));
    expect(after.paths.some(p => p.endsWith('.new'))).toBe(false);
    expect(after.code).toBe('VERSION = "2026.10.01"\n');
    expect(after.resets).toBe(0);

    await expect(page.locator('#btn-fw-retry')).toBeVisible();
    await page.evaluate(() => { window.__serialMock.failWriteOn = null; });
    await page.click('#btn-fw-retry');
    await expect(page.locator('#fw-status')).toHaveText('Updated to 2026.10.27. Reconnect over Bluetooth.', { timeout: 10000 });
    expect(await page.evaluate(() => window.__serialMock.file('code.py'))).toBe(FILES['code.py']);
    expect(await page.evaluate(() => window.__serialMock.portRequests)).toBe(1);
  });

  test('a port with no REPL gives a clear error', async ({ page }) => {
    test.setTimeout(30000);
    await setupPage(page);
    await page.evaluate(() => { window.__serialMock.silent = true; });
    await openSettings(page);
    await page.click('#btn-fw-update');
    await expect(page.locator('#fw-status')).toContainText('No CircuitPython REPL answered', { timeout: 20000 });
  });

  test('a published file that does not match the manifest is never sent', async ({ page }) => {
    const bad = { ...MANIFEST, files: MANIFEST.files.map(f => f.path === 'code.py' ? { ...f, crc32: '00000000' } : f) };
    await setupPage(page, { manifest: bad });
    await seedDevice(page);
    await openSettings(page);
    await page.click('#btn-fw-update');
    await expect(page.locator('#fw-status')).toContainText('does not match the manifest', { timeout: 10000 });
    expect(await page.evaluate(() => window.__serialMock.written())).toEqual([]);
  });

});
