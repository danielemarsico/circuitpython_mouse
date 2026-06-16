# Changelog

All notable changes to this project will be documented in this file.
Format: `[YYYY-MM-DD] - Description`

---

## [Unreleased]

### Added
- `TASKS.md` with phased implementation checklist for trackpad/jiggle features
- `README.md` tab layout section documenting Mouse, Cipher, Trackpad, and Settings tabs
- `CLAUDE.md` rule requiring `CHANGELOG.md` update before every commit/push

### Changed
- `[2026-06-16]` - Device firmware: added `PRESS`, `RELEASE`, `JIGGLE`, and `JIGGLEPATH` commands to `handle_command()` in `device/code.py`
- `[2026-06-16]` - Web UI: added Trackpad tab/panel with Draw Mode toggle, Right Click button, and Sensitivity slider in `app/index.html`
- `[2026-06-16]` - Web UI: added Jiggle Speed & Range sliders and Jiggle Path canvas (freehand + SVG upload) to Settings panel in `app/index.html`
- `[2026-06-16]` - Web logic: implemented trackpad pointer events (40ms throttle), draw mode hold-release, jiggle slider persistence, jiggle canvas drawing, SVG upload with path sampling, and Set Jiggle command in `app/app.js`

---

## [2026-05-24]

### Added
- Device setup instructions in `app/about.html`
- `device.zip` download link on GitHub Pages
- Static Pages workflow deploying `app/` folder
- Relocated project to `danielemarsico` fork; updated URLs and remote
