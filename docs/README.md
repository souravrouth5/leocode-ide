# LeoCode docs

| File | Purpose |
|---|---|
| [`LeoCode_Implementation_Plan_v9.md`](LeoCode_Implementation_Plan_v9.md) | **Source of truth**: requirements, architecture, error model, root mode, devices, Tasks 1–33; Python is the primary language (D-017) |
| [`decisions/README.md`](decisions/README.md) | D-001 … D-017 with alternatives and reopen triggers |
| [`bridge-contract.md`](bridge-contract.md) | v1 WebView ↔ Kotlin contract, error codes, timeouts, limits |
| [`ux-spec.md`](ux-spec.md) | Mobile shell, editor, terminal, Git, onboarding, root mode, error surfaces, budgets |
| [`test-matrix.md`](test-matrix.md) | Per-device results: D1 (Android 9, unrooted) and D2 (Android 15, unrooted until the owner roots it) |
| [`phase0-runbook.md`](phase0-runbook.md) | Device preparation (incl. Wi-Fi ADB for two phones on one cable), install, harness, failure playbook |
| [`compatibility.md`](compatibility.md) | Python package support matrix (fill in Tasks 24–26) |
| [`reports/phase-a-analysis.md`](reports/phase-a-analysis.md) | **Phase A review**: verdict, findings A-01…A-19 and P-01…P-10, evidence index, exit checklist, hand-off prompt |
| [`LeoCode_Implementation_Plan_v8.md`](LeoCode_Implementation_Plan_v8.md) | History. Superseded by v9; mapping in v9 §18 |
| [`../PROGRESS.md`](../PROGRESS.md) | Live task tracker (v9 Tasks 1–33) |

## Reading order for a new contributor

1. Plan v9 "Devices", §1–4 (decisions and the `targetSdk 28` constraint — everything follows from it).
2. `decisions/README.md` (why the alternatives were rejected; D-011…D-017 are new in v9).
3. Plan v9 §5–7 (architecture, module layout, error model).
4. `bridge-contract.md` before touching either `web/` or `android/`.
5. `ux-spec.md` "Error surfaces" before writing any user-visible failure.
6. `reports/phase-a-analysis.md` if Phase A is not yet closed.
7. Plan v9 §15 for the task you are picking up, then `PROGRESS.md` for its status.
8. `test-matrix.md` before claiming anything works.
