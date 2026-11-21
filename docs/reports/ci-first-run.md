# First green CI run

**Date:** 2026-11-21 · **Branch:** `v9-impl` · **Commit:** `7e62c71`
**Run:** [44884113986](https://github.com/souravrouth5/leocode-ide/actions/runs/44884113986)
(`workflow_dispatch`) · **Repo:** `souravrouth5/leocode-ide` · **PR:** #1 (`v9-impl` → `main`)

This is the first execution of `.github/workflows/ci.yml` on GitHub. It closes the "CI has never
run" caveat that kept Tasks 2, 3 and 7 in progress.

## Why it had never run

The workflow triggers on `push` to `main`, on `pull_request`, and on `workflow_dispatch`
(`ci.yml:3-7`). All work was pushed to `v9-impl`, which matches none of those, so no run was
created. The branch was pushed and the token could not read Actions, which made the absence look
like a permissions problem.

## Result

| Job | Result | Notes |
|---|---|---|
| Web (lint + tests + build) | **PASS** | `npm ci`, lint, 277 tests, typecheck, build, `web-dist` artifact |
| Android (tests + lint + assemble + 16 KB) | **PASS** | SDK 34 / build-tools 35 / CMake 3.22.1 / NDK 28.2.13676358 installed; `testDebugUnitTest lintDebug assembleDebug`; generated-type drift check; `check-elf-alignment.sh`; `leocode-debug-apk` (17 183 077 bytes) |
| Python runtime (stub) | skipped | `if: false` until Task 24 |
| Nightly APK release | skipped | only runs on `main` pushes |

Artifacts uploaded: `web-dist` (6 234 146 bytes) and `leocode-debug-apk` (17 183 077 bytes), both
unexpired.

The PR-triggered run 44883877335 was cancelled after this dispatch was started; it is superseded,
not a failure.

## What this does and does not prove

- It proves the workflow YAML, pinned action SHAs, Gradle wrapper, NDK pin, drift check and 16 KB
  check all work on a clean `ubuntu-latest` runner.
- It is **one** run. There is no history of CI catching a regression yet.
- A plain push to `v9-impl` still runs nothing. Keep changes flowing through PR #1, or add
  `v9-impl` to the `push` branches.

## Reproduction

GitHub → Actions → CI → **Run workflow** → branch `v9-impl`. Or with a token that has
`actions:write`:

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/souravrouth5/leocode-ide/actions/workflows/ci.yml/dispatches \
  -d '{"ref":"v9-impl"}'
```

Reading status needs `actions:read`:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/souravrouth5/leocode-ide/actions/runs?branch=v9-impl&per_page=5"
```
