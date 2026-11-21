#!/usr/bin/env python3
"""Build a static PEP 503 index for the Android wheels (Task 24).

    python3 runtime-packaging/build_wheel_index.py \
        --wheels runtime-packaging/out/wheels \
        --out runtime-packaging/out/index

The result can be served as a static site and passed to pip as
`--extra-index-url https://.../index/`. Only wheels already built for the
target (cp314 / android_24_arm64_v8a) are indexed; pip still filters by the
device's tags.
"""

from __future__ import annotations

import argparse
import html
import re
import shutil
from pathlib import Path


def project_name(filename: str) -> str:
    name = filename.split("-", 1)[0]
    return re.sub(r"[-_.]+", "-", name).lower()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheels", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    wheels = sorted(args.wheels.glob("*.whl"))
    if not wheels:
        raise SystemExit(f"no wheels in {args.wheels}")

    site = args.out
    wheel_dir = site / "wheels"
    wheel_dir.mkdir(parents=True, exist_ok=True)
    projects: dict[str, list[str]] = {}
    for wheel in wheels:
        shutil.copy2(wheel, wheel_dir / wheel.name)
        projects.setdefault(project_name(wheel.name), []).append(wheel.name)

    for project, files in sorted(projects.items()):
        page = site / project
        page.mkdir(parents=True, exist_ok=True)
        links = "\n".join(
            f'    <a href="../../wheels/{html.escape(name)}">{html.escape(name)}</a><br>'
            for name in sorted(files)
        )
        (page / "index.html").write_text(
            "<!doctype html>\n<html><body>\n"
            f"<h1>{html.escape(project)}</h1>\n{links}\n"
            "</body></html>\n"
        )

    items = "\n".join(
        f'  <li><a href="{html.escape(project)}/index.html">{html.escape(project)}</a></li>'
        for project in sorted(projects)
    )
    (site / "index.html").write_text(
        "<!doctype html>\n<html><body>\n"
        "<h1>LeoCode Android wheels</h1>\n"
        f"<ul>\n{items}\n</ul>\n"
        "</body></html>\n"
    )
    print(f"index {site}: {len(wheels)} wheel(s), {len(projects)} project(s)")
    for project, files in sorted(projects.items()):
        for name in sorted(files):
            print(f"  {project}: {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
