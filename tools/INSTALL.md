# Installing / upgrading the dongle

This archive contains everything that belongs on the dongle:

```
CIRCUITPY/          # copy the contents of this folder to the drive root
├── boot.py         # USB setup (HID-only unless the button is held at boot)
├── code.py         # main firmware
└── lib/            # CircuitPython libraries
secret.txt.example  # rename to secret.txt on the drive and set your password
install.sh          # Linux / macOS installer
install.ps1         # Windows installer
```

## Mount the drive first

If `boot.py` is already installed, the `CIRCUITPY` drive is hidden by design.
Do **not** hold the button while plugging in — that enters the UF2 bootloader.
Instead, with the dongle plugged in and running:

- **hold the button for 3 seconds**, or
- send the BLE command **`MAINTENANCE`** from the web app.

The board resets and the `CIRCUITPY` drive appears for that one boot. Install,
then unplug and re-plug to return to HID-only mode.

## Linux / macOS

```bash
chmod +x install.sh
./install.sh                      # auto-detects the CIRCUITPY mount point
./install.sh /media/$USER/CIRCUITPY   # or pass it explicitly
```

## Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Target E:\
```

## Manual install

Copy the contents of `CIRCUITPY/` onto the drive root, then copy
`secret.txt.example` to `secret.txt` and edit it. On Linux run `sync`
afterwards, otherwise files can end up empty when the board reboots.

## Notes

- Both installers **keep an existing `secret.txt`**, so upgrades never wipe your
  CIPHER password.
- `lib/` is merged, not wiped — remove stale libraries by hand if you need to.
- Unplug and re-plug **without** holding the button to run the new code.
