#!/usr/bin/env python3
"""Publish the device files and their manifest next to the web app.

Usage:
    python3 tools/build_firmware_manifest.py [--output-dir app/firmware]

Copies boot.py, code.py and lib/** (the files the installer copies, never
secret.txt) into the output directory and writes manifest.json:

    {"version": "2026.10.27", "files": [
      {"path": "code.py", "size": 12034, "crc32": "9f1c2a7e"}, ...]}

The version is VERSION in device/code.py, so there is a single source. The web
app compares it with the dongle's VERSION reply, and the USB updater sends only
the files whose CRC32 differs from what is on the device (RULEBOOK §7.2).
"""
import argparse
import ast
import json
import pathlib
import shutil
import zlib

from build_package import DEVICE, REPO, ROOT_DIRS, ROOT_FILES, iter_dir


def read_version(code_py):
    """The string assigned to VERSION at the top level of code.py."""
    tree = ast.parse(code_py.read_text(encoding="utf-8"))
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "VERSION" for t in node.targets)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            return node.value.value
    raise SystemExit(f"no VERSION = \"...\" found in {code_py}")


def device_files():
    """(path on the device, source file) for every file the installer copies."""
    for name in ROOT_FILES:
        source = DEVICE / name
        if not source.exists():
            raise SystemExit(f"missing required file: {source}")
        yield name, source
    for name in ROOT_DIRS:
        source = DEVICE / name
        if not source.is_dir():
            raise SystemExit(f"missing required directory: {source}")
        for path in iter_dir(source):
            yield f"{name}/{path.relative_to(source).as_posix()}", path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        default=str(REPO / "app" / "firmware"),
        help="directory the files and manifest.json are written to (default: app/firmware)",
    )
    args = parser.parse_args()

    out_dir = pathlib.Path(args.output_dir)
    # Only ever wipe a directory this script created, so a typo can't delete
    # anything else.
    if out_dir.exists():
        if any(out_dir.iterdir()) and not (out_dir / "manifest.json").exists():
            raise SystemExit(f"{out_dir} is not empty and has no manifest.json; refusing to overwrite")
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    files = []
    for path, source in device_files():
        data = source.read_bytes()
        target = out_dir / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        files.append({"path": path, "size": len(data), "crc32": f"{zlib.crc32(data):08x}"})

    manifest = {"version": read_version(DEVICE / "code.py"), "files": files}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    total = sum(f["size"] for f in files)
    print(f"wrote {out_dir / 'manifest.json'}: version {manifest['version']}, {len(files)} files, {total} bytes")


if __name__ == "__main__":
    main()
