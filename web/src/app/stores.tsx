import { createContext, useContext, type ReactNode } from "react"
import type { StoreApi } from "zustand/vanilla"
import {
  createNotificationsStore,
  type NotificationsState
} from "../notifications/notificationsStore"
import { createErrorsStore, type ErrorsState } from "../errors/errorsStore"

export interface AppStores {
  notifications: StoreApi<NotificationsState>
  errors: StoreApi<ErrorsState>
}

/** Manual DI (D-015): stores are built once per bridge and passed explicitly. */
export function createAppStores(): AppStores {
  const notifications = createNotificationsStore()
  const errors = createErrorsStore((notice) => {
    notifications.getState().enqueue(notice)
  })
  return { notifications, errors }
}

const StoresContext = createContext<AppStores | null>(null)

export function StoresProvider({
  stores,
  children
}: {
  stores: AppStores
  children: ReactNode
}) {
  return <StoresContext.Provider value={stores}>{children}</StoresContext.Provider>
}

export function useStores(): AppStores {
  const stores = useContext(StoresContext)
  if (!stores) throw new Error("useStores must be used inside StoresProvider")
  return stores
}
