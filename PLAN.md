# Feature Plan: Speech-to-Keyboard (v1.1)

> The previous plan (Trackpad, Draw Mode, Jiggle Settings, SVG Jiggle Path) is
> complete. Its tasks are archived at the bottom of `TASKS.md`, and the full
> plan text is in git history (`git show 23b1c50:PLAN.md`).
> Rules this plan must respect are in `RULEBOOK.md` §5.

## Context

Users want to dictate on the phone and have the words typed on the PC through
the dongle. A speech service already exists: **dudu-worker**
(`https://dudu.officinegenerative.com`, `POST /v1/utterance`,
`../dudu-worker/ASSISTANT_PROTOCOL.md` Part A), which transcribes with Whisper
large-v3-turbo on Workers AI.

---

## 1. Feasibility assessment

**Verdict: feasible, almost entirely in the web app. One small server change
(CORS) is needed. The firmware needs no change.**

| Question | Finding |
|---|---|
| Is a new "send to keyboard" tool needed? | **No.** The firmware already has `TYPE <text>` (layout-aware EN/IT, case preserved) and `KEY <KEYCODE>`. The "tool" is a web-app function that turns a transcript into a paced sequence of `TYPE`/`KEY` commands. |
| Can the browser record audio? | Yes. `getUserMedia` + `MediaRecorder` work in Chrome over HTTPS (GitHub Pages) and on `localhost`. Chrome is already required for Web Bluetooth. |
| Can the browser produce the WAV the worker expects? | Yes. Decode with `decodeAudioData`, resample with `OfflineAudioContext(1, n, 16000)`, then write a 44-byte RIFF header + s16le. The worker's own `/tryit` page does exactly this (`pages/tryit.html`, `wavOf()`), so the code can be ported. |
| Does the worker return dictation-quality text? | Yes, in **transcribe mode**. When `X-Tembed-Protocol` is absent, `handleUtterance` skips the agent and the 200-character clip, and returns `{protocol:1, text:<full transcript>}`. With the header it would return an agent answer, which is wrong for dictation. |
| Can the browser call the worker? | **Not yet.** `/v1/utterance` sends no `Access-Control-Allow-Origin` and does not answer `OPTIONS`. The `Authorization` header forces a preflight, so a call from `https://danielemarsico.github.io` is blocked. **This is the only server change.** |
| Can the BLE link carry long text? | Yes, if it is chunked. The device's UART RX buffer is 64 bytes and `layout.write` blocks while typing, so a 300-character transcript sent as one line would overflow. Split into ≤ 60-byte lines and pace them (§4). |
| Edge cases in the firmware | (a) `cmd.strip()` drops spaces at the edges of a chunk. (b) `layout.write` raises `ValueError` on the first character the layout can't type, after typing the characters before it, so the rest of the text is lost. Both are handled in the web app (§4). Optional firmware hardening is in §6. |
| Service worker | It currently tries `cache.put()` on every fetch, including the POST to the worker, which throws because the Cache API refuses non-GET requests. It must bypass non-GET and cross-origin requests. |
| Latency | One full round trip after you release the mic: upload (~32 KB/s of audio) + Whisper, typically 1–3 s for a 10 s phrase. That's acceptable for push-to-talk. Streaming isn't needed. |
| Cost/quota | Each request counts against the key's daily audio quota on the worker. A `429` with `Retry-After` is shown to the user. |

### Alternatives considered
- **Web Speech API only** (`webkitSpeechRecognition`): no server, live interim
  text. But audio goes to the browser vendor, it needs a network connection
  anyway, and it is uneven on some Android builds. **Kept as an optional
  fallback engine**, not the default.
- **Same-origin proxy instead of CORS**: `app/nginx.conf` could proxy
  `/v1/utterance` to the worker. That works for the Docker self-host only, not
  GitHub Pages. Documented as an alternative.
- **Agent mode for voice commands** (`X-Tembed-Protocol` + actions): the
  action allowlist is T-Embed-specific. Out of scope.

### Can the worker's agent format the text for the keyboard?
**Partly. A prompt alone is not enough.** Assistant turns are hard-clipped to
200 characters (`clipReply`), and they are answers, not transcripts. So the
worker gets a dedicated **dictation mode** (`X-Tembed-Mode: dictation`, handed
off to the dudu-worker repo, §3). It runs a cleanup prompt over the transcript
and is modeled on the watch's `task_cleanup.txt` / `agentTaskEnrich`.

| Concern | Who handles it |
|---|---|
| Punctuation, casing, filler words, spoken punctuation/commands ("virgola", "a capo") → text and `\n` | **worker agent** (dictation mode), same language, never translated |
| Which characters the PC's layout can type | **web app**: only the app knows the selected host layout |
| Chunking, pacing, `\n` → `KEY ENTER`, trailing space | **web app** |
| Fallback when the agent fails or no agent is configured | worker returns the raw transcript |

The web app also keeps the local spoken-command mapping (§4.4 step 2) for
the Browser engine and for keys without a dictation agent.

---

## 2. Overview of changes

| Area | Files | Required |
|---|---|---|
| Server (CORS) | `../dudu-worker/worker.js`, `API.md`, `ASSISTANT_PROTOCOL.md` | yes |
| Web UI | `app/index.html` | yes |
| Web logic | `app/app.js` (or a new `app/voice.js`) | yes |
| Service worker | `app/service-worker.js` | yes |
| Tests | `test/webapp_tests/tests/voice.spec.js`, mocks | yes |
| Docs | `README.md`, `app/about.html`, `CHANGELOG.md` | yes |
| Firmware | `device/code.py` | optional (§6) |

---

## 3. Server: dudu-worker CORS for `/v1/utterance` + dictation mode

> **Handed off.** This section is built in the dudu-worker repository by a
> separate agent. This project only consumes it. Contract summary: CORS
> allow-list for the app's origin, and an optional `X-Tembed-Mode: dictation`
> header that returns `{protocol, text, raw}` with the cleaned (unclipped) text
> in `text` and the Whisper transcript in `raw`.

- New env var `CORS_ORIGINS` (comma-separated allow-list), e.g.
  `https://danielemarsico.github.io,http://localhost:8080`.
- `OPTIONS /v1/utterance` → `204` with:
  - `Access-Control-Allow-Origin: <origin, if allow-listed>`
  - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
  - `Access-Control-Allow-Headers: Authorization, Content-Type, X-Tembed-Locale, X-Tembed-Session, X-Tembed-Device-Id, X-Tembed-Mode`
  - `Access-Control-Max-Age: 600`, `Vary: Origin`
- Add `Access-Control-Allow-Origin` + `Vary: Origin` +
  `Access-Control-Expose-Headers: Retry-After` to **every** response on the
  route, including `401`/`429`/`500` errors. Without this, the browser hides
  the error body.
- Origins that are not allow-listed get no CORS headers. The browser then
  blocks the call, so a key alone is no longer usable from an arbitrary site.
- Document *transcribe mode* (no `X-Tembed-Protocol` → raw, unclipped
  transcript, no agent, no speech) as a supported client mode in `API.md` and
  `ASSISTANT_PROTOCOL.md` §2.
- Tests in the worker repo: preflight allowed/denied, CORS headers on
  200/401/429.

---

## 4. Web app

### 4.1 UI (`app/index.html`)
- New tab **Voice** (between Trackpad and Settings), panel `#panel-voice`:
  - Big mic button `#btn-mic`: hold to talk (pointerdown/up). Tapping it
    toggles recording on and off. It shows a timer and a level meter, and stops
    on its own at 60 s.
  - Status line: `idle · recording 0:07 · transcribing… · error message`.
  - `<textarea id="voice-text">`: the editable transcript.
  - Buttons: `#btn-voice-type` (Type it), `#btn-voice-enter` (KEY ENTER),
    `#btn-voice-clear`. `Type it` / `Enter` are in `cmdButtons`, so they are
    disabled while disconnected.
  - Toggle `#voice-autotype`: type straight away when the transcript arrives.
- Settings card **Speech to Keyboard**: worker URL (default
  `https://dudu.officinegenerative.com/v1/utterance`), API key (password field
  with an eye toggle), language (`auto`/`it`/`en`), engine
  (`worker`/`browser`), trailing space toggle, and a **Test connection** button
  (`GET` health → shows `name`, or "key rejected" on 401). Saved by the
  existing Save button.

### 4.2 Recording → WAV
```js
const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
const rec = new MediaRecorder(stream);            // webm/opus in Chrome
// on stop: Blob → arrayBuffer → AudioContext.decodeAudioData
const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
// source → destination, startRendering() → Float32 → s16le → RIFF header (wavOf)
```
Stop the tracks after each take so the mic indicator turns off.

### 4.3 Transcription
```js
async function transcribe(wav) {
  const headers = { 'Content-Type': 'audio/wav', 'X-Tembed-Device-Id': 'ble-mouse-web' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  if (lang !== 'auto') headers['X-Tembed-Locale'] = lang === 'it' ? 'it-IT' : 'en-US';
  if (cleanup) headers['X-Tembed-Mode'] = 'dictation';   // agent cleanup; ignored by an older worker
  // NO X-Tembed-Protocol → never an assistant turn
  const r = await fetch(workerUrl, { method: 'POST', headers, body: wav });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || ('HTTP ' + r.status));
  return j.text || '';
}
```
Browser engine: `webkitSpeechRecognition` with `lang`, `interimResults: true`.
Interim text is shown in the textarea, and the final result goes through the
same pipeline.

### 4.4 Typing pipeline (`typeText(text)`)
1. `normalize('NFC')`, trim, collapse runs of whitespace into one space.
2. *(phase 2)* Local spoken commands, matched at word boundaries:
   `a capo`/`new line` → `KEY ENTER`, `invio`/`enter` → `KEY ENTER`,
   `tab` → `KEY TAB`. Off by default.
3. `sanitizeForLayout(text, layout)`:
   - Map `‘’`→`'`, `“”`→`"`, `–—`→`-`, `…`→`...`, NBSP→space.
   - EN: NFD, drop combining marks, keep `[\x20-\x7E]`.
   - IT: keep `[\x20-\x7E]` + IT set (`àèéìòùç°§£€` and others, to be
     confirmed on the device). For anything else, strip the diacritic, then
     drop it if it is still untypable.
4. `chunkForType(text, 60)`: split at spaces so each `'TYPE ' + chunk + '\n'`
   is ≤ 60 UTF-8 bytes. A chunk boundary falls *before* a space, so each later
   chunk starts with `' word…'`. The device's `strip()` only touches the line
   ends, and `cmd[5:]` keeps that leading space. A single word longer than the
   limit is hard-split.
5. Send through `sendCommand('TYPE …')` with pacing: `await sleep(50 + 15 *
   chunk.length)` between chunks. Do this in an async loop that the user can
   cancel (Clear while typing stops it).
6. If trailing space is on → `KEY SPACE`.

`sanitizeForLayout` and `chunkForType` are pure functions exposed on `window`
for tests.

### 4.5 Languages and keyboard layouts
Two **independent** settings:

| Setting | Values | Drives |
|---|---|---|
| Speech language | `auto` · `it` · `en` (quick IT/EN switch on the Voice tab) | `X-Tembed-Locale`, Web Speech `lang` |
| Host keyboard layout | what is installed on the dongle: `US`, `IT` today; `UK`, `DE`, `FR`, `ES`, `MAC_IT`, … later | `LAYOUT xx` on the dongle + the app's charset filter |

The layout must match the **PC's OS keyboard setting**, not the spoken
language. HID sends key positions and the host maps them to characters, so
the dongle cannot detect the layout.

- **Firmware**: replace the hard-coded EN/IT branch with a registry
  `{code: module}` loaded lazily with `__import__` (only the active layout
  takes RAM). Layouts come from the community *Circuitpython_Keyboard_Layouts*
  bundle (`keyboard_layout_win_xx`, `keyboard_layout_mac_xx`, matching
  `keycode_*`). New `LAYOUTS` command replies with the installed codes
  (`Layouts: US,IT`). `LAYOUT xx` still replies `Layout: xx` / `… not
  available`. `EN` is kept as an alias of `US`.
- **App**: the layout dropdown is filled from `LAYOUTS` on connect, with a
  fallback of US/IT for old firmware. A per-layout charset table
  (`app/layouts.json`) is generated at build time by
  `tools/gen_layout_charsets.py` from each layout's `ASCII_TO_KEYCODE` +
  `HIGHER_ASCII`/`COMBINED_KEYS` tables. `sanitizeForLayout` uses it, so
  adding a layout needs no hand-written list.
- **Layout test** button in Settings: types `àèéìòù @#[]{}"'€` so you can check
  the setting matches the PC.
- Matrix to verify: dictated IT/EN × host layout US/IT (Windows), plus Mac IT
  when it is added.
- *Later*: a fallback for characters the layout can't type, using a host-OS
  input method (Windows Alt+numpad cp1252 codes, Linux Ctrl+Shift+U hex). It
  needs a "Host OS" setting and a firmware `UNICODE` command.

### 4.6 Service worker (`app/service-worker.js`)
```js
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // bypass
  …existing network-first…
});
```
Bump `CACHE` to `ble-mouse-v8`.

---

## 5. Tests (`test/webapp_tests/`)
- Mocks: `getUserMedia`/`MediaRecorder`/`AudioContext` (return a short
  synthetic buffer), and `page.route()` for the worker URL (200, 401, 429,
  500 with error body).
- Cases: tab renders and buttons are disabled while disconnected; record →
  transcript appears; auto-type sends the expected `TYPE` lines; request has no
  `X-Tembed-Protocol` and has the Bearer key; error message shown;
  `sanitizeForLayout` (EN/IT) and `chunkForType` (≤ 60 bytes, spaces kept,
  long word split); settings persist; Test connection.

---

## 6. Optional firmware hardening (`device/code.py`, later)
- **Per-character fallback in `TYPE`**: when `layout.write` fails, type
  character by character and skip the ones it can't type, so one bad character
  doesn't lose the rest. Same for `CIPHER`.
- **Flow control**: reply `OK\n` on TX after a `TYPE` finishes. The app could
  then wait for the ack instead of timing the pacing, which is more robust on
  slow hosts.
- **Bigger RX buffer**: build `UARTService` with a larger `buffer_size` if the
  library allows it, so chunks can be longer.

---

## 7. Implementation order
1. dudu-worker CORS (+ dictation mode) — handed off to the dudu-worker repo; unblocks everything.
2. Service worker bypass.
3. Pure helpers `sanitizeForLayout`, `chunkForType`, `typeText` + tests.
4. Recording → WAV → transcribe, Settings card, Test connection.
5. Voice tab UI, auto-type.
6. Layout registry (firmware `LAYOUTS`), `layouts.json` generator, layout test.
7. Browser engine fallback.
8. README/about docs, changelog.
9. Phase 2: local spoken commands, Unicode fallback, optional firmware hardening.

## 8. Verification
1. `curl -i -X OPTIONS https://dudu.officinegenerative.com/v1/utterance -H 'Origin: https://danielemarsico.github.io' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type'` → 204 with the allow headers. A foreign origin gets no headers.
2. Settings → Test connection → shows `dudu`. Then a wrong key → "key rejected".
3. Open Notepad on the PC, connect, Voice tab, hold the mic and say "ciao, questo è un test di dettatura" (layout IT) → the exact text is typed, accents included.
4. Same with layout EN → typed as `ciao, questo e un test di dettatura`.
5. Dictate ~45 s of speech → the whole transcript is typed, with no missing chunks or glued words.
6. Disconnect the BLE → the transcript stays in the preview, nothing is lost. Reconnect → Type it works.
7. Browser engine → live interim text, and the final text is typed.
8. Offline → the app shell still loads, and the mic shows a network error.
