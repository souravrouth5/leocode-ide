// Runs before the stylesheet so the first paint already has the right colours.
// The Android host passes ?theme=<mode>; otherwise we fall back to the persisted
// choice, then to the system preference. Kept as a separate file because the
// shipped CSP only allows same-origin scripts (Task 8).
;(function () {
  var DARK = "#0f1115"
  var LIGHT = "#f7f8fa"
  try {
    var params = new URLSearchParams(location.search)
    var fromUrl = params.get("mode")
    if (fromUrl === "system" || fromUrl === "light" || fromUrl === "dark") {
      localStorage.setItem("leocode.theme", fromUrl)
    }
    var stored = localStorage.getItem("leocode.theme") || "system"
    var forced = params.get("theme")
    var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    var dark =
      forced === "dark" || forced === "light"
        ? forced === "dark"
        : stored === "dark" || (stored === "system" && systemDark)
    var theme = dark ? "dark" : "light"
    var root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme
    root.style.backgroundColor = dark ? DARK : LIGHT
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute("content", dark ? DARK : LIGHT)
  } catch {
    document.documentElement.dataset.theme = "dark"
  }
})()
