/**
 * Content-Security-Policy for the bundled page (Task 8).
 *
 * The shipped page is served from the `appassets.androidplatform.net` asset
 * origin and must not need any remote host. Development relaxes only the two
 * directives Vite's HMR client needs: an inline/react-refresh preamble and the
 * websocket. Everything else stays identical, so a remote reference that works
 * in `npm run dev` still fails in the APK.
 */

export const CSP_PLACEHOLDER = "__LEOCODE_CSP__"

const SHARED = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
]

export const PROD_CSP = [
  ...SHARED,
  "script-src 'self'",
  "connect-src 'self'"
].join("; ")

export const DEV_CSP = [
  ...SHARED,
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' ws://localhost:5173 ws://127.0.0.1:5173"
].join("; ")
