import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { StatusBar } from "../../components/StatusBar"
import { isDirty } from "../editor/model"

export function AppStatusBar() {
  const { bridge, editor, files, shell, errors } = useStores()
  const view = useStore(shell, (state) => state.view)
  const status = useStore(shell, (state) => state.status)
  const cwd = useStore(files, (state) => state.cwd)
  const docs = useStore(editor, (state) => state.docs)
  const activePath = useStore(editor, (state) => state.activePath)
  const statusError = useStore(
    errors,
    (state) => state.banner?.error.message ?? state.sheet?.error.message ?? null
  )

  const activeDoc = docs.find((doc) => doc.path === activePath) ?? null
  const path = view === "editor" ? (activePath ?? ".") : cwd

  return (
    <StatusBar
      mode={bridge.mode}
      path={statusError ? "error" : path}
      dirty={activeDoc ? isDirty(activeDoc) : false}
      message={statusError ?? status}
    />
  )
}
