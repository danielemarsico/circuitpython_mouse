const { test, expect } = require('../fixtures');

const MOCK_PATH = require('path').resolve(__dirname, '../mocks/bluetooth-mock.js');

async function setupPage(page) {
  await page.addInitScript({ path: MOCK_PATH });
  await page.goto('/');
  await page.waitForSelector('#btn-connect');
}

async function connectMock(page) {
  await page.click('#btn-connect');
  await page.waitForSelector('#status-dot.connected');
}

test.describe('BLE Connection', () => {

  test.beforeEach(async ({ page }) => {
    await setupPage(page);
    await page.evaluate(() => localStorage.clear());
  });

  test('connects to mock device and shows connected status', async ({ page }) => {
    await page.click('#btn-connect');
    await page.waitForSelector('#status-dot.connected');
    const statusText = await page.textContent('#status-text');
    expect(statusText).toBe('Connected');
    expect(await page.textContent('#btn-connect')).toBe('Disconnect');
  });

  test('disconnects and returns to disconnected status', async ({ page }) => {
    await connectMock(page);
    await page.click('#btn-connect');
    await page.waitForSelector('#status-dot:not(.connected)');
    const statusText = await page.textContent('#status-text');
    expect(statusText).toBe('Disconnected');
    expect(await page.textContent('#btn-connect')).toBe('Connect');
  });

  test('command buttons are disabled when disconnected', async ({ page }) => {
    const btn = page.locator('#btn-move');
    await expect(btn).toBeDisabled();
  });

  test('command buttons are enabled after connection', async ({ page }) => {
    await connectMock(page);
    const btn = page.locator('#btn-move');
    await expect(btn).toBeEnabled();
  });

  test('log shows connection messages', async ({ page }) => {
    await connectMock(page);
    const logText = await page.textContent('#log');
    expect(logText).toContain('connected to Mock BLE Mouse');
  });

});
