# LeoCode — Device Test Matrix

Fill one cell per measurement. Do not infer a result from another device; each cell is measured.
Device policy: [plan v9 §Devices](LeoCode_Implementation_Plan_v9.md#devices) and D-014.

## Devices

| # | Model | Android | Root | SELinux | ABI | Userspace | PAGE_SIZE | WebView | ROM / skin | Storage free | RAM |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **D1** | Redmi Note 7S (`lavender`) | 9 (SDK 28, patch 2020-02-05) | No | enforcing, `untrusted_app` | arm64-v8a (+v7a,abi) | toybox, no unzip/git/python | **4096** | Chrome **137.0.7151.115** | MIUI V11 (code 9) | 15 786 MB / 51 205 MB | 3.8 GB (heap 256 MB) |
| **D2** | POCO F1 (`beryllium`, SD845) | 15 (SDK 35, patch 2025-09-01) | **No `su`** (LineageOS user build; Magisk/KernelSU not installed) | enforcing, `untrusted_app_27` | arm64-v8a (+v7a) | toybox incl. unzip/curl; no git/python/su | **4096** | WebView **156.0.8078.47** | LineageOS, build `BP1A.250505.005`, `lineage_beryllium-user` | 101 021 MB free / 115 797 MB | 5.7 GB (heap 256 MB) |
| X1 | SD695 phone (optional, unavailable) | 11 | No | | | | | | | | |
| X2 | Stock Android 14+ (optional, unavailable) | 14+ | No | | | | | | | | |

Raw reports: D1 [`device-reports/20261108-131918-device.txt`](device-reports/20261108-131918-device.txt); D2 [`device-reports/20261111-141335-device.txt`](device-reports/20261111-141335-device.txt). Smoke logs: `docs/device-reports/*-smoke-*.txt`.

**D2 root status (2026-11-11).** `su` is absent and `ro.debuggable=0`, so D2 is **unrooted** as
measured. D-014/Phase E expect a rooted D2: install a root manager (Magisk or KernelSU) and record
it here before Task 17. Until then root-mode rows stay blocked, and unrooted Android 15 is exactly
the state Task 3 needs.

**D2 page size.** 4096 B, so 16 KB hardware behaviour is not measurable here. The APK check
(`scripts/check-elf-alignment.sh`) plus CI cover alignment.

**Connection:** D2 on USB, D1 on Wi-Fi ADB (plan v9 §12). Record the serial used in each run's notes.
**Unrooted Android 15:** measured on D2 with `su` denied to LeoCode; mark such cells `PASS (su denied)`.
**Android 10–14:** not verified on hardware.

## Phase 0B — process execution

D1 measured 2026-11-08, `app-debug.apk` targetSdk 28, driven by
`adb shell am start -n dev.leocode/.HarnessActivity --es run all`.

| Test | D1 (A9) | D2 (A15, rooted) | Notes |
|---|---|---|---|
| Install targetSdk-28 APK | **PASS** | **PASS** | D2: Android 15 floor is targetSdk 24 |
| Old-target warning dialog at launch | not recorded | **No dialog** | D2 screenshot `20261111` run; app opened straight to the IDE |
| T1 `/system/bin/sh -c echo` | **PASS** | **PASS** — exit 0, 105 ms | D1: 403 ms; D2 uid `u0_a554`, SELinux `untrusted_app_27` |
| T2 exec binary from app data | **PASS** | **PASS** — `exec-from-data-ok` | D2: targetSdk 28 still allows `execve()` from app data on Android 15 |
| T2c control: targetSdk 29 build must fail T2 | not run | **PASS (blocked as designed)** | D2: `error=13, Permission denied`; documents the W^X gate. Rebuilt at 28 afterwards |
| T3 process-group kill (`setsid` + `kill(-pgid)`) | **PASS** | **PASS** — exited in <5 s | |
| T4 exit-code propagation | **PASS** | **PASS** — exit 42, stderr captured | |
| T5 output flood, bounded | **PASS** | **PASS** — 25 MB in 206 ms, 262 144 B captured | D2 `rate=121359KB/s`; D1 16.6 s (`1506KB/s`) |
| T6 native PTY (`fork`/`setsid`/`TIOCSCTTY`) | **PASS** | **PASS** — `pty-ok`, `cols=80`, exit 7 | page size 4096 on both |
| T7 shell applet inventory | **INFO** | **INFO** | D2 has `unzip` and `curl`; **no** git/python/su (D1 also lacks unzip) |
| T8 PTY child env contains only allowlisted keys | | | Task 9 |
| T9 PTY child has no fds > 2 | | | Task 9 |

> Renumbering note: v8's "T8 control build" is now **T2c**. T8–T15 are the v9 harness tests.

**Throughput finding.** `yes | head -c` moves 0.5–4 MB/s through the system shell on D1
(cold 50 MB: 69 s; 25 MB: 46 s cold, 13 s, then 6 s warm). Real compiler/test output is far
smaller; the number matters only for the output-buffer and coalescing design.

**Repeatability.** Two independent runs produced the same PASS set (harness-driven and
user-driven from the UI). T5's timing is the only value that varies, as expected.

**Shell gap.** `unzip` is absent, so runtime/archive extraction must be done in Kotlin
(`ZipFile`/`ZipInputStream`, commons-compress), not by shelling out. `git` and `python` are
supplied by JGit and the CPython package respectively.

## Phase 0A — WebView gate

| Check | D1 | D2 |
|---|---|---|
| WebView version | 137.0.7151.115 (Chrome) | **156.0.8078.47** (Android System WebView) |
| Chromium ≥ 100 | **PASS** | **PASS** |
| `WebViewFeature.isFeatureSupported(ADD_WEB_MESSAGE_LISTENER)` | **PASS** — bridge answers `app.info` | **PASS** — IDE shell boots, workspace status shown |
| CodeMirror 6 boots | **PASS** — Python highlighting, line numbers, keymap | **PASS** — editor pane loads |
| xterm.js boots | **PASS** — raw PTY bytes render | not exercised (Task 6/9) |
| Degraded mode required? | **No** | **No** |

## 16 KB pages and native code (Task 2, 24)

| Check | CI | D1 | D2 |
|---|---|---|---|
| `libleocodepty.so` all `LOAD` align ≥ `2**14` | **PASS** (`0x4000`) | **PASS** (4 KB) | **PASS** (4 KB device, r28 build) |
| `zipalign -c -P 16 -v 4` on APK | **PASS** | — | — |
| Python package `.so` files aligned | | — | — |
| PTY library loads (T6) | — | **PASS** | **PASS** |
| Device page size | — | 4096 | **4096** |

## Phase 0C — Python (Tasks 24–26)

| Test | D1 | D2 |
|---|---|---|
| `/system/bin/sh` available | **PASS** | |
| toybox applets: ls/cat/grep/find/sed/tar | **PASS** (no unzip) | |
| Runtime install (download, verify, extract, health check) | | |
| Install resumes after network loss | | |
| CPython `--version` | | |
| run script | | |
| `pip --version` | | |
| `venv` create + activate | | |
| T15 `venv` + `pip install requests` + import `markupsafe` | | |
| console script shebang | | |
| venv symlinks on internal storage | | |
| peak RSS of `python -c pass` | | |

## Phase 0D — Git / SSH (Tasks 19–23)

| Test | D1 | D2 |
|---|---|---|
| T10 JGit HTTPS clone (public repo) | | |
| T11 Ed25519 keygen (MINA + BC) | | |
| T12 SSH clone | | |
| T13 push to test repo | | |
| T14 Keystore envelope round-trip (StrongBox: yes/no) | | |
| JGit version used (D-016) | | |
| status / add / commit | | |
| diff / log / branch | | |
| pull / push over SSH | | |
| pull / push over HTTPS token | | |
| conflict detected + resolved | | |
| RSA keygen | | |
| passphrase-protected key import | | |
| host-key prompt + fingerprint | | |
| changed host key rejected | | |
| no key material in logcat | | |

## Phase 0E — PTY / terminal

| Test | D1 | D2 |
|---|---|---|
| PTY spawn + output + exit code | **PASS** | **PASS** (T6) |
| interactive shell round-trip | **PASS** (Phase 1 smoke: prompt, `ls`) | not exercised (Task 6/9) |
| resize (SIGWINCH) | **PASS** (live resize) | not exercised |
| Ctrl+C | | |
| Ctrl+D | | |
| process-group kill from UI | **PASS** (run sheet Stop, no children left) | |
| orphan reaped after app death | | |
| output flood with xterm.js attached, UI responsive | | |
| keyboard open/close layout | | |
| extra-keys row inserts control chars | | |
| selection + copy/paste | | |
| OSC 52 write ignored | | |
| terminal title sanitised | | |
| ANR count during session | | |

## Root mode (Tasks 17–18, D2 only)

> **Blocked on D2 (2026-11-11):** `su` is absent (`ro.debuggable=0`, LineageOS user build).
> Every D2 cell in this table is therefore **blocked until a root manager is installed and
> recorded** in the devices table. D1 correctly reports "no su" and never prompts.

| Test | D1 | D2 |
|---|---|---|
| No `su` prompt at startup | **N/A** (no `su`) | |
| Toggle shows "Root not available" | | N/A |
| Enable → warning sheet → grant | N/A | |
| Grant denied → `E_ROOT_DENIED` sheet | N/A | |
| Grant revoked in root manager mid-session → session ends + banner | N/A | |
| Root session `id` shows `uid=0` | N/A | |
| Run as root: output + exit code | N/A | |
| Stop root job leaves no process (`su -c ps`) | N/A | |
| ROOT badge visible while root process alive | N/A | |
| `su` denied: all non-root features unchanged | N/A | |

## Background survival and lifecycle (Task 10)

| Test | D1 | D2 |
|---|---|---|
| Foreground notification "N processes running" + Stop all | | |
| Notification permission prompt (A13+, targetSdk ≤ 32 behaviour) | N/A | **not shown** — no channel yet (`POST_NOTIFICATIONS` granted=false, app importance NONE); Task 10 creates the first channel |
| `sleep 600; echo done` survives 10 min in background | | |
| Terminal reattaches with scrollback (`term.attach`) | | |
| Survives rotation / theme change | | |
| Phantom-process killer effect (A12+) | N/A | |
| Root option: `max_phantom_processes` applied | N/A | |
| MIUI "no restrictions" + autostart documented | | N/A |
| low-memory kill behaviour | | |
| storage pressure (< 500 MB) | | |
| thermal throttling during long job | | |

## Crash recovery and errors (Tasks 8, 11, 12)

| Test | D1 | D2 |
|---|---|---|
| Renderer killed (debug intent) → WebView recreated + banner | | |
| Forced host crash → RecoveryActivity → Restart | | |
| Share diagnostics contains no outside paths / secrets | | |
| Cancelled SAF picker → snackbar | | |
| Disk full on save → error sheet | | |
| Bridge timeout → banner, no endless spinner | | |
| Back: sheets → Files → exit | **PASS** (Phase 1) | |

## Phase 1 — IDE shell (WebView + bridge)

Measured 2026-11-08 on D1, debug APK with the real IDE (no harness).

| Test | D1 (A9) | D2 (A15) | Notes |
|---|---|---|---|
| Cold start → first frame | **2.77 s** (2026-11-08); 3.309 s (2026-11-11, after reinstall) | **0.941 s** (2026-11-11) | `am start -W` TotalTime; D2 `LaunchState: COLD`. A sleeping screen on D1 makes `-W` report tens of seconds; `smoke.sh` wakes it first |
| Splash before JS runs | **PASS** | **PASS** | static markup in `index.html`, correct theme from URL |
| Bridge attach (`addWebMessageListener`) | **PASS** | **PASS** | origin `https://appassets.androidplatform.net` only |
| List workspace | **PASS** | **PASS** (IDE shell boots) | dirs first, sizes, `.trash` hidden |
| Create file | **PASS** | not exercised | prompt sheet → `fs.write` |
| Open + edit | **PASS** | not exercised | CodeMirror, Python highlight, dirty dot |
| Save | **PASS** | not exercised | `print(1+2)` on disk; tmp → fsync → rename (rename-over fix in Task 4) |
| Terminal PTY | **PASS** | not exercised | prompt, `ls` runs, live resize, restart button |
| Terminal keystroke batching | **PASS** | not exercised | one bridge message per animation frame |
| Theme: system / light / dark | **PASS** | **PASS** (dark rendered) | `data-theme` + status/nav bars update together |
| No first-paint theme flash | **PASS** | **PASS** | mode + resolved theme passed in the page URL |
| Keyboard accessory rows | **PASS** | not exercised | keeps soft keyboard open |
| Adaptive launcher icon | **PASS** | not exercised | MIUI squircle mask, art visible |
| Back button hierarchy | **PASS** | not exercised | closes sheets → returns to Files → exits |
| Rename / delete | PARTIAL | | implemented, not yet exercised on device; delete uses `.trash` |
| Shared storage browsing (legacy permission) | **PASS** (S1: 56 entries, write round-trip) | **PASS** (S1: 27 entries, write round-trip) | targetSdk 28 keeps legacy storage on Android 15; `PRIVATE_FLAG_REQUEST_LEGACY_EXTERNAL_STORAGE` |
| Path jail: `/system/build.prop` → `E_PATH_OUTSIDE_ROOT` | | | Task 4 |

**Cold-start breakdown.** WebView init dominates; the web bundle is ~45 KB gzip at boot and
CodeMirror (133 KB) / xterm (74 KB) are fetched on first use.

## Workspace and editor (Tasks 14–16)

| Test | D1 | D2 |
|---|---|---|
| Create / switch two workspaces | | |
| Import folder via SAF | | |
| Export + restore zip backup | | |
| Draft restored after force-stop | | |
| External change banner after terminal edit | | |
| > 1 MB file opens in large-file mode | | |
| Find / replace | | |
| Search ~1 000-file repo | | |

## Release (Tasks 28–29)

| Test | D1 | D2 |
|---|---|---|
| R8 release build passes `smoke.sh` | | |
| Signed rc installs over previous build | | |
| In-app update check finds next rc | | |
| 4 h soak (Wi-Fi ADB) | | |
| Accessibility: 48 dp, 200 % font | | |
| Keystroke-to-glyph < 50 ms | | |
| Editor RSS < 120 MB | | |

## Legend

`PASS` / `FAIL` / `PARTIAL (note)` / `N/A` / `INFO`. Any FAIL that blocks an exit criterion is a go/no-go item.
