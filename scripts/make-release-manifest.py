#!/usr/bin/env python3
"""Write the signed `release.json` manifest for a LeoCode APK (Task 28).

The manifest names the APK, its SHA-256 and size. `scripts/sign-release.sh`
then writes the detached Ed25519 signature next to it. Keep this file stdlib
only: CI runs it before any Python dependencies are installed.

    scripts/make-release-manifest.py \
        --apk dist/leocode.apk \
        --version-name 0.1.0-rc1 --version-code 1001 \
        --url https://github.com/.../leocode.apk \
        --notes-file docs/release-notes/0.1.0-rc1.md \
        --out dist/release.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys

MAX_NOTES = 4000
SCHEMA = 1


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True, type=pathlib.Path)
    parser.add_argument("--version-name", required=True)
    parser.add_argument("--version-code", required=True, type=int)
    parser.add_argument("--url", required=True)
    parser.add_argument("--notes", default="")
    parser.add_argument("--notes-file", type=pathlib.Path)
    parser.add_argument("--package", default="dev.leocode")
    parser.add_argument("--min-sdk", default=28, type=int)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()

    if not args.apk.is_file():
        print(f"error: APK not found: {args.apk}", file=sys.stderr)
        return 2
    if args.version_code <= 0:
        print("error: --version-code must be positive", file=sys.stderr)
        return 2
    if not args.url.startswith(("https://", "http://", "file://")):
        print("error: --url must be http(s) or file", file=sys.stderr)
        return 2

    notes = args.notes
    if args.notes_file:
        notes = args.notes_file.read_text(encoding="utf-8")
    notes = notes.strip()[:MAX_NOTES]

    manifest = {
        "schema": SCHEMA,
        "package": args.package,
        "versionName": args.version_name,
        "versionCode": args.version_code,
        "minSdk": args.min_sdk,
        "notes": notes,
        "apk": {
            "url": args.url,
            "sha256": sha256(args.apk),
            "size": args.apk.stat().st_size,
        },
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({manifest['apk']['sha256']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
