const { test, expect } = require('../fixtures');

const MOCK_PATH  = require('path').resolve(__dirname, '../mocks/bluetooth-mock.js');
const WORKER_URL = 'https://dudu.officinegenerative.com/v1/utterance';

// Chromium's fake microphone, so the real MediaRecorder → WAV path runs.
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});

async function open(page, { connect = true } = {}) {
  await page.addInitScript({ path: MOCK_PATH });
  await page.goto('/');
  await page.waitForSelector('#btn-connect');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#btn-connect');
  await page.evaluate(() => { window.voicePacing.msPerChunk = 0; window.voicePacing.msPerChar = 0; });
  if (connect) {
    await page.click('#btn-connect');
    await page.waitForSelector('#status-dot.connected');
  }
}

async function getCommands(page) {
  return page.evaluate(() => window.__bluetoothMock.commands);
}

// Routes the worker; returns the list of captured requests.
async function mockWorker(page, { status = 200, body = { protocol: 1, text: 'ciao mondo' }, headers = {} } = {}) {
  const requests = [];
  await page.route(WORKER_URL, async route => {
    const req = route.request();
    requests.push({ method: req.method(), headers: req.headers(), body: req.postDataBuffer() });
    await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  return requests;
}

// Tap to start, wait, tap to stop.
async function dictate(page) {
  await page.click('[data-tab="voice"]');
  await page.click('#btn-mic');
  await page.waitForSelector('#btn-mic.recording');
  await page.waitForTimeout(700);
  await page.click('#btn-mic');
  await page.waitForSelector('#btn-mic:not(.recording):not(.busy)');
}

test.describe('Voice — text pipeline', () => {
  test.beforeEach(async ({ page }) => { await open(page, { connect: false }); });

  test('chunkForType keeps every TYPE line within 60 bytes and loses no spaces', async ({ page }) => {
    const text = 'questa è una frase abbastanza lunga da dover essere spezzata in più comandi TYPE diversi';
    const chunks = await page.evaluate(t => window.chunkForType(t), text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(new TextEncoder().encode('TYPE ' + c + '\n').length).toBeLessThanOrEqual(60);
    }
    expect(chunks.join('')).toBe(text);
    chunks.slice(1).forEach(c => expect(c.startsWith(' ')).toBe(true));
  });

  test('chunkForType hard-splits a word longer than the limit', async ({ page }) => {
    const word = 'x'.repeat(130);
    const chunks = await page.evaluate(t => window.chunkForType(t), word);
    expect(chunks.join('')).toBe(word);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(54));
  });

  test('sanitizeForLayout strips accents for US, keeps them for IT', async ({ page }) => {
    const out = await page.evaluate(() => {
      const it = 'àèéìòùç£€';
      return {
        us: window.sanitizeForLayout('perché è così', null),
        it: window.sanitizeForLayout('perché è così È', it + 'abcdefghijklmnopqrstuvwxyzE '),
      };
    });
    expect(out.us).toBe('perche e cosi');
    expect(out.it).toBe('perché è così E');
  });

  test('sanitizeForLayout maps typographic marks and drops the untypable', async ({ page }) => {
    const out = await page.evaluate(() => window.sanitizeForLayout('“Ciao” – l’ok… 😀', null));
    expect(out).toBe('"Ciao" - l\'ok... ');
  });

  test('buildTypeCommands turns line breaks into KEY ENTER and adds a trailing space', async ({ page }) => {
    const cmds = await page.evaluate(() => window.buildTypeCommands('Ciao,\ncome stai?', { trailingSpace: true }));
    expect(cmds).toEqual(['TYPE Ciao,', 'KEY ENTER', 'TYPE come stai?', 'KEY SPACE']);
  });

  test('encodeWav writes a 16 kHz mono 16-bit header', async ({ page }) => {
    const hdr = await page.evaluate(async () => {
      const b = await window.encodeWav(new Float32Array(160), 16000).arrayBuffer();
      const v = new DataView(b);
      return { size: b.byteLength, ch: v.getUint16(22, true), rate: v.getUint32(24, true), bits: v.getUint16(34, true) };
    });
    expect(hdr).toEqual({ size: 44 + 320, ch: 1, rate: 16000, bits: 16 });
  });
});

test.describe('Voice tab', () => {

  test('Type it and Enter are disabled until connected', async ({ page }) => {
    await open(page, { connect: false });
    await expect(page.locator('#btn-voice-type')).toBeDisabled();
    await expect(page.locator('#btn-voice-enter')).toBeDisabled();
    await page.click('#btn-connect');
    await page.waitForSelector('#status-dot.connected');
    await expect(page.locator('#btn-voice-type')).toBeEnabled();
  });

  test('dictation posts a WAV in transcribe mode and shows the transcript', async ({ page }) => {
    await open(page);
    const requests = await mockWorker(page);
    await page.click('[data-tab="settings"]');
    await page.fill('#voice-key', 'secret-key');
    await page.click('#btn-save-settings');
    await page.click('[data-tab="voice"]');
    await page.click('#voice-lang [data-lang="it"]');
    await dictate(page);

    await expect(page.locator('#voice-text')).toHaveValue('ciao mondo');
    expect(requests).toHaveLength(1);
    const { headers, body } = requests[0];
    expect(headers['authorization']).toBe('Bearer secret-key');
    expect(headers['content-type']).toBe('audio/wav');
    expect(headers['x-tembed-locale']).toBe('it-IT');
    expect(headers['x-tembed-device-id']).toBe('ble-mouse-web');
    expect(headers['x-tembed-protocol']).toBeUndefined();
    expect(headers['x-tembed-mode']).toBeUndefined();
    expect(body.subarray(0, 4).toString()).toBe('RIFF');
    expect(body.readUInt32LE(24)).toBe(16000);
    expect(body.readUInt16LE(22)).toBe(1);
  });

  test('Type it sends the transcript as TYPE commands', async ({ page }) => {
    await open(page);
    await page.click('[data-tab="voice"]');
    await page.fill('#voice-text', 'hello world');
    await page.click('#btn-voice-type');
    await expect(page.locator('#voice-status')).toHaveText('typed');
    expect(await getCommands(page)).toContain('TYPE hello world\n');
  });

  test('auto-type types the transcript as soon as it arrives', async ({ page }) => {
    await open(page);
    await mockWorker(page, { body: { protocol: 1, text: 'Ciao,\nci vediamo' } });
    await page.click('[data-tab="voice"]');
    await page.check('#voice-autotype');
    await dictate(page);
    await expect(page.locator('#voice-status')).toHaveText('typed');
    const cmds = await getCommands(page);
    const i = cmds.indexOf('TYPE Ciao,\n');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(cmds.slice(i, i + 3)).toEqual(['TYPE Ciao,\n', 'KEY ENTER\n', 'TYPE ci vediamo\n']);
  });

  test('agent cleanup sends X-Tembed-Mode and offers the raw transcript', async ({ page }) => {
    await open(page);
    const requests = await mockWorker(page, { body: { protocol: 1, text: 'Ciao, come stai?', raw: 'ciao virgola come stai' } });
    await page.click('[data-tab="settings"]');
    await page.check('#voice-cleanup');
    await page.click('#btn-save-settings');
    await dictate(page);
    expect(requests[0].headers['x-tembed-mode']).toBe('dictation');
    await expect(page.locator('#voice-text')).toHaveValue('Ciao, come stai?');
    await page.click('#btn-voice-raw');
    await expect(page.locator('#voice-text')).toHaveValue('ciao virgola come stai');
    await expect(page.locator('#btn-voice-raw')).toBeHidden();
  });

  test('a rejected key is reported', async ({ page }) => {
    await open(page);
    await mockWorker(page, { status: 401, body: { error: { code: 'unauthorized', message: 'nope' } } });
    await dictate(page);
    await expect(page.locator('#voice-status')).toHaveText('Key rejected');
    await expect(page.locator('#voice-status')).toHaveClass(/error/);
  });

  test('the quota error shows the server message and retry time', async ({ page }) => {
    await open(page);
    await mockWorker(page, { status: 429, headers: { 'Retry-After': '600', 'Access-Control-Expose-Headers': 'Retry-After' },
      body: { error: { code: 'quota_exceeded', message: 'Daily limit reached' } } });
    await dictate(page);
    await expect(page.locator('#voice-status')).toHaveText('Daily limit reached (retry in 10 min)');
  });

  test('an empty transcript says nothing was heard', async ({ page }) => {
    await open(page);
    await mockWorker(page, { body: { protocol: 1, text: '' } });
    await dictate(page);
    await expect(page.locator('#voice-status')).toHaveText("Didn't catch that");
  });

  test('typing while disconnected keeps the text', async ({ page }) => {
    await open(page);
    await page.click('[data-tab="voice"]');
    await page.fill('#voice-text', 'keep me');
    await page.evaluate(() => window.__bluetoothMock.disconnectSimulated());
    await page.evaluate(() => document.getElementById('btn-voice-type').disabled = false);
    await page.click('#btn-voice-type');
    await expect(page.locator('#voice-status')).toHaveText('Not connected: the text is kept here');
    await expect(page.locator('#voice-text')).toHaveValue('keep me');
  });

  test('Clear empties the transcript', async ({ page }) => {
    await open(page);
    await page.click('[data-tab="voice"]');
    await page.fill('#voice-text', 'something');
    await page.click('#btn-voice-clear');
    await expect(page.locator('#voice-text')).toHaveValue('');
  });

  test('speech settings persist across reloads', async ({ page }) => {
    await open(page, { connect: false });
    await page.click('[data-tab="settings"]');
    await page.fill('#voice-url', 'https://example.test/v1/utterance');
    await page.fill('#voice-key', 'k1');
    await page.check('#voice-trailing-space');
    await page.click('#btn-save-settings');
    await page.click('[data-tab="voice"]');
    await page.click('#voice-lang [data-lang="en"]');
    await page.check('#voice-autotype');
    await page.reload();
    await expect(page.locator('#voice-url')).toHaveValue('https://example.test/v1/utterance');
    await expect(page.locator('#voice-key')).toHaveValue('k1');
    await expect(page.locator('#voice-trailing-space')).toBeChecked();
    await expect(page.locator('#voice-autotype')).toBeChecked();
    await expect(page.locator('#voice-lang [data-lang="en"]')).toHaveClass(/active/);
  });

  test('Test connection reports the worker name, or a rejected key', async ({ page }) => {
    await open(page, { connect: false });
    let status = 200;
    await page.route(WORKER_URL, route => route.fulfill({
      status, contentType: 'application/json',
      body: JSON.stringify(status === 200 ? { protocol: 1, name: 'dudu', tts: false } : { error: { code: 'x', message: 'x' } }),
    }));
    await page.click('[data-tab="settings"]');
    await page.click('#btn-voice-test');
    await expect(page.locator('#voice-test-msg')).toHaveText('OK: dudu (protocol 1)');
    status = 401;
    await page.click('#btn-voice-test');
    await expect(page.locator('#voice-test-msg')).toHaveText('Key rejected');
  });

  test('a network failure suggests CORS or offline', async ({ page }) => {
    await open(page, { connect: false });
    await page.route(WORKER_URL, route => route.abort('failed'));
    await page.click('[data-tab="settings"]');
    await page.click('#btn-voice-test');
    await expect(page.locator('#voice-test-msg')).toContainText('CORS');
  });
});

test.describe('Keyboard layouts', () => {

  test('connect restores the saved layout and asks for the installed ones', async ({ page }) => {
    await open(page);
    const cmds = await getCommands(page);
    expect(cmds).toContain('LAYOUT EN\n');
    expect(cmds).toContain('LAYOUTS\n');
  });

  test('a LAYOUTS reply split across notifications rebuilds the dropdown', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      window.__bluetoothMock.sendDeviceResponse('Layouts: US,IT,D');
      window.__bluetoothMock.sendDeviceResponse('E\n');
    });
    const options = page.locator('#keyboard-layout option');
    await expect(options).toHaveCount(3);
    await expect(options).toHaveText(['English (US)', 'Italiano', 'Deutsch']);
    expect(await options.evaluateAll(o => o.map(x => x.value))).toEqual(['EN', 'IT', 'DE']);
  });

  test('dictated accents follow the selected layout', async ({ page }) => {
    await open(page);
    await page.waitForFunction(() => Object.keys(layoutCharsets).length > 0);
    await page.click('[data-tab="voice"]');
    await page.fill('#voice-text', 'è così');
    await page.click('#btn-voice-type');
    await expect(page.locator('#voice-status')).toHaveText('typed');
    await page.click('[data-tab="settings"]');
    await page.selectOption('#keyboard-layout', 'IT');
    await page.click('[data-tab="voice"]');
    await page.click('#btn-voice-type');
    await expect(page.locator('#voice-status')).toHaveText('typed');
    const cmds = await getCommands(page);
    expect(cmds).toContain('TYPE e cosi\n');
    expect(cmds).toContain('TYPE è così\n');
  });

  test('Layout test types the unfiltered probe string', async ({ page }) => {
    await open(page);
    await page.click('[data-tab="settings"]');
    await page.click('#btn-layout-test');
    await expect.poll(async () => (await getCommands(page)).some(c => c.startsWith('TYPE àèéìòù'))).toBe(true);
  });
});
