import { useState } from "react"
import type { FileEntry } from "../bridge"
import { FileTree } from "./FileTree"
import {
  ChevronRightIcon,
  ChevronUpIcon,
  FileIcon,
  FilePlusIcon,
  FolderPlusIcon,
  RefreshIcon,
  XIcon
} from "./Icons"

interface OpenDoc {
  path: string
  content: string
  saved: string
}

const baseName = (path: string) => path.split("/").pop() ?? path
const isDirty = (doc: OpenDoc) => doc.content !== doc.saved

interface Props {
  open: boolean
  onClose: () => void
  cwd: string
  entries: FileEntry[]
  loading: boolean
  docs: OpenDoc[]
  activePath: string | null
  onOpenDoc: (path: string) => void
  onCloseDoc: (path: string) => void
  onNavigate: (path: string) => void
  onRefresh: () => void
  onCreate: (kind: "file" | "dir") => void
  onRename: (entry: FileEntry) => void
  onDelete: (entry: FileEntry) => void
}

export function Sidebar({
  open,
  onClose,
  cwd,
  entries,
  loading,
  docs,
  activePath,
  onOpenDoc,
  onCloseDoc,
  onNavigate,
  onRefresh,
  onCreate,
  onRename,
  onDelete
}: Props) {
  const [openEditorsCollapsed, setOpenEditorsCollapsed] = useState(false)

  return (
    <>
      <div
        className={"sidebar-backdrop" + (open ? " is-open" : "")}
        onClick={onClose}
        aria-hidden={!open}
      />

      <aside className={"sidebar" + (open ? " is-open" : "")} aria-label="Explorer sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title-group">
            <span className="sidebar-heading">EXPLORER</span>
            <span className="sidebar-subheading">{cwd === "." ? "workspace" : cwd}</span>
          </div>
          <div className="sidebar-actions">
            <button
              className="icon-btn tiny"
              onClick={() => onCreate("file")}
              title="New file"
              aria-label="New file"
            >
              <FilePlusIcon size={16} />
            </button>
            <button
              className="icon-btn tiny"
              onClick={() => onCreate("dir")}
              title="New folder"
              aria-label="New folder"
            >
              <FolderPlusIcon size={16} />
            </button>
            <button
              className="icon-btn tiny"
              onClick={onRefresh}
              title="Refresh files"
              aria-label="Refresh files"
            >
              <RefreshIcon size={16} />
            </button>
            <button
              className="icon-btn tiny sidebar-close"
              onClick={onClose}
              title="Close sidebar"
              aria-label="Close sidebar"
            >
              <XIcon size={16} />
            </button>
          </div>
        </div>

        <div className="sidebar-scrollable">
          {docs.length > 0 && (
            <div className="sidebar-section">
              <div
                className="sidebar-section-header"
                onClick={() => setOpenEditorsCollapsed((c) => !c)}
              >
                <span className="sidebar-section-chevron">
                  {openEditorsCollapsed ? (
                    <ChevronRightIcon size={12} />
                  ) : (
                    <ChevronUpIcon size={12} />
                  )}
                </span>
                <span className="sidebar-section-title">OPEN EDITORS</span>
                <span className="sidebar-count">{docs.length}</span>
              </div>

              {!openEditorsCollapsed && (
                <div className="sidebar-open-list">
                  {docs.map((doc) => {
                    const active = doc.path === activePath
                    const dirty = isDirty(doc)
                    return (
                      <div
                        key={doc.path}
                        className={"sidebar-doc-row" + (active ? " active" : "")}
                        onClick={() => {
                          onOpenDoc(doc.path)
                          onClose()
                        }}
                      >
                        <FileIcon size={15} className="sidebar-doc-icon" />
                        <span className="sidebar-doc-name">{baseName(doc.path)}</span>
                        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
                        <button
                          className="sidebar-doc-close"
                          aria-label={`Close ${baseName(doc.path)}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onCloseDoc(doc.path)
                          }}
                        >
                          <XIcon size={13} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span className="sidebar-section-title">FILES</span>
            </div>

            <div className="sidebar-filetree-wrap">
              <FileTree
                path={cwd}
                entries={entries}
                loading={loading}
                onOpen={(entry) => {
                  onOpenDoc(entry.path)
                  onClose()
                }}
                onNavigate={onNavigate}
                onRefresh={onRefresh}
                onCreate={onCreate}
                onRename={onRename}
                onDelete={onDelete}
              />
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
