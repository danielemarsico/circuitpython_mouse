const fs = require('fs');
const path = require('path');
const { test: base, expect } = require('@playwright/test');

const COVERAGE_DIR = path.resolve(__dirname, '.coverage');

if (!fs.existsSync(COVERAGE_DIR)) {
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
}

// Extend the base test to collect V8 JS coverage on every page
const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    const v8Coverage = await page.coverage.stopJSCoverage();
    const safeName = testInfo.titlePath.join('__').replace(/[^a-zA-Z0-9_\-]/g, '_');
    fs.writeFileSync(
      path.join(COVERAGE_DIR, `${safeName}.json`),
      JSON.stringify(v8Coverage, null, 2)
    );
    fs.writeFileSync(
      path.join(COVERAGE_DIR, `${safeName}-urls.txt`),
      v8Coverage.map(e => e.url).join('\n')
    );
  },
});

module.exports = { test, expect };
