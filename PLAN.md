# Feature Plan: Trackpad, Draw Mode, Jiggle Settings, SVG Jiggle Path

## Context
The BLE Mouse Controller app currently only has discrete directional buttons for movement and one-shot click commands. Users want a finger-trackpad experience, the ability to draw in apps like Paint (hold-click while moving), configurable jiggler parameters, and a custom cursor path for the jiggler defined by freehand drawing or SVG upload.

---

## Overview of Changes

| Area | Files |
|------|-------|
| Device firmware | `device/code.py` |
| Web UI | `app/index.html` |
| Web logic | `app/app.js` |

---

## 1. New Device Commands (`device/code.py`)

Add these four commands to `handle_command()`:

### `PRESS [LEFT|RIGHT|MIDDLE]`
Holds a mouse button down without releasing.
```python
elif verb == "PRESS":
    btn = parts[1].upper() if len(parts) > 1 else "LEFT"
    if btn == "RIGHT":   m.press(Mouse.RIGHT_BUTTON)
    elif btn == "MIDDLE": m.press(Mouse.MIDDLE_BUTTON)
    else:                 m.press(Mouse.LEFT_BUTTON)
```

### `RELEASE [LEFT|RIGHT|MIDDLE]`
Releases a held mouse button.
```python
elif verb == "RELEASE":
    btn = parts[1].upper() if len(parts) > 1 else "LEFT"
    if btn == "RIGHT":   m.release(Mouse.RIGHT_BUTTON)
    elif btn == "MIDDLE": m.release(Mouse.MIDDLE_BUTTON)
    else:                 m.release(Mouse.LEFT_BUTTON)
```

### `JIGGLE speed amplitude`
Updates the jiggle interval and move magnitude at runtime.
- `speed`: float seconds (e.g. `2.0`)
- `amplitude`: int pixels (e.g. `5`)
```python
elif verb == "JIGGLE" and len(parts) >= 3:
    try:
        JIGGLE_INTERVAL = float(parts[1])
        amp = int(parts[2])
        JIGGLE_MOVES = [(amp,0,0),(0,amp,0),(-amp,0,0),(0,-amp,0)]
    except ValueError:
        pass
```
> Note: `JIGGLE_INTERVAL` and `JIGGLE_MOVES` must be declared `global` inside `handle_command`.

### `JIGGLEPATH dx1,dy1,dx2,dy2,...`
Replaces `JIGGLE_MOVES` with a custom path encoded as a flat comma-separated list.
Max ~30 points to stay within BLE MTU.
```python
elif verb == "JIGGLEPATH" and len(parts) >= 2:
    try:
        nums = [int(n) for n in parts[1].split(",")]
        pairs = [(nums[i], nums[i+1], 0) for i in range(0, len(nums)-1, 2)]
        if pairs:
            JIGGLE_MOVES = pairs
            move_index = 0
    except (ValueError, IndexError):
        pass
```

---

## 2. New "Trackpad" Tab (`app/index.html`)

Add a fourth tab button between Cipher and Settings:
```html
<button class="tab-btn" data-tab="trackpad">Trackpad</button>
```

### Trackpad panel HTML
```html
<div id="panel-trackpad" class="tab-panel hidden">

  <!-- Trackpad card -->
  <div class="card">
    <h2>Trackpad</h2>
    <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">
      <button id="btn-draw-mode" class="btn-primary" style="flex:1;">Draw Mode OFF</button>
      <button class="btn-blue" id="btn-right-click" disabled style="flex:1;">Right Click</button>
    </div>
    <div id="trackpad-area"
         style="width:100%;aspect-ratio:4/3;background:#0d1117;border:1px solid #1e4480;
                border-radius:10px;cursor:crosshair;touch-action:none;user-select:none;">
    </div>
    <div style="margin-top:0.75rem;" class="input-row">
      <label style="min-width:7rem;font-size:0.8rem;color:#aaa;">Sensitivity</label>
      <input type="range" id="trackpad-sensitivity" min="1" max="10" value="3"
             style="flex:1;accent-color:#3b82f6;" />
      <span id="sensitivity-val" style="min-width:1.5rem;text-align:right;font-size:0.85rem;">3</span>
    </div>
  </div>

</div>
```

### Jiggle Speed & Range card (inside Settings panel)
Add below the Keyboard Layout card, before the Save button:
```html
<div class="card">
  <h2>Jiggle Speed &amp; Range</h2>
  <div class="input-row" style="margin-bottom:0.5rem;">
    <label style="min-width:5rem;font-size:0.8rem;color:#aaa;">Speed (s)</label>
    <input type="range" id="jiggle-speed" min="0.5" max="30" step="0.5" value="2"
           style="flex:1;accent-color:#3b82f6;" />
    <span id="jiggle-speed-val" style="min-width:2.5rem;text-align:right;font-size:0.85rem;">2s</span>
  </div>
  <div class="input-row">
    <label style="min-width:5rem;font-size:0.8rem;color:#aaa;">Range (px)</label>
    <input type="range" id="jiggle-range" min="1" max="50" step="1" value="2"
           style="flex:1;accent-color:#3b82f6;" />
    <span id="jiggle-range-val" style="min-width:2.5rem;text-align:right;font-size:0.85rem;">2px</span>
  </div>
</div>

<div class="card">
  <h2>Jiggle Path</h2>
  <canvas id="jiggle-canvas" width="300" height="150"
          style="width:100%;background:#0d1117;border:1px solid #1e4480;
                 border-radius:8px;cursor:crosshair;touch-action:none;"></canvas>
  <div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
    <button id="btn-jiggle-clear" class="btn-primary" style="flex:1;">Clear</button>
    <label class="btn-primary" style="flex:1;display:flex;align-items:center;
           justify-content:center;cursor:pointer;padding:0.7rem 0.5rem;
           font-size:0.9rem;font-weight:600;letter-spacing:0.02em;">
      Load SVG
      <input type="file" id="jiggle-svg-upload" accept=".svg,image/svg+xml"
             style="display:none;" />
    </label>
    <button id="btn-jiggle-set" class="btn-green" style="flex:1;" disabled>Set Jiggle</button>
  </div>
</div>
```

---

## 3. Trackpad Logic (`app/app.js`)

### Add to `cmdButtons` selector
Add `#btn-right-click` to the querySelectorAll list so it auto-disables when not connected.

### Draw mode toggle
```js
let drawMode = false;
const btnDrawMode = document.getElementById('btn-draw-mode');
btnDrawMode.addEventListener('click', () => {
  drawMode = !drawMode;
  btnDrawMode.textContent = drawMode ? 'Draw Mode ON' : 'Draw Mode OFF';
  btnDrawMode.className = drawMode ? 'btn-green' : 'btn-primary';
});
```

### Right-click button
```js
document.getElementById('btn-right-click').addEventListener('click', () => sendCommand('CLICK RIGHT'));
```

### Sensitivity display
```js
const sensitivitySlider = document.getElementById('trackpad-sensitivity');
const sensitivityVal    = document.getElementById('sensitivity-val');
sensitivitySlider.addEventListener('input', () => {
  sensitivityVal.textContent = sensitivitySlider.value;
});
```

### Trackpad pointer events
Use `pointermove` with `getCoalescedEvents()` for smooth tracking. Throttle sends to max one per 40ms (25 Hz) to avoid BLE congestion.

```js
const trackpad = document.getElementById('trackpad-area');
let lastSendTime = 0;
let tpStartTime, tpMoved;

trackpad.addEventListener('pointerdown', e => {
  trackpad.setPointerCapture(e.pointerId);
  tpStartTime = Date.now(); tpMoved = false;
  if (drawMode) sendCommand('PRESS LEFT');
  e.preventDefault();
});

trackpad.addEventListener('pointermove', e => {
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  let totalDx = 0, totalDy = 0;
  for (const ce of events) { totalDx += ce.movementX; totalDy += ce.movementY; }
  const sens = parseInt(sensitivitySlider.value);
  const dx = Math.round(totalDx * sens);
  const dy = Math.round(totalDy * sens);
  if (dx !== 0 || dy !== 0) {
    tpMoved = true;
    const now = Date.now();
    if (now - lastSendTime >= 40) {
      sendCommand(`MOVE ${dx} ${dy}`);
      lastSendTime = now;
    }
  }
  e.preventDefault();
});

trackpad.addEventListener('pointerup', e => {
  if (drawMode) {
    sendCommand('RELEASE LEFT');
  } else if (!tpMoved && Date.now() - tpStartTime < 200) {
    sendCommand('CLICK LEFT');  // tap = left click
  }
  e.preventDefault();
});
```

---

## 4. Jiggle Settings Logic (`app/app.js`)

### Sliders with live display
```js
const jiggleSpeedSlider = document.getElementById('jiggle-speed');
const jiggleSpeedVal    = document.getElementById('jiggle-speed-val');
const jiggleRangeSlider = document.getElementById('jiggle-range');
const jiggleRangeVal    = document.getElementById('jiggle-range-val');

jiggleSpeedSlider.addEventListener('input', () => {
  jiggleSpeedVal.textContent = jiggleSpeedSlider.value + 's';
});
jiggleRangeSlider.addEventListener('input', () => {
  jiggleRangeVal.textContent = jiggleRangeSlider.value + 'px';
});
```

### Load from localStorage on init
```js
jiggleSpeedSlider.value = localStorage.getItem('jiggleSpeed') ?? '2';
jiggleSpeedVal.textContent = jiggleSpeedSlider.value + 's';
jiggleRangeSlider.value = localStorage.getItem('jiggleRange') ?? '2';
jiggleRangeVal.textContent = jiggleRangeSlider.value + 'px';
```

### Persist and send on Save (add to existing `btnSaveSettings` handler)
```js
localStorage.setItem('jiggleSpeed', jiggleSpeedSlider.value);
localStorage.setItem('jiggleRange', jiggleRangeSlider.value);
if (rxCharacteristic) {
  sendCommand(`JIGGLE ${jiggleSpeedSlider.value} ${jiggleRangeSlider.value}`);
}
```

---

## 5. Jiggle Path Canvas + SVG Upload (`app/app.js`)

### Canvas freehand drawing
```js
const jiggleCanvas = document.getElementById('jiggle-canvas');
const jCtx = jiggleCanvas.getContext('2d');
let jigglePath = [];
let jDrawing = false;

jiggleCanvas.addEventListener('pointerdown', e => {
  jDrawing = true; jigglePath = [];
  jCtx.clearRect(0, 0, jiggleCanvas.width, jiggleCanvas.height);
  jCtx.beginPath();
  const r = jiggleCanvas.getBoundingClientRect();
  const sx = jiggleCanvas.width / r.width, sy = jiggleCanvas.height / r.height;
  jCtx.moveTo((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
  jigglePath.push({ x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy });
  e.preventDefault();
});

jiggleCanvas.addEventListener('pointermove', e => {
  if (!jDrawing) return;
  const r = jiggleCanvas.getBoundingClientRect();
  const sx = jiggleCanvas.width / r.width, sy = jiggleCanvas.height / r.height;
  const x = (e.clientX - r.left) * sx, y = (e.clientY - r.top) * sy;
  jCtx.lineTo(x, y);
  jCtx.strokeStyle = '#3b82f6'; jCtx.lineWidth = 2; jCtx.stroke();
  jigglePath.push({ x, y });
  e.preventDefault();
});

jiggleCanvas.addEventListener('pointerup', () => {
  jDrawing = false;
  document.getElementById('btn-jiggle-set').disabled = jigglePath.length < 2;
});
```

### SVG upload + preview
```js
document.getElementById('jiggle-svg-upload').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(evt.target.result, 'image/svg+xml');
    const pathEl = svgDoc.querySelector('path');
    if (!pathEl) { addLog('! No <path> found in SVG', '#f87171'); return; }
    const pts = sampleSvgPath(pathEl, 30);
    if (pts.length < 2) { addLog('! SVG path too short', '#f87171'); return; }
    jCtx.clearRect(0, 0, jiggleCanvas.width, jiggleCanvas.height);
    jCtx.beginPath();
    pts.forEach((p, i) => i === 0 ? jCtx.moveTo(p.x, p.y) : jCtx.lineTo(p.x, p.y));
    jCtx.strokeStyle = '#3b82f6'; jCtx.lineWidth = 2; jCtx.stroke();
    jigglePath = pts;
    document.getElementById('btn-jiggle-set').disabled = false;
  };
  reader.readAsText(file);
});
```

### SVG path sampling helper (no external library — uses built-in browser API)
```js
function sampleSvgPath(pathEl, numPoints) {
  const total = pathEl.getTotalLength();
  const pts = [];
  for (let i = 0; i < numPoints; i++) {
    const pt = pathEl.getPointAtLength((i / (numPoints - 1)) * total);
    pts.push({ x: pt.x, y: pt.y });
  }
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  const scaleX = maxX > minX ? (jiggleCanvas.width  - 20) / (maxX - minX) : 1;
  const scaleY = maxY > minY ? (jiggleCanvas.height - 20) / (maxY - minY) : 1;
  return pts.map(p => ({ x: (p.x - minX) * scaleX + 10, y: (p.y - minY) * scaleY + 10 }));
}
```

### Clear button
```js
document.getElementById('btn-jiggle-clear').addEventListener('click', () => {
  jCtx.clearRect(0, 0, jiggleCanvas.width, jiggleCanvas.height);
  jigglePath = [];
  document.getElementById('btn-jiggle-set').disabled = true;
});
```

### "Set Jiggle" — downsample, convert to deltas, send
```js
document.getElementById('btn-jiggle-set').addEventListener('click', () => {
  if (jigglePath.length < 2) return;
  const step = Math.ceil(jigglePath.length / 30);
  const sampled = jigglePath.filter((_, i) => i % step === 0);
  const scale = 20 / Math.max(jiggleCanvas.width, jiggleCanvas.height);
  const nums = [];
  for (let i = 1; i < sampled.length; i++) {
    nums.push(Math.round((sampled[i].x - sampled[i-1].x) * scale));
    nums.push(Math.round((sampled[i].y - sampled[i-1].y) * scale));
  }
  sendCommand('JIGGLEPATH ' + nums.join(','));
});
```

---

## Implementation Order

1. **`device/code.py`** — add `PRESS`, `RELEASE`, `JIGGLE`, `JIGGLEPATH` to `handle_command()`; declare `JIGGLE_INTERVAL` and `JIGGLE_MOVES` as globals inside that function.
2. **`app/index.html`** — add "Trackpad" tab button + panel; add Jiggle Speed/Range and Jiggle Path cards to Settings panel.
3. **`app/app.js`** — wire up draw mode, trackpad pointer events, right-click button, jiggle slider persistence, jiggle canvas drawing, SVG upload, and "Set Jiggle" sender.

---

## Verification

1. Flash updated `code.py` to device; open serial console → confirm `PRESS LEFT` / `RELEASE LEFT` hold/release in Paint.
2. Open Paint → connect app → Trackpad tab → Draw Mode ON → drag finger → verify stroke appears.
3. Tap trackpad (< 200 ms, < 10 px movement) → verify left click fires without drawing.
4. Right Click button → verify context menu appears on PC.
5. Settings → adjust speed/range sliders → Save → verify cursor jiggle speed and amplitude change.
6. Settings → draw path on canvas → Set Jiggle → verify cursor traces that shape.
7. Settings → upload a simple SVG → Set Jiggle → verify cursor follows the path.
