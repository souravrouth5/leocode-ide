# Agent rules — LeoCode

Rules for AI agents working in this repository. Read [`docs/HANDOFF.md`](docs/HANDOFF.md) for
orientation and [`PROGRESS.md`](PROGRESS.md) for the live task state before starting.

## Parallel work

Use specialized subagents for work that can be split and run independently: codebase exploration,
isolated test runs and documentation. Run at most **three** concurrently; beyond that, coordination
costs more than the work it saves.

- Give each subagent a disjoint file scope. Two subagents must never edit the same file, and a
  read-only subagent must not be asked to write.
- State the deliverable, the exact files it may touch and whether it may commit. Only the parent
  session commits.
- Verify the output before committing: read the diff, run the relevant gate (`web`: tests,
  typecheck, lint; `android`: `testDebugUnitTest`, `lintDebug`) and check claims against the code.
  A subagent's "done" is a claim, not evidence.

Do not spawn a subagent for a single small edit.
