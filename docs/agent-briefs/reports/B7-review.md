# B7 review

**Verdict: nearly done.** The Phase E wording is correct and evidenced: Tasks 17/18 `[x]` with
links, the 2026-11-24 changelog row says E-18 failed and B6 fixed it, and E-15 is "not reachable"
with the real test name. The grep gate is clean apart from T2c (expected) and history rows, and
the links resolve. Five accuracy fixes are left, mostly in `RELEASE-READINESS.md`, which now claims
more than the evidence shows. Docs only.

## Fixes

### D1 (High): `RELEASE-READINESS.md` summary overclaims

The summary says "all roadmap phases (A–H) are complete and verified across both devices" and
"runtime/Python … runs on both phones (Tasks 24–26 and 30–33)". The evidence disagrees:
- Task 24 is still `[-]` in `PROGRESS.md` (signed `python-runtime` release not published, owner action).
- Tasks 31 and 33 are device-verified on **D2 only**. Task 32's D1 run used build 1006, which
  predates the rc builds. That is plan item M-1.
- Gate 9 (instrumented tests) is ABSENT, and gate 12 (Android 10–14) has no hardware.

Rewrite the summary as: what is done and evidenced; then a list **"Before v0.1.0"** with D1 parity
for Tasks 31–33 (M-1), the Task 24 signed release (M-3), the offline key backup (M-2), PAT rotation
(M-4), PR to `main` + green CI on the release commit (M-5), and the accepted gaps 9/12. The
`task29-hardening-report.md` "GO" verdict (2026-11-23) predates the Phase E rebuild and these open
items. Say that, and don't edit the Task 29 report itself.

### D2 (Medium): gate 19 is PASS, but D1 missed its cold-start budget

The Task 29 scorecard sets the cold-start budget at `< 2.5 s (D1)`, and D1 measured **3.0–3.17 s**.
The report itself calls it "ACCEPTABLE (D1 minor variance)". Mark gate 19 **PARTIAL**: all budgets
met except D1 cold start (3.0–3.17 s vs 2.5 s). Keep the measured numbers.

### D3 (Medium): gates 10, 11 and 13 are stale

- Gate 13 still says "Tasks 30–33 open". It should say: Tasks 24–26 on D1+D2; 30–33 done, with
  31–33 device-verified on D2 only (D1 pending, M-1); Task 24 signed release pending.
- Gates 10/11: add Phase E (D2: E-00…E-19; D1: E-02, E-10), Task 29 soak, and on D2 Tasks 31–33.
  Keep them PARTIAL until M-1 is done.
- Gate 20: add the measured size of the soak (the 25 executions per device in
  `20261123-*-soak-*.txt`, read from the log).

### D4 (Low): wrong mechanism in `PROGRESS.md`

- Task 18 says process execution "terminates via `RootManager.killSession`". Root **jobs**
  (`ProcessSupervisor`) use the **group** kill (`RootManager.kill`, proven by E-16/E-17); only root
  **terminals** and the root orphan reaper use `killSession`. Fix the sentence.
- The 2026-11-24 changelog says session kill is "`kill -$sig -$sid`". It's a `/proc/*/stat` scan
  that signals every pid whose session id matches. Fix the wording the same way in
  `HANDOFF.md` / `ux-spec.md` if it's repeated there.

### D5 (process): show the commit

`B7.md` doesn't show the commit. The initial status listed the untracked briefs, reports, device
reports and screenshots. Those must be in the repo with the doc changes. Add to the report:
`git log --oneline -3`, `git show --stat --oneline HEAD | head -60`, and `git status --short`
(expected: empty).

## Gate

Same grep as B7, plus:
`grep -n "verified across both devices\|Tasks 30–33 open\|killSession" docs/RELEASE-READINESS.md PROGRESS.md`
must show no stale claims. Commit `docs: B7 accuracy fixes (readiness summary, gates 10/11/13/19/20, kill mechanism)`.
Append the results to `reports/B7.md` under "## Review fixes".
