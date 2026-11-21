# Task 9 verification — native PTY correctness

**Date:** 2026-11-14 · **Branch:** `v9-impl` · **Plan:** [v9 §15](../LeoCode_Implementation_Plan_v9.md) Task 9

## What changed

### `android/app/src/main/cpp/pty.c`

| Requirement | Change |
|---|---|
| `execve` with a prepared environment | `copy_env_pairs()` builds a NULL-terminated `envp` (stored `KEY=VALUE` strings) before `fork()`. The child calls `execve("/system/bin/sh", {"sh","-c",cmd,NULL}, envp)`; the old `setenv()` loop after `fork()` is gone. An empty environment is passed as `{ NULL }`, never the JVM's `environ`. |
| Close fds ≥ 3 | `close_inherited_fds()` uses `SYS_close_range` where the kernel has it, otherwise a bounded `close()` loop. It runs after the PTY is `dup2()`'d onto 0/1/2 and before `chdir`/`execve`. |
| Reset signals | `reset_child_signals()` empties the signal mask (`sigprocmask`) and restores every disposition to `SIG_DFL` (`signal(1.._NSIG-1, SIG_DFL)`). |
| `ptsname_r` | Replaced `ptsname()` + `strncpy` with `ptsname_r(master, slave_path, sizeof)` and checked the return value. |
| `TIOCSCTTY` | The `ioctl(slave, TIOCSCTTY, 0)` result is checked; failure now aborts the child with a readable error instead of continuing with a half-setup terminal. |

The `execve` path and the two harness probes share `copy_env_pairs()`,
`close_inherited_fds()` and `reset_child_signals()`, so the probes test the
production setup rather than a parallel implementation.

### Kotlin (`core/Pty.kt`)

`PtySession` has a volatile `closed` flag. After `destroy()`:

- `write` returns `-1`, `readBlocking` returns `null` (and `read` returns `""`),
- `resize` is a no-op instead of an `ioctl` on a possibly reused fd,
- a second `destroy` is a no-op.

### Harness (`debug/.../HarnessActivity.kt`)

- **T8** `probeEnvironment` execs `/system/bin/env` with the `ChildEnv` array and
  compares the printed keys with the allowlist: no unexpected inherited key
  (for example `ANDROID_DATA`) and no missing allowlisted key.
- **T9** `probeFds` reports `open_above_2=N` from the child after `dup2` and the
  fd sweep; the test passes only for `N = 0`.
- T6 (the PTY smoke test) still runs through the same `createSubprocess` path.

## Gates

| Check | Result |
|---|---|
| Native build (`assembleDebug`, CMake/NDK r28) | **PASS**; `libleocodepty.so` exports `probeEnvironment` / `probeFds` |
| `testDebugUnitTest` | **PASS**: 94 tests, 0 failures |
| `lintDebug` | **PASS** (blocking) |
| `assembleDebug` / `assembleRelease` | **PASS**: debug 34,288,973 B; release 25,938,526 B |
| 16 KB check (`check-elf-alignment.sh`) | **PASS**, 2 ELF files (`libleocodepty.so` LOAD p_align `0x4000`) |
| Harness T8/T9 on D1 and D2 | **PENDING** — no device attached (`adb devices` empty; D1 `192.168.29.26:5555` returned “No route to host”) |

## Device run

```bash
adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s <serial> shell am start -n dev.leocode/.HarnessActivity --es run all
adb -s <serial> logcat -d -s LeoCodeHarness | tee docs/device-reports/<date>-harness-task9-<serial>.txt
```

Expected additions to the existing T1–T7/S1 log:

```
▶ T8 — PTY child environment is allowlisted
  allowed=COLUMNS,HOME,LANG,LD_LIBRARY_PATH,LINES,PATH,PWD,PYTHONHOME,SSL_CERT_FILE,TERM,TMP,TMPDIR
  child=<same keys>
  unexpected=[] missing=[]
  PWD=/data/user/0/dev.leocode/files/workspaces/default
  PASS

▶ T9 — PTY child has no fds above stderr
  open_above_2=0
  PASS
```

T6 must still print `pty-ok`, `cols=80`, `exit=7` on both phones. D2 is currently
offline and unrooted; the test does not need root.

## Why this is not marked done

The code and local gates pass, but the plan's Task 9 demo is the device harness.
It stays `[-]` in `PROGRESS.md` until the T8/T9 lines above are recorded on D1
and D2. The `npm`/Gradle CI has still not observed a GitHub run.
