#!/usr/bin/env bash
# Security & Fuzz Hardening Suite Runner (Task 29).
#
# Executes the Android bridge fuzz tests, path traversal security matrix,
# and Web terminal title sanitization & OSC 52 clipboard protection tests.
#
# Usage:
#   scripts/tests/run-security-suite.sh
#
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "============================================================"
echo " LeoCode Security & Fuzz Hardening Suite (Task 29)"
echo "============================================================"
echo

total=0
failed=0

step_pass() {
  total=$((total + 1))
  echo "[PASS] $1"
}

step_fail() {
  total=$((total + 1))
  failed=$((failed + 1))
  echo "[FAIL] $1: $2"
}

# ------------------------------------------------------------
# 1. Web Terminal Sanitization & OSC 52 Protection Tests
# ------------------------------------------------------------
echo ">>> Running Web Terminal Sanitization & OSC 52 Tests..."
if (cd "$root/web" && npx vitest run src/features/terminal/terminalSanitize.test.ts); then
  step_pass "Web Terminal Sanitization (terminalSanitize.test.ts)"
else
  step_fail "Web Terminal Sanitization" "vitest tests failed"
fi
echo

# ------------------------------------------------------------
# 2. Android Security & Fuzz Unit Tests
# ------------------------------------------------------------
echo ">>> Running Android Bridge Fuzz Tests & Path Traversal Matrix..."
if (cd "$root/android" && ./gradlew testDebugUnitTest \
  --tests "dev.leocode.bridge.BridgeFuzzTest" \
  --tests "dev.leocode.core.PathTraversalSecurityTest"); then
  step_pass "Android Bridge Fuzzing (BridgeFuzzTest)"
  step_pass "Android Path Traversal Matrix (PathTraversalSecurityTest)"
else
  step_fail "Android Security Tests" "Gradle unit tests failed"
fi
echo

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------
echo "============================================================"
if [ "$failed" -eq 0 ]; then
  echo " ALL SECURITY SUITE TESTS PASSED ($total/$total)"
  echo "============================================================"
  exit 0
else
  echo " SECURITY SUITE FAILED ($failed/$total failed)"
  echo "============================================================"
  exit 1
fi
