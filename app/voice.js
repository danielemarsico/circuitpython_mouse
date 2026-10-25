// Speech to Keyboard (Voice tab): dictate on the phone, type on the PC.
// Loaded after app.js and uses its globals (sendCommand, _bleQueue, rxCharacteristic,
// addLog, typableChars, keyboardLayoutSelect, btnSaveSettings, SVG_EYE_*).
// Rules: RULEBOOK.md §5.

const VOICE_DEFAULT_URL   = 'https://dudu.officinegenerative.com/v1/utterance';
const VOICE_DEVICE_ID     = 'ble-mouse-web';
const VOICE_MAX_SECONDS   = 60;
const VOICE_HOLD_MS       = 400;    // a press longer than this is hold-to-talk
const VOICE_TIMEOUT_MS    = 35000;  // worker answers within 30 s (protocol §2)
const TYPE_LINE_MAX_BYTES = 60;     // device UART buffer is 64 bytes

// Pacing between BLE writes, so the device finishes typing one chunk before
// the next arrives. Exposed for tests.
const voicePacing = { msPerChunk: 50, msPerChar: 15 };

// --- Text pipeline (pure) ---

const TYPOGRAPHIC = {
  '‘': "'", '’': "'", '‚': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '«': '"', '»': '"',
  '–': '-', '—': '-', '−': '-',
  '…': '...', ' ': ' ', ' ': ' ', ' ': ' ',
};
const PRINTABLE_ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

// NFC, unified newlines, single spaces, no spaces around line breaks.
function normalizeDictation(text) {
  return text.normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

// Keep only what the layout can type: typographic marks become ASCII, an
// untypable accented letter loses its accent, anything else is dropped.
function sanitizeForLayout(text, chars) {
  const allowed = new Set(chars || PRINTABLE_ASCII);
  let out = '';
  for (const ch of text) {
    const mapped = TYPOGRAPHIC[ch] ?? ch;
    for (const c of mapped) {
      if (c === '\n' || allowed.has(c)) { out += c; continue; }
      const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (const b of base) if (allowed.has(b)) out += b;
    }
  }
  return out;
}

const _utf8 = new TextEncoder();
const _bytes = s => _utf8.encode(s).length;

// Split one line into TYPE payloads of at most maxBytes per command line
// ("TYPE " + payload + "\n"). Breaks fall before a space, so every chunk after
// the first starts with one: the device trims only the line ends.
function chunkForType(line, maxBytes = TYPE_LINE_MAX_BYTES) {
  const limit = maxBytes - _bytes('TYPE \n');
  const chunks = [];
  let cur = '';
  for (const piece of line.split(/(?= )/)) {
    if (_bytes(cur + piece) <= limit) { cur += piece; continue; }
    if (cur) chunks.push(cur);
    cur = '';
    // A single word longer than the limit is split by characters.
    for (const ch of piece) {
      if (_bytes(cur + ch) > limit) { chunks.push(cur); cur = ''; }
      cur += ch;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// The full command sequence for a dictation: TYPE chunks, KEY ENTER for line
// breaks, and an optional trailing KEY SPACE.
function buildTypeCommands(text, { chars = null, trailingSpace = false, sanitize = true } = {}) {
  const clean = normalizeDictation(sanitize ? sanitizeForLayout(text, chars) : text);
  const cmds = [];
  clean.split('\n').forEach((line, i) => {
    if (i > 0) cmds.push('KEY ENTER');
    for (const chunk of chunkForType(line)) cmds.push('TYPE ' + chunk);
  });
  if (trailingSpace && clean) cmds.push('KEY SPACE');
  return cmds;
}

// --- Typing over BLE ---

let typingJob = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendTypeCommands(cmds) {
  if (typingJob) typingJob.cancelled = true;
  const job = { cancelled: false };
  typingJob = job;
  for (const cmd of cmds) {
    if (job.cancelled || !rxCharacteristic) return false;
    sendCommand(cmd);
    await _bleQueue;
    const chars = cmd.startsWith('TYPE ') ? cmd.length - 5 : 0;
    await sleep(voicePacing.msPerChunk + voicePacing.msPerChar * chars);
  }
  if (typingJob === job) typingJob = null;
  return !job.cancelled;
}

function typeDictation(text) {
  return sendTypeCommands(buildTypeCommands(text, {
    chars: typableChars(),
    trailingSpace: voiceTrailingSpace.checked,
  }));
}

// --- WAV encoding (16 kHz mono s16le, as protocol §2 expects) ---

async function blobToWav(blob) {
  const ctx = new AudioContext();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close();
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
  const off = new OfflineAudioContext(1, frames, 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return encodeWav((await off.startRendering()).getChannelData(0), 16000);
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// --- Worker client (dudu-worker, ASSISTANT_PROTOCOL.md Part A) ---

function workerHeaders(extra = {}) {
  const h = { 'X-Tembed-Device-Id': VOICE_DEVICE_ID, ...extra };
  const key = voiceKeyInput.value.trim();
  if (key) h.Authorization = 'Bearer ' + key;
  return h;
}

function workerUrl() { return voiceUrlInput.value.trim() || VOICE_DEFAULT_URL; }

async function workerError(res) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) return 'Key rejected';
  const msg = body.error?.message || ('HTTP ' + res.status);
  const retry = res.headers.get('Retry-After');
  return res.status === 429 && retry ? `${msg} (retry in ${Math.ceil(retry / 60)} min)` : msg;
}

function networkError(e) {
  return e.name === 'AbortError'
    ? 'The worker took too long'
    : 'Network error: offline, or the worker does not allow this site (CORS)';
}

// Never sends X-Tembed-Protocol: without it the worker returns the transcript,
// not an assistant answer clipped for a small screen.
async function transcribeWithWorker(wav) {
  const extra = { 'Content-Type': 'audio/wav' };
  if (voiceLang !== 'auto') extra['X-Tembed-Locale'] = voiceLang === 'it' ? 'it-IT' : 'en-US';
  if (voiceCleanup.checked) extra['X-Tembed-Mode'] = 'dictation';
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), VOICE_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(workerUrl(), { method: 'POST', headers: workerHeaders(extra), body: wav, signal: abort.signal });
  } catch (e) {
    throw new Error(networkError(e));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(await workerError(res));
  const body = await res.json();
  return { text: body.text || '', raw: body.raw || '' };
}

// --- UI refs and settings ---

const btnMic             = document.getElementById('btn-mic');
const voiceStatus        = document.getElementById('voice-status');
const voiceLevel         = document.querySelector('#voice-level > div');
const voiceText          = document.getElementById('voice-text');
const btnVoiceType       = document.getElementById('btn-voice-type');
const btnVoiceEnter      = document.getElementById('btn-voice-enter');
const btnVoiceClear      = document.getElementById('btn-voice-clear');
const btnVoiceRaw        = document.getElementById('btn-voice-raw');
const voiceAutotype      = document.getElementById('voice-autotype');
const voiceEngineSelect  = document.getElementById('voice-engine');
const voiceUrlInput      = document.getElementById('voice-url');
const voiceKeyInput      = document.getElementById('voice-key');
const btnEyeVoiceKey     = document.getElementById('btn-eye-voice-key');
const voiceCleanup       = document.getElementById('voice-cleanup');
const voiceTrailingSpace = document.getElementById('voice-trailing-space');
const btnVoiceTest       = document.getElementById('btn-voice-test');
const voiceTestMsg       = document.getElementById('voice-test-msg');
const btnLayoutTest      = document.getElementById('btn-layout-test');

const VOICE_KEYS = {
  url: 'voiceWorkerUrl', key: 'voiceApiKey', engine: 'voiceEngine', lang: 'voiceLang',
  cleanup: 'voiceCleanup', trailing: 'voiceTrailingSpace', autotype: 'voiceAutotype',
};
const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;

voiceUrlInput.value        = localStorage.getItem(VOICE_KEYS.url) ?? VOICE_DEFAULT_URL;
voiceKeyInput.value        = localStorage.getItem(VOICE_KEYS.key) ?? '';
voiceEngineSelect.value    = localStorage.getItem(VOICE_KEYS.engine) ?? 'worker';
voiceCleanup.checked       = localStorage.getItem(VOICE_KEYS.cleanup) === '1';
voiceTrailingSpace.checked = localStorage.getItem(VOICE_KEYS.trailing) === '1';
voiceAutotype.checked      = localStorage.getItem(VOICE_KEYS.autotype) === '1';
if (!SpeechRecognitionApi) {
  voiceEngineSelect.querySelector('option[value="browser"]').disabled = true;
  voiceEngineSelect.value = 'worker';
}

btnSaveSettings.addEventListener('click', () => {
  localStorage.setItem(VOICE_KEYS.url, voiceUrlInput.value.trim());
  localStorage.setItem(VOICE_KEYS.key, voiceKeyInput.value.trim());
  localStorage.setItem(VOICE_KEYS.engine, voiceEngineSelect.value);
  localStorage.setItem(VOICE_KEYS.cleanup, voiceCleanup.checked ? '1' : '0');
  localStorage.setItem(VOICE_KEYS.trailing, voiceTrailingSpace.checked ? '1' : '0');
});

voiceAutotype.addEventListener('change', () => {
  localStorage.setItem(VOICE_KEYS.autotype, voiceAutotype.checked ? '1' : '0');
});

btnEyeVoiceKey.innerHTML = SVG_EYE_OPEN;
btnEyeVoiceKey.addEventListener('click', () => {
  const visible = voiceKeyInput.type === 'text';
  voiceKeyInput.type = visible ? 'password' : 'text';
  btnEyeVoiceKey.innerHTML = visible ? SVG_EYE_OPEN : SVG_EYE_OFF;
});

// Speech language: a quick switch on the Voice tab, separate from the host layout.
let voiceLang = localStorage.getItem(VOICE_KEYS.lang) ?? 'auto';
const langButtons = document.querySelectorAll('#voice-lang button');
function setVoiceLang(lang) {
  voiceLang = lang;
  localStorage.setItem(VOICE_KEYS.lang, lang);
  langButtons.forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}
langButtons.forEach(b => b.addEventListener('click', () => setVoiceLang(b.dataset.lang)));
setVoiceLang(voiceLang);

function setVoiceStatus(text, isError = false) {
  voiceStatus.textContent = text;
  voiceStatus.classList.toggle('error', isError);
}

// --- Transcript handling ---

let rawTranscript = '';

function showTranscript({ text, raw }) {
  voiceText.value = text;
  rawTranscript = raw && raw !== text ? raw : '';
  btnVoiceRaw.hidden = !rawTranscript;
  if (!text) { setVoiceStatus("Didn't catch that", true); return; }
  setVoiceStatus('ready');
  if (voiceAutotype.checked) typeFromPreview();
}

async function typeFromPreview() {
  const text = voiceText.value;
  if (!text.trim()) return;
  if (!rxCharacteristic) { setVoiceStatus('Not connected: the text is kept here', true); return; }
  setVoiceStatus('typing…');
  const done = await typeDictation(text);
  setVoiceStatus(done ? 'typed' : 'typing stopped', !done);
}

btnVoiceType.addEventListener('click', typeFromPreview);
btnVoiceEnter.addEventListener('click', () => sendCommand('KEY ENTER'));
btnVoiceClear.addEventListener('click', () => {
  if (typingJob) typingJob.cancelled = true;
  voiceText.value = '';
  rawTranscript = '';
  btnVoiceRaw.hidden = true;
  setVoiceStatus('idle');
});
btnVoiceRaw.addEventListener('click', () => {
  voiceText.value = rawTranscript;
  rawTranscript = '';
  btnVoiceRaw.hidden = true;
});

btnLayoutTest.addEventListener('click', () => {
  // Unfiltered, so whatever the layout can't type shows up as missing.
  sendTypeCommands(buildTypeCommands(LAYOUT_TEST_TEXT, { sanitize: false }));
});

// --- Recording ---

let recorder = null;       // { stop(): void } while a take is in progress
let micDownAt = 0;
let busy = false;

function setMicState(state) {
  btnMic.classList.toggle('recording', state === 'recording');
  btnMic.classList.toggle('busy', state === 'busy');
  btnMic.textContent = state === 'recording' ? '● Recording… release or tap to stop'
                     : state === 'busy'      ? 'Transcribing…'
                     : 'Hold to talk · tap to toggle';
}

async function startWorkerTake() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone not available (needs https)');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const chunks = [];
  const mr = new MediaRecorder(stream);
  mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  // Level meter and timer
  const meterCtx = new AudioContext();
  const analyser = meterCtx.createAnalyser();
  analyser.fftSize = 512;
  meterCtx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const started = Date.now();
  const tick = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((a, s) => a + s * s, 0) / samples.length);
    voiceLevel.style.width = Math.min(100, rms * 400) + '%';
    const secs = Math.floor((Date.now() - started) / 1000);
    setVoiceStatus(`recording 0:${String(secs).padStart(2, '0')}`);
    if (secs >= VOICE_MAX_SECONDS) stopTake();
  }, 100);

  const finished = new Promise(resolve => { mr.onstop = resolve; });
  mr.start();
  recorder = {
    stop: async () => {
      clearInterval(tick);
      voiceLevel.style.width = '0%';
      mr.stop();
      await finished;
      stream.getTracks().forEach(t => t.stop());
      meterCtx.close();
      return new Blob(chunks, { type: mr.mimeType });
    },
  };
}

function startBrowserTake() {
  const rec = new SpeechRecognitionApi();
  if (voiceLang !== 'auto') rec.lang = voiceLang === 'it' ? 'it-IT' : 'en-US';
  rec.interimResults = true;
  rec.continuous = true;
  let finalText = '';
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    voiceText.value = finalText + interim;
  };
  const finished = new Promise((resolve, reject) => {
    rec.onend = () => resolve(finalText);
    rec.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') reject(new Error('Speech recognition: ' + e.error)); };
  });
  finished.catch(() => {});   // reported when the take is stopped
  rec.start();
  setVoiceStatus('listening…');
  recorder = { stop: async () => { rec.stop(); return finished; } };
}

async function startTake() {
  busy = true;
  try {
    if (voiceEngineSelect.value === 'browser' && SpeechRecognitionApi) startBrowserTake();
    else await startWorkerTake();
    setMicState('recording');
  } catch (e) {
    recorder = null;
    setMicState('idle');
    setVoiceStatus(e.name === 'NotAllowedError' ? 'Microphone permission denied' : e.message, true);
  } finally {
    busy = false;
  }
}

async function stopTake() {
  if (!recorder) return;
  const current = recorder;
  recorder = null;
  busy = true;
  setMicState('busy');
  try {
    const result = await current.stop();
    if (typeof result === 'string') {
      showTranscript({ text: result.trim(), raw: '' });
    } else {
      setVoiceStatus('transcribing…');
      showTranscript(await transcribeWithWorker(await blobToWav(result)));
    }
  } catch (e) {
    setVoiceStatus(e.message, true);
    addLog('! voice: ' + e.message, '#f87171');
  } finally {
    busy = false;
    setMicState('idle');
  }
}

// Press and hold records until release; a short tap starts a take that the
// next tap stops.
btnMic.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (busy) return;
  if (recorder) { stopTake(); return; }
  micDownAt = Date.now();
  startTake();
});
btnMic.addEventListener('pointerup', () => {
  if (recorder && micDownAt && Date.now() - micDownAt > VOICE_HOLD_MS) stopTake();
  micDownAt = 0;
});
btnMic.addEventListener('contextmenu', e => e.preventDefault());

// --- Test connection (GET health check, protocol §8) ---

btnVoiceTest.addEventListener('click', async () => {
  voiceTestMsg.style.color = '#aaa';
  voiceTestMsg.textContent = 'testing…';
  try {
    const res = await fetch(workerUrl(), { headers: workerHeaders() });
    if (!res.ok) throw new Error(await workerError(res));
    const body = await res.json();
    voiceTestMsg.style.color = '#4ade80';
    voiceTestMsg.textContent = `OK: ${body.name || 'worker'} (protocol ${body.protocol})`;
  } catch (e) {
    voiceTestMsg.style.color = '#f87171';
    voiceTestMsg.textContent = e instanceof TypeError ? networkError(e) : e.message;
  }
});

// For tests
Object.assign(window, { normalizeDictation, sanitizeForLayout, chunkForType, buildTypeCommands, encodeWav, voicePacing });
