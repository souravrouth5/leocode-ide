import { expect, vi } from "vitest"
import type { AppStores } from "../app/stores"
import type { DialogRequest } from "../features/dialogs/dialogStore"

/**
 * Test helpers for the in-app dialogs (PD-02). A store method that confirms
 * now awaits a promise, so a test starts the method, answers the request, then
 * awaits the original promise.
 */

export async function nextDialog(stores: AppStores): Promise<DialogRequest> {
  await vi.waitFor(() => {
    expect(stores.dialogs.getState().request).not.toBeNull()
  })
  return stores.dialogs.getState().request as DialogRequest
}

export async function answerConfirm(stores: AppStores, accept: boolean): Promise<void> {
  const request = await nextDialog(stores)
  expect(request.kind).toBe("confirm")
  if (accept) stores.dialogs.getState().accept()
  else stores.dialogs.getState().cancel()
}

export async function answerPrompt(stores: AppStores, value: string | null): Promise<void> {
  const request = await nextDialog(stores)
  expect(request.kind).toBe("prompt")
  if (value === null) stores.dialogs.getState().cancel()
  else stores.dialogs.getState().answer(value)
}
