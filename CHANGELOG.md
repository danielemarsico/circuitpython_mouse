# Changelog

All notable changes to this project will be documented in this file.
Format: `[YYYY-MM-DD] - Description`

---

## [Unreleased]

### Added
- `[2026-10-27]` - App updates in place: deploy-time `app/version.json`, app version in Settings and About, and an "Update available → Reload" banner when the app returns to the foreground with a newer version (held while dictating or typing); new `app/updates.js`
- `[2026-10-27]` - Firmware `VERSION` constant (`2026.10.27`) and `VERSION` command; the app asks for it on connect and shows "Firmware update available" when a newer firmware is published
- `[2026-10-27]` - `tools/build_firmware_manifest.py` publishes the device files and `firmware/manifest.json` (version, size and CRC32 per file, never `secret.txt`); run by the Pages deploy
- `[2026-10-27]` - Firmware update over USB (`app/updater.js`, loaded on demand): Settings → Updates → Update over USB in desktop Chrome/Edge drives the CircuitPython raw REPL over Web Serial, writes only changed files (verified `.new` + swap, `code.py` last, `code.bak` kept) and resets the dongle; Retry after errors, clear message in maintenance mode
- `[2026-10-27]` - 21 Playwright tests in `test/webapp_tests/tests/updates.spec.js` with a Web Serial mock that emulates the raw REPL and a filesystem; coverage report includes `updates.js` and `updater.js`
- `[2026-10-25]` - Plan for app and firmware updates (v1.4): `PLAN.md` Part 2 (feasibility of in-place PWA updates, Web Serial updater, authenticated Bluetooth OTA) and `RULEBOOK.md` §6–§7 with update rules and the planned `VERSION` command
- `[2026-10-25]` - Speech to Keyboard: new Voice tab (`app/voice.js`) records from the microphone, sends 16 kHz mono WAV to the DuDu worker (`POST /v1/utterance`, transcribe mode, optional `X-Tembed-Mode: dictation` agent cleanup) or uses the browser's speech recognition, and types the transcript through paced `TYPE`/`KEY` commands of 60 bytes or less; editable preview, auto-type, raw-transcript undo, IT/EN/auto speech language
- `[2026-10-25]` - Settings card "Speech to Keyboard": engine, worker URL, API key, agent cleanup, trailing space, Test connection
- `[2026-10-25]` - Keyboard layouts UK, DE, FR, ES (Windows, Neradoc release 20250409) in `device/lib/`; firmware layout registry with lazy import and a new `LAYOUTS` command; the app fills the layout dropdown from the dongle and adds a Layout test button
- `[2026-10-25]` - `tools/gen_layout_charsets.py` generates `app/layouts.json` (typable characters per layout) from the pinned layout sources; the app uses it to replace or drop untypable characters
- `[2026-10-25]` - 23 Playwright tests in `test/webapp_tests/tests/voice.spec.js` (fake microphone, routed worker); coverage report now includes `voice.js`
- `[2026-10-25]` - `RULEBOOK.md` (v1.1): project rules, BLE command protocol, summary of shipped features and the planned Speech-to-Keyboard feature
- `[2026-10-25]` - `PLAN.md` replaced with the Speech-to-Keyboard plan (feasibility assessment, dudu-worker CORS change, web-app typing pipeline); `TASKS.md` gains phases S1–S10, previous tasks archived as completed
- `[2026-10-25]` - Plan/RULEBOOK v1.2: worker changes (CORS, `X-Tembed-Mode: dictation` cleanup) handed off to dudu-worker; separate speech language and host keyboard layout; firmware layout registry with `LAYOUTS` command and generated per-layout charsets

### Changed
- `[2026-10-27]` - Docs: USB update confirmed on the real dongle (TASKS U4); README and `tools/INSTALL.md` explain the Ubuntu/Lubuntu Chromium snap fix (`snap connect chromium:raw-usb`) for an empty serial port picker
- `[2026-10-27]` - Service worker (cache `ble-mouse-v9`) revalidates every file with `cache: 'no-cache'`, never caches `version.json` or `firmware/`, and is registered with `updateViaCache: 'none'`
- `[2026-10-27]` - Docs: README, About and `tools/INSTALL.md` recommend the USB updater (with the Linux `dialout` note); `RULEBOOK.md` 1.5; `TASKS.md` phases U1–U8
- `[2026-10-25]` - Firmware `TYPE` and `CIPHER` type one character at a time and skip untypable characters instead of losing the rest of the text
- `[2026-10-25]` - The app reassembles device replies split across BLE notifications, and on connect restores the saved keyboard layout (the dongle boots with US)
- `[2026-10-25]` - Service worker (cache `ble-mouse-v8`) no longer intercepts POST or cross-origin requests, and caches `voice.js` and `layouts.json`
- `[2026-10-25]` - Tab buttons shrink on narrow screens so the five tabs fit at 360 px
- `[2026-10-25]` - Test server binds to `127.0.0.1` and honours `TEST_PORT`

### Fixed
- `[2026-10-27]` - Elements with the `hidden` attribute stay hidden even when a class sets `display`
- `[2026-10-25]` - `tools/INSTALL.md` and README project structure no longer describe `boot.py` as "hold the button at boot" (replaced by the `maintenance.flag` mechanism)

### Fixed
- `[2026-07-05]` - Mark all Phase 4 verification tasks complete in TASKS.md
- `[2026-07-05]` - Fix JIGGLEPATH scaling: deltas now normalised so the largest step equals the Range slider value, preventing sub-pixel (1px) movements from SVG paths
- `[2026-07-05]` - BLE write queue added to `sendCommand()` in `app/app.js` to prevent "GATT operation already in progress" error when multiple commands fire in rapid succession (e.g. Save button sending LAYOUT + JIGGLE)

### Fixed
- `[2026-09-03]` - Maintenance mode no longer relies on holding the button at power-up: on the MDBT50Q-RX that enters the UF2 bootloader before `boot.py` runs. `code.py` now writes a `maintenance.flag` file and resets on a 3-second button hold or the new BLE `MAINTENANCE` command, and `boot.py` consumes the flag to re-enable the `CIRCUITPY` drive for exactly one boot
- `[2026-09-03]` - README recovery instructions: `storage.enable_usb_drive()` cannot be called from the REPL (it is `boot.py`-only); documented the correct fallback (`storage.remount("/", readonly=False)` to neutralise `boot.py`) and clarified the button-hold timing for maintenance mode

### Added
- `[2026-09-03]` - README REPL recovery section: Thonny setup, how to find the serial port on Linux/Windows, and the snippet to delete `boot.py` when the installed version predates the `maintenance.flag` mechanism
- `[2026-09-03]` - `.github/workflows/release-package.yml`: publishing a GitHub release now builds the device zip automatically and attaches it to the release as a downloadable asset
- `[2026-09-03]` - `tools/build_package.py` builds a downloadable `dist/circuitpython_mouse-device-<version>.zip` containing the `CIRCUITPY/` payload, `secret.txt.example` and both installers
- `[2026-09-03]` - `tools/install.sh` (Linux/macOS) and `tools/install.ps1` (Windows) install or upgrade a mounted `CIRCUITPY` drive, auto-detecting the mount point and preserving an existing `secret.txt`
- `[2026-09-03]` - `tools/INSTALL.md` plus a README "Packaged Install / Upgrade" section
- `[2026-09-03]` - `device/boot.py`: dongle now enumerates as USB HID only (no `CIRCUITPY` drive); hold the on-board button while plugging in to re-enable the drive for code updates
- `[2026-09-03]` - README section "Hiding the USB Drive (HID-only mode)" documenting the escape hatch and recovery options
- `TASKS.md` with phased implementation checklist for trackpad/jiggle features
- `README.md` tab layout section documenting Mouse, Cipher, Trackpad, and Settings tabs
- `CLAUDE.md` rule requiring `CHANGELOG.md` update before every commit/push
- `[2026-06-16]` - Test suite: 38 Playwright browser tests with BLE mock, V8 coverage reporting (84.88% statement coverage), and README documentation in `test/webapp_tests/`

### Changed
- `[2026-09-03]` - Physical button: short press still toggles auto-movement, a 3-second hold reboots into maintenance mode
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
