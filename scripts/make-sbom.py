#!/usr/bin/env python3
"""Write a CycloneDX 1.5 SBOM for a LeoCode release (Task 28).

Inputs are the two resolved dependency sets that actually ship in the APK:

* `android/app/build/reports/release-dependencies.txt` from
  `./gradlew exportReleaseDependencies` (Maven coordinates, one per line);
* `web/package-lock.json` (production npm packages, dev tooling excluded).

The web bundle is static and is compiled into the APK, so both sets belong in
one component list. The output is deterministic: components are sorted by purl
and no timestamp is embedded, which keeps the SBOM diffable between builds.
"""

from __future__ import annotations

import argparse
import base64
import json
import pathlib
import sys
import urllib.parse


def android_components(path: pathlib.Path) -> list[dict]:
    components = []
    if not path.is_file():
        return components
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(":")
        if len(parts) != 3:
            print(f"warning: ignoring Maven coordinate '{line}'", file=sys.stderr)
            continue
        group, artifact, version = parts
        purl = f"pkg:maven/{group}/{artifact}@{version}"
        components.append(
            {
                "type": "library",
                "bom-ref": purl,
                "group": group,
                "name": artifact,
                "version": version,
                "purl": purl,
            }
        )
    return components


def npm_components(lock_path: pathlib.Path) -> list[dict]:
    components = []
    if not lock_path.is_file():
        return components
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    for key, entry in lock.get("packages", {}).items():
        if not key or entry.get("dev") or entry.get("link"):
            continue
        version = entry.get("version")
        if not version:
            continue
        marker = "node_modules/"
        index = key.rfind(marker)
        if index < 0:
            continue
        name = key[index + len(marker) :]
        if not name:
            continue
        if name.startswith("@"):
            scope, _, base = name.partition("/")
            purl = f"pkg:npm/{urllib.parse.quote(scope, safe='')}/{base}@{version}"
        else:
            purl = f"pkg:npm/{name}@{version}"
        component = {
            "type": "library",
            "bom-ref": purl,
            "name": name,
            "version": version,
            "purl": purl,
        }
        integrity = entry.get("integrity", "")
        if integrity.startswith("sha512-"):
            try:
                digest = base64.b64decode(integrity[len("sha512-") :]).hex()
                component["hashes"] = [{"alg": "SHA-512", "content": digest}]
            except ValueError:
                pass
        components.append(component)
    return components


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--android-deps", type=pathlib.Path, required=True)
    parser.add_argument("--web-lock", type=pathlib.Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()

    if not args.android_deps.is_file():
        print(f"error: Android dependency list not found: {args.android_deps}", file=sys.stderr)
        return 2
    if not args.web_lock.is_file():
        print(f"error: web lockfile not found: {args.web_lock}", file=sys.stderr)
        return 2

    android = android_components(args.android_deps)
    web = npm_components(args.web_lock)
    if not android:
        print(f"error: no Maven coordinates in {args.android_deps}", file=sys.stderr)
        return 2
    if not web:
        print(f"error: no production npm packages in {args.web_lock}", file=sys.stderr)
        return 2

    components = android + web
    # Deduplicate (the lockfile can list one version under nested paths).
    unique = {component["purl"]: component for component in components}
    ordered = [unique[purl] for purl in sorted(unique)]

    bom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "bom-ref": f"pkg:apk/dev.leocode@{args.version}",
                "name": "LeoCode",
                "version": args.version,
                "purl": f"pkg:apk/dev.leocode@{args.version}",
            }
        },
        "components": ordered,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(bom, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({len(ordered)} components)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
