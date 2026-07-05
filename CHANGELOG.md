# Changelog

All notable changes to this project will be documented in this file.
Format: `[YYYY-MM-DD] - Description`

---

## [Unreleased]

### Fixed
- `[2026-07-05]` - Mark all Phase 4 verification tasks complete in TASKS.md
- `[2026-07-05]` - Fix JIGGLEPATH scaling: deltas now normalised so the largest step equals the Range slider value, preventing sub-pixel (1px) movements from SVG paths
- `[2026-07-05]` - BLE write queue added to `sendCommand()` in `app/app.js` to prevent "GATT operation already in progress" error when multiple commands fire in rapid succession (e.g. Save button sending LAYOUT + JIGGLE)

### Added
- `TASKS.md` with phased implementation checklist for trackpad/jiggle features
- `README.md` tab layout section documenting Mouse, Cipher, Trackpad, and Settings tabs
- `CLAUDE.md` rule requiring `CHANGELOG.md` update before every commit/push
- `[2026-06-16]` - Test suite: 38 Playwright browser tests with BLE mock, V8 coverage reporting (84.88% statement coverage), and README documentation in `test/webapp_tests/`

### Changed
- `[2026-06-16]` - Device firmware: added `PRESS`, `RELEASE`, `JIGGLE`, and `JIGGLEPATH` commands to `handle_command()` in `device/code.py`
- `[2026-06-16]` - Web UI: added Trackpad tab/panel with Draw Mode toggle, Right Click button, and Sensitivity slider in `app/index.html`
- `[2026-06-16]` - Web UI: added Jiggle Speed & Range sliders and Jiggle Path canvas (freehand + SVG upload) to Settings panel in `app/index.html`
- `[2026-06-16]` - Web logic: implemented trackpad pointer events (40ms throttle), draw mode hold-release, jiggle slider persistence, jiggle canvas drawing, SVG upload with path sampling, and Set Jiggle command in `app/app.js`
- `[2026-06-16]` - Fixed Move card arrow button layout to match D-pad order (▲ centered above, ◀ ▶ in row, ▼ centered below)

---

## [2026-05-24]

### Added
- Device setup instructions in `app/about.html`
- `device.zip` download link on GitHub Pages
- Static Pages workflow deploying `app/` folder
- Relocated project to `danielemarsico` fork; updated URLs and remote
