# boot.py - runs once at power-up, before code.py, and decides which USB
# devices the dongle exposes to the host.
#
# Default: HID only (mouse + keyboard). The CIRCUITPY drive is hidden so the
# dongle looks like a plain input device when plugged into a PC.
#
# Maintenance mode: the drive comes back for one boot when the flag file below
# exists. code.py creates it on a long button press or on the BLE MAINTENANCE
# command, then resets the board. The flag is cleared here, so the next boot is
# HID-only again.
#
# The on-board button cannot be used directly: holding it at power-up enters the
# UF2 bootloader, before CircuitPython (and this file) ever runs.
import os
import storage

MAINTENANCE_FLAG = "maintenance.flag"


def flag_present():
    try:
        os.stat(MAINTENANCE_FLAG)
        return True
    except OSError:
        return False


if flag_present():
    # Consume the flag so maintenance mode lasts exactly one boot. The
    # filesystem must be writable by CircuitPython to delete it, then read-only
    # again so the host gets write access to the drive.
    try:
        storage.remount("/", readonly=False)
        os.remove(MAINTENANCE_FLAG)
    except OSError:
        pass
    finally:
        try:
            storage.remount("/", readonly=True)
        except OSError:
            pass
else:
    # Hide the mass-storage drive: the dongle enumerates as HID only.
    storage.disable_usb_drive()
