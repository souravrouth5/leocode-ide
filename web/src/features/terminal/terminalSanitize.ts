/**
 * Terminal Sanitization and Escape Sequence Hardening (Task 29).
 *
 * Untrusted PTY stdout or terminal title updates must never execute escape
 * sequence injections, alter header layout via control chars, or access the
 * host clipboard via OSC 52.
 */

export const MAX_TERMINAL_TITLE = 80

// OSC (`ESC ] … BEL` or `ESC \`), CSI (`ESC [ … final`), DCS (`ESC P … ESC \`),
// APC (`ESC _ … ESC \`), PM (`ESC ^ … ESC \`), and generic 2-char escape sequences.
/* eslint-disable no-control-regex */
const OSC_REGEX = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const CSI_REGEX = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const DCS_OR_APC_REGEX = /\u001b[P_^\\][^\u001b]*(?:\u001b\\|\u0007)/g
const GENERIC_ESC_REGEX = /\u001b[@-Z\\-_]/g
const CONTROL_REGEX = /[\u0000-\u001f\u007f-\u009f]/g
const OSC_52_REGEX = /\u001b\]52;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g
/* eslint-enable no-control-regex */

/**
 * Sanitizes terminal title for rendering in tabs, headers, or window title.
 * Strips ANSI escape sequences, control characters (0x00-0x1F, 0x7F-0x9F),
 * collapses whitespace, and clamps to MAX_TERMINAL_TITLE (80 chars).
 */
export function sanitizeTerminalTitle(raw: string): string {
  if (!raw) return ""
  return raw
    .replace(OSC_REGEX, "")
    .replace(CSI_REGEX, "")
    .replace(DCS_OR_APC_REGEX, "")
    .replace(GENERIC_ESC_REGEX, "")
    .replace(CONTROL_REGEX, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERMINAL_TITLE)
}

/**
 * Detects whether a string contains an OSC 52 clipboard escape sequence.
 */
export function hasOsc52(text: string): boolean {
  OSC_52_REGEX.lastIndex = 0
  return OSC_52_REGEX.test(text)
}

/**
 * Strips OSC 52 clipboard manipulation sequences from terminal text.
 */
export function stripOsc52(text: string): string {
  return text.replace(OSC_52_REGEX, "")
}

/**
 * Handler for xterm.js `registerOscHandler(52, handler)`.
 * Always returns true to swallow/consume OSC 52 sequences so untrusted
 * terminal stdout cannot read or write the device/host clipboard.
 */
export function handleOsc52(_data: string): boolean {
  // Returning true signals to xterm.js that the sequence was handled and consumed,
  // preventing any default clipboard operation.
  return true
}
