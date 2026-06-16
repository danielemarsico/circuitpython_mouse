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

// Helper: simulate pointer events on trackpad area
async function trackpadPointerDown(page) {
  await page.evaluate(() => {
    const el = document.getElementById('trackpad-area');
    el.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, clientX: 150, clientY: 100, bubbles: true,
    }));
  });
}

async function trackpadPointerUp(page) {
  await page.evaluate(() => {
    const el = document.getElementById('trackpad-area');
    el.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, clientX: 150, clientY: 100, bubbles: true,
    }));
  });
}

test.describe('Trackpad Tab', () => {

  test.beforeEach(async ({ page }) => {
    await setupAndConnect(page);
    // Switch to Trackpad tab
    await page.click('[data-tab="trackpad"]');
    await page.waitForSelector('#panel-trackpad:not(.hidden)');
  });

  test('draw mode toggle changes button text and class', async ({ page }) => {
    const btn = page.locator('#btn-draw-mode');
    await expect(btn).toHaveText('Draw Mode OFF');
    await expect(btn).toHaveClass(/btn-primary/);

    await btn.click();
    await expect(btn).toHaveText('Draw Mode ON');
    await expect(btn).toHaveClass(/btn-green/);

    await btn.click();
    await expect(btn).toHaveText('Draw Mode OFF');
    await expect(btn).toHaveClass(/btn-primary/);
  });

  test('right click button sends CLICK RIGHT', async ({ page }) => {
    await page.click('#btn-right-click');
    const cmds = await getCommands(page);
    expect(cmds).toContain('CLICK RIGHT\n');
  });

  test('tap on trackpad sends CLICK LEFT when draw mode is OFF', async ({ page }) => {
    await trackpadPointerDown(page);
    // Short delay to simulate tap (< 200ms)
    await page.waitForTimeout(50);
    await trackpadPointerUp(page);
    // Wait for async send
    await page.waitForTimeout(100);
    const cmds = await getCommands(page);
    expect(cmds).toContain('CLICK LEFT\n');
  });

  test('draw mode ON: pointerdown sends PRESS LEFT, pointerup sends RELEASE LEFT', async ({ page }) => {
    // Enable draw mode
    await page.click('#btn-draw-mode');

    await trackpadPointerDown(page);
    await page.waitForTimeout(100);
    let cmds = await getCommands(page);
    expect(cmds).toContain('PRESS LEFT\n');

    await trackpadPointerUp(page);
    await page.waitForTimeout(100);
    cmds = await getCommands(page);
    expect(cmds).toContain('RELEASE LEFT\n');
  });

  test('sensitivity slider updates value display', async ({ page }) => {
    await page.fill('#trackpad-sensitivity', '7');
    await page.evaluate(() => {
      document.getElementById('trackpad-sensitivity').dispatchEvent(new Event('input', { bubbles: true }));
    });
    const val = await page.textContent('#sensitivity-val');
    expect(val).toBe('7');
  });

  test('command buttons are disabled when not connected', async ({ page }) => {
    // Disconnect first
    await page.evaluate(() => {
      window.__bluetoothMock._gattServer.disconnect();
    });
    await page.waitForSelector('#status-dot:not(.connected)');
    await expect(page.locator('#btn-right-click')).toBeDisabled();
  });

});
