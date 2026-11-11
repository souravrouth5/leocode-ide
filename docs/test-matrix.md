# LeoCode — Device Test Matrix

Fill one cell per measurement. Do not infer a result from another device; each cell is measured.
Device policy: [plan v9 §Devices](LeoCode_Implementation_Plan_v9.md#devices) and D-014.

## Devices

| # | Model | Android | Root | SELinux | ABI | Userspace | PAGE_SIZE | WebView | ROM / skin | Storage free | RAM |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **D1** | Redmi Note 7S (`lavender`) | 9 (SDK 28, patch 2020-02-05) | No | enforcing, `untrusted_app` | arm64-v8a (+v7a,abi) | toybox, no unzip/git/python | **4096** | Chrome **137.0.7151.115** | MIUI V11 (code 9) | 15 786 MB / 51 205 MB | 3.8 GB (heap 256 MB) |
| **D2** | ? (custom ROM, no device integrity) | 15 (SDK 35) | **Yes** (manager: ?) | ? | ? | ? | ? | ? | ? | ? | ? |
| X1 | SD695 phone (optional, unavailable) | 11 | No | | | | | | | | |
| X2 | Stock Android 14+ (optional, unavailable) | 14+ | No | | | | | | | | |

Raw reports: D1 [`device-reports/20261108-131918-device.txt`](device-reports/20261108-131918-device.txt); D2 pending (Task 3).

**Connection:** D2 on USB, D1 on Wi-Fi ADB (plan v9 §12). Record the serial used in each run's notes.
**Unrooted Android 15:** measured on D2 with `su` denied to LeoCode; mark such cells `PASS (su denied)`.
**Android 10–14:** not verified on hardware.

## Phase 0B — process execution

D1 measured 2026-11-08, `app-debug.apk` targetSdk 28, driven by
`adb shell am start -n dev.leocode/.HarnessActivity --es run all`.

| Test | D1 (A9) | D2 (A15, rooted) | Notes |
|---|---|---|---|
| Install targetSdk-28 APK | **PASS** | | D2: Android 15 floor is targetSdk 24 |
| Old-target warning dialog at launch | not recorded | | D2: record text if shown |
| T1 `/system/bin/sh -c echo` | **PASS** | | D1: exit 0, 322 ms; uid 10090, SELinux `untrusted_app` |
| T2 exec binary from app data | **PASS** | | `exec-from-data-ok`; the critical W^X gate |
| T2c control: targetSdk 29 build must fail T2 | | | optional (Task 3); documents finding #1 |
| T3 process-group kill (`setsid` + `kill(-pgid)`) | **PASS** | | group gone on SIGTERM within 5 s |
| T4 exit-code propagation | **PASS** | | exit 42, stdout/stderr separated |
| T5 output flood, bounded | **PASS** | | 25 MB in 6–46 s (0.5–4 MB/s, cache/thermal dependent); captured exactly 262 144 B |
| T6 native PTY (`fork`/`setsid`/`TIOCSCTTY`) | **PASS** | | `pty-ok`, `cols=80`, exit 7, page size 4096 |
| T7 shell applet inventory | **INFO** | | setsid/tar/gzip/sed/awk/grep/find/xxd/curl present; **no** unzip, git, python |
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
| WebView version | 137.0.7151.115 (Chrome) | |
| Chromium ≥ 100 | **PASS** | |
| `WebViewFeature.isFeatureSupported(ADD_WEB_MESSAGE_LISTENER)` | **PASS** — bridge answers `app.info` | |
| CodeMirror 6 boots | **PASS** — Python highlighting, line numbers, keymap | |
| xterm.js boots | **PASS** — raw PTY bytes render | |
| Degraded mode required? | **No** | |

## 16 KB pages and native code (Task 2, 24)

| Check | CI | D1 | D2 |
|---|---|---|---|
| `libleocodepty.so` all `LOAD` align ≥ `2**14` | | — | — |
| `zipalign -c -P 16 -v 4` on APK | | — | — |
| Python package `.so` files aligned | | — | — |
| PTY library loads (T6) | — | **PASS** (4 KB) | |
| Device page size | — | 4096 | |

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
| PTY spawn + output + exit code | **PASS** | |
| interactive shell round-trip | **PASS** (Phase 1 smoke: prompt, `ls`) | |
| resize (SIGWINCH) | **PASS** (live resize) | |
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
| Notification permission prompt (A13+, targetSdk ≤ 32 behaviour) | N/A | |
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
| Cold start → first frame | **2.77 s** | | `am start -W` TotalTime; 3.08 s before lazy editor chunk |
| Splash before JS runs | **PASS** | | static markup in `index.html`, correct theme from URL |
| Bridge attach (`addWebMessageListener`) | **PASS** | | origin `https://appassets.androidplatform.net` only |
| List workspace | **PASS** | | dirs first, sizes, `.trash` hidden |
| Create file | **PASS** | | prompt sheet → `fs.write` |
| Open + edit | **PASS** | | CodeMirror, Python highlight, dirty dot |
| Save | **PASS** | | `print(1+2)` on disk; tmp → fsync → rename (rename-over fix in Task 4) |
| Terminal PTY | **PASS** | | prompt, `ls` runs, live resize, restart button |
| Terminal keystroke batching | **PASS** | | one bridge message per animation frame |
| Theme: system / light / dark | **PASS** | | `data-theme` + status/nav bars update together |
| No first-paint theme flash | **PASS** | | mode + resolved theme passed in the page URL |
| Keyboard accessory rows | **PASS** | | keeps soft keyboard open |
| Adaptive launcher icon | **PASS** | | MIUI squircle mask, art visible |
| Back button hierarchy | **PASS** | | closes sheets → returns to Files → exits |
| Rename / delete | PARTIAL | | implemented, not yet exercised on device; delete uses `.trash` |
| Shared storage browsing (legacy permission) | | | D2: confirm legacy storage still applies at targetSdk 28 |
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
