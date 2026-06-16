const { test, expect } = require('../fixtures');

const MOCK_PATH = require('path').resolve(__dirname, '../mocks/bluetooth-mock.js');

async function setupAndConnect(page) {
  await page.addInitScript({ path: MOCK_PATH });
  await page.goto('/');
  await page.waitForSelector('#btn-connect');
  await page.evaluate(() => localStorage.clear());
  await page.click('#btn-connect');
  await page.waitForSelector('#status-dot.connected');
}

async function getCommands(page) {
  return page.evaluate(() => window.__bluetoothMock.commands);
}

test.describe('Cipher and Settings', () => {

  test.beforeEach(async ({ page }) => {
    await setupAndConnect(page);
  });

  // --- Cipher tab ---
  test('cipher send encrypts text and logs [encrypted]', async ({ page }) => {
    await page.click('[data-tab="cipher"]');
    await page.waitForSelector('#panel-cipher:not(.hidden)');

    await page.fill('#cipher-text', 'secret message');
    await page.click('#btn-cipher');
    await page.waitForTimeout(200);

    const cmds = await getCommands(page);
    const cipherCmd = cmds.find(c => c.startsWith('CIPHER '));
    expect(cipherCmd).toBeDefined();
    // Must be valid base64
    const b64 = cipherCmd.replace('CIPHER ', '').replace('\n', '');
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // Log should hide the actual ciphertext
    const log = await page.textContent('#log');
    expect(log).toContain('[encrypted]');
  });

  test('cipher eye toggle switches password visibility', async ({ page }) => {
    await page.click('[data-tab="cipher"]');
    await page.waitForSelector('#panel-cipher:not(.hidden)');

    const input = page.locator('#cipher-text');
    await expect(input).toHaveAttribute('type', 'password');
    await page.click('#btn-eye-cipher');
    await expect(input).toHaveAttribute('type', 'text');
    await page.click('#btn-eye-cipher');
    await expect(input).toHaveAttribute('type', 'password');
  });

  // --- Settings tab ---
  test('keyboard layout save sends LAYOUT command', async ({ page }) => {
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#panel-settings:not(.hidden)');

    await page.selectOption('#keyboard-layout', 'IT');
    await page.click('#btn-save-settings');
    await page.waitForTimeout(200);

    const cmds = await getCommands(page);
    expect(cmds).toContain('LAYOUT IT\n');

    const stored = await page.evaluate(() => localStorage.getItem('keyboardLayout'));
    expect(stored).toBe('IT');
  });

  test('cipher key persistence in settings', async ({ page }) => {
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#panel-settings:not(.hidden)');

    await page.fill('#cipher-key', 'mysecretkey');
    await page.click('#btn-save-settings');
    await page.waitForTimeout(200);

    const stored = await page.evaluate(() => localStorage.getItem('cipherPassword'));
    expect(stored).toBe('mysecretkey');
  });

  test('settings saved message appears and disappears', async ({ page }) => {
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#panel-settings:not(.hidden)');

    await page.click('#btn-save-settings');
    const msg = page.locator('#settings-saved-msg');
    await expect(msg).toHaveCSS('visibility', 'visible');
    // After 2.5s it should hide
    await page.waitForTimeout(2500);
    await expect(msg).toHaveCSS('visibility', 'hidden');
  });

  test('settings key eye toggle switches visibility', async ({ page }) => {
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#panel-settings:not(.hidden)');

    const input = page.locator('#cipher-key');
    await expect(input).toHaveAttribute('type', 'password');
    await page.click('#btn-eye-key');
    await expect(input).toHaveAttribute('type', 'text');
    await page.click('#btn-eye-key');
    await expect(input).toHaveAttribute('type', 'password');
  });

});
