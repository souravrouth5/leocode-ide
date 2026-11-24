# LeoCode — Remaining Work Plan (Phase E close-out → v0.1.0)

**Written:** 2026-11-24 · **Scope:** everything between today's tree and a stable `v0.1.0` tag.
**Inputs read:** `PROGRESS.md`, `docs/HANDOFF.md`, `docs/RELEASE-READINESS.md`,
`docs/LeoCode_Implementation_Plan_v9.md` (§8, Tasks 17–18), `docs/test-matrix.md` (Root mode),
`docs/bridge-contract.md`, and the root code paths (`RootManager.kt`, `RootHandler.kt`,
`ProcessSupervisor.kt`, `Pty.kt`, `ProcHandler.kt`, `TermHandler.kt`, `AppGraph.kt`,
`web/src/features/root/*`, `web/src/bridge/android.ts`, `SettingsDialog.tsx`, `TerminalPane.tsx`).

Status key (same as `PROGRESS.md`): `[ ]` not started · `[-]` in progress · `[x]` done · `[!]` blocked · `[~]` deferred

---

## 0. Where we actually are

Phases A–D, F, G and H are done and device-verified. **Phase E (root mode) is the open phase.**
D2 (POCO F1, Android 15, `e76846f`) is now Magisk-rooted and connected.

What Phase E has already proven on D2 (2026-11-23):

- `root.status` → `available=true, granted=true, enabled=true, su=/product/bin/su`
- Settings › Advanced toggle, `RootWarningDialog`, `# ROOT` header and terminal badges
- Root PTY: `id` → `uid=0(root) gid=0(root) … context=u:r:magisk:s0` (`d2-root-terminal-id.png`)
- Run sheet shows the "Run as root" toggle (`d2-run-sheet-root.png`)

What has **not** been proven: every behavioural row in `test-matrix.md` § Root mode except
`uid=0` is still "blocked", and there is **no raw text log** for Phase E under `docs/device-reports/`
(only screenshots). The plan's Task 17/18 demos (grant / deny / revoke, D1 "Root not available",
"stopping a root `sleep` leaves no process", "lost grant ends the session with a banner") have no
evidence.

**Decision:** treat Tasks 17–18 as `[-]` until §2 passes. `PROGRESS.md` currently says both
"complete" (Snapshot, Phase E list) and "blocked on phone root" (header, Blocking facts, Known debt).
The project's own rule (A-10: status stays honest until the evidence exists) applies here.

---

## 1. Phase E code gaps (from reading the code; fix before the device pass)

Each item says what the code does today, why it matters, and the fix. Items marked **verify** are
risks that only a device run can confirm or rule out.

| ID | Sev | Finding | Fix | Status |
|---|---|---|---|---|
| **R-01** | High | `RootManager.ProcessShellRunner` reads stdout and stderr to EOF **before** `waitFor(timeoutMs)`. If `su` blocks (a Magisk prompt waiting, a hung daemon), `readText()` never returns, so the 3 s `isGranted`, 30 s `requestGrant` and 2 s `kill` timeouts are not enforced and the bridge worker thread hangs. stderr is drained only after stdout, so a chatty stderr can also deadlock. | Drain both streams on separate threads (or `redirectErrorStream(true)` + one reader thread), `waitFor(timeout)` first, `destroyForcibly()` on timeout, bound the captured size. JVM test with a fake process that never closes its stream. | **Fixed in B1/B2** |
| **R-02** | High | `root.status` can prompt, which breaks D-011 and the contract ("never prompts"). When root mode is enabled, `status()` → `isGranted()` runs `su -c id`. If the grant was revoked or Magisk's policy for LeoCode is set to "prompt", that call opens a superuser prompt. The same applies to `AppGraph` diagnostics (`rootManager.isGranted()`). Every status/diagnostics call also runs `su`, so Magisk logs (and may toast) a grant each time. | Keep a cached `granted` state in `RootManager` (set by `requestGrant`, by a root op that succeeds, and cleared on failure/`root.lost`). `status()` and diagnostics read the cache and never run `su`. Test: status with enabled prefs makes zero shell calls. | **Fixed in B1/B2** |
| **R-03** | High | **The host never emits `root.lost`.** `web/src/bridge/android.ts` listens for it and `rootStore` handles it, but no Kotlin code sends it. A grant revoked mid-session therefore produces no banner and doesn't end the session. | Detect loss where it shows up: a root PTY whose `su` exits non-zero quickly / prints `permission denied`, a `proc.run root:true` that fails the same way, a `kill` via `su` that fails. Then clear the cached grant, emit `root.lost { sessionId? }`, and return `E_ROOT_DENIED` on the next use. Web: banner + end the root tab (Restart offers a normal shell). | **Fixed in B1/B2/B4** |
| **R-04** | High | The root kill path misses the real process under Magisk. The app's `su` is only a *client*: `magiskd` forks the root command in its own tree. `ProcessSupervisor` also starts root jobs **without setsid**, so the client sits in the app's process group and `kill -15 -<clientPid>` hits no group. `Pty.destroy` / `ProcessSupervisor` then poll the client pid and report success. Result: `sleep 600` keeps running as root. | The root wrapper writes `"$$ <starttime>"` to `files/run/root/<id>.pid`; kill and liveness checks target that pid through `su`; never use `NativePty.killGroup` for root work. Briefs B1 (helpers) + B3 (wiring) + B6 (session kill via `/proc/[0-9]*/stat`). Device row E-08/E-19 confirms. | **Fixed in B1/B3/B6** |
| **R-05** | Medium | Turning root mode **off** is web-only. `rootStore.disableRoot()` just sets `enabled:false` locally. I found no bridge method that clears `RootPrefs`, so the host stays enabled, `proc.run root:true` / `term.open root:true` are still accepted, and root mode comes back after a relaunch. | Add `root.setEnabled { enabled }` (or `root.disable`) to `Contract.kt`, regenerate `types.gen.ts`, call it from the store, and on disable close live root sessions/jobs. Tests on both sides. | **Fixed in B1/B2/B4** |
| **R-06** | Medium | Root orphans after a crash. `TerminalRegistry` writes `root-term` and `ProcessSupervisor` writes `root-proc` pidfiles, but `OrphanReaper` kills with `NativePty.killGroup` under the app UID (can't signal root) and `/proc` is hidden for other UIDs, so the record is silently dropped. | Startup reaper skips root kinds (startup must never run `su`). A new `RootOrphanReaper` runs lazily before the first root job/session and after `root.request` succeeds. Session kill in B6 reaps child processes. Brief B3 + B6. Device row E-11/E-19. | **Fixed in B1/B3/B6** |
| **R-07** | Low | `ProcHandler`/`TermHandler` check `isEnabled()` but not the grant, so a denied `su` shows up as a generic non-zero exit instead of `E_ROOT_DENIED`. | Fold into R-03's failure classification. | **Fixed in B2** |
| **R-08** | Low | `HANDOFF.md`/`PROGRESS.md` list `/data/adb/ksu/bin/su` as a detection path, but `DEFAULT_SU_PATHS` doesn't include it (or `/debug_ramdisk/su`). | Decide what's in scope (Magisk is the only manager we can test). Add the paths or correct the docs. Don't claim KernelSU/APatch support without a device. | **Fixed in B1** |
| **R-09** | Low | Phantom-process option: plan §8 / Task 10 say rooted phones are *offered* `device_config put activity_manager max_phantom_processes 2147483647` with an explanation. Settings only prints the command text. test-matrix row "Root option applied" is pending. | Add an "Apply (until reboot)" button that only shows when root is enabled+granted and runs through `proc.run root:true` after a confirm, or explicitly descope it to 0.2 in the tracker. | **Fixed in B5** |
| **R-10** | Low | Badge semantics: plan §8 says the ROOT badge shows on root tabs, the run sheet and the status bar *while any root process is alive*. Today the header badge follows `enabled`. | Pick one rule (recommend: header = mode enabled; tab/run sheet/status bar = a live root process) and write it in `ux-spec.md`. | **Fixed in B4** |

**Contract first** (same approach as Phase F): lock `root.setEnabled`, the `root.lost` payload and

> **Implementation briefs:** [`docs/agent-briefs/`](agent-briefs/README.md) has B1–B5, run in order. (The briefs name the method `root.disable` instead of `root.setEnabled`, because enabling always goes through `root.request`.)
the failure → `E_ROOT_DENIED` mapping in `Contract.kt` + `bridge-contract.md` +
regenerated types in one commit, then build both sides.

**Suggested split** (AGENTS.md: ≤ 3 subagents, disjoint files, only the parent commits):

| Worktree | Owns | Items |
|---|---|---|
| `phase-e-host` | `core/RootManager.kt`, `bridge/RootHandler.kt`, `core/ProcessSupervisor.kt`, `core/Pty.kt`, `core/TerminalRegistry.kt`, `core/OrphanReaper.kt`, `AppGraph.kt`, their tests | R-01…R-07 host halves |
| `phase-e-web` | `features/root/*`, `components/SettingsDialog.tsx`, `features/terminal/TerminalPane.tsx`, `features/run/RunSheet.tsx`, `errors/catalog.ts`, their tests | R-03/R-05 web halves, R-09 UI, R-10 |
| parent | `Contract.kt`, `types.gen.ts`, `docs/*` | contract lock, merges, gates |

**Gates before the device pass:** Android `testDebugUnitTest lintDebug assembleDebug`, web
typecheck/lint/test/build, `check-elf-alignment.sh`, bridge drift check.

---

## 2. Phase E device pass (D2 rooted, D1 unrooted)

Run this on a fresh APK built after §1. Record everything in one raw log,
`docs/device-reports/2026112x-phaseE-D2-e76846f.txt`, plus a D1 file, the same way Phase F did.
Screenshots on their own don't count as evidence.

Useful commands (run on the host that has `adb`):

```bash
S=e76846f
adb -s $S logcat -G 16M && adb -s $S logcat -c
adb -s $S shell dumpsys package dev.leocode | grep -m1 userId        # LeoCode app uid
# Magisk policy for LeoCode (0 = prompt, 1 = deny, 2 = allow) — set via the Magisk app,
# or: adb -s $S shell su -c "magisk --sqlite 'UPDATE policies SET policy=1 WHERE uid=<uid>'"
adb -s $S shell su -c "ps -A -o PID,PGID,USER,NAME | grep -E 'sleep|leocode'"   # leak check
adb -s $S logcat -d -s LeoCodeRoot:I LeoCode:I
```

| # | Row (test-matrix § Root mode) | D2 | D1 | How |
|---|---|---|---|---|
| E-01 | No `su` prompt at startup (fresh install, Magisk policy = prompt) | **PASS** | **PASS** | `pm clear`, launch, walk onboarding, open Settings: no prompt; `root.status` log shows no `su` call |
| E-02 | Toggle shows "Root not available" | n/a | **PASS** | D1 Settings › Advanced; toggle disabled with message |
| E-03 | Enable → warning sheet → grant → badge | **PASS** | n/a | Cancel the warning once (nothing happens), then accept; Magisk grant; header badge |
| E-04 | Grant denied → `E_ROOT_DENIED` sheet + Try again | **PASS** | n/a | Magisk policy = deny, enable again |
| E-05 | Revoke → next root op fails with `E_ROOT_DENIED` + `root.lost` banner | **PASS** | n/a | Revoke in Magisk, then open a new root shell and Run as root. A root shell that is **already running** keeps uid 0 (Magisk doesn't kill it); this is documented, not a failure |
| E-06 | Root session `id` shows `uid=0` | **PASS** | n/a | Re-capture as text in the log (`id; echo $$`) |
| E-07 | Run as root: output + exit code | **PASS** | n/a | Script `id -u; exit 3` → shows `0` and `EXIT 3` |
| E-08 | **Stop root job leaves no process** | **PASS** | n/a | Run as root `sleep 600`, Stop, then the leak check above. Repeat for a root PTY running `sleep 600` → Exit Root Shell / Stop all |
| E-09 | ROOT badge visible while a root process is alive | **PASS** | n/a | Per the R-10 rule |
| E-10 | `su` denied: all non-root features unchanged | **PASS** | **PASS** | Magisk deny; run `smoke.sh`, a Python run, a terminal, a Git status |
| E-11 | Root orphan reaped on the next root use after a forced kill | **PASS** | n/a | Root `sleep 600`, `am force-stop dev.leocode`, relaunch (no prompt), open a root shell, leak check |
| E-12 | Disable persists across relaunch (R-05) | **PASS** | n/a | Disable, force-stop, relaunch: toggle off, `proc.run root:true` → `E_ROOT_DENIED` |
| E-13 | `root.status` / diagnostics never prompt (R-02) | **PASS** | **PASS** | Policy = prompt while enabled; open Diagnostics and Settings; no prompt |
| E-14 | Phantom-process option (R-09) | **PASS** | n/a | Apply, then `adb shell device_config get activity_manager max_phantom_processes` |
| E-15 | Bridge timeouts hold while a Magisk prompt is pending (R-01) | **NOT REACHABLE ON DEVICE** (Magisk 31.1 auto-denies; unit test PASS) | n/a | Leave the prompt untouched 40 s: UI stays responsive, request fails cleanly |
| E-16 | Root kill reaches children | **PASS** | n/a | Run as root `sleep 600 & sleep 601 & wait` → Stop → `su -c "ps -A -o PID,PGID,USER,NAME \| grep -E 'sleep 60[01]'"` empty |
| E-17 | Early Stop doesn't leak (B3 F3) | **PASS** | n/a | Stop within 0.5 s of starting a root `sleep 600`; leak check |
| E-18 | Re-request root keeps open root shells (B3 F2) | **PASS** | n/a | Root shell running `sleep 900`; trigger `root.request` again; the shell and the sleep survive; session kill reaps on exit |
| E-19 | Background `sleep 700 &` + foreground `sleep 701` session kill | **PASS** | n/a | Both reaped on next root session spawn by `RootOrphanReaper` |

**Exit gate for Phase E:** E-01…E-13 PASS on the listed devices (E-14 PASS or written down as
deferred), raw logs committed. Then Tasks 17–18 go to `[x]` and RELEASE-READINESS gate 22 goes to
PASS.

---

## 3. Documentation reconciliation (same commit as the Phase E close)

The docs currently disagree with each other. Fix them together so the next session isn't misled:

- [x] `PROGRESS.md` header: drop "Only Phase E (root mode) remains blocked on phone root" and
  "Both phones are unrooted"; Phase E list → `[-]` now, `[x]` after §2; Blocking facts and the
  Known-debt row "D2 has no `su`" → resolved with the date; Snapshot "Devices" is already right.
- [x] `README.md` status block: still says "Phase G (Python) next" and "Both are currently unrooted".
- [x] Test-count claims: `PROGRESS.md`/`HANDOFF.md` say "Android 465+ tests / 0 failures", but
  `RootHandlerTest` failed 3/3 on that tree (`android.util.Log` not mocked; found in the B1 review,
  fixed in B2). After B2, re-run the full suite and quote the real numbers.
- [x] `docs/LeoCode_Implementation_Plan_v9.md` items 10 and the D2 row ("Not yet rooted"): add a
  dated note that D2 is Magisk-rooted.
- [x] `docs/test-matrix.md`: D2 header "unrooted", the D2 root-status note, the Root-mode table
  (fill it in from §2), and the device table root column.
- [x] `docs/RELEASE-READINESS.md`: gate 22 (BLOCKED → result of §2); gates 2/4 test counts (435/315 →
  current 465+/463); gates 18–20 (a11y, perf, soak) to match Task 29's report; summary paragraph
  (it still lists Tasks 30–33 and a11y/soak as open); §4 "Root mode is blocked".
- [x] `docs/bridge-contract.md`: `root.status`/`root.request` still say "planned"; add
  `root.setEnabled`; document the `root.lost` emitter.
- [x] `docs/HANDOFF.md`: "What to do next" still says "Ask before starting Task 29"; replace it with this plan's
  order; correct the su-path list (R-08).
- [x] `docs/ux-spec.md`: badge rule (R-10).

---

## 4. Non-root work still open before v0.1.0

### 4.1 Must do for 0.1

| # | Item | Owner | Notes |
|---|---|---|---|
| M-1 | **D1 parity for Tasks 31–33** | dev | Only D2 is evidenced for the run sheet (stdin, tracebacks, summaries), the Python indent extension/snippets, the template and the compatibility sheet. Task 32 on D1 ran build 1006. D1's WebView is Chrome 80, the oldest target, so CodeMirror extensions are most at risk there. Re-run on the release-candidate APK and commit a text log. |
| M-2 | **Offline backup of release keys** | owner | `~/.config/leocode/release.jks`, `release.properties`, `release-signing.pem`. The keystore is permanent: the updater compares signer sets. |
| M-3 | **Task 24 signed Python runtime release** | owner | Create the protected `python-runtime` environment + `RUNTIME_SIGNING_KEY`, dispatch CI, confirm the release page lists tarball/manifest/sig/wheel/`SHA256SUMS`. Task 24 stays `[-]` until then. |
| M-4 | **Rotate the GitHub PAT** stored in plaintext in `.git/config` | owner | Move it to a credential helper; the repo is public now. |
| M-5 | **Merge and run CI** | dev | `feat/phase-g` (+ Phase E work) → `v9-impl` → `main` through a PR so the `pull_request` trigger runs; CI doesn't run on branch pushes. |
| M-6 | **Cut stable `v0.1.0`** | owner + dev | Tag on `main`, confirm `releases/latest/download/release.json` is populated (empty until now), update both phones rc5 → 0.1.0 in-app, re-run `smoke.sh`, update the Task 29 go/no-go with the Phase E result. |

### 4.2 Triage: fix now or defer to 0.2 with a written reason

Nothing here blocks 0.1 by itself, but each item needs a decision recorded in `PROGRESS.md`:

- **Narrow Phase B/C review items still open:** L-06 (reaper when group leader is gone), L-08
  (detach on `onStop`), L-15 (wake lock), L-24 (back timeout), S-15…S-18 (fsync, `.tmp` sweep, SAF
  binary, purge off-path), S-19/S-20, B-15/B-16, W-25 (large-file perf), W-30/W-31/W-33/W-38.
  *Recommendation:* fix S-15/S-16 (data durability) and L-06 (it interacts with R-06) for 0.1;
  defer the rest.
- **Pending device checks:** S-12 case-only rename on shared storage, L-09 renderer kill while
  backgrounded, W-24 visual scroll, W-18 CRLF, W-12 run-hide; Phase D checks still listed as unit-only
  (draft recovery on device, 20 000-file import cap rollback, PD-19).
- **Deliberately partial:** PD-20 async `workspace.ensure()`, PD-25 host-side cancel for `saf.*` → `[~]` 0.2.
- **D1 startup error:** `Cannot read properties of null (reading 'style')` twice on Chrome 80. It's
  harmless today, but chase it during M-1 with the WebView console attached.
- **Gate 9, instrumented tests (`androidTest` absent):** every device-only defect (Phase F ×5,
  Task 28 API 28 signer, Task 26 cwd) slipped past the JVM tests. *Recommendation:* a minimal
  `androidTest` set for 0.1 (SecretStore Keystore round-trip, MINA SHA-256 provider, `RootManager`
  timeout behaviour) or an explicit `[~]` with that reasoning.
- **Repeatability:** Phase E results will be single runs. Run the E-rows twice on D2 (the cheapest
  soak, RELEASE-READINESS §3.3).

### 4.3 Already deferred (no action for 0.1)

Track C1 userspace, Node.js/Java/PHP providers, web preview (D-010), degraded WebView mode, Termux
GPL view, root file browsing (D-011 reopen trigger), Android 10–14 hardware (D-014).

---

## 5. Order of work

1. [x] **Contract lock** for root (`root.setEnabled` / `root.disable`, `root.lost` payload, error mapping) — *done in B1*.
2. [x] **§1 host + web fixes** in parallel worktrees, then merge and run the gates — *done in B2–B5, follow-up B6*.
3. [x] **§2 device pass** on D2 (rooted) and D1 (unrooted), with raw logs committed. Run it twice on D2 — *done (rc10/rc11)*.
4. [x] **§3 doc reconciliation** → Phase E `[x]`, gate 22 PASS — *done in B7*.
5. **M-1 D1 parity** for Tasks 31–33, plus the D1 startup error.
6. **§4.2 triage** decisions written into `PROGRESS.md`; fix the 0.1 picks.
7. **Owner actions M-2, M-3, M-4** (can run in parallel with 1–6).
8. **M-5 merge + CI green**, then **M-6 `v0.1.0`** and the in-app update on both phones.

## 6. Definition of done for v0.1.0

- Every task in `PROGRESS.md` §1 is `[x]` or `[~]` with a written reason; no `[-]` left except
  ones explicitly carried to 0.2.
- RELEASE-READINESS gates 1–8, 10–11, 13–17, 21–24 PASS on the release commit; 9, 12, 18–20 PASS or
  accepted in writing.
- Phase E rows E-01…E-13 PASS with raw logs on the devices listed.
- CI green on `main` for the tagged commit; signed `v0.1.0` on the stable channel; both phones
  updated to it in-app.
- README, HANDOFF, PROGRESS, test-matrix and RELEASE-READINESS agree with each other.
