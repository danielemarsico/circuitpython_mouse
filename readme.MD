# Circuitpython Mouse

A CircuitPython project for continuous mouse movement and keyboard input, controllable via Bluetooth (BLE UART).
Configured for the [MDBT50Q-RX](https://circuitpython.org/board/raytac_mdbt50q-rx/) (nRF52840).

---

## Flashing the Firmware

> **Note:** CircuitPython 8.2+ requires bootloader **0.6.1 or later**. If your board has an older bootloader (check the boot info printed over USB serial), update it first.

### Step 1 — Update the Bootloader (if needed)

1. Hold the button and plug the board into USB — it appears as a `MDBT50QRX` USB drive
2. Drag `device/firmware/update-raytac_mdbt50q_rx_bootloader-0.10.0_nosd.uf2` onto the drive
3. The board will reboot back into bootloader mode with version 0.10.0

### Step 2 — Flash CircuitPython

1. Hold the button and plug in again to enter bootloader mode (`MDBT50QRX` drive)
2. Drag `device/firmware/adafruit-circuitpython-raytac_mdbt50q-rx-en_US-10.1.3.uf2` onto the drive
3. The board will reboot and appear as a `CIRCUITPY` USB drive

## Deploying the Code

Copy the following onto the `CIRCUITPY` drive:

- `device/code.py` → `CIRCUITPY/code.py`
- `device/lib/` → `CIRCUITPY/lib/`
- `device/secret.txt` → `CIRCUITPY/secret.txt` *(required for the CIPHER command — edit it first)*

> **Linux users:** always run `sync` after copying files to avoid empty files caused by the OS flushing writes after the device reboots:
> ```bash
> cp device/code.py /media/$USER/CIRCUITPY/ && sync
> ```

The code runs automatically on boot.

---

## Usage

### Physical Button

Press the button on the board to toggle the auto-movement on/off. The LED indicates the current state (on = LED lit).

### Bluetooth (BLE UART)

The board advertises a Nordic UART BLE service. You can connect using:

- The **Progressive Web App** (see [Web App](#web-app) section below)
- Any BLE UART app such as [Adafruit Bluefruit Connect](https://learn.adafruit.com/bluefruit-le-connect)

Send the following text commands (terminated with a newline):

| Command         | Action                                                      |
|-----------------|-------------------------------------------------------------|
| `START`         | Enable auto-movement                                        |
| `STOP`          | Disable auto-movement                                       |
| `TOGGLE`        | Toggle auto-movement on/off                                 |
| `MOVE x y`      | Move mouse by x,y pixels (e.g. `MOVE 50 -20`)              |
| `CLICK`         | Left click                                                  |
| `CLICK LEFT`    | Left click                                                  |
| `CLICK RIGHT`   | Right click                                                 |
| `CLICK MIDDLE`  | Middle click                                                |
| `SCROLL n`      | Scroll by n steps (positive=up, negative=down)              |
| `TYPE text`     | Type text via USB HID keyboard (printable ASCII only, e.g. `TYPE Hello World`) |
| `LAYOUT EN`     | Switch the keyboard layout to English (US)                  |
| `LAYOUT IT`     | Switch the keyboard layout to Italian (Windows)             |
| `CIPHER <b64>`  | Decrypt an AES-128-CTR payload and type the result (see [Cipher](#cipher)) |

The board re-advertises automatically after a disconnect.

---

## Cipher

The `CIPHER` command lets the web app send sensitive text (e.g. passwords) over BLE without transmitting it in plaintext.

### How it works

- **Encryption:** AES-128-CTR. A fresh random 16-byte IV is generated for every message.
- **Payload format:** `CIPHER <base64(IV + ciphertext)>`
- **Key derivation:** the pre-shared password is UTF-8-encoded and zero-padded/truncated to 16 bytes. Both the device and the app use the same derivation.

### Setup

1. Choose a strong password and write it as the only line in `device/secret.txt`.
2. Copy `secret.txt` to `CIRCUITPY/secret.txt`.
3. Open the **Settings** tab in the web app, enter the same password in the **Pre-shared Key** field, and click **Save** — it is stored in the browser's `localStorage` and persists across sessions.

> **Security note:** AES-128-CTR with a random IV protects against passive BLE sniffing. The password itself is stored in plaintext on the device (`secret.txt`) and in `localStorage` in the browser, so physical access to either device defeats the protection.

---

## Web App

A Progressive Web App (PWA) is included in `app/` to control the device from Android (or any browser with Web Bluetooth support, such as Chrome on Android or desktop Chrome/Edge).

Hosted on GitHub Pages: [danielemarsico.github.io/circuitpython_mouse](https://danielemarsico.github.io/circuitpython_mouse/)

### Features

- Connect / disconnect to the board via BLE
- Buttons for all commands: Start, Stop, Toggle, Click (L/M/R), Scroll
- Move controls: X/Y number inputs and an arrow pad
- **Type Text** — send text to be typed via the USB HID keyboard on the connected PC
- **Cipher Text** — encrypt and send sensitive text using AES-128-CTR; the device decrypts and types it
- **Keyboard Layout** (Settings tab) — select English (US) or Italian; saved in `localStorage` and sent to the device on Save. The layout must match the OS keyboard layout of the machine the dongle is plugged into
- Custom command text box — type any raw command and press Send or Enter
- Live log showing sent commands and replies from the device
- Installable on Android as a home screen app (PWA)
- `ble-debug.html` — standalone debug page for testing BLE connectivity and commands

### Requirements

- Chrome on Android (or any Chromium-based browser with Web Bluetooth)
- The app **must be served over HTTPS** — Web Bluetooth does not work over plain HTTP

### Self-hosting with Docker

The app is packaged as a Docker container served by nginx. It listens on HTTP port 80 — TLS must be terminated by your reverse proxy (nginx, Traefik, Caddy, etc.), which is required for Web Bluetooth to work.

```bash
# From the repo root
docker compose -f app/docker-compose.yml up -d --build
```

The app is then available at `http://<server-ip>:9090`. Point your reverse proxy to that address and expose it over HTTPS.

### Installing on Android

1. Open the app URL in Chrome
2. Tap the menu → **Add to Home Screen**
3. The app installs like a native app and works offline

---

## Project Structure

```
app/
├── index.html           # UI (buttons, inputs, log)
├── app.js               # Web Bluetooth + command logic
├── about.html           # Project description page
├── ble-debug.html       # Standalone BLE debug/test page
├── manifest.json        # PWA manifest
├── service-worker.js    # Offline caching
├── Dockerfile           # nginx:alpine container
├── nginx.conf           # nginx config (gzip, caching, SPA fallback)
└── docker-compose.yml   # Compose file (port 9090)

device/
├── code.py              # Main CircuitPython script
├── secret.txt           # Pre-shared password for CIPHER command (copy to CIRCUITPY/)
├── firmware/            # Bootloader updater + CircuitPython 10.1.3 (.uf2)
└── lib/
    ├── adafruit_ble/                # BLE + Nordic UART service
    ├── adafruit_hid/                # USB HID (mouse + keyboard)
    ├── adafruit_debouncer.mpy       # Button debouncing
    ├── adafruit_ticks.mpy           # Timing utility
    ├── keyboard_layout_win_it.mpy   # Italian keyboard layout (Windows)
    └── keycode_win_it.mpy           # Italian keycodes
```

---

Enjoy!

---

## License

MIT — see [LICENSE](LICENSE) for details.
