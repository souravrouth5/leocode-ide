import { useStore } from "zustand"
import type { StoreApi } from "zustand/vanilla"
import { InlineBanner } from "./InlineBanner"
import { ErrorSheet } from "./ErrorSheet"
import { Snackbar } from "./Snackbar"
import { redact } from "./redact"
import type { ErrorsState } from "./errorsStore"
import type { NotificationsState } from "../notifications/notificationsStore"

interface ErrorSurfacesProps {
  errors: StoreApi<ErrorsState>
  notifications: StoreApi<NotificationsState>
  /** `app.info` version, included in the sheet's Copy details (W-09). */
  version?: string
  /** Storage permission flow for E_PERMISSION / E_PATH_OUTSIDE_ROOT (W-27). */
  onRequestStoragePermission?: () => void
}

/** Renders the active banner, sheet and the head of the snackbar queue. */
export function ErrorSurfaces({
  errors,
  notifications,
  version,
  onRequestStoragePermission
}: ErrorSurfacesProps) {
  const banner = useStore(errors, (state) => state.banner)
  const sheet = useStore(errors, (state) => state.sheet)
  const queue = useStore(notifications, (state) => state.queue)
  const notice = queue[0] ?? null

  const dismissBanner = errors.getState().dismissBanner
  const dismissSheet = errors.getState().dismissSheet
  const dismissNotice = notifications.getState().dismiss
  const notify = (message: string) =>
    notifications.getState().enqueue({ kind: "success", message, durationMs: 3_000 })

  const bannerAction =
    banner?.retry && banner.entry.action.kind === "retry"
      ? { label: banner.entry.action.label, run: banner.retry }
      : banner?.entry.action.kind === "reload"
        ? { label: banner.entry.action.label, run: () => location.reload() }
        : null

  return (
    <>
      {banner && (
        <div className="banner-slot">
          <InlineBanner
            title={banner.entry.title}
            message={redact(banner.error.message)}
            tone={banner.entry.severity === "error" ? "error" : "warning"}
            actionLabel={bannerAction?.label}
            onAction={bannerAction?.run}
            onDismiss={dismissBanner}
          />
        </div>
      )}
      <ErrorSheet
        active={sheet}
        onClose={dismissSheet}
        onNotice={notify}
        version={version}
        onRequestStoragePermission={onRequestStoragePermission}
      />
      <Snackbar notice={notice} onDismiss={dismissNotice} />
    </>
  )
}
