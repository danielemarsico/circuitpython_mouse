# RULEBOOK — CircuitPython BLE Mouse

The rules, contracts and feature set of this project: what exists, how the
parts talk to each other, and what every change must respect.

| | |
|---|---|
| **Version** | 1.3 (1.0 = shipped features · 1.1–1.3 = Speech-to-Keyboard and keyboard layouts) |
| **Date** | 2026-10-25 |
| **Status** | 1.0 current · 1.3 implemented, pending hardware verification (`TASKS.md` Phase S9) |
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
7. **On connect the app sends `LAYOUT <saved>` and `LAYOUTS`**, because the
   dongle boots with the US layout.
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
  - **DuDu worker** (default): records audio, encodes 16 kHz mono WAV in the
    browser, sends `POST /v1/utterance` in *transcribe mode* (no
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
  shape: `Content-Type: audio/wav` with a raw RIFF/WAVE body (16-bit PCM,
  16 kHz, mono) and `Authorization: Bearer <key>`.
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
- Recordings are capped at **60 s** (about 1.9 MB; the worker accepts up to 8 MB).

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

## 6. Project conventions
- **Changelog first**: every commit/push has a `CHANGELOG.md` entry
  (`[YYYY-MM-DD] - Description`) under `## [Unreleased]`.
- New app features need Playwright tests in `test/webapp_tests/`, with BLE,
  microphone and network mocked. Tests never call the real worker.
- New BLE commands are documented in §2 of this file and in the README.
- The firmware stays dependency-light: only libraries in `device/lib/`.

## 7. Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-25 | Baseline: shipped features, BLE protocol and conventions written down |
| 1.1 | 2026-10-25 | Speech-to-Keyboard specified (planned): Voice tab, dudu-worker transcribe mode, typing pipeline rules |
| 1.2 | 2026-10-25 | Worker work handed off to dudu-worker; opt-in agent cleanup (`X-Tembed-Mode: dictation`); speech language vs host layout; layout registry, `LAYOUTS`, generated charsets |
| 1.3 | 2026-10-25 | Implemented: Voice tab (`app/voice.js`), layout registry + `LAYOUTS` + UK/DE/FR/ES layouts, `app/layouts.json` generator, per-character `TYPE`, TX line reassembly, layout sync on connect, service worker bypass. Pending hardware verification |
