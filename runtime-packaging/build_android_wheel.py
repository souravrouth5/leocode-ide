#!/usr/bin/env python3
"""Build an Android aarch64 wheel with the NDK (Task 24).

This is the small, deterministic alternative to cibuildwheel for the handful of
native packages LeoCode ships. It compiles the package's extension against the
headers and libpython of the official python.org Android build, then assembles
the wheel itself so the platform tag and RECORD are exactly what we intend.

Usage:
    python3 runtime-packaging/build_android_wheel.py \
        --recipe runtime-packaging/wheels/markupsafe.json \
        --python-prefix /tmp/python/prefix \
        --ndk "$ANDROID_HOME/ndk/28.2.13676358" \
        --out runtime-packaging/out/wheels

The recipe pins the sdist URL and sha256. The output is
<name>-<version>-cp3XX-cp3XX-android_<api>_arm64_v8a.whl, which is the tag the
official build reports from sysconfig.get_platform() ("android-24-arm64_v8a").
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

CHUNK = 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, dest: Path) -> None:
    print(f"download {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "LeoCode-packaging/1"})
    with urllib.request.urlopen(request, timeout=120) as response, dest.open("wb") as out:
        shutil.copyfileobj(response, out)


def fetch_sdist(recipe: dict, work: Path) -> Path:
    name = recipe["name"]
    version = recipe["version"]
    filename = recipe["sdist"].get("filename", f"{name}-{version}.tar.gz")
    dest = work / filename
    if not dest.is_file() or sha256_file(dest) != recipe["sdist"]["sha256"]:
        download(recipe["sdist"]["url"], dest)
    actual = sha256_file(dest)
    if actual != recipe["sdist"]["sha256"]:
        raise SystemExit(
            f"sdist sha256 mismatch: {actual} != {recipe['sdist']['sha256']}"
        )
    return dest


def extract(archive: Path, dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            target = (dest / member.name).resolve()
            if not str(target).startswith(str(dest.resolve()) + os.sep) and target != dest.resolve():
                raise SystemExit(f"unsafe path in {archive}: {member.name}")
            if member.isdev() or member.isfifo():
                raise SystemExit(f"device node in {archive}: {member.name}")
        extract_kwargs = {"filter": "data"} if hasattr(tarfile, "data_filter") else {}
        tar.extractall(dest, **extract_kwargs)
    entries = [entry for entry in dest.iterdir() if entry.is_dir()]
    if len(entries) != 1:
        raise SystemExit(f"expected one top-level directory in {archive}, found {entries}")
    return entries[0]


def host_tag() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "linux" and machine in ("x86_64", "amd64"):
        return "linux-x86_64"
    if system == "darwin":
        return "darwin-arm64" if machine in ("arm64", "aarch64") else "darwin-x86_64"
    if system == "windows":
        return "windows-x86_64"
    raise SystemExit(f"unsupported build host: {system}/{machine}")


def python_version(prefix: Path) -> tuple[int, int, str]:
    include = prefix / "include"
    matches = sorted(include.glob("python3.*"), key=lambda p: p.name)
    if not matches:
        raise SystemExit(f"no python3.* headers under {include}")
    match = re.fullmatch(r"python3\.(\d+)", matches[-1].name)
    if not match:
        raise SystemExit(f"unexpected header directory: {matches[-1].name}")
    return 3, int(match.group(1)), matches[-1].name


def compiler(ndk: Path, api: int) -> Path:
    base = ndk / "toolchains" / "llvm" / "prebuilt" / host_tag() / "bin"
    candidate = base / f"aarch64-linux-android{api}-clang"
    if not candidate.is_file():
        raise SystemExit(f"NDK compiler not found: {candidate}")
    return candidate


def compile_extension(
    recipe: dict,
    sdist: Path,
    prefix: Path,
    ndk: Path,
    work: Path,
) -> Path:
    api = int(recipe.get("api", 24))
    major, minor, include_name = python_version(prefix)
    extension = recipe["extension"]
    ext_suffix = f".cpython-{major}{minor}-aarch64-linux-android.so"
    output = work / f"{extension['name']}{ext_suffix}"

    command = [
        str(compiler(ndk, api)),
        "-shared",
        "-fPIC",
        "-O2",
        "-DNDEBUG",
        f"-I{prefix / 'include' / include_name}",
    ]
    for include in extension.get("include_dirs", []):
        command.append(f"-I{sdist / include}")
    command += [str(sdist / source) for source in extension["sources"]]
    command += [f"-L{prefix / 'lib'}", f"-lpython{major}.{minor}"]
    command += [f"-l{library}" for library in extension.get("libraries", [])]
    command += ["-o", str(output)]

    print("compile " + " ".join(command))
    subprocess.run(command, check=True)
    return output


def wheel_files(sdist: Path, recipe: dict, built: Path) -> dict[str, Path]:
    package = sdist / recipe["package_dir"]
    if not package.is_dir():
        raise SystemExit(f"package directory not found: {package}")
    files: dict[str, Path] = {}
    parent = package.parent
    for path in sorted(package.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(parent)
        if path.suffix in (".c", ".h") or "__pycache__" in path.parts:
            continue
        files[relative.as_posix()] = path
    files[f"{package.name}/{built.name}"] = built
    return files


def record_line(path: str, data: bytes) -> str:
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
    return f"{path},sha256={digest},{len(data)}"


def write_wheel(
    recipe: dict,
    sdist: Path,
    built: Path,
    out_dir: Path,
    minor: int,
) -> Path:
    name = re.sub(r"[-_.]+", "-", recipe["name"]).lower()
    version = recipe["version"]
    api = int(recipe.get("api", 24))
    tag = f"cp3{minor}-cp3{minor}-android_{api}_arm64_v8a"
    dist_info = f"{name}-{version}.dist-info"
    wheel = out_dir / f"{name}-{version}-{tag}.whl"
    out_dir.mkdir(parents=True, exist_ok=True)

    metadata = (sdist / "PKG-INFO").read_bytes()
    wheel_metadata = (
        "Wheel-Version: 1.0\n"
        "Generator: leocode-runtime-packaging\n"
        "Root-Is-Purelib: false\n"
        f"Tag: {tag}\n"
    ).encode()

    files = wheel_files(sdist, recipe, built)
    records: list[str] = []
    with zipfile.ZipFile(wheel, "w", zipfile.ZIP_DEFLATED) as archive:
        for relative, path in files.items():
            data = path.read_bytes()
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if path.suffix == ".so" else 0o644) << 16
            archive.writestr(info, data)
            records.append(record_line(relative, data))

        for name_in_wheel, data in (
            (f"{dist_info}/METADATA", metadata),
            (f"{dist_info}/WHEEL", wheel_metadata),
        ):
            info = zipfile.ZipInfo(name_in_wheel, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
            records.append(record_line(name_in_wheel, data))

        license_file = sdist / "LICENSE.txt"
        if license_file.is_file():
            target = f"{dist_info}/LICENSE.txt"
            data = license_file.read_bytes()
            info = zipfile.ZipInfo(target, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
            records.append(record_line(target, data))

        record_path = f"{dist_info}/RECORD"
        records.append(f"{record_path},,")
        info = zipfile.ZipInfo(record_path, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, "\n".join(records) + "\n")
    return wheel


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", required=True, type=Path)
    parser.add_argument("--python-prefix", required=True, type=Path)
    parser.add_argument("--ndk", type=Path, help="NDK root (or ANDROID_NDK_HOME)")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    recipe = json.loads(args.recipe.read_text())
    ndk = args.ndk or os.environ.get("ANDROID_NDK_HOME") or os.environ.get("ANDROID_NDK_ROOT")
    if not ndk:
        raise SystemExit("pass --ndk or set ANDROID_NDK_HOME")
    ndk = Path(ndk)

    with tempfile.TemporaryDirectory(prefix="leocode-wheel-") as temporary:
        work = Path(temporary)
        sdist_archive = fetch_sdist(recipe, work)
        sdist = extract(sdist_archive, work / "src")
        built = compile_extension(recipe, sdist, args.python_prefix, ndk, work)
        _, minor, _ = python_version(args.python_prefix)
        wheel = write_wheel(recipe, sdist, built, args.out, minor)
        print(f"wheel {wheel} ({wheel.stat().st_size} bytes)")
        print(f"sha256 {sha256_file(wheel)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
