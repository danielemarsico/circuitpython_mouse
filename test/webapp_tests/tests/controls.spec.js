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

test.describe('Controls Tab', () => {

  test.beforeEach(async ({ page }) => {
    await setupAndConnect(page);
  });

  // --- Auto-movement ---
  test('START sends START\\n', async ({ page }) => {
    await page.click('[data-cmd="START"]');
    const cmds = await getCommands(page);
    expect(cmds).toContain('START\n');
  });

  test('STOP sends STOP\\n', async ({ page }) => {
    await page.click('[data-cmd="STOP"]');
    const cmds = await getCommands(page);
    expect(cmds).toContain('STOP\n');
  });

  test('TOGGLE sends TOGGLE\\n', async ({ page }) => {
    await page.click('[data-cmd="TOGGLE"]');
    const cmds = await getCommands(page);
    expect(cmds).toContain('TOGGLE\n');
  });

  // --- Move ---
  test('directional up arrow sends MOVE 0 -50', async ({ page }) => {
    await page.click('[data-move="0,-50"]');
    const cmds = await getCommands(page);
    expect(cmds).toContain('MOVE 0 -50\n');
  });

  test('directional right arrow sends MOVE 50 0', async ({ page }) => {
    await page.click('[data-move="50,0"]');
    const cmds = await getCommands(page);
    expect(cmds).toContain('MOVE 50 0\n');
  });

  test('custom move sends MOVE with input values', async ({ page }) => {
    await page.fill('#move-x', '10');
    await page.fill('#move-y', '20');
    await page.click('#btn-move');
    const cmds = await getCommands(page);
    expect(cmds).toContain('MOVE 10 20\n');
  });

  // --- Click ---
  test('CLICK LEFT sends CLICK LEFT\\n', async ({ page }) => {
    await page.click('[data-cmd="CLICK LEFT"]');
    const cmds = await getCommands(page);
    expect(cmds).toContain('CLICK LEFT\n');
  });

  test('CLICK RIGHT sends CLICK RIGHT\\n', async ({ page }) => {
    await page.click('[data-cmd="CLICK RIGHT"]');
    const cmds = await getCommands(page);
    expect(cmds).toContain('CLICK RIGHT\n');
  });

  test('CLICK MIDDLE sends CLICK MIDDLE\\n', async ({ page }) => {
    await page.click('[data-cmd="CLICK MIDDLE"]');
    const cmds = await getCommands(page);
    expect(cmds).toContain('CLICK MIDDLE\n');
  });

  // --- Scroll ---
  test('scroll up sends SCROLL with positive value', async ({ page }) => {
    await page.fill('#scroll-amount', '5');
    await page.click('#btn-scroll-up');
    const cmds = await getCommands(page);
    expect(cmds).toContain('SCROLL 5\n');
  });

  test('scroll down sends SCROLL with negative value', async ({ page }) => {
    await page.fill('#scroll-amount', '3');
    await page.click('#btn-scroll-down');
    const cmds = await getCommands(page);
    expect(cmds).toContain('SCROLL -3\n');
  });

  // --- Type Text ---
  test('TYPE sends text preserving original case', async ({ page }) => {
    await page.fill('#type-text', 'Hello World');
    await page.click('#btn-type');
    const cmds = await getCommands(page);
    expect(cmds).toContain('TYPE Hello World\n');
    // input clears after send
    await expect(page.locator('#type-text')).toHaveValue('');
  });

  test('Enter key sends KEY ENTER\\n', async ({ page }) => {
    await page.click('#btn-enter');
    const cmds = await getCommands(page);
    expect(cmds).toContain('KEY ENTER\n');
  });

  // --- Custom Command ---
  test('custom command sends trimmed text', async ({ page }) => {
    await page.fill('#custom-cmd', '  move 5 -5  ');
    await page.click('#btn-custom');
    const cmds = await getCommands(page);
    expect(cmds).toContain('MOVE 5 -5\n');
    await expect(page.locator('#custom-cmd')).toHaveValue('');
  });

});
