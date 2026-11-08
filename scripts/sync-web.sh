#!/usr/bin/env bash
# Build the web IDE and copy it into the APK assets.
#
# The APK must build without Node installed, so the built bundle is committed
# under android/app/src/main/assets/web. Run this after any web/ change.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
web="$root/web"
dest="$root/android/app/src/main/assets/web"

cd "$web"

if [ ! -d node_modules ]; then
  echo "==> installing web dependencies"
  npm ci --no-audit --no-fund
fi

echo "==> typecheck + build"
npm run build

echo "==> syncing dist -> ${dest#$root/}"
rm -rf "$dest"
mkdir -p "$dest"
cp -R dist/. "$dest/"

echo "==> done"
du -sh "$dest"
ls "$dest"
