# LeoCode docs

| File | Purpose |
|---|---|
| [`LeoCode_Implementation_Plan_v8.md`](LeoCode_Implementation_Plan_v8.md) | Source of truth for scope, architecture, phases, gates |
| [`decisions/README.md`](decisions/README.md) | D-001 … D-010 with alternatives and reopen triggers |
| [`bridge-contract.md`](bridge-contract.md) | v1 WebView ↔ Kotlin contract, error codes, limits |
| [`ux-spec.md`](ux-spec.md) | Mobile shell, editor, terminal, Git, onboarding, budgets |
| [`test-matrix.md`](test-matrix.md) | Per-device Phase 0 results (fill on hardware) |
| [`phase0-runbook.md`](phase0-runbook.md) | Step-by-step device preparation, install, test taps, failure playbook |
| [`compatibility.md`](compatibility.md) | Python package support matrix (fill in Phase 0C) |
| [`../PROGRESS.md`](../PROGRESS.md) | Live task tracker |

## Reading order for a new contributor

1. Plan §1–4 (decisions and the `targetSdk 28` constraint — everything follows from it).
2. `decisions/README.md` (why the alternatives were rejected).
3. `bridge-contract.md` before touching either `web/` or `android/`.
4. `test-matrix.md` before claiming anything works.
