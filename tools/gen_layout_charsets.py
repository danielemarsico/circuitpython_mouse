#!/usr/bin/env python3
"""Generate app/layouts.json: the characters each keyboard layout can type.

Usage:
    python3 tools/gen_layout_charsets.py [--src DIR] [--output app/layouts.json]

The web app filters dictated text through this table before sending TYPE, so
nothing reaches the dongle that its active layout cannot type. The table is
read from the layout sources' ASCII_TO_KEYCODE, HIGHER_ASCII and COMBINED_KEYS
with `ast` (the files are parsed, never executed).

Sources are downloaded from the pinned versions below, which match the .mpy
files in device/lib/. --src reads <module>.py files from a local directory
instead. Re-run this after adding a layout to LAYOUTS (and to device/code.py).
"""
import argparse
import ast
import json
import pathlib
import urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent

# adafruit_hid 6.1.8 is the version bundled in device/lib/adafruit_hid.
HID_URL = "https://raw.githubusercontent.com/adafruit/Adafruit_CircuitPython_HID/6.1.8/adafruit_hid/{}.py"
# Circuitpython_Keyboard_Layouts release 20250409 (the 10.x .mpy in device/lib/).
NERADOC_URL = ("https://raw.githubusercontent.com/Neradoc/Circuitpython_Keyboard_Layouts/"
               "6b4cf4fd8ce761dc71b8a8ae219976a9a3510600/libraries/layouts/{}.py")

# Same codes and modules as LAYOUTS in device/code.py.
LAYOUTS = {
    "US": ("English (US)", "keyboard_layout_us", HID_URL),
    "IT": ("Italiano", "keyboard_layout_win_it", NERADOC_URL),
    "UK": ("English (UK)", "keyboard_layout_win_uk", NERADOC_URL),
    "DE": ("Deutsch", "keyboard_layout_win_de", NERADOC_URL),
    "FR": ("Français", "keyboard_layout_win_fr", NERADOC_URL),
    "ES": ("Español", "keyboard_layout_win_es", NERADOC_URL),
}

TABLES = ("ASCII_TO_KEYCODE", "HIGHER_ASCII", "COMBINED_KEYS")


def read_source(module, url, src_dir):
    if src_dir:
        return (pathlib.Path(src_dir) / f"{module}.py").read_text(encoding="utf-8")
    with urllib.request.urlopen(url.format(module), timeout=30) as resp:
        return resp.read().decode("utf-8")


def layout_tables(source):
    """The literal values of the layout class's tables, by name."""
    tables = {}
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id in TABLES:
                tables[target.id] = ast.literal_eval(node.value)
    return tables


def typable_chars(tables):
    ascii_table = tables.get("ASCII_TO_KEYCODE", b"")
    chars = {chr(i) for i in range(0x20, 0x7F) if i < len(ascii_table) and ascii_table[i]}
    for key in list(tables.get("HIGHER_ASCII", {})) + list(tables.get("COMBINED_KEYS", {})):
        chars.add(key if isinstance(key, str) else chr(key))
    return "".join(sorted(chars))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", help="directory with the layout .py sources (default: download)")
    parser.add_argument("--output", default=str(REPO / "app" / "layouts.json"))
    args = parser.parse_args()

    layouts = {}
    for code, (name, module, url) in LAYOUTS.items():
        chars = typable_chars(layout_tables(read_source(module, url, args.src)))
        layouts[code] = {"name": name, "module": module, "chars": chars}
        print(f"{code}: {len(chars)} characters")

    out = pathlib.Path(args.output)
    out.write_text(json.dumps({"generated_by": "tools/gen_layout_charsets.py", "layouts": layouts},
                              ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", out)


if __name__ == "__main__":
    main()
