/**
 * Terminal session bookkeeping and title hardening (Task 13).
 *
 * The session id survives WebView recreation in localStorage. Titles arrive
 * from the PTY via OSC 0/2; they are untrusted text, so they are stripped of
 * control/escape sequences and capped before the UI renders them. OSC 52
 * (clipboard writes from the terminal) is swallowed in TerminalPane.
 */

export const TERMINAL_SESSION_KEY = "leocode.terminal.session"
export const MAX_TERMINAL_TITLE = 80

// OSC (`ESC ] … BEL` or `ESC \`) and CSI (`ESC [ … final`) are exactly what must
// be removed; the remaining control characters go too.
/* eslint-disable no-control-regex */
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g
/* eslint-enable no-control-regex */

export function sanitizeTerminalTitle(raw: string): string {
  return raw
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(CONTROL, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERMINAL_TITLE)
}

export function readSessionId(): string | null {
  try {
    return localStorage.getItem(TERMINAL_SESSION_KEY)
  } catch {
    return null
  }
}

export function writeSessionId(sessionId: string): void {
  try {
    localStorage.setItem(TERMINAL_SESSION_KEY, sessionId)
  } catch {
    // Storage can be blocked; reattach just falls back to a new session.
  }
}

export function clearSessionId(): void {
  try {
    localStorage.removeItem(TERMINAL_SESSION_KEY)
  } catch {
    // Nothing to do.
  }
}
