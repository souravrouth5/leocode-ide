import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useSheetRegistration } from "../features/shell/useSheetRegistration"
import {
  CodeIcon,
  EditIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  MoreVerticalIcon,
  PaletteIcon,
  RedoIcon,
  RefreshIcon,
  SafIcon,
  SaveIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  UndoIcon,
  XIcon
} from "./Icons"

interface FileMenuProps {
  onNew: () => void
  onOpenExplorer: () => void
  onOpenSaf: () => void
  onSave: () => void
  onSaveAs: () => void
  onReload: () => void
  onCloseTab: () => void
  onCloseAllTabs: () => void
  hasActiveDoc: boolean
  isDirty: boolean
}

interface EditMenuProps {
  onUndo: () => void
  onRedo: () => void
  onSelectAll: () => void
  onFormat: () => void
  onInsertDateTime: () => void
  onIndent: () => void
  onUnindent: () => void
  hasActiveDoc: boolean
}

interface OverflowMenuProps {
  onFindReplace: () => void
  onSearchWorkspace: () => void
  onGotoLine: () => void
  onSelectSyntax: () => void
  onOpenSettings: () => void
  wordWrap: boolean
  onToggleWordWrap: () => void
  lineNumbers: boolean
  onToggleLineNumbers: () => void
  onShowStatistics: () => void
}

function Dropdown({
  trigger,
  children,
  align = "right"
}: {
  trigger: ReactNode
  children: (close: () => void) => ReactNode
  align?: "left" | "right"
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  // Back closes an open menu before it closes the view behind it (W-12).
  useSheetRegistration(`menu-${menuId}`, open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const handleClick = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener("mousedown", handleClick)
    window.addEventListener("touchstart", handleClick)
    return () => {
      window.removeEventListener("mousedown", handleClick)
      window.removeEventListener("touchstart", handleClick)
    }
  }, [open])

  return (
    <div className="menu-container" ref={menuRef}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div className={`menu-dropdown align-${align}`} onClick={() => setOpen(false)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function FileMenu({
  onNew,
  onOpenExplorer,
  onOpenSaf,
  onSave,
  onSaveAs,
  onReload,
  onCloseTab,
  onCloseAllTabs,
  hasActiveDoc,
  isDirty
}: FileMenuProps) {
  return (
    <Dropdown
      trigger={
        <button
          className={"icon-btn menu-trigger-btn" + (isDirty ? " dirty" : "")}
          title="File Menu"
          aria-label="File Menu"
        >
          <FolderIcon size={19} />
        </button>
      }
      align="right"
    >
      {() => (
        <div className="menu-items">
          <button className="menu-item" onClick={onNew}>
            <FolderPlusIcon size={16} />
            <span>New File</span>
          </button>
          <button className="menu-item" onClick={onOpenExplorer}>
            <FolderIcon size={16} />
            <span>Open (File Explorer)</span>
          </button>
          <button className="menu-item" onClick={onOpenSaf}>
            <SafIcon size={16} />
            <span>Open (SAF System Picker)</span>
          </button>
          <div className="menu-divider" />
          <button className="menu-item" onClick={onSave} disabled={!hasActiveDoc || !isDirty}>
            <SaveIcon size={16} />
            <span>Save</span>
          </button>
          <button className="menu-item" onClick={onSaveAs} disabled={!hasActiveDoc}>
            <SaveIcon size={16} />
            <span>Save As…</span>
          </button>
          <button className="menu-item" onClick={onReload} disabled={!hasActiveDoc}>
            <RefreshIcon size={16} />
            <span>Reload from Disk</span>
          </button>
          <div className="menu-divider" />
          <button className="menu-item" onClick={onCloseTab} disabled={!hasActiveDoc}>
            <XIcon size={16} />
            <span>Close Tab</span>
          </button>
          <button className="menu-item danger" onClick={onCloseAllTabs} disabled={!hasActiveDoc}>
            <XIcon size={16} />
            <span>Close All Tabs</span>
          </button>
        </div>
      )}
    </Dropdown>
  )
}

export function EditMenu({
  onUndo,
  onRedo,
  onSelectAll,
  onFormat,
  onInsertDateTime,
  onIndent,
  onUnindent,
  hasActiveDoc
}: EditMenuProps) {
  return (
    <Dropdown
      trigger={
        <button
          className="icon-btn menu-trigger-btn"
          title="Edit Menu"
          aria-label="Edit Menu"
          disabled={!hasActiveDoc}
        >
          <EditIcon size={19} />
        </button>
      }
      align="right"
    >
      {() => (
        <div className="menu-items">
          <button className="menu-item" onClick={onUndo} disabled={!hasActiveDoc}>
            <UndoIcon size={16} />
            <span>Undo</span>
          </button>
          <button className="menu-item" onClick={onRedo} disabled={!hasActiveDoc}>
            <RedoIcon size={16} />
            <span>Redo</span>
          </button>
          <div className="menu-divider" />
          <button className="menu-item" onClick={onSelectAll} disabled={!hasActiveDoc}>
            <CodeIcon size={16} />
            <span>Select All</span>
          </button>
          <button className="menu-item" onClick={onFormat} disabled={!hasActiveDoc}>
            <SparklesIcon size={16} />
            <span>Format Code (Prettier)</span>
          </button>
          <button className="menu-item" onClick={onInsertDateTime} disabled={!hasActiveDoc}>
            <FileIcon size={16} />
            <span>Insert Date / Time</span>
          </button>
          <div className="menu-divider" />
          <button className="menu-item" onClick={onIndent} disabled={!hasActiveDoc}>
            <span>→ Increase Indent</span>
          </button>
          <button className="menu-item" onClick={onUnindent} disabled={!hasActiveDoc}>
            <span>← Decrease Indent</span>
          </button>
        </div>
      )}
    </Dropdown>
  )
}

export function OverflowMenu({
  onFindReplace,
  onSearchWorkspace,
  onGotoLine,
  onSelectSyntax,
  onOpenSettings,
  wordWrap,
  onToggleWordWrap,
  lineNumbers,
  onToggleLineNumbers,
  onShowStatistics
}: OverflowMenuProps) {
  return (
    <Dropdown
      trigger={
        <button className="icon-btn menu-trigger-btn" title="More Options" aria-label="More Options">
          <MoreVerticalIcon size={19} />
        </button>
      }
      align="right"
    >
      {() => (
        <div className="menu-items">
          <button className="menu-item" onClick={onFindReplace}>
            <SearchIcon size={16} />
            <span>Find & Replace</span>
          </button>
          <button className="menu-item" onClick={onSearchWorkspace}>
            <SearchIcon size={16} />
            <span>Search in Workspace</span>
          </button>
          <button className="menu-item" onClick={onGotoLine}>
            <span>Goto Line…</span>
          </button>
          <button className="menu-item" onClick={onSelectSyntax}>
            <PaletteIcon size={16} />
            <span>Syntax Language…</span>
          </button>
          <button className="menu-item" onClick={onShowStatistics}>
            <span>Document Statistics</span>
          </button>
          <div className="menu-divider" />
          <label className="menu-item-check" onClick={(e) => e.stopPropagation()}>
            <span>Word Wrap</span>
            <input type="checkbox" checked={wordWrap} onChange={onToggleWordWrap} />
          </label>
          <label className="menu-item-check" onClick={(e) => e.stopPropagation()}>
            <span>Line Numbers</span>
            <input type="checkbox" checked={lineNumbers} onChange={onToggleLineNumbers} />
          </label>
          <div className="menu-divider" />
          <button className="menu-item" onClick={onOpenSettings}>
            <SettingsIcon size={16} />
            <span>Settings</span>
          </button>
        </div>
      )}
    </Dropdown>
  )
}
