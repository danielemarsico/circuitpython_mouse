# Tasks

## Phase 1 — Device Firmware (`device/code.py`)

- [ ] Add `PRESS [LEFT|RIGHT|MIDDLE]` command to `handle_command()`
- [ ] Add `RELEASE [LEFT|RIGHT|MIDDLE]` command to `handle_command()`
- [ ] Add `JIGGLE speed amplitude` command to `handle_command()`; declare `JIGGLE_INTERVAL` and `JIGGLE_MOVES` as `global`
- [ ] Add `JIGGLEPATH dx1,dy1,...` command to `handle_command()`; reset `move_index` to 0 on update

## Phase 2 — HTML (`app/index.html`)

- [ ] Add "Trackpad" tab button (between Cipher and Settings)
- [ ] Add Trackpad panel (`#panel-trackpad`) with: trackpad area, Draw Mode toggle, Right Click button, Sensitivity slider
- [ ] Add "Jiggle Speed & Range" card inside Settings panel (before Save button)
- [ ] Add "Jiggle Path" card inside Settings panel (canvas + Clear / Load SVG / Set Jiggle buttons)

## Phase 3 — JavaScript (`app/app.js`)

- [ ] Add `#btn-right-click` to `cmdButtons` querySelectorAll so it auto-disables when disconnected
- [ ] Implement Draw Mode toggle (`drawMode` flag, button label/class swap)
- [ ] Wire Right Click button → `sendCommand('CLICK RIGHT')`
- [ ] Wire Sensitivity slider → live display update
- [ ] Implement trackpad pointer events (`pointerdown`, `pointermove`, `pointerup`) with 40 ms throttle and draw-mode PRESS/RELEASE
- [ ] Implement Jiggle Speed/Range sliders with live display
- [ ] Load jiggle slider values from `localStorage` on init
- [ ] Persist and send `JIGGLE` command in existing `btnSaveSettings` handler
- [ ] Implement Jiggle Path canvas freehand drawing (pointerdown/move/up)
- [ ] Implement SVG upload + `sampleSvgPath()` helper + canvas preview
- [ ] Implement Clear button for jiggle canvas
- [ ] Implement "Set Jiggle" button — downsample path, convert to deltas, send `JIGGLEPATH`

## Phase 4 — Verification

- [ ] Flash updated `code.py`; confirm `PRESS LEFT` / `RELEASE LEFT` hold/release in Paint
- [ ] Draw Mode ON on Trackpad tab → drag finger → verify stroke in Paint
- [ ] Tap trackpad (< 200 ms) → verify left click fires without drawing
- [ ] Right Click button → verify context menu appears
- [ ] Adjust Jiggle speed/range sliders → Save → verify jiggle behavior changes
- [ ] Draw path on canvas → Set Jiggle → verify cursor traces shape
- [ ] Upload SVG → Set Jiggle → verify cursor follows path
