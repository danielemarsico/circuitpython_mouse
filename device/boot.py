# boot.py - runs once at power-up, before code.py, and decides which USB
# devices the dongle exposes to the host.
#
# Default: HID only (mouse + keyboard). The CIRCUITPY drive is hidden so the
# dongle looks like a plain input device when plugged into a PC.
#
# Escape hatch: hold the on-board BUTTON while plugging in / resetting the
# board and the CIRCUITPY drive comes back so you can edit code.py again.
import board
import digitalio
import storage

button = digitalio.DigitalInOut(board.BUTTON)
button.switch_to_input(pull=digitalio.Pull.UP)

# Button is active-low: pressed == False
maintenance_mode = not button.value

led = digitalio.DigitalInOut(board.INVERTED_LED)
led.direction = digitalio.Direction.OUTPUT
led.value = not maintenance_mode  # True == OFF, so LED is lit in maintenance

if not maintenance_mode:
    # Hide the mass-storage drive: the dongle enumerates as HID only.
    storage.disable_usb_drive()

button.deinit()
led.deinit()
