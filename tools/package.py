#!/usr/bin/env python3
"""Build the release zip.

Ships only what the browser loads. Tests, tooling and the captured fixtures
stay out, and entries are written in sorted order with a fixed timestamp so
two builds of the same tree produce byte-identical archives.

    python3 tools/package.py
"""

import hashlib
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP_DIRS = {"test", "tools", "store", ".git", ".github"}
SKIP_NAMES = {".DS_Store"}

# Zip entries need a fixed mtime to stay reproducible; 1980-01-01 is the
# earliest the format allows.
FIXED_TIME = (1980, 1, 1, 0, 0, 0)

REQUIRED = (
    "manifest.json",
    "LICENSE",
    "src/popup.html",
    "src/popup.css",
    "src/popup.js",
    "src/content.js",
    "src/extract.js",
    "src/report.js",
    "src/settings.js",
    "src/indicator.js",
    "src/options.html",
    "src/options.js",
    "src/readfile.js",
    "src/file.html",
    "src/file.js",
    "vendor/pdfjs/pdf.min.mjs",
    "vendor/pdfjs/pdf.worker.min.mjs",
    "vendor/pdfjs/LICENSE",
    "fonts/saira-latin.woff2",
    "fonts/OFL-Saira.txt",
)


def shipped_files():
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue

        relative = path.relative_to(ROOT)
        if relative.parts[0] in SKIP_DIRS or path.name in SKIP_NAMES:
            continue
        if relative.suffix == ".zip":
            continue

        yield relative


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    version = manifest["version"]
    out = ROOT.parent / f"slop-lens-{version}.zip"

    files = list(shipped_files())
    present = {path.as_posix() for path in files}

    missing = [name for name in REQUIRED if name not in present]
    if missing:
        sys.exit(f"refusing to package, missing: {', '.join(missing)}")

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in files:
            info = zipfile.ZipInfo(relative.as_posix(), date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, (ROOT / relative).read_bytes())

    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"{out}")
    print(f"  version {version}, {len(files)} files, {out.stat().st_size // 1024} KB")
    print(f"  sha256  {digest}")


if __name__ == "__main__":
    main()
