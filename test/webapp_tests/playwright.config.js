const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 15000,
  expect: { timeout: 5000 },
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
  },
  webServer: {
    command: 'cd ../../app && python3 -m http.server 8080',
    port: 8080,
    reuseExistingServer: true,
    timeout: 10000,
  },
});
