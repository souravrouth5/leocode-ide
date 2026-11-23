# D-018 — Python Code Formatter Strategy

## Status
Decided / Frozen for v0.1 (2026-11-23)

## Context
Python is LeoCode's primary supported language (D-017). For web technologies (JavaScript, TypeScript, HTML, CSS, JSON, Markdown), LeoCode runs Prettier in-process via `@prettier/standalone` inside the WebView.

However, Python formatting cannot easily use Prettier standalone (which lacks official Python AST support without external plugins). Standard Python formatting tools (such as `black` or `ruff`) are written in Python or Rust, and either require a full CPython runtime/tokenizer or native binaries. LeoCode targets resource-constrained Android devices (e.g. Redmi Note 7S / D1, 3–4 GB RAM, 32-bit/64-bit ARM) where memory bloat, APK size, and cold-start latency directly affect app stability and responsiveness.

We evaluated three potential architectural strategies for Python code formatting.

---

## Options Considered

### Option A: Pure-JS or WebAssembly Formatter (e.g., Black-WASM / Pyodide Black / JS port)
- **Description**: Package a WASM-compiled Python runtime running Black or Pyodide in the web environment, or compile a JS port of a Python formatter.
- **Disadvantages**:
  - **Massive binary size**: A minimal Pyodide/Black WASM bundle is 15–30 MB+, which would drastically increase APK download size and storage footprint.
  - **High heap overhead**: The WASM runtime allocates 30–60 MB+ of linear memory upon initialization, creating intense memory pressure on 3–4 GB devices and increasing the risk of the Android Low-Memory Killer (LMK) discarding background tasks or the WebView.
  - **Cold-start lag**: Initializing a WASM CPython interpreter takes 2–5 seconds on older ARM devices, leading to noticeable UI stutter or frozen format buttons.
  - **Non-standard formatting**: Pure-JS heuristic formatters (e.g. js-beautify) produce non-PEP-8 compliant code and fail on modern Python 3.10+ syntax (pattern matching, type unions).
- **Verdict**: Rejected.

### Option B: On-Device CLI Formatter (running `black` or `ruff` in the project `.venv`)
- **Description**: When the user requests formatting (or on save), LeoCode invokes `black` or `ruff` installed inside the project's virtual environment (`.venv/bin/black` or `.venv/bin/ruff`) via the Native Bridge `proc.run` API.
- **Disadvantages**:
  - **Not available out-of-the-box**: Requires the user to have explicitly installed `black` or `ruff` into the virtual environment via `pip`.
  - **Network and build dependency**: Installing `ruff` or `black` on Android requires either compatible pre-built `aarch64` wheels on our wheel index or compiling from source (which is slow or infeasible on-device).
  - **Process startup overhead**: Spawning a child process, reading stdout, and replacing the editor buffer has perceptible latency compared to in-memory formatting.
- **Verdict**: Viable as a future enhancement for advanced workflows, but cannot serve as a reliable default for v0.1.

### Option C: Deferred / No Built-In Formatter for v0.1 (Chosen)
- **Description**: Defer an automated whole-document formatter for Python in v0.1. Instead, invest heavily in editor-level ergonomics:
  - Smart CodeMirror indentation rules (`pythonIndent.ts`):
    - Strict 4-space indent unit and tab size (PEP 8).
    - Automatic +4 space indent after colon-terminated block headers (`def`, `class`, `if`, `for`, `while`, `try`, `except`, `else`, `finally`, `with`, `match`, `case`).
    - Smart dedent (-4 spaces) on newlines following terminal statements (`return`, `pass`, `break`, `continue`, `raise`).
    - Auto-dedenting parent blocks on typing `else:`, `elif`, `except`, `finally`, `case`.
  - Keyboard accessory row with dedicated Python snippets (`def`, `class`, `main`, `for`, `try`) and 4-space Tab key.
  - Bracket, quote, and triple-quote (`"""`, `'''`) auto-closing tuned for Python strings and f-strings.
  - Friendly notification if the user triggers format on a `.py` file, clarifying that formatting is deferred for v0.1 and relying on auto-indentation.
- **Advantages**:
  - **Zero APK size overhead**: No extra WASM blobs or heavy npm packages.
  - **Zero memory footprint**: CodeMirror's indentation service runs instantaneously in micro-seconds without garbage collection churn.
  - **Rock-solid predictability**: Code adheres strictly to standard Python indentation rules as the user types, eliminating the need for periodic reformatting.

---

## Decision
Adopt **Option C** for v0.1:
1. LeoCode does not bundle a WASM Python formatter or heavy JS emulation engine.
2. The Python editing experience relies on CodeMirror's tailored Python indentation engine (`web/src/features/editor/pythonIndent.ts`), 4-space tab handling, tuned bracket/quote completion, and keyboard accessory row snippets.
3. If formatting is explicitly triggered on a Python file, the editor displays an informative notification acknowledging that AST-level Python formatting is deferred for v0.1.
4. Establish a future architectural path toward **Option B**: When virtual environments with pre-installed `ruff` or `black` CLI binaries become ubiquitous in subsequent releases, allow the editor to optionally delegate formatting to the on-device CLI.

## Trigger to Reopen
- A lightweight, fast, pure-JS or sub-megabyte WASM formatter with complete modern Python 3.12+ syntax support becomes available.
- Or native `ruff` `aarch64` binaries are pre-packaged as standard runtime utilities in LeoCode's core prefix without requiring network download or pip wheel compilation.
