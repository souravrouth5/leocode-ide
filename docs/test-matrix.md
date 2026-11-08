# LeoCode — Device Test Matrix

Fill one row per device. Do not infer a result from another device; each cell is measured.

## Devices

| # | Model | Android | Selinux | ABI | Userspace | PAGE_SIZE | WebView | MIUI | Storage free | RAM |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Redmi Note 7S (`lavender`) | 9 (SDK 28, patch 2020-02-05) | enforcing, `untrusted_app` | arm64-v8a (+v7a,abi) | toybox, no unzip/git/python | **4096** | Chrome **137.0.7151.115** | V11 (code 9) | 15 786 MB / 51 205 MB | 3.8 GB (heap 256 MB) |
| 2 | SD695 phone | 11 | ? | ? | ? | ? | ? | ? | ? | ? |
| 3 | (to acquire) | 14+ | ? | ? | ? | ? | ? | ? | ? | ? |

Raw report: [`device-reports/20261108-131918-device.txt`](device-reports/20261108-131918-device.txt).

## Phase 0B — process execution

Measured 2026-11-08 on D1, `app-debug.apk` targetSdk 28, driven by
`adb shell am start -n dev.leocode/.HarnessActivity --es run all`.

| Test | D1 (A9) | D2 (A11) | D3 (A14+) | Notes |
|---|---|---|---|---|
| T1 `/system/bin/sh -c echo` | **PASS** | | | exit 0, 322 ms; uid 10090, SELinux `untrusted_app` |
| T2 exec binary from app data | **PASS** | | | `exec-from-data-ok`; the critical W^X gate |
| T3 process-group kill (`setsid` + `kill(-pgid)`) | **PASS** | | | group gone on SIGTERM within 5 s |
| T4 exit-code propagation | **PASS** | | | exit 42, stdout/stderr separated |
| T5 output flood, bounded | **PASS** | | | 25 MB in 6–46 s (0.5–4 MB/s, cache/thermal dependent); captured exactly 262 144 B |
| T6 native PTY (`fork`/`setsid`/`TIOCSCTTY`) | **PASS** | | | `pty-ok`, `cols=80`, exit 7, page size 4096 |
| T7 shell applet inventory | **INFO** | | | setsid/tar/gzip/sed/awk/grep/find/xxd/curl present; **no** unzip, git, python |
| T8 control: targetSdk 29 build must fail T2 | | | | not yet run; documents finding #1 |

**Throughput finding.** `yes | head -c` moves 0.5–4 MB/s through the system shell on this device
(cold 50 MB: 69 s; 25 MB: 46 s cold, 13 s, then 6 s warm). Real compiler/test output is far
smaller; the number matters only for the output-buffer and coalescing design.

**Repeatability.** Two independent runs produced the same PASS set (harness-driven and
user-driven from the UI). T5's timing is the only value that varies, as expected.

**Shell gap.** `unzip` is absent, so runtime/archive extraction must be done in Kotlin
(`ZipFile`/`ZipInputStream`), not by shelling out. `git` and `python` are supplied by JGit and
the NDK CPython build respectively.

## Phase 0A — WebView gate

| Check | D1 | D2 | D3 |
|---|---|---|---|
| WebView version | 137.0.7151.115 (Chrome) | | |
| Chromium ≥ 100 | **PASS** | | |
| `WebViewFeature.isFeatureSupported(ADD_WEB_MESSAGE_LISTENER)` | **PASS** — bridge answers `app.info` | | |
| CodeMirror 6 boots | **PASS** — Python highlighting, line numbers, keymap | | |
| xterm.js boots | **PASS** — raw PTY bytes render | | |
| Degraded mode required? | **No** | | |

## Phase 0C — Python

| Test | D1 | D2 | D3 |
|---|---|---|---|
| `/system/bin/sh` available | **PASS** | | |
| toybox applets: ls/cat/grep/find/sed/tar | **PASS** (no unzip) | | |
| CPython `--version` | | | |
| run script | | | |
| `pip --version` | | | |
| `venv` create + activate | | | |
| `pip install requests` | | | |
| console script shebang | | | |
| native wheel import (markupsafe/ujson) | | | |
| venv symlinks on internal storage | | | |
| peak RSS of `python -c pass` | | | |

## Phase 0D — Git / SSH

| Test | D1 | D2 | D3 |
|---|---|---|---|
| JGit clone (small repo) | | | |
| status / add / commit | | | |
| diff / log / branch | | | |
| pull / push over SSH | | | |
| pull / push over HTTPS token | | | |
| Ed25519 keygen | | | |
| RSA keygen | | | |
| passphrase-protected key import | | | |
| host-key prompt + fingerprint | | | |
| changed host key rejected | | | |
| no key material in logcat | | | |

## Phase 0E — PTY / terminal

| Test | D1 | D2 | D3 |
|---|---|---|---|
| PTY spawn + output + exit code | **PASS** | | |
| interactive shell round-trip | | | |
| resize (SIGWINCH) | | | |
| Ctrl+C | | | |
| Ctrl+D | | | |
| process-group kill from UI | **PASS** (JNI, T3) | | |
| orphan reaped after app death | | | |
| long-running script + reopen | | | |
| output flood with xterm.js attached | | | |
| keyboard open/close layout | | | |
| extra-keys row inserts control chars | | | |
| selection + copy/paste | | | |
| OSC 52 write ignored | | | |
| terminal title sanitised | | | |
| ANR count during session | | | |

## Phase 1 — IDE shell (WebView + bridge)

Measured 2026-11-08 on D1, debug APK with the real IDE (no harness).

| Test | D1 (A9) | D2 (A11) | D3 (A14+) | Notes |
|---|---|---|---|---|
| Cold start → first frame | **2.77 s** | | | `am start -W` TotalTime; 3.08 s before lazy editor chunk |
| Splash before JS runs | **PASS** | | | static markup in `index.html`, correct theme from URL |
| Bridge attach (`addWebMessageListener`) | **PASS** | | | origin `https://appassets.androidplatform.net` only |
| List workspace | **PASS** | | | dirs first, sizes, `.trash` hidden |
| Create file | **PASS** | | | prompt sheet → `fs.write` |
| Open + edit | **PASS** | | | CodeMirror, Python highlight, dirty dot |
| Save | **PASS** | | | `print(1+2)` on disk; atomic tmp → fsync → rename |
| Terminal PTY | **PASS** | | | prompt, `ls` runs, live resize, restart button |
| Terminal keystroke batching | **PASS** | | | one bridge message per animation frame |
| Theme: system / light / dark | **PASS** | | | `data-theme` + status/nav bars update together |
| No first-paint theme flash | **PASS** | | | mode + resolved theme passed in the page URL |
| Keyboard accessory rows | **PASS** | | | keeps soft keyboard open |
| Adaptive launcher icon | **PASS** | | | MIUI squircle mask, art visible |
| Back button hierarchy | **PASS** | | | closes sheets → returns to Files → exits |
| Rename / delete | PARTIAL | | | implemented, not yet exercised on device; delete uses `.trash` |

**Cold-start breakdown.** WebView init dominates; the web bundle is ~45 KB gzip at boot and
CodeMirror (133 KB) / xterm (74 KB) are fetched on first use.

## Lifecycle / environment

| Test | D1 | D2 | D3 |
|---|---|---|---|
| background 30 min, process survives (foreground service) | | | |
| MIUI "no restrictions" + autostart documented | | | |
| phantom-process killer effect | | | |
| low-memory kill behaviour | | | |
| storage pressure (<500 MB) | | | |
| thermal throttling during build | | | |
| cold start time | | | |
| editor memory (4 GB device) | | | |

## Legend

`PASS` / `FAIL` / `PARTIAL (note)` / `N/A`. Any FAIL that blocks an exit criterion is a go/no-go item.
