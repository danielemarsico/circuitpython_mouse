#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const v8toIstanbul = require('v8-to-istanbul');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

const COVERAGE_DIR = path.resolve(__dirname, '.coverage');
const APP_DIR = path.resolve(__dirname, '..', '..', 'app');
// Scripts loaded by index.html that are measured.
const APP_SCRIPTS = ['app.js', 'voice.js'];

(async () => {
  const coverageMap = libCoverage.createCoverageMap();

  const files = fs.readdirSync(COVERAGE_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No coverage data found. Run tests first.');
    process.exit(0);
  }

  let entriesProcessed = 0;

  for (const file of files) {
    const v8Data = JSON.parse(fs.readFileSync(path.join(COVERAGE_DIR, file), 'utf-8'));

    for (const entry of v8Data) {
      const script = entry.url && APP_SCRIPTS.find(s => entry.url.startsWith('http') && new URL(entry.url).pathname.endsWith('/' + s));
      if (!script) continue;
      if (!entry.source || entry.source.length === 0) continue;
      if (!entry.functions || entry.functions.length === 0) continue;

      const converter = v8toIstanbul(path.join(APP_DIR, script), 0, { source: entry.source });
      await converter.load();
      converter.applyCoverage(entry.functions);
      const data = converter.toIstanbul();

      for (const [scriptPath, cov] of Object.entries(data)) {
        coverageMap.addFileCoverage(cov);
      }
      entriesProcessed++;
    }
  }

  console.log(`\nCoverage files processed: ${files.length}`);
  console.log(`App script coverage entries: ${entriesProcessed}`);

  const context = libReport.createContext({
    dir: path.resolve(__dirname, 'coverage-report'),
    coverageMap,
    defaultSummarizer: 'nested',
  });

  reports.create('text', { file: 'coverage.txt', maxCols: 100 }).execute(context);
  reports.create('text-summary').execute(context);

  for (const script of APP_SCRIPTS) {
    const file = path.join(APP_DIR, script);
    if (!coverageMap.files().includes(file)) continue;
    const s = coverageMap.fileCoverageFor(file).toSummary();
    console.log(`\n${script}`);
    console.log(`Statement coverage: ${s.statements.pct}% (${s.statements.covered}/${s.statements.total})`);
    console.log(`Branch coverage:   ${s.branches.pct}% (${s.branches.covered}/${s.branches.total})`);
    console.log(`Function coverage: ${s.functions.pct}% (${s.functions.covered}/${s.functions.total})`);
    console.log(`Line coverage:     ${s.lines.pct}% (${s.lines.covered}/${s.lines.total})`);
  }
})();
