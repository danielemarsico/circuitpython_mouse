const { defineConfig } = require('@playwright/test');

const PORT = process.env.TEST_PORT || 8080;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 15000,
  expect: { timeout: 5000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
  },
  webServer: {
    command: `cd ../../app && python3 -m http.server ${PORT} --bind 127.0.0.1`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 10000,
  },
});
