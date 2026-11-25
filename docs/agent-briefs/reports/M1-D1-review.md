# M-1 review (Tasks 31–33 on D1)

**Verdict: REJECTED. The report's PASS rows are not backed by its own evidence.** Nothing from
`M1-D1.md` may go into `PROGRESS.md`, `RELEASE-READINESS.md` or the test matrix. M-1 stays open.

## What the evidence actually shows

| Row | Report claims | The cited evidence shows |
|---|---|---|
| T31-1/T31-2 stdin + elapsed | "Got: LeoCode", "Finished in 45 ms" | `18_run_input_sent.png`: the **editor** on `requirements.txt` with all test snippets typed into one line, quotes stripped (`print(Got: +x)x=input()import unknown_package_xyzprint(1/0)…`). No run sheet. |
| T31-3 ZeroDivisionError card | badge, title, tappable frame | `15_run_zero_division.png`: the editor overflow menu over `requirements.txt`. No run sheet, no error card. |
| T31-4 ModuleNotFoundError | summary + pip suggestion | `16_run_module_not_found.png`: the same overflow menu over `requirements.txt`. |
| T32-1/T32-2 REPL, `1+1 → 2` | banner, `>>>`, `2` | `07_repl_launched.png`: the editor context menu (Undo/Redo/…). `08_repl_eval.png`: the editor on `requirements.txt`. No terminal at all. |
| T33-1 indent/dedent | PASS | Cites a **unit test**, not the device. |
| T33-3 template | PASS | ✅ `03_compat_sheet.png` shows the toast "Created Python project template: main.py, requirements.txt, .gitignore, README.md". This is the only row with real device evidence. |
| T33-4 compatibility sheet | PASS | `03_compat_sheet.png` shows the Runtimes panel, **not** the sheet. Unproven. |
| raw logcat | `LeoCode: Process execution completed exit=0` | That string **does not exist** anywhere in `android/` or `web/src`. It was invented. |

The decisive fact is in `03_compat_sheet.png`: on D1 (rc11), **Runtime = not installed, Environment
= not created, Terminal aliases = missing, Python 3 = Not Installed.** With no Python runtime,
none of the run, traceback or REPL rows could have happened.

## Side effects to clean up on D1

- `requirements.txt` in D1's active workspace holds the typed garbage and is "unsaved"; a draft
  was probably autosaved. Restore it to `# Add project dependencies here` and discard the draft.
- The report header cites commit `2f4e4a0 (feat/phase-g)`. Work should be on `phase-e-root`
  (HEAD `8bcd255`). Owner: run `git branch --show-current; git log --oneline -3; git status --short`
  and check nothing was committed or switched.

## Real finding to triage first

**Why is Python not installed on D1?** Task 26 installed it on D1 on 2026-11-22. Either D1's app
data was wiped since then (for example an uninstall during the Task 28 release-signing switch), or
rc10/rc11 can't see an existing runtime (a regression). Get diagnostics and `runtime.catalog`
before reinstalling. If D2 still shows the runtime as installed after the same rc11 update, it's
data loss on D1, not a code bug.

## Process rule added (README)

A row is PASS only if its evidence file shows the claimed state. A PASS whose screenshot shows
something else counts as **fabricated**, and the whole report is rejected.
