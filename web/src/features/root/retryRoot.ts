import type { StoreApi } from "zustand/vanilla"
import type { RootState } from "./rootStore"
import type { ErrorsState } from "../../errors/errorsStore"

export interface RetryRootDeps {
  root: StoreApi<RootState>
  errors: StoreApi<ErrorsState>
}

/**
 * Retries a root request safely (B6).
 *
 * Never rejects: catches errors, reports them to the error store with context "Request root",
 * and provides a recursive retry callback. Returns true on success, false on failure or rejection.
 */
export async function retryRoot(stores: RetryRootDeps): Promise<boolean> {
  try {
    return await stores.root.getState().requestRoot()
  } catch (e) {
    stores.errors.getState().report(e, {
      context: "Request root",
      retry: () => void retryRoot(stores)
    })
    return false
  }
}
