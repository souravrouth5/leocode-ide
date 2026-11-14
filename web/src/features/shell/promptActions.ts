import type { AppStores } from "../../app/stores"
import { dirName, join } from "../editor/model"

/**
 * Applies the prompt sheet's value. New file/folder/rename are file operations;
 * "Save As" writes the active buffer and renames the tab (Task 13).
 */
export async function submitPrompt(stores: AppStores, value: string): Promise<void> {
  const prompt = stores.shell.getState().prompt
  if (!prompt) return

  const { bridge, files, editor, shell, errors } = stores
  const cwd = files.getState().cwd

  try {
    if (prompt.title === "Save As") {
      const target = value.startsWith("/") ? value : join(cwd, value)
      await editor.getState().saveAs(target)
      return
    }

    if (prompt.kind === "rename" && prompt.target) {
      const target = join(dirName(prompt.target.path), value)
      await bridge.rename(prompt.target.path, target)
      editor.getState().renamePath(prompt.target.path, target)
      shell.getState().flash("Renamed")
      await files.getState().refresh()
      return
    }

    if (prompt.kind === "dir") {
      await bridge.mkdir(join(cwd, value))
      shell.getState().flash("Folder created")
      await files.getState().refresh()
      return
    }

    const path = value.startsWith("/") ? value : join(cwd, value)
    await bridge.write(path, "")
    shell.getState().flash("File created")
    await files.getState().refresh()
    await editor.getState().openFile(path)
  } catch (error) {
    errors.getState().report(error, {
      context: prompt.kind === "rename" ? "Rename" : "Create file or folder"
    })
  } finally {
    shell.getState().closePrompt()
  }
}
