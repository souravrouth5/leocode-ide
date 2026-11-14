import { useStore } from "zustand"
import type { StoreApi } from "zustand/vanilla"
import { InlineBanner } from "./InlineBanner"
import { ErrorSheet } from "./ErrorSheet"
import { Snackbar } from "./Snackbar"
import type { ErrorsState } from "./errorsStore"
import type { NotificationsState } from "../notifications/notificationsStore"

interface ErrorSurfacesProps {
  errors: StoreApi<ErrorsState>
  notifications: StoreApi<NotificationsState>
}

/** Renders the active banner, sheet and the head of the snackbar queue. */
export function ErrorSurfaces({ errors, notifications }: ErrorSurfacesProps) {
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
            message={banner.error.message}
            tone={banner.entry.severity === "error" ? "error" : "warning"}
            actionLabel={bannerAction?.label}
            onAction={bannerAction?.run}
            onDismiss={dismissBanner}
          />
        </div>
      )}
      <ErrorSheet active={sheet} onClose={dismissSheet} onNotice={notify} />
      <Snackbar notice={notice} onDismiss={dismissNotice} />
    </>
  )
}
