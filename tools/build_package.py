#!/usr/bin/env python3
"""Build a distributable zip with everything that must live on the CIRCUITPY drive.

Usage:
    python3 tools/build_package.py [--version 2026.09.03] [--output-dir dist]

The archive contains the device payload plus the two installer scripts, so a
user can download it, unzip it and run install.sh / install.ps1 (or just copy
the files across by hand).
"""
import argparse
import datetime
import pathlib
import zipfile

REPO = pathlib.Path(__file__).resolve().parent.parent
DEVICE = REPO / "device"
TOOLS = REPO / "tools"

# Files copied to the root of the CIRCUITPY drive.
ROOT_FILES = ["boot.py", "code.py"]
# Directories copied recursively to the CIRCUITPY drive.
ROOT_DIRS = ["lib"]
# Skipped when walking ROOT_DIRS.
EXCLUDE_SUFFIXES = (".pyc",)
EXCLUDE_NAMES = {".DS_Store", "__pycache__"}


def iter_dir(directory):
    for path in sorted(directory.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix in EXCLUDE_SUFFIXES:
            continue
        if EXCLUDE_NAMES & set(path.parts):
            continue
        yield path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--version",
        default=datetime.date.today().isoformat(),
        help="version string used in the archive name (default: today's date)",
    )
    parser.add_argument(
        "--output-dir",
        default=str(REPO / "dist"),
        help="directory the archive is written to (default: ./dist)",
    )
    args = parser.parse_args()

    out_dir = pathlib.Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    archive = out_dir / f"circuitpython_mouse-device-{args.version}.zip"

    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in ROOT_FILES:
            source = DEVICE / name
            if not source.exists():
                raise SystemExit(f"missing required file: {source}")
            zf.write(source, f"CIRCUITPY/{name}")

        for name in ROOT_DIRS:
            source = DEVICE / name
            if not source.is_dir():
                raise SystemExit(f"missing required directory: {source}")
            for path in iter_dir(source):
                zf.write(path, f"CIRCUITPY/{name}/{path.relative_to(source).as_posix()}")

        # Shipped as a sample so an installer never clobbers a real key.
        zf.write(DEVICE / "secret.txt", "secret.txt.example")

        for script in ("install.sh", "install.ps1"):
            zf.write(TOOLS / script, script)
        zf.write(TOOLS / "INSTALL.md", "INSTALL.md")

    print(f"wrote {archive} ({archive.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
