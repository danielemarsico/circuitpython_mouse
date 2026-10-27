# Tasks

## App and firmware updates (v1.4) — see `PLAN.md` Part 2, rules in `RULEBOOK.md` §6–§7

### Phase U1 — PWA updates (`app/service-worker.js`, `app/updates.js`, `static.yml`)
- [x] Service worker: same-origin GETs with `cache: 'no-cache'`; `version.json` and `firmware/` never cached; `CACHE` → `ble-mouse-v9`
- [x] Register with `updateViaCache: 'none'` (moved from `index.html` into `updates.js`)
- [x] Deploy writes `app/version.json` (`<date>-<sha7>`, commit, built); a checkout without it shows `dev`
- [x] Update banner on `visibilitychange` (≤ every 5 min): new `version.json` or a new service worker → **Update available → Reload**; held while recording or typing
- [x] App version in Settings (Updates card) and About

### Phase U2 — Firmware version
- [x] `VERSION = "2026.10.27"` in `code.py` and the `VERSION` command (`Version: …`)
- [x] App sends `VERSION` on connect; no reply in 3 s → "unknown (older than 1.4)"; cleared on disconnect

### Phase U3 — Firmware manifest
- [x] `tools/build_firmware_manifest.py` → `app/firmware/` + `manifest.json` (version from `code.py`, size + CRC32, never `secret.txt`)
- [x] `static.yml` runs it before the Pages upload; `app/firmware/` and `app/version.json` are gitignored
- [x] "Firmware update available" when the manifest is newer than the dongle

### Phase U4 — On the device (needs the dongle and a serial terminal)
- [ ] Raw REPL reachable over the CDC port in HID-only mode (Ctrl-C, any key, Ctrl-A)
- [ ] `binascii.crc32`, `binascii.a2b_base64` and `json` available on CircuitPython 10.1.3 nRF52
- [ ] `storage.remount("/", readonly=False)` works from the REPL in HID-only mode, fails in maintenance mode

### Phase U5 — Option A: Web Serial updater (`app/updater.js`)
- [x] Updates card: device / latest version, **Update over USB** only when `navigator.serial` exists, PC hint otherwise
- [x] Raw REPL driver: enter, `exec` with OK/stdout/stderr parsing, helpers defined once on the device
- [x] Download + verify against the manifest before touching the device; send only files with a different CRC32
- [x] Write `<path>.new` in 144-byte chunks, read back size + CRC32, swap (`code.py` → `code.bak`); libraries first, `code.py` last
- [x] Remount read-only, `microcontroller.reset()`, close the port
- [x] On error: remove `.new`, keep the port open, **Retry**; maintenance mode and "no REPL" messages
- [ ] Filter the port picker by USB vendor ID once confirmed on the device
- [x] Playwright: `mocks/serial-mock.js` (raw REPL + fake filesystem), `updates.spec.js` (21 tests)

### Phase U6 — Docs
- [x] README (Updating over USB, `dialout`, update banner, Updates card, `VERSION`), `about.html`, `tools/INSTALL.md`
- [x] `RULEBOOK.md` → 1.5, `CHANGELOG.md`

### Phase U7 — Verification on hardware (PLAN Part 2 §7)
- [ ] Deploy a change with the PWA in the background → foreground → banner → Reload → new version, no reinstall
- [ ] Offline launch: shell from cache, no banner or error loop
- [ ] Old firmware → "unknown (older than 1.4)", update available
- [ ] Desktop Chrome, HID-only mode → Update over USB → only changed files sent → reset → `VERSION` reports the new version → Layout test still works
- [ ] Unplug mid-update → replug → old firmware runs (or `code.bak` restorable) → rerun completes
- [ ] Maintenance mode → "drive is mounted" message
- [ ] Phone → PC hint, no button

### Phase U8 — Later / optional (Option B)
- [ ] BLE pairing/bonding
- [ ] OTA commands (`OTA NONCE/BEGIN/DATA/END/COMMIT`) with AES-CMAC from `secret.txt`
- [ ] `boot.py` rollback (`pending.flag` / `attempt.flag`, `code.bak`)

---

## Speech-to-Keyboard (v1.1) — see `PLAN.md`, rules in `RULEBOOK.md` §5

### Phase S1 — Server: dudu-worker (EXTERNAL — handed off to the dudu-worker repo)
- [ ] CORS allow-list on `/v1/utterance` (preflight + headers on every response) — tracked in dudu-worker
- [ ] Dictation mode `X-Tembed-Mode: dictation` → `{protocol, text, raw}`, unclipped — tracked in dudu-worker
- [ ] Here: once deployed, verify PLAN §8.1 from this side and note the worker version in `RULEBOOK.md`

### Phase S2 — Service worker (`app/service-worker.js`)
- [x] Bypass non-GET and cross-origin requests in the `fetch` handler
- [x] Bump `CACHE` to `ble-mouse-v8`

### Phase S3 — Typing pipeline (`app/app.js` or `app/voice.js`)
- [x] `sanitizeForLayout(text, layout)`: typographic → ASCII map; EN: strip diacritics, keep printable ASCII; IT: keep IT layout set
- [x] IT (and other) character sets generated from the layout sources (`app/layouts.json`), not hand-written
- [ ] Confirm on the device with **Layout test** that each layout types its set (IT, US first)
- [x] `chunkForType(text, 60)`: word-boundary chunks ≤ 60 bytes per `TYPE` line, leading space kept, long words hard-split
- [x] `typeText(text)`: async paced sender (50 ms + 15 ms/char), cancellable, optional trailing `KEY SPACE`
- [x] Expose the pure helpers on `window` for tests

### Phase S3b — Languages and keyboard layouts (PLAN §4.5)
- [x] Firmware: layout registry `{code: module}` with lazy `__import__`; `EN` alias of `US`
- [x] Firmware: `LAYOUTS` command → `Layouts: US,IT,…`
- [x] Add UK/DE/FR/ES Windows layouts (Neradoc 10.x release 20250409, ~1 KB each) to `device/lib/` — no Mac layouts in that release
- [ ] On the device: switch through every layout and check free RAM (`gc.mem_free()`) stays healthy
- [x] `tools/gen_layout_charsets.py` → `app/layouts.json` (typable characters per layout, pinned sources, parsed with `ast`)
- [ ] Optional: check in CI that `app/layouts.json` is up to date
- [x] App: fill the layout dropdown from `LAYOUTS` on connect (fallback US/IT); `sanitizeForLayout` reads `layouts.json`
- [x] Settings: "Layout test" button types a fixed probe string
- [x] Voice tab: quick IT/EN speech-language switch (separate from the host layout)

### Phase S4 — Recording and transcription
- [x] Mic capture with `getUserMedia` + `MediaRecorder`; stop the tracks after each take; 60 s auto-stop
- [x] Decode + resample to 16 kHz mono with `OfflineAudioContext`; WAV encoder (port `wavOf` from dudu-worker `pages/tryit.html`)
- [x] `transcribe(wav)`: POST with Bearer key, `X-Tembed-Locale`, `X-Tembed-Device-Id: ble-mouse-web`, optional `X-Tembed-Mode: dictation`, **no** `X-Tembed-Protocol`; `\n` in `text` → `KEY ENTER`; keep `raw` for an "undo cleanup" button
- [x] Error handling: show `error.message`; 401 → "key rejected"; 429 → show `Retry-After`; network error
- [x] Settings card "Speech to Keyboard": worker URL, API key (eye toggle), language, engine, agent cleanup (`X-Tembed-Mode: dictation`), trailing space; persist in `localStorage` via Save
- [x] Test connection button (`GET` health → `name` / key rejected)

### Phase S5 — Voice tab UI (`app/index.html`)
- [x] Add "Voice" tab button + `#panel-voice`
- [x] Mic button (hold to talk + tap to toggle), timer, level meter, status line
- [x] Editable transcript `<textarea>`, Type it / Enter / Clear buttons (Type it + Enter in `cmdButtons`)
- [x] Auto-type toggle (persisted)

### Phase S6 — Browser engine fallback
- [x] `webkitSpeechRecognition` engine with interim results into the textarea; final result goes through the pipeline
- [x] Hide or disable the engine option when the API is unavailable

### Phase S7 — Tests (`test/webapp_tests/`)
- [x] Mocks for `getUserMedia` / `MediaRecorder` / `AudioContext`; `page.route()` for the worker
- [x] `voice.spec.js`: disabled while disconnected, transcript shown, auto-type sends the expected `TYPE` lines, request headers (no `X-Tembed-Protocol`, Bearer), error paths, settings persistence, Test connection
- [x] Unit-style tests for `sanitizeForLayout` and `chunkForType`
- [x] Coverage stays ≥ current level

### Phase S8 — Docs and release
- [x] README: Voice tab section, Settings card, worker setup (key, CORS origin), privacy note (no secrets by voice)
- [x] `app/about.html`: Speech-to-Keyboard usage
- [x] `CHANGELOG.md` entries; `RULEBOOK.md` → 1.3 (implemented, pending hardware verification)
- [ ] After Phase S9 passes: mark `RULEBOOK.md` 1.3 as current

### Phase S9 — Verification on hardware (PLAN §8) — needs the dongle, a phone and the deployed worker
- [ ] CORS preflight allowed/denied
- [ ] Test connection OK / key rejected
- [ ] IT dictation with accents typed exactly
- [ ] EN layout: accents stripped, nothing lost after them
- [ ] Matrix: dictated IT/EN × host layout US/IT (Windows); Layout test string correct
- [ ] Dictation mode on: punctuation fixed, "a capo" → Enter, language unchanged; worker without the mode → raw text still typed
- [ ] ~45 s dictation typed completely (no lost chunks, no glued words)
- [ ] Disconnect mid-flow: transcript kept; Type it after reconnect works
- [ ] Browser engine end-to-end
- [ ] Offline: shell loads, clear network error on the mic

### Phase S10 — Later / optional
- [ ] Local spoken commands (`a capo` / `new line` / `invio` → `KEY ENTER`, `tab` → `KEY TAB`), off by default
- [x] Firmware: per-character fallback in `TYPE`/`CIPHER` for untypable characters
- [ ] Firmware: `OK` ack after `TYPE` on TX; app waits for the ack instead of fixed pacing
- [ ] Firmware: larger UART RX buffer if supported
- [ ] Unicode fallback for untypable characters (Host OS setting + firmware `UNICODE`: Windows Alt+numpad, Linux Ctrl+Shift+U)

---

## Completed — Trackpad, Draw Mode, Jiggle Settings, SVG Jiggle Path (v1.0)

### Phase 1 — Device Firmware (`device/code.py`)

- [x] Add `PRESS [LEFT|RIGHT|MIDDLE]` command to `handle_command()`
- [x] Add `RELEASE [LEFT|RIGHT|MIDDLE]` command to `handle_command()`
- [x] Add `JIGGLE speed amplitude` command to `handle_command()`; declare `JIGGLE_INTERVAL` and `JIGGLE_MOVES` as `global`
- [x] Add `JIGGLEPATH dx1,dy1,...` command to `handle_command()`; reset `move_index` to 0 on update

### Phase 2 — HTML (`app/index.html`)

- [x] Add "Trackpad" tab button (between Cipher and Settings)
- [x] Add Trackpad panel (`#panel-trackpad`) with: trackpad area, Draw Mode toggle, Right Click button, Sensitivity slider
- [x] Add "Jiggle Speed & Range" card inside Settings panel (before Save button)
- [x] Add "Jiggle Path" card inside Settings panel (canvas + Clear / Load SVG / Set Jiggle buttons)

### Phase 3 — JavaScript (`app/app.js`)

- [x] Add `#btn-right-click` to `cmdButtons` querySelectorAll so it auto-disables when disconnected
- [x] Implement Draw Mode toggle (`drawMode` flag, button label/class swap)
- [x] Wire Right Click button → `sendCommand('CLICK RIGHT')`
- [x] Wire Sensitivity slider → live display update
- [x] Implement trackpad pointer events (`pointerdown`, `pointermove`, `pointerup`) with 40 ms throttle and draw-mode PRESS/RELEASE
- [x] Implement Jiggle Speed/Range sliders with live display
- [x] Load jiggle slider values from `localStorage` on init
- [x] Persist and send `JIGGLE` command in existing `btnSaveSettings` handler
- [x] Implement Jiggle Path canvas freehand drawing (pointerdown/move/up)
- [x] Implement SVG upload + `sampleSvgPath()` helper + canvas preview
- [x] Implement Clear button for jiggle canvas
- [x] Implement "Set Jiggle" button — downsample path, convert to deltas, send `JIGGLEPATH`

### Phase 4 — Verification

- [x] Flash updated `code.py`; confirm `PRESS LEFT` / `RELEASE LEFT` hold/release in Paint
- [x] Draw Mode ON on Trackpad tab → drag finger → verify stroke in Paint
- [x] Tap trackpad (< 200 ms) → verify left click fires without drawing
- [x] Right Click button → verify context menu appears
- [x] Adjust Jiggle speed/range sliders → Save → verify jiggle behavior changes
- [x] Draw path on canvas → Set Jiggle → verify cursor traces shape
- [x] Upload SVG → Set Jiggle → verify cursor follows path
