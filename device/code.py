import time
import board
import digitalio
import usb_hid
import binascii
import aesio
from adafruit_hid.mouse import Mouse
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keyboard_layout_us import KeyboardLayoutUS
from adafruit_hid.keycode import Keycode
try:
    from keyboard_layout_win_it import KeyboardLayout as KeyboardLayoutIT
    _HAS_IT_LAYOUT = True
except ImportError:
    _HAS_IT_LAYOUT = False
from adafruit_debouncer import Debouncer
import adafruit_ble
from adafruit_ble.advertising.standard import ProvideServicesAdvertisement
from adafruit_ble.services.nordic import UARTService

# Wait at the beginning
print("booting...")
time.sleep(10)

# Load AES key from secret.txt (place the file on the device's USB drive)
def _make_key(password):
    b = password.encode("utf-8")
    return bytes((list(b) + [0] * 16)[:16])

try:
    with open("secret.txt", "r") as f:
        cipher_key = _make_key(f.read().strip())
    print("cipher key loaded")
except OSError:
    cipher_key = None
    print("secret.txt not found, CIPHER disabled")

# Setup mouse
print("setting up mouse...")
m = Mouse(usb_hid.devices)
kbd = Keyboard(usb_hid.devices)
layout = KeyboardLayoutUS(kbd)

# Setup LED
led = digitalio.DigitalInOut(board.INVERTED_LED)
led.direction = digitalio.Direction.OUTPUT
led.value = True  # True == OFF

# Setup button
button = digitalio.DigitalInOut(board.BUTTON)
button.switch_to_input(pull=digitalio.Pull.UP)
switch = Debouncer(button)

# Setup BLE UART
print("setting up BLE...")
ble = adafruit_ble.BLERadio()
print("BLE name:", ble.name)
uart_service = UARTService()
advertisement = ProvideServicesAdvertisement(uart_service)
ble.start_advertising(advertisement)
print("advertising started")
ble_was_connected = False

# Setup Status
status = True
move_index = 0
last_movement = time.monotonic()

# Jiggler config
JIGGLE_INTERVAL = 2  # seconds between each move
JIGGLE_MOVES = [
    (2, 0, 0),
    (0, 2, 0),
    (-2, 0, 0),
    (0, -2, 0),
]


def _decrypt_cipher(b64_payload):
    # Payload = base64(16-byte IV + AES-CTR ciphertext)
    data = binascii.a2b_base64(b64_payload)
    iv = bytearray(data[:16])
    ct = bytearray(data[16:])
    pt = bytearray(len(ct))
    aesio.AES(cipher_key, aesio.MODE_CTR, iv).decrypt_into(ct, pt)
    return pt.decode("utf-8")


def handle_command(cmd):
    global status, move_index, last_movement, layout, JIGGLE_INTERVAL, JIGGLE_MOVES
    cmd = cmd.strip()
    parts = cmd.split()
    verb = parts[0].upper() if parts else ""
    if not parts:
        return
    if verb == "TOGGLE":
        status = not status
        move_index = 0
        last_movement = time.monotonic()
    elif verb == "START":
        status = True
    elif verb == "STOP":
        status = False
        move_index = 0
        last_movement = time.monotonic()
    elif verb == "MOVE" and len(parts) >= 3:
        try:
            m.move(int(parts[1]), int(parts[2]), 0)
        except ValueError:
            pass
    elif verb == "CLICK":
        btn = parts[1].upper() if len(parts) > 1 else "LEFT"
        if btn == "RIGHT":
            m.click(Mouse.RIGHT_BUTTON)
        elif btn == "MIDDLE":
            m.click(Mouse.MIDDLE_BUTTON)
        else:
            m.click(Mouse.LEFT_BUTTON)
    elif verb == "SCROLL" and len(parts) >= 2:
        try:
            m.move(0, 0, int(parts[1]))
        except ValueError:
            pass
    elif verb == "PRESS":
        btn = parts[1].upper() if len(parts) > 1 else "LEFT"
        if btn == "RIGHT":
            m.press(Mouse.RIGHT_BUTTON)
        elif btn == "MIDDLE":
            m.press(Mouse.MIDDLE_BUTTON)
        else:
            m.press(Mouse.LEFT_BUTTON)
    elif verb == "RELEASE":
        btn = parts[1].upper() if len(parts) > 1 else "LEFT"
        if btn == "RIGHT":
            m.release(Mouse.RIGHT_BUTTON)
        elif btn == "MIDDLE":
            m.release(Mouse.MIDDLE_BUTTON)
        else:
            m.release(Mouse.LEFT_BUTTON)
    elif verb == "JIGGLE" and len(parts) >= 3:
        try:
            JIGGLE_INTERVAL = float(parts[1])
            amp = int(parts[2])
            JIGGLE_MOVES = [(amp, 0, 0), (0, amp, 0), (-amp, 0, 0), (0, -amp, 0)]
        except ValueError:
            pass
    elif verb == "JIGGLEPATH" and len(parts) >= 2:
        try:
            nums = [int(n) for n in parts[1].split(",")]
            pairs = [(nums[i], nums[i + 1], 0) for i in range(0, len(nums) - 1, 2)]
            if pairs:
                JIGGLE_MOVES = pairs
                move_index = 0
        except (ValueError, IndexError):
            pass
    elif verb == "TYPE" and len(cmd) > 5:
        try:
            layout.write(cmd[5:])
        except ValueError:
            pass
    elif verb == "KEY" and len(parts) >= 2:
        key_name = parts[1].upper()
        key = getattr(Keycode, key_name, None)
        if key is not None:
            kbd.press(key)
            kbd.release_all()
    elif verb == "LAYOUT" and len(parts) >= 2:
        lang = parts[1].upper()
        if lang == "EN":
            layout = KeyboardLayoutUS(kbd)
            return "Layout: EN"
        elif lang == "IT":
            if _HAS_IT_LAYOUT:
                layout = KeyboardLayoutIT(kbd)
                return "Layout: IT"
            else:
                return "Layout IT not available"
    elif verb == "CIPHER" and len(parts) >= 2:
        if cipher_key:
            try:
                layout.write(_decrypt_cipher(parts[1]))
            except Exception as e:
                print("CIPHER error:", e)
        else:
            print("CIPHER: no key loaded (secret.txt missing)")


while True:
    now = time.monotonic()
    switch.update()
    if switch.fell:
        status = not status

    # BLE: handle reconnection and incoming commands
    if ble.connected:
        if not ble_was_connected:
            print("BLE connected")
        ble_was_connected = True
        if uart_service.in_waiting:
            raw = uart_service.readline()
            if raw:
                cmd = raw.decode("utf-8").strip()
                print("raw bytes:", raw)
                print("cmd:", repr(cmd))
                response = handle_command(cmd)
                if response:
                    try:
                        uart_service.write((response + "\n").encode("utf-8"))
                    except Exception:
                        pass
    elif ble_was_connected:
        print("BLE disconnected, re-advertising...")
        ble_was_connected = False
        ble.start_advertising(advertisement)

    jiggling = status or not ble.connected
    if jiggling:
        led.value = False
        if now - last_movement > JIGGLE_INTERVAL:
            dx, dy, dw = JIGGLE_MOVES[move_index]
            m.move(dx, dy, dw)
            move_index = (move_index + 1) % len(JIGGLE_MOVES)
            last_movement = time.monotonic()
    else:
        led.value = True
        move_index = 0
        last_movement = time.monotonic()
