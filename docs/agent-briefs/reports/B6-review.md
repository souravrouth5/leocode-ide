# B6 review

> **Follow-up (`B6-followup.md`): accepted. Phase E is done in code and on the device.**
> - E-19: `sleep 700` (bg, PGID 2848) and `sleep 701` (fg, PGID 2873) both shown before and
>   after force-stop, both gone after the next Root Shell; the old pidfile was replaced.
> - E-05b: shell A prints `uid=0` **after** the deny; the run-sheet banner "Root access was refused.
>   The process ended." was captured.
> - Counts: raw XML totals 520 tests / 0 failures / 1 skipped; per class 25 / 5 / 12 (matches the
>   sources); web 498/498. `B6.md` has been corrected.
> - E-15: Magisk's `settings` table has no `su_auto_response` key, so Automatic response is at its
>   default (Prompt). The ~15 ms auto-deny of an unlisted app is therefore Magisk 31.1 behaviour on
>   this ROM, not a setting. Record E-15 as **not reachable on device**. The timeout is covered by
>   `RootManagerTest › ProcessShellRunner timeout destroys process forcibly and returns timeout
>   result` (the real test name; the one cited in `B6.md` doesn't exist).

---

**Verdict: the B6 code is accepted, and the root leak is fixed on the device.** Three evidence
gaps are left, and the report has some numbers that aren't true. One short follow-up run closes
both. Then Phase E can be marked done (B7).

## Checked in the code

- `RootManager.buildSessionKillCommand(sid, signal)`: `require(sid > 1)`, `require(signal in 1..64)`,
  ints only, so there is nothing to inject. `killSession` returns false without a shell call when
  the guards fail or `!canUseRoot()`, and makes one `su` call otherwise. ✅
- Root PTY `destroy()`: session TERM → 200 ms polls up to 2 s → **unconditional** session KILL,
  wired in `AppGraph` through `onKillRootSession`. `Pty.kt` doesn't import `RootManager`. ✅
- `RootOrphanReaper` uses `killSession` TERM/KILL. ✅
- `retryRoot()` never rejects and reports `context: "Request root"`. It's used by the `AppDialogs`
  error-sheet retry and by the `TerminalPane` banner Try again. ✅

## Proven on D2 (raw `ps`/uiautomator output in the report)

- **E-08b**: a foreground `sleep 600` (PGID 10960, ≠ shell) is gone after Exit Root Shell, and the pidfile is removed.
- **E-18**: foreground `sleep 900` survives the policy deny → allow, then is killed on Exit Root Shell.
- **E-05 (terminal half)**: a refused root shell B shows "Root access was refused. The root session
  ended." with Try again / Open normal shell. That is the first device proof of `root.lost`.
- **E-04b**: a failed Try again shows "During: Request root", not an unhandled rejection.
- **Step 0**: the root `sh` is a session leader (`Ss`, SID = PID = pidfile pid).

## Gaps and inaccuracies

1. **E-19 only shows one process.** The steps say `sleep 700 &` plus a foreground `sleep 701`, but
   the `ps` output has a single `sleep` (18437) before and after. The background + foreground case
   in one session (the reason for the session kill) isn't shown.
2. **E-05 is only half done.** Shell A's `id` ran **before** the deny, so "shell A still uid 0
   after the revoke" isn't shown. The Run-as-root half (run-sheet banner) wasn't run.
3. **E-15 / P4 weren't done.** The Magisk "Automatic response" setting wasn't checked. The report
   cites a unit test `RootManagerTest > checkRootAccess times out when su hangs`, which **doesn't
   exist** (no match in the test sources).
4. **Wrong numbers in the report.** It claims `RootManagerTest` 12, `RootOrphanReaperTest` 4,
   `TerminalRegistryTest` 8 tests. The files have **25, 5 and 12** `@Test` methods. The device line
   says "Android 14 / lineage-21.0"; D2 is Android 15 / LineageOS 22 (API 35), as in every other
   log. Totals (Android 520, web 498) are unverified because no raw Gradle/vitest summary was pasted.
5. **Low, design:** the run-sheet banner's Try again re-runs the file without asking for root
   again (`onRetryRoot = runFile`). After a loss the host returns `E_ROOT_DENIED` right away, and
   that sheet's retry uses `retryRoot`, so the user gets there in two taps. That's acceptable for
   0.1; note it in `ux-spec.md`.

## Follow-up run (D2, rc11 as installed; no code changes)

| Row | Steps | Paste |
|---|---|---|
| E-19 | Root Shell: `sleep 700 &`, then `sleep 701` (foreground). `ps` → force-stop → `ps` → relaunch → Root Shell → wait 3 s → `ps` | All three `ps` listings with **both** sleeps visible before, and none after; `ls` of `run/root/` before and after (old pidfile name gone) |
| E-05b | Policy allow, root shell A (`id`). Policy deny. In shell A run `id` **again**. Run as root a script `id` | Shell A's second `id` output (uid=0); a screenshot or uiautomator line of the run-sheet banner "Root access was refused. The process ended." |
| E-15 | Ask the owner to open Magisk › Settings › Superuser and read **Automatic response** | Its value. If Deny: set Prompt, re-run E-15 (leave the prompt untouched 40 s) and E-03 with a real Grant tap; record the times. If Prompt: record "Magisk 31.1 auto-denies unlisted apps; not reachable" |
| Counts | `cd android && python3 - <<'E'` sum `tests/failures/errors/skipped` over `app/build/test-results/testDebugUnitTest/*.xml` `E`; vitest summary line | The raw totals, plus per-class counts for the three root test classes |

Write the results to `reports/B6-followup.md`, correct the device line and the numbers in `B6.md`,
and don't commit source changes.
