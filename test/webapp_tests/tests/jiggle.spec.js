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

test.describe('Jiggle Settings and Path', () => {

  test.beforeEach(async ({ page }) => {
    await setupAndConnect(page);
    // Switch to Settings tab
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#panel-settings:not(.hidden)');
  });

  // --- Jiggle Speed & Range sliders ---
  test('speed slider updates live display', async ({ page }) => {
    await page.fill('#jiggle-speed', '5');
    await page.evaluate(() => {
      document.getElementById('jiggle-speed').dispatchEvent(new Event('input', { bubbles: true }));
    });
    const val = await page.textContent('#jiggle-speed-val');
    expect(val).toBe('5s');
  });

  test('range slider updates live display', async ({ page }) => {
    await page.fill('#jiggle-range', '10');
    await page.evaluate(() => {
      document.getElementById('jiggle-range').dispatchEvent(new Event('input', { bubbles: true }));
    });
    const val = await page.textContent('#jiggle-range-val');
    expect(val).toBe('10px');
  });

  test('slider values loaded from localStorage on page init', async ({ page }) => {
    // Set localStorage values, then reload page with fresh mock injection
    await page.evaluate(() => {
      localStorage.setItem('jiggleSpeed', '8');
      localStorage.setItem('jiggleRange', '25');
    });
    await page.addInitScript({ path: MOCK_PATH });
    await page.reload();
    await page.waitForSelector('#btn-connect');
    await page.click('#btn-connect');
    await page.waitForSelector('#status-dot.connected');
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#panel-settings:not(.hidden)');

    await expect(page.locator('#jiggle-speed-val')).toHaveText('8s');
    await expect(page.locator('#jiggle-range-val')).toHaveText('25px');
  });

  test('Save persists values and sends JIGGLE command', async ({ page }) => {
    await page.fill('#jiggle-speed', '3');
    await page.fill('#jiggle-range', '7');
    await page.evaluate(() => {
      document.getElementById('jiggle-speed').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('jiggle-range').dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.click('#btn-save-settings');
    await page.waitForTimeout(200);

    const cmds = await getCommands(page);
    expect(cmds).toContain('JIGGLE 3 7\n');

    const storedSpeed = await page.evaluate(() => localStorage.getItem('jiggleSpeed'));
    const storedRange = await page.evaluate(() => localStorage.getItem('jiggleRange'));
    expect(storedSpeed).toBe('3');
    expect(storedRange).toBe('7');
  });

  // --- Jiggle Path canvas ---
  test('clear button clears canvas and disables Set Jiggle', async ({ page }) => {
    // Draw something on the canvas first
    await page.evaluate(() => {
      const canvas = document.getElementById('jiggle-canvas');
      const r = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 2, clientX: 100, clientY: 100, bubbles: true,
      }));
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 2, clientX: 200, clientY: 150, bubbles: true,
      }));
      canvas.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 2, clientX: 200, clientY: 150, bubbles: true,
      }));
    });

    await expect(page.locator('#btn-jiggle-set')).toBeEnabled();

    await page.click('#btn-jiggle-clear');
    await expect(page.locator('#btn-jiggle-set')).toBeDisabled();
  });

  test('Set Jiggle sends JIGGLEPATH with computed deltas', async ({ page }) => {
    // Draw a simple line on the canvas
    await page.evaluate(() => {
      const canvas = document.getElementById('jiggle-canvas');
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 3, clientX: 50, clientY: 50, bubbles: true,
      }));
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 3, clientX: 120, clientY: 90, bubbles: true,
      }));
      canvas.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 3, clientX: 120, clientY: 90, bubbles: true,
      }));
    });

    await page.waitForTimeout(100);
    await page.click('#btn-jiggle-set');
    await page.waitForTimeout(100);

    const cmds = await getCommands(page);
    const jigglePathCmd = cmds.find(c => c.startsWith('JIGGLEPATH'));
    expect(jigglePathCmd).toBeDefined();
    // Should contain comma-separated delta pairs
    expect(jigglePathCmd).toMatch(/^JIGGLEPATH -?\d+,-?\d+(,-?\d+,-?\d+)*\n$/);
  });

  test('SVG upload parses path and enables Set Jiggle', async ({ page }) => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M10,10 L50,10 L50,50 L10,50 Z"/></svg>';

    await page.evaluate((svg) => {
      // Simulate file input by constructing a File and firing change
      const input = document.getElementById('jiggle-svg-upload');
      const dt = new DataTransfer();
      const file = new File([svg], 'test.svg', { type: 'image/svg+xml' });
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, svgContent);

    await page.waitForTimeout(200);
    await expect(page.locator('#btn-jiggle-set')).toBeEnabled();
  });

});
