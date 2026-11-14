import { useEffect, useRef } from "react"
import { useStores } from "../../app/stores"

/**
 * Register a component-local sheet in the back-button stack while it is open
 * (W-12). `close` is called by the stack; the latest closure is used so the
 * registration does not need to be re-created on every render.
 */
export function useSheetRegistration(
  id: string,
  open: boolean,
  close: () => void,
  priority = 0
): void {
  const { shell } = useStores()
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!open) return
    return shell.getState().registerSheet({
      id,
      close: () => closeRef.current(),
      priority
    })
  }, [id, open, priority, shell])
}
