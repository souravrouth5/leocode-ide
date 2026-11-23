#!/usr/bin/env bash
# Tests for the Task 28 release scripts. No network, no Gradle, no device.
#
#   scripts/tests/run-release-script-tests.sh
#
# Covers the tag-to-version mapping, the manifest generator (hash, size, URL
# checks) and the CycloneDX SBOM (Maven + npm, deduplicated and sorted).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

total=0
fail=0

pass() { total=$((total + 1)); echo "PASS $1"; }
bad() { total=$((total + 1)); fail=$((fail + 1)); echo "FAIL $1${2:+: $2}"; }

version_case() {
  local tag="$1" want_name="$2" want_code="$3"
  local out
  out="$("$root/scripts/version-from-tag.sh" "$tag")" || { bad "$tag (exit)"; return; }
  if grep -qx "VERSION_NAME=$want_name" <<<"$out" && grep -qx "VERSION_CODE=$want_code" <<<"$out"; then
    pass "$tag -> $want_name / $want_code"
  else
    bad "$tag" "$out"
  fi
}

version_case v0.1.0-rc1 0.1.0-rc1 1001
version_case v0.1.0-rc2 0.1.0-rc2 1002
version_case v0.1.0 0.1.0 1009
version_case v2.3.4-rc8 2.3.4-rc8 2003048
version_case 0.1.0-rc1 0.1.0-rc1 1001

if "$root/scripts/version-from-tag.sh" v0.1.0-rc9 >/dev/null 2>&1; then
  bad "rc9 is rejected"
else
  pass "rc9 is rejected"
fi
if "$root/scripts/version-from-tag.sh" nightly >/dev/null 2>&1; then
  bad "a non-version tag is rejected"
else
  pass "a non-version tag is rejected"
fi

# Canonical decimal only: leading zeros would otherwise collide (rc01 == rc1,
# 01.2.3 == 1.2.3) and `rc08` used to abort mid-output with a bash octal error.
for tag in v0.1.0-rc01 v0.1.0-rc08 v01.2.3 v0.0.0-rc0 v2100.0.0 \
  v18446744073709551616.0.0; do
  if "$root/scripts/version-from-tag.sh" "$tag" >/dev/null 2>&1; then
    bad "$tag is rejected"
  else
    pass "$tag is rejected"
  fi
done

# ---------------------------------------------------------------- manifest
apk="$tmp/leocode.apk"
printf 'not really an apk\n' >"$apk"
sha="$(sha256sum "$apk" | cut -d' ' -f1)"
size="$(stat -c %s "$apk")"

"$root/scripts/make-release-manifest.py" \
  --apk "$apk" --version-name 0.1.0-rc1 --version-code 1001 \
  --url file:///sdcard/Download/leocode-update/leocode-1001.apk \
  --notes "Demo" --out "$tmp/release.json" >/dev/null
if python3 - "$tmp/release.json" "$sha" "$size" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
assert m["schema"] == 1
assert m["package"] == "dev.leocode"
assert m["versionName"] == "0.1.0-rc1"
assert m["versionCode"] == 1001
assert m["minSdk"] == 28
assert m["notes"] == "Demo"
assert m["apk"]["sha256"] == sys.argv[2]
assert m["apk"]["size"] == int(sys.argv[3])
assert m["apk"]["url"].startswith("file:///")
PY
then
  pass "manifest carries hash, size and version"
else
  bad "manifest contents"
fi

if "$root/scripts/make-release-manifest.py" \
  --apk "$apk" --version-name x --version-code 1 \
  --url ftp://example/x --out "$tmp/bad.json" >/dev/null 2>&1; then
  bad "an unsupported URL is rejected"
else
  pass "an unsupported URL is rejected"
fi

# -------------------------------------------------------------------- SBOM
cat >"$tmp/deps.txt" <<'EOF'
org.eclipse.jgit:org.eclipse.jgit:6.10.0.202406032230-r
org.bouncycastle:bcprov-jdk18on:1.78
org.eclipse.jgit:org.eclipse.jgit:6.10.0.202406032230-r
EOF
cat >"$tmp/package-lock.json" <<'EOF'
{
  "lockfileVersion": 3,
  "packages": {
    "": {"version": "0.0.1"},
    "node_modules/@codemirror/state": {"version": "6.5.2"},
    "node_modules/vite": {"version": "5.4.0", "dev": true},
    "node_modules/@codemirror/state/node_modules/lru-cache": {"version": "10.4.3"}
  }
}
EOF

"$root/scripts/make-sbom.py" \
  --android-deps "$tmp/deps.txt" --web-lock "$tmp/package-lock.json" \
  --version 0.1.0-rc1 --out "$tmp/bom.json" >/dev/null
if python3 - "$tmp/bom.json" <<'PY'
import json, sys
bom = json.load(open(sys.argv[1]))
assert bom["bomFormat"] == "CycloneDX"
assert bom["specVersion"] == "1.5"
purls = [c["purl"] for c in bom["components"]]
assert purls == sorted(purls), purls
assert len(purls) == len(set(purls)), "duplicates"
assert "pkg:maven/org.eclipse.jgit/org.eclipse.jgit@6.10.0.202406032230-r" in purls
assert "pkg:npm/%40codemirror/state@6.5.2" in purls
assert "pkg:npm/lru-cache@10.4.3" in purls
assert not any("vite" in purl for purl in purls), "dev dependency leaked"
assert bom["metadata"]["component"]["version"] == "0.1.0-rc1"
PY
then
  pass "SBOM includes Maven and npm, drops dev, deduplicates"
else
  bad "SBOM contents"
fi

if "$root/scripts/make-sbom.py" \
  --android-deps "$tmp/missing-deps.txt" --web-lock "$tmp/package-lock.json" \
  --version 0.1.0-rc1 --out "$tmp/empty.json" >/dev/null 2>&1; then
  bad "a missing Android dependency list fails the SBOM"
else
  pass "a missing Android dependency list fails the SBOM"
fi

echo
echo "$((total - fail))/$total passed"
[[ "$fail" -eq 0 ]]
