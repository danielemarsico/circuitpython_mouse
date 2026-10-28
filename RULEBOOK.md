# RULEBOOK — CircuitPython BLE Mouse

The rules, contracts and feature set of this project: what exists, how the
parts talk to each other, and what every change must respect.

| | |
|---|---|
| **Version** | 1.5 (1.0 = shipped features · 1.1–1.3 = Speech-to-Keyboard and keyboard layouts · 1.4–1.5 = app and firmware updates) |
| **Date** | 2026-10-27 |
| **Status** | 1.0 current · 1.3 implemented, pending hardware verification (`TASKS.md` Phase S9) · 1.5 implemented (updates, Option A), pending hardware verification (`TASKS.md` Phase U7); Option B not started |
| **Authors** | Daniele Marsico and Claude (Anthropic) |

---

## 1. Architecture

```
 phone / PC browser (Chrome, Web Bluetooth)          host PC
 ┌──────────────────────────────┐   BLE NUS    ┌──────────────────────┐
 │ Web app (PWA, app/)          │ ───────────► │ Dongle (device/)     │ USB HID
 │  Controls · Cipher · Trackpad│  text lines  │ MDBT50Q-RX,          │ ───────► mouse
 │  Voice (1.1) · Settings      │ ◄─────────── │ CircuitPython 10.x   │          keyboard
 └──────┬───────────────┬───────┘  replies     └──────────────────────┘
        │ HTTPS         │ HTTPS (1.1)
        ▼               ▼
 password-deriver   dudu-worker  POST /v1/utterance  (Whisper ASR)
 (cloudflare_worker/)   (separate repo, ../dudu-worker)
```

- **The dongle is a dumb executor.** It turns one text command into HID
  reports. All UI, logic, crypto key handling and network calls live in the
  web app.
- **The web app is static.** It is served from GitHub Pages (or the Docker
  nginx image in `app/`) and has no backend of its own. Anything that needs a
  server goes to a Cloudflare Worker.

## 2. BLE command protocol (app → dongle)

Transport: Nordic UART Service (`6e400001-…`). The app writes to RX (`…0002`),
the device notifies replies on TX (`…0003`). One command per line, terminated
by `\n`.

| Command | Effect |
|---|---|
| `TOGGLE` / `START` / `STOP` | jiggler on/off |
| `MOVE dx dy` | relative mouse move |
| `CLICK [LEFT\|RIGHT\|MIDDLE]` | click |
| `PRESS` / `RELEASE [LEFT\|RIGHT\|MIDDLE]` | hold / release a button (draw mode) |
| `SCROLL n` | wheel |
| `JIGGLE seconds amplitude` | jiggler interval and square size |
| `JIGGLEPATH dx1,dy1,dx2,dy2,…` | custom jiggle path (≤ ~30 points) |
| `TYPE <text>` | types text with the active layout (case preserved), one character at a time; characters the layout can't type are skipped (1.3) |
| `KEY <KEYCODE>` | one key press, `adafruit_hid.Keycode` name (e.g. `ENTER`, `SPACE`, `BACKSPACE`) |
| `LAYOUT <code>` | keyboard layout `US` (alias `EN`), `IT`, `UK`, `DE`, `FR`, `ES`; replies `Layout: <code>` or `Layout <code> not available` |
| `LAYOUTS` | replies `Layouts: US,IT,…`, the layouts installed on the dongle |
| `CIPHER <base64>` | AES-CTR (IV ‖ ciphertext) decrypted with `secret.txt`, then typed |
| `MAINTENANCE` | writes `maintenance.flag` and resets with the drive visible |
| `VERSION` *(1.5)* | replies `Version: <firmware version>` (e.g. `Version: 2026.10.27`) |

Rules:

1. **Lines stay ≤ 60 bytes (UTF-8).** The device's UART receive buffer is
   64 bytes. Longer payloads are split by the app (see §5.3).
2. **The app serialises writes** through the `_bleQueue` in `sendCommand()`.
   No code path may call `writeValue` concurrently.
3. **The app uppercases every command except `TYPE` and `CIPHER` payloads.**
4. **The device trims each line at both ends.** A space that must be typed at
   the start or end of a chunk goes inside the `TYPE` payload after the first
   character, or is sent as `KEY SPACE`.
5. **Unknown or malformed commands are ignored**, never fatal.
6. **Replies end with `\n`** and may arrive split across notifications. The
   app reassembles lines (`handleDeviceData`) before parsing them.
7. **On connect the app sends `LAYOUT <saved>`, `LAYOUTS` and `VERSION`**,
   because the dongle boots with the US layout. No `VERSION` reply within 3 s
   means firmware older than 1.5.
8. **The device never makes network calls** and never stores user text.

## 3. Shipped features (v1.0)

### Device (`device/`)
- USB HID mouse and keyboard, BLE UART remote control.
- **Jiggler**: always active while no BLE client is connected. When connected
  it follows `START`/`STOP`/`TOGGLE`. Speed, range and custom path can be set.
- **Physical button**: short press toggles the jiggler. Hold 3 s to reboot
  into maintenance mode.
- **HID-only boot** (`boot.py`): the `CIRCUITPY` drive is hidden, and
  `maintenance.flag` brings it back for exactly one boot.
- **Keyboard**: `TYPE`, `KEY`, EN/IT layouts.
- **Cipher**: encrypted text typing with a pre-shared key in `secret.txt`.

### Web app (`app/`)
- PWA (installable, offline shell through a network-first service worker).
- **Controls tab**: jiggler toggle, D-pad move, clicks, scroll, type text +
  Enter, custom command.
- **Cipher tab**: password deriver client (`cloudflare_worker/`), encrypt and
  send text.
- **Trackpad tab**: finger trackpad with a 40 ms throttle, tap-to-click,
  draw mode (hold-click), right click, sensitivity.
- **Settings tab**: pre-shared key, deriver URL, keyboard layout, jiggle
  speed/range, jiggle path (freehand or SVG). Settings live in `localStorage`.

### Tooling
- `tools/` packaging and install scripts; a release workflow attaches the
  device zip.
- `test/webapp_tests/`: Playwright suite with a Web Bluetooth mock and V8
  coverage.

## 4. New feature: Speech-to-Keyboard (v1.1–1.3, implemented in `app/voice.js`)

Dictate on the phone and the words are typed on the PC through the dongle.

- **New "Voice" tab**: a push-to-talk mic button, an editable transcript
  preview, **Type it**, **Enter**, **Clear**, and an *auto-type* toggle.
- **Speech engine**:
  - **DuDu worker** (default): records audio as WebM/Opus (WAV fallback), sends `POST /v1/utterance` in *transcribe mode* (no
    `X-Tembed-Protocol` header) and gets the full transcript back as `text`.
  - **Browser** (optional fallback): the Web Speech API. No server, live
    interim text, and audio goes to the browser vendor.
- **Typing pipeline (web app only)**: normalise text, apply the layout's
  charset filter, split into ≤ 60-byte `TYPE` chunks, then send them paced.
- **Settings card "Speech to Keyboard"**: worker URL, API key, language
  (auto/it/en), engine, auto-type, trailing space, and *Test connection*
  (`GET /v1/utterance`).
- **Firmware**: a layout registry (`LAYOUTS` dict, lazy `__import__`) with
  US/IT/UK/DE/FR/ES, the `LAYOUTS` command, and character-by-character
  `TYPE`/`CIPHER` (1.3).
- **Server**: dudu-worker must answer CORS for the app's origin on
  `/v1/utterance`.

## 5. Rules for the Speech-to-Keyboard feature

### 5.1 Worker contract
- Follow `../dudu-worker/ASSISTANT_PROTOCOL.md` Part A §2 for the request
  shape: a raw audio body and `Authorization: Bearer <key>`. The worker detects
  the format from the bytes: **WebM-Opus**, **Ogg-Opus** (0.3–60 s) or **WAV**
  (16-bit PCM, 16 kHz, mono).
- Send the `MediaRecorder` blob as-is when it is WebM/Ogg (Opus at 32 kbps),
  with `Content-Type` set to its `mimeType`; a `Content-Type` must match the
  bytes. Send WAV for takes under 0.4 s and for recorders without Opus
  (Safari's MP4).
- **`415` means "send WAV instead"**: resend the take as WAV, then use WAV for
  the rest of the session.
- **Never send `X-Tembed-Protocol`.** Without it the worker skips the agent and
  returns the unclipped transcript. With it the reply is an agent answer
  clipped for a 320×170 screen.
- **Agent cleanup is opt-in** with `X-Tembed-Mode: dictation` (built in the
  dudu-worker repo). The reply is `{protocol, text, raw}`: `text` is cleaned
  and unclipped, `raw` is the Whisper transcript, and `\n` means Enter. A
  worker that predates the mode ignores the header and returns the raw text,
  so the app must work either way.
- **The agent never decides what the keyboard can type.** Charset filtering,
  chunking and pacing stay in the app.
- Send `X-Tembed-Locale` when a language is chosen, and
  `X-Tembed-Device-Id: ble-mouse-web` for the worker's logs.
- Errors use `{ "error": { "code", "message" } }`. Show `message`. On `429`,
  honour `Retry-After`.
- Recordings are capped at **60 s** (about 240 KB as Opus, 1.9 MB as WAV; the worker accepts up to 8 MB).

### 5.2 Privacy and keys
- The API key is stored in `localStorage`, the same way as the deriver URL, and
  is sent only to the configured worker URL. It never goes to the dongle.
- Audio is never stored by the app. The transcript lives only in the preview
  box and the on-screen log.
- **Do not dictate secrets.** Passwords go through the Cipher tab.

### 5.3 Languages and layouts
- **Speech language** (`auto`/`it`/`en`) and **host keyboard layout** are
  separate settings, and the code never derives one from the other.
- The host layout must match the PC's OS keyboard setting. The dongle can't
  detect it, and the Layout test button is how the user checks it.
- The layout list comes from the dongle (`LAYOUTS`). The characters each
  layout can type come from the generated `app/layouts.json`, never from a
  hand-written list.

### 5.4 Typing
- Text is NFC-normalised, whitespace is collapsed, and characters are filtered
  for the active layout:
  - **EN**: printable ASCII only. Accents are stripped (`è`→`e`), typographic
    quotes, dashes and ellipses become ASCII, and anything else is dropped.
  - **IT**: printable ASCII plus the characters the IT layout can type
    (`àèéìòù` and the AltGr set, to be confirmed on the device).
- Chunks split at word boundaries, each `TYPE` line ≤ 60 bytes. Pacing is
  about 15 ms per character + 50 ms between chunks, so the device's 64-byte
  buffer never overflows while it is typing.
- The optional trailing space is sent as `KEY SPACE`.
- Nothing is typed while disconnected. The transcript stays in the preview.

### 5.5 Service worker
- Only same-origin `GET` requests are cached. `POST` and cross-origin requests
  bypass the cache. Bump `CACHE` on every release that changes app assets.

## 6. App and firmware updates (v1.4 planned, v1.5 implemented)

Keep the installed app and the dongle current without reinstalling the app
or running the installer by hand. Design and feasibility: `PLAN.md` Part 2.

- **App updates in place**: the service worker always revalidates with the
  server. A deploy-time `version.json` is shown in Settings/About, and an
  "Update available → Reload" banner appears when the app returns to the
  foreground and finds a newer version. Reinstalling is never needed.
- **Firmware version**: a `VERSION` constant in `code.py` and the `VERSION`
  command, so the app can say "firmware update available" on connect.
- **Firmware manifest**: the Pages deploy publishes `firmware/manifest.json`
  (version, and path, size and CRC32 for each file) next to the device files.
- **Web Serial updater (Option A, implemented in `app/updater.js`)**: desktop Chrome/Edge on the
  PC the dongle is plugged into. It uses the USB serial console, which stays on
  in HID-only mode, to interrupt `code.py` and write the files through the raw
  REPL. It needs no firmware change and no maintenance mode, and it doubles as
  a recovery tool.
- **Bluetooth OTA (Option B, later and optional)**: phone-only updates over
  the Nordic UART link, with authenticated packages and an automatic rollback.

## 7. Rules for updates

### 7.1 App (PWA)
- **Reinstalling is never part of an update.** Every change ships through the
  service worker and network revalidation.
- The service worker fetches same-origin `GET`s with `cache: 'no-cache'`
  (ETag revalidation). An offline launch still falls back to the cache.
- `version.json` is generated at deploy time and never hand-edited. The page
  only offers a reload, and never reloads on its own while a dictation or
  typing job is in progress.

### 7.2 Firmware versions and packages
- `VERSION` in `code.py` uses the release date format `YYYY.MM.DD[.n]` and
  is bumped by every firmware change. It matches `firmware/manifest.json`.
- The manifest lists every file the installer copies (`boot.py`, `code.py`,
  `lib/**`) with size and CRC32 (`binascii.crc32`, available in CircuitPython).
  `secret.txt` is **never** in the manifest and is never written by an updater.
- Updaters send only the files whose CRC32 differs from what is on the device.

### 7.3 Writing files on the device (both updaters)
- Write each file to `<name>.new`, read it back and check its size and CRC32,
  then swap it in. FAT's `os.rename` won't replace an existing file, so the
  original is removed first (for `code.py`, renamed to `code.bak`). `code.py`
  is written **last**, so a partial update never leaves new code running
  against old libraries.
- Keep `code.bak` (the previous `code.py`) until the new version has started
  successfully.
- After the update, a hard reset (`microcontroller.reset()`), never just a soft
  reload, because `boot.py` only runs on a hard reset.
- If an update fails partway through, the device must still be recoverable by
  rerunning the updater over USB serial, and the UF2 bootloader remains the
  last resort.

### 7.4 Bluetooth OTA (Option B only)
- **No unauthenticated code installs.** The BLE link has no pairing, so every
  OTA package is authenticated with a key derived from `secret.txt`: AES-CMAC
  built on `aesio` ECB, since CircuitPython has no `hmac` on nRF52. The device
  rejects a package without a valid tag, and OTA is disabled when `secret.txt`
  is missing.
- Rollback: `boot.py` restores `code.bak` if the new `code.py` doesn't mark
  itself healthy (an `ok` flag written after its first full loop) within one
  boot.
- OTA commands follow §2: lines of 60 bytes or less, base64 payloads, and a
  reply for every chunk (the app waits for the acknowledgement, not for a timer).
- Bluetooth pairing/bonding should come before or together with OTA.

## 8. Project conventions
- **Changelog first**: every commit/push has a `CHANGELOG.md` entry
  (`[YYYY-MM-DD] - Description`) under `## [Unreleased]`.
- New app features need Playwright tests in `test/webapp_tests/`, with BLE,
  microphone and network mocked. Tests never call the real worker.
- New BLE commands are documented in §2 of this file and in the README.
- The firmware stays dependency-light: only libraries in `device/lib/`.

## 9. Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-25 | Baseline: shipped features, BLE protocol and conventions written down |
| 1.1 | 2026-10-25 | Speech-to-Keyboard specified (planned): Voice tab, dudu-worker transcribe mode, typing pipeline rules |
| 1.2 | 2026-10-25 | Worker work handed off to dudu-worker; opt-in agent cleanup (`X-Tembed-Mode: dictation`); speech language vs host layout; layout registry, `LAYOUTS`, generated charsets |
| 1.3 | 2026-10-25 | Implemented: Voice tab (`app/voice.js`), layout registry + `LAYOUTS` + UK/DE/FR/ES layouts, `app/layouts.json` generator, per-character `TYPE`, TX line reassembly, layout sync on connect, service worker bypass. Pending hardware verification |
| 1.4 | 2026-10-25 | Planned: in-place app updates (no-cache revalidation, `version.json`, update banner), firmware `VERSION` command and manifest, Web Serial updater (Option A), authenticated Bluetooth OTA with rollback (Option B); rules in §7 |
| 1.5 | 2026-10-27 | Implemented: service worker `ble-mouse-v9` with `no-cache` revalidation, deploy-time `version.json`, update banner (`app/updates.js`), firmware `VERSION` (`2026.10.27`), `tools/build_firmware_manifest.py` published to `firmware/`, Web Serial updater (`app/updater.js`). Pending hardware verification; Option B not started |
