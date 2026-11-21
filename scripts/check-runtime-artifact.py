#!/usr/bin/env python3
"""Verify a pinned runtime artifact against its manifest (Task 24).

Checks, in order:
  * the manifest is well formed and pins an https artifact with a sha256;
  * the downloaded bytes match the pinned size and sha256;
  * the archive is a safe tar.gz (no absolute paths, `..`, devices, FIFOs,
    setuid/setgid or escaping links);
  * the layout contains libpython, the stdlib and the headers the wheel build
    needs;
  * every shared object is 16 KB page-size safe (scripts/check-elf-alignment.sh);
  * the extracted size fits the manifest's `install.installedSize` reservation.

The script is dependency-free (stdlib only) so the CI job needs no extra pip
packages. The signature is checked separately with scripts/verify-manifest.sh.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

CHUNK = 1024 * 1024
MAX_ENTRIES = 20_000
MAX_LINK_TARGET = 4096


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail(message: str) -> None:
    print(f"FAIL {message}", file=sys.stderr)
    raise SystemExit(1)


def load_manifest(path: Path) -> dict:
    try:
        manifest = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot read {path}: {error}")
    required = ["schema", "id", "version", "versionCode", "abi", "minAndroid", "artifact", "install"]
    missing = [key for key in required if key not in manifest]
    if missing:
        fail(f"manifest is missing {', '.join(missing)}")
    if manifest["schema"] != 1:
        fail(f"unsupported schema {manifest['schema']}")
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,32}", str(manifest["id"])):
        fail(f"invalid runtime id: {manifest['id']}")
    artifact = manifest["artifact"]
    for key in ("url", "sha256", "size"):
        if key not in artifact:
            fail(f"artifact is missing {key}")
    if not str(artifact["url"]).startswith("https://"):
        fail("artifact URL must be https")
    if not re.fullmatch(r"[a-f0-9]{64}", str(artifact["sha256"])):
        fail("artifact sha256 is malformed")
    if int(artifact["size"]) <= 0:
        fail("artifact size must be positive")
    install = manifest["install"]
    if install.get("layout") not in ("prefix", "flat"):
        fail(f"unsupported layout: {install.get('layout')}")
    if "arm64-v8a" not in manifest["abi"]:
        fail("manifest does not list arm64-v8a")
    return manifest


def download(url: str, dest: Path, expected_size: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_suffix(dest.suffix + ".part")
    offset = partial.stat().st_size if partial.is_file() else 0
    if offset > expected_size:
        partial.unlink()
        offset = 0
    headers = {"User-Agent": "LeoCode-packaging/1"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    request = urllib.request.Request(url, headers=headers)
    print(f"download {url} (from {offset})")
    with urllib.request.urlopen(request, timeout=120) as response:
        # Only append when the server honoured the Range request; some mirrors
        # ignore it and reply 200 with the whole body.
        mode = "ab" if offset and response.status == 206 else "wb"
        if mode == "wb":
            offset = 0
        with partial.open(mode) as out:
            shutil.copyfileobj(response, out)
    partial.replace(dest)


def safe_extract(archive: Path, dest: Path) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    count = 0
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            count += 1
            if count > MAX_ENTRIES:
                fail(f"archive has more than {MAX_ENTRIES} entries")
            name = member.name
            if name.startswith("/") or ".." in Path(name).parts:
                fail(f"unsafe path: {name}")
            if member.isdev() or member.isfifo():
                fail(f"device or FIFO in archive: {name}")
            if member.mode & 0o6000:
                fail(f"setuid/setgid in archive: {name}")
            target = (dest / name).resolve()
            if target != root and root not in target.parents:
                fail(f"path escapes the extraction root: {name}")
            if member.issym() or member.islnk():
                if not member.linkname or len(member.linkname) > MAX_LINK_TARGET:
                    fail(f"invalid link target for {name}")
                if member.linkname.startswith("/") or ".." in Path(member.linkname).parts:
                    fail(f"unsafe link target for {name}: {member.linkname}")
            # Python 3.12+ applies a safety filter; our checks above are stricter.
            extract_kwargs = {"filter": "data"} if hasattr(tarfile, "data_filter") else {}
            tar.extract(member, dest, **extract_kwargs)
    return count


def is_pruned(relative: Path) -> bool:
    """Match RuntimeInstaller/SafeExtractor's post-extract pruning."""
    parts = relative.parts
    if not parts:
        return False
    if parts[0] == "include":
        return True
    if len(parts) >= 2 and parts[0] == "lib" and parts[1] == "pkgconfig":
        return True
    if (
        len(parts) >= 3
        and parts[0] == "lib"
        and re.fullmatch(r"python3\.\d+", parts[1])
        and parts[2] == "test"
    ):
        return True
    return False


def check_layout(extract: Path, manifest: dict) -> tuple[Path, int]:
    prefix_name = manifest["install"].get("prefix", "prefix")
    prefix = extract / prefix_name if manifest["install"]["layout"] == "prefix" else extract
    if not prefix.is_dir():
        fail(f"missing install prefix in archive: {prefix_name}")

    libdirs = sorted((prefix / "lib").glob("libpython3.*.so"))
    if not libdirs:
        fail(f"no libpython3.*.so under {prefix / 'lib'}")
    stdlib = sorted((prefix / "lib").glob("python3.*"))
    if not stdlib:
        fail(f"no stdlib directory under {prefix / 'lib'}")
    headers = sorted((prefix / "include").glob("python3.*/Python.h"))
    if not headers:
        fail(f"no Python.h under {prefix / 'include'} (needed for wheels)")

    raw = installed = 0
    files = installed_files = 0
    for path in prefix.rglob("*"):
        if path.is_file() and not path.is_symlink():
            size = path.stat().st_size
            raw += size
            files += 1
            if not is_pruned(path.relative_to(prefix)):
                installed += size
                installed_files += 1
    print(f"layout  {prefix_name}/  libpython={libdirs[0].name}  stdlib={stdlib[0].name}  headers={headers[0].parent.name}")
    print(f"size    raw {files} files / {raw} bytes; installed {installed_files} files / {installed} bytes")
    return prefix, installed


def check_alignment(prefix: Path) -> None:
    root = Path(__file__).resolve().parent.parent
    script = root / "scripts" / "check-elf-alignment.sh"
    if not script.is_file():
        fail(f"alignment script not found: {script}")
    print(f"align   {script} {prefix}")
    subprocess.run(["bash", str(script), str(prefix)], check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--artifact", type=Path, help="use an existing tarball")
    parser.add_argument("--cache-dir", type=Path, default=Path(os.environ.get("LEOCODE_CACHE", "/tmp/leocode-runtime")))
    parser.add_argument("--skip-alignment", action="store_true")
    parser.add_argument("--extract-to", type=Path, help="extract here and keep the tree")
    parser.add_argument("--keep", action="store_true", help="keep the temporary tree")
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    artifact = manifest["artifact"]
    expected_size = int(artifact["size"])

    archive = args.artifact
    if archive is None:
        name = Path(urllib.parse.urlparse(artifact["url"]).path).name
        archive = args.cache_dir / name
        if not archive.is_file() or archive.stat().st_size != expected_size:
            download(artifact["url"], archive, expected_size)

    if not archive.is_file():
        fail(f"artifact not found: {archive}")
    actual_size = archive.stat().st_size
    if actual_size != expected_size:
        fail(f"size mismatch: {actual_size} != {expected_size}")
    actual_sha = sha256_file(archive)
    if actual_sha != artifact["sha256"]:
        fail(f"sha256 mismatch: {actual_sha} != {artifact['sha256']}")
    print(f"sha256  {actual_sha}")
    print(f"bytes   {actual_size}")

    if args.extract_to:
        args.extract_to.mkdir(parents=True, exist_ok=True)
        work = args.extract_to
    else:
        work = Path(tempfile.mkdtemp(prefix="leocode-runtime-check-"))
    extract_root = work if args.extract_to else work / "extract"
    try:
        entries = safe_extract(archive, extract_root)
        print(f"tar     {entries} entries, no unsafe paths/links")
        prefix, installed = check_layout(extract_root, manifest)

        reserved = int(manifest["install"].get("installedSize", 0))
        if reserved and installed > reserved:
            fail(f"extracted size {installed} exceeds the manifest reservation {reserved}")
        if reserved:
            print(f"reserve {installed} <= {reserved} (manifest installedSize)")

        if not args.skip_alignment:
            check_alignment(prefix)
        else:
            print("align   skipped")
        print("PASS runtime artifact")
    finally:
        if args.extract_to:
            print(f"kept    {work}")
        elif args.keep:
            print(f"kept    {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
