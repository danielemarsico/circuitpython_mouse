#!/usr/bin/env bash
# Install / upgrade the dongle firmware payload on a mounted CIRCUITPY drive.
#
# Usage:
#   ./install.sh                 # auto-detect the CIRCUITPY drive
#   ./install.sh /media/me/CIRCUITPY
#
# Works both inside the extracted release zip (payload in ./CIRCUITPY) and in a
# repository checkout (payload in ../device).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -d "$SCRIPT_DIR/CIRCUITPY" ]]; then
    PAYLOAD="$SCRIPT_DIR/CIRCUITPY"
elif [[ -d "$SCRIPT_DIR/../device" ]]; then
    PAYLOAD="$(cd "$SCRIPT_DIR/../device" && pwd)"
else
    echo "error: cannot find the payload (expected ./CIRCUITPY or ../device)" >&2
    exit 1
fi

find_drive() {
    local candidate
    for candidate in \
        "/media/$USER/CIRCUITPY" \
        /media/*/CIRCUITPY \
        /run/media/"$USER"/CIRCUITPY \
        /run/media/*/CIRCUITPY \
        /mnt/CIRCUITPY \
        /Volumes/CIRCUITPY; do
        if [[ -d "$candidate" ]]; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
    if ! TARGET="$(find_drive)"; then
        cat >&2 <<'EOF'
error: no CIRCUITPY drive found.

If boot.py is already installed the drive is hidden by design. With the dongle
plugged in and running, hold the button for 3 seconds (or send the BLE command
MAINTENANCE) to reboot into maintenance mode, then re-run this script.
Do not hold the button while plugging in: that enters the UF2 bootloader.
You can also pass the mount point explicitly:  ./install.sh /media/me/CIRCUITPY
EOF
        exit 1
    fi
fi

if [[ ! -d "$TARGET" ]]; then
    echo "error: $TARGET is not a directory" >&2
    exit 1
fi

echo "Payload: $PAYLOAD"
echo "Target:  $TARGET"

# secret.txt is user data: never overwrite an existing one.
if [[ ! -f "$TARGET/secret.txt" ]]; then
    if [[ -f "$SCRIPT_DIR/secret.txt.example" ]]; then
        cp "$SCRIPT_DIR/secret.txt.example" "$TARGET/secret.txt"
    elif [[ -f "$PAYLOAD/secret.txt" ]]; then
        cp "$PAYLOAD/secret.txt" "$TARGET/secret.txt"
    fi
    echo "Created secret.txt (edit it to set your CIPHER password)"
else
    echo "Kept existing secret.txt"
fi

for file in boot.py code.py; do
    if [[ -f "$PAYLOAD/$file" ]]; then
        cp "$PAYLOAD/$file" "$TARGET/$file"
        echo "Copied $file"
    fi
done

if [[ -d "$PAYLOAD/lib" ]]; then
    mkdir -p "$TARGET/lib"
    cp -R "$PAYLOAD/lib/." "$TARGET/lib/"
    echo "Copied lib/"
fi

# Flush writes before the board reboots, otherwise files can end up empty.
sync
echo "Done. Unplug and re-plug the dongle (without holding the button) to run it."
