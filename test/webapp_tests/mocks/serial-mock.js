// Mock of the Web Serial API with a CircuitPython dongle behind it: friendly
// and raw REPL, and a fake filesystem. Injected via page.addInitScript().
//
// It understands only the code app/updater.js sends (the helper definitions
// and one-line calls to them), matched by pattern, not a Python interpreter.

(() => {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = bytes => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const fromBase64 = b64 => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  const traceback = msg => `Traceback (most recent call last):\r\n  File "<stdin>", line 1, in <module>\r\n${msg}\r\n`;

  const mock = window.__serialMock = {
    fs: {},               // '/path' -> Uint8Array
    driveMounted: false,  // maintenance mode: remount fails
    failWriteOn: null,    // path whose f.write raises OSError
    silent: false,        // no REPL at all on this port
    writable: false,
    resets: 0,
    execs: [],            // every raw REPL program received
    portRequests: 0,

    setFiles(files) {     // {path: base64}
      this.fs = {};
      for (const [p, b64] of Object.entries(files)) this.fs['/' + p] = fromBase64(b64);
    },
    file(path) {
      const f = this.fs['/' + path];
      return f ? new TextDecoder().decode(f) : null;
    },
    paths() { return Object.keys(this.fs).map(p => p.slice(1)).sort(); },
    written() {           // files opened for writing, in order
      return this.execs.map(c => c.match(/f = open\("\/(.*)\.new", 'wb'\)/)?.[1]).filter(Boolean);
    },
  };

  let ctrl = null;
  let mode = 'running';   // running | friendly | raw
  let rawBuf = '';
  let openFile = null;    // {path, chunks: []}
  let helpers = false;

  const emit = text => { if (ctrl) ctrl.enqueue(new TextEncoder().encode(text)); };

  function run(code) {
    mock.execs.push(code);
    const parsePaths = s => JSON.parse(s);
    let m;
    if (code.includes('def _crc(')) { helpers = true; return ['', '']; }
    if (!helpers && /^_/.test(code)) return ['', traceback("NameError: name '_crcs' isn't defined")];
    if (code === "storage.remount('/', readonly=False)") {
      if (mock.driveMounted) return ['', traceback("RuntimeError: Cannot remount '/' when visible via USB.")];
      mock.writable = true;
      return ['', ''];
    }
    if (code === "storage.remount('/', readonly=True)") { mock.writable = false; return ['', '']; }
    if ((m = code.match(/^_crcs\((.*)\)$/))) {
      const out = parsePaths(m[1]).map(p => {
        const f = mock.fs['/' + p];
        return f ? [f.length, crc32(f)] : null;
      });
      return [JSON.stringify(out).replace(/,/g, ', ') + '\r\n', ''];
    }
    if ((m = code.match(/^_mkdirs\(.*\)\nf = open\("(.*)", 'wb'\)$/))) {
      if (!mock.writable) return ['', traceback("OSError: [Errno 30] Read-only filesystem")];
      openFile = { path: m[1], chunks: [] };
      return ['', ''];
    }
    if ((m = code.match(/^f\.write\(binascii\.a2b_base64\(b'(.*)'\)\)$/))) {
      if (mock.failWriteOn && openFile.path === '/' + mock.failWriteOn + '.new') {
        return ['', traceback('OSError: [Errno 28] No space left on device')];
      }
      openFile.chunks.push(fromBase64(m[1]));
      return ['', ''];
    }
    if (code === 'f.close()') {
      const size = openFile.chunks.reduce((n, c) => n + c.length, 0);
      const data = new Uint8Array(size);
      let o = 0;
      for (const c of openFile.chunks) { data.set(c, o); o += c.length; }
      mock.fs[openFile.path] = data;
      openFile = null;
      return ['', ''];
    }
    if ((m = code.match(/^_swap\((".*"), (None|'code\.bak')\)$/))) {
      const t = '/' + JSON.parse(m[1]);
      if (m[2] !== 'None') {
        if (mock.fs[t]) mock.fs['/code.bak'] = mock.fs[t];
      }
      delete mock.fs[t];
      mock.fs[t] = mock.fs[t + '.new'];
      delete mock.fs[t + '.new'];
      return ['', ''];
    }
    if ((m = code.match(/_clean\((.*)\)$/))) {
      openFile = null;
      for (const p of parsePaths(m[1])) delete mock.fs['/' + p + '.new'];
      return ['', ''];
    }
    if (code.includes('microcontroller.reset()')) {
      mock.resets++;
      mode = 'running';
      helpers = false;
      ctrl?.close();    // the USB device goes away
      ctrl = null;
      return null;
    }
    return ['', traceback('SyntaxError: mock does not understand: ' + code.slice(0, 40))];
  }

  function feed(text) {
    if (mock.silent) return;
    for (const ch of text) {
      if (mode === 'raw') {
        if (ch === '\x02') { mode = 'friendly'; emit('\r\n>>> '); }
        else if (ch === '\x04') {
          const result = run(rawBuf);
          rawBuf = '';
          if (result) emit('OK' + result[0] + '\x04' + result[1] + '\x04>');
        } else rawBuf += ch;
      } else if (ch === '\x03') {
        if (mode === 'running') {
          emit('\r\nKeyboardInterrupt\r\nCode done running.\r\n\r\nPress any key to enter the REPL. Use CTRL-D to reload.\r\n');
          mode = 'waiting';
        } else if (mode === 'friendly') emit('\r\nKeyboardInterrupt\r\n>>> ');
      } else if (mode === 'waiting') {
        mode = 'friendly';
        emit('\r\nAdafruit CircuitPython 10.1.3 on 2026-01-01; Raytac MDBT50Q-RX\r\n>>> ');
      } else if (mode === 'friendly') {
        if (ch === '\x01') { mode = 'raw'; rawBuf = ''; emit('raw REPL; CTRL-B to exit\r\n>'); }
        else if (ch === '\r') emit('\r\n>>> ');
      }
    }
  }

  const port = {
    readable: null,
    writable: null,
    async open() {
      if (this.readable) throw new DOMException('The port is already open.', 'InvalidStateError');
      this.readable = new ReadableStream({ start(c) { ctrl = c; } });
      const decoder = new TextDecoder();
      this.writable = new WritableStream({ write(chunk) { feed(decoder.decode(chunk, { stream: true })); } });
    },
    async close() { this.readable = null; this.writable = null; },
    getInfo() { return { usbVendorId: 0x239a, usbProductId: 0x8100 }; },
  };

  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      async requestPort() { mock.portRequests++; return port; },
      async getPorts() { return [port]; },
    },
  });
})();
