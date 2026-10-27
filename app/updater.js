// Firmware updater over USB serial (PLAN.md Part 2 §4, RULEBOOK §7.2–§7.3).
//
// Drives CircuitPython's raw REPL on the dongle's USB serial console, the way
// Thonny or mpremote do: interrupt code.py, remount the filesystem writable,
// and write only the files whose CRC32 differs from the published manifest.
// The serial console stays on in HID-only mode, so no maintenance mode and no
// firmware support are needed, and a broken code.py can be repaired too.
//
// Loaded on demand by updates.js (import('./updater.js')).

const CHUNK_BYTES = 144;          // 192 base64 characters per f.write() exec
const EXEC_TIMEOUT_MS = 5000;
const CRC_TIMEOUT_MS = 20000;     // reads back every file on the device
const RAW_PROMPT = 'raw REPL; CTRL-B to exit\r\n>';

// Helpers defined once on the device, so every later exec is a one-liner.
const DEVICE_HELPERS = `import os, binascii, json, storage
def _crc(p):
    try:
        c = 0
        n = 0
        with open(p, 'rb') as f:
            while True:
                b = f.read(512)
                if not b:
                    break
                c = binascii.crc32(b, c)
                n += len(b)
        return [n, c & 0xffffffff]
    except OSError:
        return None
def _crcs(ps):
    print(json.dumps([_crc('/' + p) for p in ps]))
def _mkdirs(p):
    d = ''
    for part in p.split('/')[:-1]:
        d += '/' + part
        try:
            os.mkdir(d)
        except OSError:
            pass
def _swap(p, bak):
    t = '/' + p
    try:
        if bak:
            try:
                os.remove('/' + bak)
            except OSError:
                pass
            os.rename(t, '/' + bak)
        else:
            os.remove(t)
    except OSError:
        pass
    os.rename(t + '.new', t)
def _clean(ps):
    for p in ps:
        try:
            os.remove('/' + p + '.new')
        except OSError:
            pass
`;

const MSG_MAINTENANCE = 'The drive is mounted (maintenance mode): unplug and re-plug the dongle normally, then retry.';
const MSG_NO_REPL = 'No CircuitPython REPL answered on this port. Pick the dongle\'s serial port and retry.';
const MSG_DISCONNECTED = 'The dongle disconnected. Plug it back in and start the update again.';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pyStr = s => JSON.stringify(s);   // JSON string literals are valid Python

// --- CRC32 (same polynomial as zlib / binascii.crc32) ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const crcHex = n => n.toString(16).padStart(8, '0');

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// Libraries first, boot.py next, code.py last (RULEBOOK §7.3).
function installOrder(a, b) {
  const rank = p => (p === 'code.py' ? 2 : p === 'boot.py' ? 1 : 0);
  return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path);
}

class DeviceError extends Error {}
class ReplError extends DeviceError {}   // a Python exception on the device

export class UsbUpdater {
  constructor(port, manifest, { onStatus = () => {}, onProgress = () => {}, baseUrl = 'firmware/' } = {}) {
    this.port = port;
    this.manifest = manifest;
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.baseUrl = baseUrl;
    this.portOpen = false;
    this._buffer = '';
    this._waiter = null;
    this._closed = false;
    this.files = [...manifest.files].sort(installOrder).map(f => ({ ...f, state: 'pending' }));
  }

  // --- Serial transport ---

  async open() {
    if (this.portOpen) return;
    await this.port.open({ baudRate: 115200 });   // ignored by USB CDC, required by the API
    this.portOpen = true;
    this._closed = false;
    this._writer = this.port.writable.getWriter();
    this._reader = this.port.readable.getReader();
    this._readLoop();
  }

  async _readLoop() {
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await this._reader.read();
        if (done) break;
        this._buffer += decoder.decode(value, { stream: true });
        this._waiter?.check();
      }
    } catch { /* port lost */ }
    this._closed = true;
    this.portOpen = false;
    this._waiter?.check();
  }

  async _write(text) {
    const data = new TextEncoder().encode(text);
    for (let i = 0; i < data.length; i += 256) await this._writer.write(data.subarray(i, i + 256));
  }

  // Resolves with everything received up to and including marker.
  _readUntil(marker, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._waiter = null; reject(new DeviceError('timeout waiting for the device')); }, timeoutMs);
      this._waiter = {
        check: () => {
          const i = this._buffer.indexOf(marker);
          if (i >= 0) {
            clearTimeout(timer);
            this._waiter = null;
            const out = this._buffer.slice(0, i + marker.length);
            this._buffer = this._buffer.slice(i + marker.length);
            resolve(out);
          } else if (this._closed) {
            clearTimeout(timer);
            this._waiter = null;
            reject(new DeviceError(MSG_DISCONNECTED));
          }
        },
      };
      this._waiter.check();
    });
  }

  async close() {
    try { await this._reader?.cancel(); } catch {}
    try { this._reader?.releaseLock(); } catch {}
    try { this._writer?.releaseLock(); } catch {}
    try { if (this.portOpen) await this.port.close(); } catch {}
    this.portOpen = false;
  }

  // --- Raw REPL ---

  async enterRawRepl() {
    for (let attempt = 0; attempt < 3; attempt++) {
      // Ctrl-B leaves a raw REPL left over from a failed run; Ctrl-C ×2 stops
      // code.py; any key then gets past "Press any key to enter the REPL".
      this._buffer = '';
      await this._write('\x02\r\x03');
      await sleep(100);
      await this._write('\x03');
      await sleep(300);
      await this._write('\r');
      try {
        await this._readUntil('>>> ', 2000);
      } catch (e) {
        if (this._closed) throw e;
        continue;
      }
      await sleep(100);
      this._buffer = '';
      await this._write('\x01');
      try {
        await this._readUntil(RAW_PROMPT, 2000);
        return;
      } catch (e) {
        if (this._closed) throw e;
      }
    }
    throw new DeviceError(MSG_NO_REPL);
  }

  // Runs code in the raw REPL: returns stdout, throws with stderr.
  async exec(code, timeoutMs = EXEC_TIMEOUT_MS) {
    await this._write(code + '\x04');
    await this._readUntil('OK', timeoutMs);
    const stdout = (await this._readUntil('\x04', timeoutMs)).slice(0, -1);
    const stderr = (await this._readUntil('\x04>', timeoutMs)).slice(0, -2);
    if (stderr.trim()) throw new ReplError(stderr.trim().split('\n').pop().trim());
    return stdout;
  }

  async deviceCrcs(paths) {
    const out = await this.exec(`_crcs(${pyStr(paths)})`, CRC_TIMEOUT_MS);
    return JSON.parse(out.trim());
  }

  // --- Update flow ---

  _progress() { this.onProgress(this.files.map(({ path, state }) => ({ path, state }))); }

  async _fetchFile(f) {
    const res = await fetch(this.baseUrl + f.path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${f.path}: download failed (HTTP ${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length !== f.size || crcHex(crc32(bytes)) !== f.crc32) {
      throw new Error(`${f.path}: the published file does not match the manifest; try again in a few minutes`);
    }
    return bytes;
  }

  async _writeFile(f, bytes) {
    f.state = 'writing';
    this._progress();
    await this.exec(`_mkdirs(${pyStr(f.path)})\nf = open(${pyStr('/' + f.path + '.new')}, 'wb')`);
    for (let i = 0; i < bytes.length; i += CHUNK_BYTES) {
      await this.exec(`f.write(binascii.a2b_base64(b'${toBase64(bytes.subarray(i, i + CHUNK_BYTES))}'))`);
    }
    await this.exec('f.close()');
    const [got] = await this.deviceCrcs([f.path + '.new']);
    if (!got || got[0] !== f.size || crcHex(got[1]) !== f.crc32) {
      throw new DeviceError(`${f.path}: verification failed after writing`);
    }
    // FAT's rename won't replace a file: the old one is removed first, and the
    // previous code.py is kept as code.bak.
    await this.exec(`_swap(${pyStr(f.path)}, ${f.path === 'code.py' ? "'code.bak'" : 'None'})`);
    f.state = 'verified';
    this._progress();
  }

  async _cleanup() {
    try {
      await this.exec(`try:\n    f.close()\nexcept Exception:\n    pass\n_clean(${pyStr(this.files.map(f => f.path))})`);
    } catch { /* best effort: the next run removes leftovers too */ }
  }

  // Returns {version, changed}. On failure throws with a readable message and
  // keeps the port open, so run() can be called again (Retry).
  async run() {
    const { version } = this.manifest;
    let writing = false;
    try {
      this.onStatus('Opening the serial port…');
      await this.open();
      this.onStatus('Stopping code.py…');
      await this.enterRawRepl();
      await this.exec(DEVICE_HELPERS);
      try {
        await this.exec("storage.remount('/', readonly=False)");
      } catch (e) {
        // Remount fails while the host owns the drive (RULEBOOK §7.3).
        if (e instanceof ReplError) throw new DeviceError(MSG_MAINTENANCE);
        throw e;
      }

      this.onStatus('Comparing files…');
      const crcs = await this.deviceCrcs(this.files.map(f => f.path));
      this.files.forEach((f, i) => {
        const got = crcs[i];
        f.state = got && got[0] === f.size && crcHex(got[1]) === f.crc32 ? 'unchanged' : 'pending';
      });
      this._progress();
      const todo = this.files.filter(f => f.state === 'pending');

      if (todo.length) {
        // Download everything first, so a network problem can't stop the
        // update halfway through.
        this.onStatus(`Downloading ${todo.length} file(s)…`);
        const data = new Map();
        for (const f of todo) data.set(f, await this._fetchFile(f));
        writing = true;
        for (const [i, f] of todo.entries()) {
          this.onStatus(`Writing ${f.path} (${i + 1}/${todo.length})…`);
          await this._writeFile(f, data.get(f));
        }
        writing = false;
      }

      this.onStatus('Restarting the dongle…');
      await this.exec("storage.remount('/', readonly=True)");
      // A hard reset, because boot.py only runs on one. The device drops the
      // connection, so there is no reply to wait for.
      await this._write('import microcontroller\nmicrocontroller.reset()\x04');
      await sleep(500);
      await this.close();
      return { version, changed: todo.length > 0 };
    } catch (e) {
      const current = this.files.find(f => f.state === 'writing');
      if (current) { current.state = 'failed'; this._progress(); }
      if (writing && !this._closed) await this._cleanup();
      throw e;
    }
  }
}
