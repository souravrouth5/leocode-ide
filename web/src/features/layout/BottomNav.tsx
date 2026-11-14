import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { CodeIcon, CpuIcon, FolderIcon, TerminalIcon } from "../../components/Icons"
import type { View } from "../shell/shellStore"

const TABS: Array<{ id: View; label: string; Icon: typeof FolderIcon }> = [
  { id: "files", label: "Explorer", Icon: FolderIcon },
  { id: "editor", label: "Editor", Icon: CodeIcon },
  { id: "terminal", label: "Terminal", Icon: TerminalIcon },
  { id: "runtimes", label: "Runtimes", Icon: CpuIcon }
]

export function BottomNav() {
  const { shell } = useStores()
  const view = useStore(shell, (state) => state.view)
  const sidebarOpen = useStore(shell, (state) => state.sidebarOpen)

  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map(({ id, label, Icon }) => {
        const active = id === "files" ? sidebarOpen : view === id
        return (
          <button
            key={id}
            className={"tabbar-item" + (active ? " active" : "")}
            onClick={() => {
              if (id === "files") shell.getState().toggleSidebar()
              else shell.getState().go(id)
            }}
            aria-current={view === id ? "page" : undefined}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
