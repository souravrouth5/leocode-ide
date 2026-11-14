import { AppError } from "../../bridge"
import type { AppStores } from "../../app/stores"
import { dirName, entryExists, isUnder, join, rewritePrefix } from "../editor/model"
import { validateEntryName, validatePathInput } from "./validation"

/**
 * Applies the prompt sheet's value. New file/folder/rename are file operations;
 * "Save As" writes the active buffer and renames the tab (Task 13).
 *
 * Returns an inline error string when the value must be corrected; the prompt
 * stays open with it instead of closing and showing a snackbar (W-28). `null`
 * means the operation finished (or was reported) and the prompt can close.
 */
export async function submitPrompt(stores: AppStores, value: string): Promise<string | null> {
  const prompt = stores.shell.getState().prompt
  if (!prompt) return null

  const { bridge, files, editor, shell, errors } = stores
  const cwd = files.getState().cwd
  const input = value.trim()

  // Validate before anything reaches the bridge so the user keeps their text.
  if (prompt.title === "Save As") {
    const problem = validatePathInput(input)
    if (problem) return problem
    try {
      const target = input.startsWith("/") ? input : join(cwd, input)
      await editor.getState().saveAs(target)
      return null
    } catch (error) {
      errors.getState().report(error, { context: "Save As" })
      return null
    }
  }

  const problem = validateEntryName(input)
  if (problem) return problem

  try {
    if (prompt.kind === "rename" && prompt.target) {
      const from = prompt.target.path
      const target = join(dirName(from), input)
      if (target === from) return null
      const previousCwd = files.getState().cwd
      await bridge.rename(from, target)
      editor.getState().renamePath(from, target)
      // A folder rename also moves the folder the explorer is showing (W-17).
      if (isUnder(previousCwd, from)) {
        files.getState().navigate(rewritePrefix(previousCwd, from, target))
      } else {
        await files.getState().refresh()
      }
      shell.getState().flash("Renamed")
      return null
    }

    if (prompt.kind === "dir") {
      await bridge.mkdir(join(cwd, input))
      shell.getState().flash("Folder created")
      await files.getState().refresh()
      return null
    }

    const path = input.startsWith("/") ? input : join(cwd, input)
    // fs.write always replaces; creating a "new" file must not truncate one (W-03).
    if (await entryExists(bridge, path)) {
      // A name clash is something the user fixes in the prompt, not a snackbar,
      // so it is returned for the inline error and the prompt stays open (W-28).
      const message = `${input} already exists`
      errors.getState().report(new AppError("E_EXISTS", message), {
        context: "Create file or folder"
      })
      return message
    }
    await bridge.write(path, "")
    shell.getState().flash("File created")
    await files.getState().refresh()
    await editor.getState().openFile(path)
    return null
  } catch (error) {
    // A host-side name clash keeps the prompt open; everything else is reported
    // through the error surfaces and the prompt closes.
    if (error instanceof AppError && error.code === "E_EXISTS") {
      errors.getState().report(error, {
        context: prompt.kind === "rename" ? "Rename" : "Create file or folder"
      })
      return error.message
    }
    errors.getState().report(error, {
      context: prompt.kind === "rename" ? "Rename" : "Create file or folder"
    })
    return null
  }
}
