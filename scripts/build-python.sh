#!/usr/bin/env bash
# DRAFT — Phase 0C2 (Track C2). Cross-compile CPython for Android/Bionic with the NDK.
#
# This script is intentionally explicit and boring. It is expected to need 1-2 days of
# iteration on a real CI runner; every stage below is a known trouble spot.
#
# Usage:
#   ANDROID_NDK_HOME=~/Android/Sdk/ndk/27.0.12077973 scripts/build-python.sh
#
# Output:
#   runtime-packaging/out/python-<version>-<abi>.tar.gz
#   (contains data/data/dev.leocode/files/usr/... , ready for the runtime installer)
set -euo pipefail

PY_VERSION="${PY_VERSION:-3.11.9}"
OPENSSL_VERSION="${OPENSSL_VERSION:-3.0.13}"
EXPAT_VERSION="${EXPAT_VERSION:-2.6.2}"
LIBFFI_VERSION="${LIBFFI_VERSION:-3.4.6}"
API="${API:-28}"
ABI="${ABI:-arm64-v8a}"
PREFIX="/data/data/dev.leocode/files/usr"

NDK="${ANDROID_NDK_HOME:-${ANDROID_HOME:-$HOME/Android/Sdk}/ndk/27.0.12077973}"
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/linux-x86_64"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$ROOT/runtime-packaging/build}"
OUT="${OUT:-$ROOT/runtime-packaging/out}"

case "$ABI" in
  arm64-v8a)   TARGET="aarch64-linux-android";        OPENSSL_TARGET="android-arm64" ;;
  armeabi-v7a) TARGET="armv7a-linux-androideabi";     OPENSSL_TARGET="android-arm" ;;
  x86_64)      TARGET="x86_64-linux-android";         OPENSSL_TARGET="android-x86_64" ;;
  *) echo "unsupported ABI: $ABI" >&2; exit 2 ;;
esac

CC="$TOOLCHAIN/bin/${TARGET}${API}-clang"
CXX="$TOOLCHAIN/bin/${TARGET}${API}-clang++"
AR="$TOOLCHAIN/bin/llvm-ar"
RANLIB="$TOOLCHAIN/bin/llvm-ranlib"
STRIP="$TOOLCHAIN/bin/llvm-strip"
export CC CXX AR RANLIB STRIP
export CFLAGS="-O2 -fPIC -D__ANDROID_API__=$API"
export LDFLAGS="-L$WORK/sysroot/lib"

mkdir -p "$WORK" "$OUT" "$WORK/sysroot"

fetch() {
  local url="$1" dest="$2"
  [[ -f "$dest" ]] || curl -fsSL "$url" -o "$dest"
}

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- OpenSSL
# pip requires the ssl module. Without this, `pip install` cannot reach PyPI.
build_openssl() {
  log "OpenSSL $OPENSSL_VERSION"
  local src="$WORK/openssl-$OPENSSL_VERSION"
  fetch "https://www.openssl.org/source/openssl-$OPENSSL_VERSION.tar.gz" "$WORK/openssl.tar.gz"
  [[ -d "$src" ]] || tar -xzf "$WORK/openssl.tar.gz" -C "$WORK"
  pushd "$src" >/dev/null
  "$src/Configure" "$OPENSSL_TARGET" \
    -D__ANDROID_API__="$API" \
    --prefix="$WORK/sysroot" \
    --openssldir="$WORK/sysroot/etc/tls" \
    no-tests no-docs no-shared
  make -j"$(nproc)"
  make install_sw
  popd >/dev/null
}

# ------------------------------------------------------------------ expat
build_expat() {
  log "expat $EXPAT_VERSION"
  local src="$WORK/expat-$EXPAT_VERSION"
  fetch "https://github.com/libexpat/libexpat/releases/download/R_${EXPAT_VERSION//./_}/expat-$EXPAT_VERSION.tar.gz" "$WORK/expat.tar.gz"
  [[ -d "$src" ]] || tar -xzf "$WORK/expat.tar.gz" -C "$WORK"
  pushd "$src" >/dev/null
  ./configure --host="$TARGET" --prefix="$WORK/sysroot" --disable-shared
  make -j"$(nproc)"
  make install
  popd >/dev/null
}

# ----------------------------------------------------------------- libffi
# Required for _ctypes. Optional for pip, needed by many packages.
build_libffi() {
  log "libffi $LIBFFI_VERSION"
  local src="$WORK/libffi-$LIBFFI_VERSION"
  fetch "https://github.com/libffi/libffi/releases/download/v$LIBFFI_VERSION/libffi-$LIBFFI_VERSION.tar.gz" "$WORK/libffi.tar.gz"
  [[ -d "$src" ]] || tar -xzf "$WORK/libffi.tar.gz" -C "$WORK"
  pushd "$src" >/dev/null
  ./configure --host="$TARGET" --prefix="$WORK/sysroot" --disable-shared
  make -j"$(nproc)"
  make install
  popd >/dev/null
}

# ---------------------------------------------------------------- CPython
build_python() {
  log "CPython $PY_VERSION"
  local src="$WORK/Python-$PY_VERSION"
  fetch "https://www.python.org/ftp/python/$PY_VERSION/Python-$PY_VERSION.tgz" "$WORK/python.tar.gz"
  [[ -d "$src" ]] || tar -xzf "$WORK/python.tar.gz" -C "$WORK"

  pushd "$src" >/dev/null
  ./configure \
    --host="$TARGET" \
    --build="$(uname -m)-pc-linux-gnu" \
    --prefix="$PREFIX" \
    --disable-shared \
    --disable-test-modules \
    --enable-ipv6 \
    --without-ensurepip \
    --with-openssl="$WORK/sysroot" \
    --with-system-expat \
    CPPFLAGS="-I$WORK/sysroot/include" \
    LDFLAGS="-L$WORK/sysroot/lib"

  make -j"$(nproc)"
  make install DESTDIR="$WORK/stage"
  popd >/dev/null
}

# ------------------------------------------------------------------ pip
# ensurepip cannot run during cross-compilation, so ship pip as a wheel and
# unpack it into site-packages. `python -m pip` then works on device.
bundle_pip() {
  log "pip wheel"
  local sp="$WORK/stage$PREFIX/lib/python3.11/site-packages"
  mkdir -p "$sp"
  local wheel="$WORK/pip.whl"
  if [[ ! -f "$wheel" ]]; then
    curl -fsSL "https://bootstrap.pypa.io/get-pip.py" -o "$WORK/get-pip.py"
    # Download the wheel on the host with any CPython 3.11 interpreter.
    python3 - "$WORK/get-pip.py" "$WORK" <<'PY'
import re, sys, urllib.request
src = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'PIP_VERSION\s*=\s*"([0-9.]+)"', src)
version = m.group(1) if m else "24.0"
url = f"https://files.pythonhosted.org/packages/any/pip/pip-{version}-py3-none-any.whl"
try:
    urllib.request.urlretrieve(url, sys.argv[2] + "/pip.whl")
except Exception as exc:
    print(f"pip wheel download failed: {exc}", file=sys.stderr)
PY
  fi
  if [[ -f "$wheel" ]]; then
    python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" \
      "$wheel" "$sp"
  else
    echo "WARN: pip wheel not bundled; device will need a network bootstrap" >&2
  fi
}

# -------------------------------------------------------------- packaging
package() {
  log "strip + package"
  find "$WORK/stage$PREFIX" -type f -name '*.so*' -exec "$STRIP" --strip-unneeded {} + 2>/dev/null || true
  find "$WORK/stage$PREFIX" -type f -perm -u+x -exec "$STRIP" --strip-unneeded {} + 2>/dev/null || true

  local tarball="$OUT/python-$PY_VERSION-$ABI.tar.gz"
  tar -czf "$tarball" -C "$WORK/stage" "data/data/dev.leocode/files/usr"
  sha256sum "$tarball" | tee "$tarball.sha256"
  du -h "$tarball"
}

build_openssl
build_expat
build_libffi
build_python
bundle_pip
package

log "done"
echo "Next: fill runtime-manifests/versions/python-$PY_VERSION.json with the sha256 and size,"
echo "then sign it with scripts/sign-manifest.sh."
