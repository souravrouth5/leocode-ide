# B1 review

**Verdict: accept after two small fixes (F1, F2).** The core of B1 is correct and matches the brief.
F1 and F2 matter on a real Magisk phone, and both are quick to do before committing.

## Checked against the code

| Brief item | Result |
|---|---|
| R-01 `ProcessShellRunner`: stdin closed, two daemon drain threads, 64 KiB caps that keep reading, `waitFor` before reads, `destroyForcibly` + bounded join, never throws | ✅ correct |
| R-02 `grantCache`; `status()`/`isGranted()` make zero shell calls; `canUseRoot`, `markGranted`, `markLost`; `setEnabled(false)` resets the cache | ✅ correct. `AppGraph.diagnostics()` goes through `isGranted()`, so it no longer runs `su` either |
| `requestGrant` deny/timeout → `E_ROOT_DENIED` with a timeout-specific message | ✅ |
| R-08 su paths + the `/data/adb` comment | ✅ |
| `buildRootCommand`/`buildRootShell`/`parseRootPidFile`/`RootPid`/`awaitRootPid`/`isRootPidAlive` | ✅ quoting is right; `/proc/<pid>/stat` field 22 / index 19 after `)` is right |
| Tests: 17 in `RootManagerTest`, covering every case in the brief | ✅ |
| Files touched: only `RootManager.kt` + `RootManagerTest.kt` | ✅ |
| LF line endings | ✅ no CR found |

## Fixes before commit

### F1 (Medium): `isRootPidAlive` must use one `su` call, not two

It runs `su -c "kill -0 P"` and then `su -c "cat /proc/P/stat"`. By default Magisk shows a toast and
writes a log entry **for every `su` invocation**, and each call costs roughly 100 ms or more. B3 will
call this in a loop while stopping a process, so two calls per check doubles the toasts and the delay.

Change it to a single call:

```kotlin
su -c "kill -0 <pid> 2>/dev/null && cut -d' ' -f22 /proc/<pid>/stat"
```

Exit 0 + the parsed start time equals `rp.startTime` → alive. Anything else → not alive.
`parseStatStartTime` already accepts a bare number. Update the test: assert **exactly one** command
per `isRootPidAlive` call, and keep the dead, recycled-pid and `canUseRoot=false` cases.

### F2 (Medium): make the root pidfile readable by the app

The wrapper writes the pidfile as root. If the root shell's umask is `077`, the file is `0600 root`,
and the app (a different uid) can't read it. `awaitRootPid` then times out, and B3 would treat a
working root run as "refused". Add `chmod 0644` right after the write in both builders:

```
echo "$$ $(cut -d' ' -f22 /proc/$$/stat)" > '<pid>' && chmod 0644 '<pid>' && cd '<cwd>' && exec …
echo "$$ $(cut -d' ' -f22 /proc/$$/stat)" > '<pid>' && chmod 0644 '<pid>' && exec /system/bin/sh -i
```

Update the exact-string assertions in `buildRootCommand and buildRootShell construct expected commands with quoting`.

### Process note

The README asks for `git status --short` at the start of each brief, recorded in the report. It's
missing from B1.md. Add it to the B1-fix report and every report from now on.

## Not caused by B1: the full suite was already red

`RootHandlerTest` fails 3/3 with `Method i in android.util.Log not mocked`. `RootHandler.kt` calls
`android.util.Log.i` and the Gradle config has no `unitTests.isReturnDefaultValues`, so these tests
**could not have passed** once that logging went in. B1 didn't touch `RootHandler.kt`; the agent
was right to leave it. This means the tree's "465+ tests, 0 failures" claim in `PROGRESS.md`/`HANDOFF.md`
was not true for the current tree, and CI on it would fail. **B2 fixes it** (brief updated: inject a
`log` lambda the way `RuntimeHandler`/`PythonHandler` do, and the full suite must be green).

## Notes carried into B3 (brief updated)

- Poll liveness slowly (≥ 200 ms between checks, at most ~10 checks per stop) because of the Magisk toast cost.
- A wrapper that fails **before** writing the pidfile looks the same as a refusal. Only classify it as
  `denied` when `su` exits non-zero with no pidfile **and** no output from our wrapper. Otherwise
  report a normal failed run.
- After an app restart with root mode on, `granted` is `false` until the first root operation
  succeeds. Diagnostics should say "enabled (not verified this session)", not "grant pending/denied".
