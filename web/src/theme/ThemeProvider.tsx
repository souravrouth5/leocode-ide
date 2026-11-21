import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react"
import type { Bridge, ThemeState } from "../bridge"
import { AppError, isThemeMode } from "../bridge/types"
import type { EffectiveTheme, ThemeMode } from "../bridge/types"
import { createBackgroundErrorReporter } from "../errors/background"
import { errorMessage } from "../errors/redact"

export const THEME_READ_FAILED = "The app's color theme could not be read"
export const THEME_WRITE_FAILED = "The color theme was not saved to the app"

const STORAGE_KEY = "leocode.theme"

interface ThemeContextValue {
  mode: ThemeMode
  effective: EffectiveTheme
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function storedMode(): ThemeMode {
  const value = localStorage.getItem(STORAGE_KEY)
  return isThemeMode(value) ? value : "system"
}

function resolve(mode: ThemeMode, systemDark: boolean): EffectiveTheme {
  if (mode === "system") return systemDark ? "dark" : "light"
  return mode
}

function applyTheme(effective: EffectiveTheme) {
  const root = document.documentElement
  if (root.dataset.theme !== effective) root.dataset.theme = effective
  root.style.colorScheme = effective
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = effective === "dark" ? "#0f1115" : "#f7f8fa"
}

interface Props {
  bridge: Bridge | null
  initial?: ThemeState | null
  /**
   * Fire-and-forget theme failures, reported once per burst (W-23). A theme that
   * never reached the host is a visible problem, not a silent one.
   */
  onError?: (error: unknown, context: string) => void
  children: ReactNode
}

export function ThemeProvider({ bridge, initial, onError, children }: Props) {
  const [mode, setModeState] = useState<ThemeMode>(() => initial?.mode ?? storedMode())
  const [systemDark, setSystemDark] = useState(() =>
    initial ? initial.effective === "dark" : systemPrefersDark()
  )

  // Reporter identity is stable; the callback behind it is always the latest.
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])
  const background = useMemo(
    () =>
      createBackgroundErrorReporter((error, context) => {
        // Keep the typed code for routing and say what the user lost, like the
        // bridge does for terminal input (W-23).
        const code = error instanceof AppError ? error.code : "E_INTERNAL"
        onErrorRef.current?.(
          new AppError(code, `${context} (${errorMessage(error)})`),
          context
        )
      }),
    []
  )

  const effective = resolve(mode, systemDark)

  useEffect(() => {
    applyTheme(effective)
  }, [effective])

  // Browser / WebView media query. On Android this may not reflect the system
  // setting, so the bridge push below is authoritative there.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystemDark(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  useEffect(() => {
    if (!bridge) return
    // The page may have loaded before the host attached; ask once for the
    // authoritative answer instead of relying on the pushed event.
    let active = true
    void bridge
      .getTheme()
      .then((state) => {
        if (!active) return
        if (isThemeMode(state.mode)) setModeState(state.mode)
        setSystemDark(state.effective === "dark")
      })
      .catch((error: unknown) => {
        // The page keeps the stored/OS theme, but the user is told once (W-23).
        background(error, THEME_READ_FAILED)
      })
    const unsubscribe = bridge.onThemeChanged((state) => {
      if (isThemeMode(state.mode)) setModeState(state.mode)
      setSystemDark(state.effective === "dark")
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge, background])

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next)
      localStorage.setItem(STORAGE_KEY, next)
      if (next === "system") setSystemDark(systemPrefersDark())
      // Android persists the choice and updates the system bars.
      void bridge?.setTheme(next).catch((error: unknown) => {
        background(error, THEME_WRITE_FAILED)
      })
    },
    [bridge, background]
  )

  const value = useMemo(
    () => ({ mode, effective, setMode }),
    [mode, effective, setMode]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error("useTheme must be used inside ThemeProvider")
  return value
}
