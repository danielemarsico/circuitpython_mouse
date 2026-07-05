# Tasks

## Phase 1 — Device Firmware (`device/code.py`)

- [x] Add `PRESS [LEFT|RIGHT|MIDDLE]` command to `handle_command()`
- [x] Add `RELEASE [LEFT|RIGHT|MIDDLE]` command to `handle_command()`
- [x] Add `JIGGLE speed amplitude` command to `handle_command()`; declare `JIGGLE_INTERVAL` and `JIGGLE_MOVES` as `global`
- [x] Add `JIGGLEPATH dx1,dy1,...` command to `handle_command()`; reset `move_index` to 0 on update

## Phase 2 — HTML (`app/index.html`)

- [x] Add "Trackpad" tab button (between Cipher and Settings)
- [x] Add Trackpad panel (`#panel-trackpad`) with: trackpad area, Draw Mode toggle, Right Click button, Sensitivity slider
- [x] Add "Jiggle Speed & Range" card inside Settings panel (before Save button)
- [x] Add "Jiggle Path" card inside Settings panel (canvas + Clear / Load SVG / Set Jiggle buttons)

## Phase 3 — JavaScript (`app/app.js`)

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

## Phase 4 — Verification

- [x] Flash updated `code.py`; confirm `PRESS LEFT` / `RELEASE LEFT` hold/release in Paint
- [x] Draw Mode ON on Trackpad tab → drag finger → verify stroke in Paint
- [x] Tap trackpad (< 200 ms) → verify left click fires without drawing
- [x] Right Click button → verify context menu appears
- [ ] Adjust Jiggle speed/range sliders → Save → verify jiggle behavior changes
- [x] Draw path on canvas → Set Jiggle → verify cursor traces shape
- [ ] Upload SVG → Set Jiggle → verify cursor follows path
