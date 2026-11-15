#!/bin/sh
# Check adb logcat for leaked private-key material (Phase F, Task 23).
#
#   scripts/ssh-key-logcat.sh [serial]
#
# Dumps the current logcat buffer (`adb logcat -d`) and searches for the
# private-key markers a failed redaction would leave behind:
#
#   BEGIN OPENSSH PRIVATE KEY
#   BEGIN RSA PRIVATE KEY
#   BEGIN PRIVATE KEY
#
# Only the matching line number and marker name are printed, never the matched
# text, so running this on a dirty log does not copy key material into the
# terminal, a shell history or a CI log.
#
# Exit codes:
#   0  clean: no marker found
#   1  a private-key marker was found
#   2  usage error, adb missing, or logcat could not be read
#
# POSIX sh; no bash arrays or pipefail. Pass a serial when more than one device
# is attached (see `adb devices`). Run it after T10-T14 and attach the exit code
# to the device report.

set -eu

usage() {
  sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'
}

serial=
case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  "")
    ;;
  -*)
    echo "error: unknown option: $1" >&2
    usage >&2
    exit 2
    ;;
  *)
    serial=$1
    ;;
esac

if ! command -v adb >/dev/null 2>&1; then
  echo "error: adb not found in PATH" >&2
  exit 2
fi

tmp=$(mktemp "${TMPDIR:-/tmp}/leocode-logcat.XXXXXX") || {
  echo "error: could not create a temp file" >&2
  exit 2
}
trap 'rm -f "$tmp"' EXIT HUP INT TERM

if [ -n "$serial" ]; then
  if ! adb -s "$serial" logcat -d >"$tmp" 2>/dev/null; then
    echo "error: could not read logcat from device $serial" >&2
    exit 2
  fi
else
  if ! adb logcat -d >"$tmp" 2>/dev/null; then
    echo "error: could not read logcat (is a device attached?)" >&2
    exit 2
  fi
fi

# Print the line number and marker only; the log line itself may contain the
# key and must not be echoed.
if awk '
  /BEGIN OPENSSH PRIVATE KEY/ { print "line " NR ": marker BEGIN OPENSSH PRIVATE KEY"; found = 1 }
  /BEGIN RSA PRIVATE KEY/     { print "line " NR ": marker BEGIN RSA PRIVATE KEY";     found = 1 }
  /BEGIN PRIVATE KEY/         { print "line " NR ": marker BEGIN PRIVATE KEY";         found = 1 }
  END { exit(found ? 1 : 0) }
' "$tmp"; then
  echo "clean: no private-key markers in logcat"
  exit 0
fi

echo "FAIL: private-key material found in logcat" >&2
exit 1
