# B7: close Phase E in the docs

Read [`README.md`](README.md), [`../REMAINING-WORK-PLAN.md`](../REMAINING-WORK-PLAN.md) §3 and all
`reports/*review*.md`. **Docs only. No source changes.** Run this only after `reports/B6-followup.md`
exists and the reviewer accepted it.

Rule for every edit: **write only what the device logs and reports show.** Every claim carries a
date and links its evidence file. Where something is unit-only or not reachable, say so.

Accepted facts to use (from `reports/B6-review.md`, follow-up box):
- Test totals: Android **520 tests / 0 failures / 1 skipped**; web **498 / 498 in 62 files**.
- Builds: rc10 (1010) for the full pass, rc11 (1011) for B6; both release-signed and run with R8.
- E-15: **not reachable on device** (Magisk 31.1 auto-denies unlisted apps in ~15 ms with Automatic
  response at its default). Unit coverage: `RootManagerTest › ProcessShellRunner timeout destroys
  process forcibly and returns timeout result`. Never cite `checkRootAccess…`; that test doesn't exist.
- E-18 failed in the first pass (a foreground job leaked as root) and was fixed by B6 (session
  kill). Say this plainly in the changelog row.

## Files and changes

1. **`PROGRESS.md`**
   - Header "Current phase": Phase E is done (2026-11-24, rc10/rc11 on D2, D1 unrooted rows).
     Remove "Only Phase E (root mode) remains blocked on phone root" and "Both phones are unrooted".
   - Snapshot: Devices row is already right; "Root mode" row → list what was rebuilt in B1–B6
     (timeouts, no-prompt status, `root.disable`, `root.lost`, real root pid + session kill, lazy
     root reaper, phantom option) with links to `docs/device-reports/20261124-phaseE-*.txt`,
     `reports/B6.md`, `reports/B6-followup.md`.
   - Phase E task list: Tasks 17 and 18 `[x]` with a short evidence sentence each. Replace the
     2026-11-23 "device-verified" text: that pass had screenshots only.
   - Blocking facts + Known-debt table: "D2 has no `su`" → resolved 2026-11-23 (Magisk 31.1).
   - Test counts everywhere: replace "465+ / 463" with the **raw** totals from `B6-followup.md`.
     Note that `RootHandlerTest` was red on the 2026-11-23 tree (Log not mocked) and fixed in B2.
   - Changelog: one row for 2026-11-24 (B1–B6, the device pass, the leak found by E-18 and fixed in B6).
2. **`README.md`** status block: phases A–H done; root mode verified on D2 (Magisk); D1 unrooted; not
   production-grade yet (link `RELEASE-READINESS.md`).
3. **`docs/RELEASE-READINESS.md`**: gate 22 → PASS (date, evidence); gates 2/4 → the raw counts;
   gates 17–20 → match `docs/reports/task29-hardening-report.md` and say plainly what is still a
   single run; summary paragraph and §4 ("Root mode is blocked") updated; §2.1 no longer says the
   runtime "has never run".
4. **`docs/test-matrix.md`**: root-mode table filled in with the result per row (E-00…E-19) for D2
   and D1, each with its evidence file; E-15 as recorded in the follow-up; D2 header "unrooted" → "rooted (Magisk 31.1)".
5. **`docs/LeoCode_Implementation_Plan_v9.md`**: under item 10 and the D2 row, add a dated note that
   D2 was rooted with Magisk 31.1 on 2026-11-23. Don't rewrite history.
6. **`docs/HANDOFF.md`**: "Where the work is" → branch `phase-e-root`, the last commit, rc11; the
   Phase E section links the new evidence; the "Known difference" list gains: Magisk 31.1
   auto-deny behaviour, and that a running root shell keeps uid 0 after a revoke.
7. **`docs/ux-spec.md`**: one line saying the run-sheet Try again re-runs the file (it doesn't request root first).
8. **`docs/REMAINING-WORK-PLAN.md`**: §1 R-01…R-10 → "fixed in Bn" (R-09 B5, R-10 B4); §2 rows →
   results; §3 checkboxes ticked; §5 steps 1–4 done.

## Gate

```bash
grep -rn "465+\|BLOCKED\|unrooted (no .su.)\|Both phones are unrooted\|blocked on phone root" README.md PROGRESS.md docs/*.md
```

This must return only historical changelog rows (quote them in the report). Also check that every
relative link you added resolves (`test -f`). Commit `docs: close Phase E (Tasks 17–18) with device
evidence`. Report to `reports/B7.md`: the files changed, the grep output, and the link check.
