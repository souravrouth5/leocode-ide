import { useState } from "react"
import type { FileEntry, StorageInfo } from "../bridge"
import { FileTree } from "./FileTree"
import {
  ChevronRightIcon,
  ChevronUpIcon,
  CpuIcon,
  DownloadIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  HistoryIcon,
  LeoCodeLogo,
  RefreshIcon,
  SafIcon,
  SettingsIcon,
  SmartphoneIcon,
  StarIcon,
  TerminalIcon,
  XIcon
} from "./Icons"

export interface OpenDoc {
  path: string
  content: string
  saved: string | null
  isUntitled?: boolean
}

const baseName = (path: string) => path.split("/").pop() ?? path
const isDirty = (doc: OpenDoc) =>
  doc.saved === null ? true : doc.content.replace(/\r\n/g, "\n") !== doc.saved.replace(/\r\n/g, "\n")

interface Props {
  open: boolean
  onClose: () => void
  cwd: string
  entries: FileEntry[]
  loading: boolean
  docs: OpenDoc[]
  activePath: string | null
  storageInfo: StorageInfo | null
  bookmarks: string[]
  recentFiles: string[]
  onOpenDoc: (path: string) => void
  onCloseDoc: (path: string) => void
  onNavigate: (path: string) => void
  onRefresh: () => void
  onCreate: (kind: "file" | "dir") => void
  onRename: (entry: FileEntry) => void
  onDelete: (entry: FileEntry) => void
  onOpenSaf: () => void
  onAddBookmark: (path: string) => void
  onRemoveBookmark: (path: string) => void
  onOpenSettings: () => void
  onOpenTerminal: () => void
  onOpenRuntimes: () => void
  /** Ask Android for shared-storage access (W-27). */
  onRequestStoragePermission?: () => void
  version: string
}

export function Sidebar({
  open,
  onClose,
  cwd,
  entries,
  loading,
  docs,
  activePath,
  storageInfo,
  bookmarks,
  recentFiles,
  onOpenDoc,
  onCloseDoc,
  onNavigate,
  onRefresh,
  onCreate,
  onRename,
  onDelete,
  onOpenSaf,
  onAddBookmark,
  onRemoveBookmark,
  onOpenSettings,
  onOpenTerminal,
  onOpenRuntimes,
  onRequestStoragePermission,
  version
}: Props) {
  const [locationsCollapsed, setLocationsCollapsed] = useState(false)
  const [bookmarksCollapsed, setBookmarksCollapsed] = useState(false)
  const [recentsCollapsed, setRecentsCollapsed] = useState(true)
  const [openEditorsCollapsed, setOpenEditorsCollapsed] = useState(false)
  const [filesCollapsed, setFilesCollapsed] = useState(false)

  const isCurrentBookmarked = bookmarks.includes(cwd)

  return (
    <>
      <div
        className={"sidebar-backdrop" + (open ? " is-open" : "")}
        onClick={onClose}
        aria-hidden={!open}
      />

      <aside className={"sidebar" + (open ? " is-open" : "")} aria-label="Navigation Drawer">
        {/* Drawer Header matching QuickEdit+ Drawer */}
        <div className="sidebar-drawer-header">
          <div className="sidebar-brand-lockup">
            <LeoCodeLogo size={36} className="sidebar-brand-logo" />
            <div className="sidebar-brand-text">
              <div className="sidebar-app-title">LeoCode IDE</div>
              <div className="sidebar-app-ver">v{version} • Android</div>
            </div>
          </div>
          <button
            className="icon-btn tiny sidebar-close-btn"
            onClick={onClose}
            aria-label="Close Drawer"
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="sidebar-scrollable">
          {/* Quick Storage Locations */}
          <div className="sidebar-section">
            <div
              className="sidebar-section-header"
              onClick={() => setLocationsCollapsed((c) => !c)}
            >
              <span className="sidebar-section-chevron">
                {locationsCollapsed ? <ChevronRightIcon size={12} /> : <ChevronUpIcon size={12} />}
              </span>
              <span className="sidebar-section-title">STORAGE LOCATIONS</span>
            </div>

            {!locationsCollapsed && (
              <div className="sidebar-locations-list">
                {storageInfo && !storageInfo.hasPermission && onRequestStoragePermission && (
                  <button
                    className="sidebar-nav-item saf-highlight"
                    onClick={onRequestStoragePermission}
                  >
                    <SmartphoneIcon size={17} className="sidebar-item-icon saf" />
                    <div className="sidebar-item-info">
                      <span className="sidebar-item-title">Grant storage access</span>
                      <span className="sidebar-item-sub">
                        Needed for Downloads, Documents and SD cards
                      </span>
                    </div>
                  </button>
                )}
                <button
                  className={"sidebar-nav-item" + (cwd === "/storage/emulated/0" ? " active" : "")}
                  onClick={() => {
                    onNavigate("/storage/emulated/0")
                  }}
                >
                  <SmartphoneIcon size={17} className="sidebar-item-icon" />
                  <div className="sidebar-item-info">
                    <span className="sidebar-item-title">Internal Storage</span>
                    <span className="sidebar-item-sub">/storage/emulated/0</span>
                  </div>
                </button>

                <button
                  className={"sidebar-nav-item" + (cwd === "/storage/emulated/0/Download" ? " active" : "")}
                  onClick={() => {
                    onNavigate("/storage/emulated/0/Download")
                  }}
                >
                  <DownloadIcon size={17} className="sidebar-item-icon" />
                  <div className="sidebar-item-info">
                    <span className="sidebar-item-title">Downloads</span>
                    <span className="sidebar-item-sub">/storage/emulated/0/Download</span>
                  </div>
                </button>

                <button
                  className={"sidebar-nav-item" + (cwd === "/storage/emulated/0/Documents" ? " active" : "")}
                  onClick={() => {
                    onNavigate("/storage/emulated/0/Documents")
                  }}
                >
                  <FolderIcon size={17} className="sidebar-item-icon" />
                  <div className="sidebar-item-info">
                    <span className="sidebar-item-title">Documents</span>
                    <span className="sidebar-item-sub">/storage/emulated/0/Documents</span>
                  </div>
                </button>

                <button
                  className={"sidebar-nav-item" + (cwd === "." ? " active" : "")}
                  onClick={() => {
                    onNavigate(".")
                  }}
                >
                  <FolderIcon size={17} className="sidebar-item-icon accent" />
                  <div className="sidebar-item-info">
                    <span className="sidebar-item-title">App Workspace</span>
                    <span className="sidebar-item-sub">Private project jail</span>
                  </div>
                </button>

                <button
                  className="sidebar-nav-item saf-highlight"
                  onClick={() => {
                    onClose()
                    onOpenSaf()
                  }}
                >
                  <SafIcon size={17} className="sidebar-item-icon saf" />
                  <div className="sidebar-item-info">
                    <span className="sidebar-item-title">Open via SAF (System Picker)</span>
                    <span className="sidebar-item-sub">SD Card, Cloud Drives & External Folders</span>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Bookmarks Section */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span
                className="sidebar-section-header-left"
                onClick={() => setBookmarksCollapsed((c) => !c)}
              >
                <span className="sidebar-section-chevron">
                  {bookmarksCollapsed ? <ChevronRightIcon size={12} /> : <ChevronUpIcon size={12} />}
                </span>
                <span className="sidebar-section-title">BOOKMARKS</span>
                <span className="sidebar-count">{bookmarks.length}</span>
              </span>

              <button
                className={"sidebar-star-action" + (isCurrentBookmarked ? " bookmarked" : "")}
                onClick={() => {
                  if (isCurrentBookmarked) {
                    onRemoveBookmark(cwd)
                  } else {
                    onAddBookmark(cwd)
                  }
                }}
                title={isCurrentBookmarked ? "Remove current folder bookmark" : "Bookmark current folder"}
              >
                <StarIcon size={14} />
                <span>{isCurrentBookmarked ? "Bookmarked" : "+ Bookmark"}</span>
              </button>
            </div>

            {!bookmarksCollapsed && bookmarks.length > 0 && (
              <div className="sidebar-bookmarks-list">
                {bookmarks.map((bm) => (
                  <div
                    key={bm}
                    className={"sidebar-bookmark-row" + (cwd === bm ? " active" : "")}
                    onClick={() => onNavigate(bm)}
                  >
                    <StarIcon size={15} className="sidebar-bm-icon" />
                    <div className="sidebar-bm-text">
                      <span className="sidebar-bm-name">{baseName(bm) || bm}</span>
                      <span className="sidebar-bm-path">{bm}</span>
                    </div>
                    <button
                      className="sidebar-bm-remove"
                      aria-label="Remove bookmark"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveBookmark(bm)
                      }}
                    >
                      <XIcon size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Files Section */}
          {recentFiles.length > 0 && (
            <div className="sidebar-section">
              <div
                className="sidebar-section-header"
                onClick={() => setRecentsCollapsed((c) => !c)}
              >
                <span className="sidebar-section-chevron">
                  {recentsCollapsed ? <ChevronRightIcon size={12} /> : <ChevronUpIcon size={12} />}
                </span>
                <span className="sidebar-section-title">RECENT FILES</span>
                <span className="sidebar-count">{recentFiles.length}</span>
              </div>

              {!recentsCollapsed && (
                <div className="sidebar-recents-list">
                  {recentFiles.map((path) => (
                    <div
                      key={path}
                      className={"sidebar-doc-row" + (path === activePath ? " active" : "")}
                      onClick={() => {
                        onOpenDoc(path)
                        onClose()
                      }}
                    >
                      <HistoryIcon size={14} className="sidebar-doc-icon" />
                      <div className="sidebar-bm-text">
                        <span className="sidebar-doc-name">{baseName(path)}</span>
                        <span className="sidebar-bm-path">{path}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Open Editors Section */}
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

          {/* Current Directory File Tree */}
          <div className="sidebar-section">
            <div
              className="sidebar-section-header"
              onClick={() => setFilesCollapsed((c) => !c)}
            >
              <span className="sidebar-section-header-left">
                <span className="sidebar-section-chevron">
                  {filesCollapsed ? <ChevronRightIcon size={12} /> : <ChevronUpIcon size={12} />}
                </span>
                <span className="sidebar-section-title">FILES IN DIRECTORY</span>
              </span>

              <div className="sidebar-files-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="icon-btn tiny"
                  onClick={() => onCreate("file")}
                  title="New file"
                  aria-label="New file"
                >
                  <FilePlusIcon size={15} />
                </button>
                <button
                  className="icon-btn tiny"
                  onClick={() => onCreate("dir")}
                  title="New folder"
                  aria-label="New folder"
                >
                  <FolderPlusIcon size={15} />
                </button>
                <button
                  className="icon-btn tiny"
                  onClick={onRefresh}
                  title="Refresh files"
                  aria-label="Refresh files"
                >
                  <RefreshIcon size={15} />
                </button>
              </div>
            </div>

            {!filesCollapsed && (
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
            )}
          </div>
        </div>

        {/* Drawer Bottom Bar: QuickEdit+-style shortcuts */}
        <div className="sidebar-drawer-footer">
          <button
            className="sidebar-footer-btn"
            onClick={() => {
              onClose()
              onOpenSettings()
            }}
          >
            <SettingsIcon size={18} />
            <span>Settings</span>
          </button>
          <button
            className="sidebar-footer-btn"
            onClick={() => {
              onClose()
              onOpenTerminal()
            }}
          >
            <TerminalIcon size={18} />
            <span>Terminal</span>
          </button>
          <button
            className="sidebar-footer-btn"
            onClick={() => {
              onClose()
              onOpenRuntimes()
            }}
          >
            <CpuIcon size={18} />
            <span>Runtimes</span>
          </button>
        </div>
      </aside>
    </>
  )
}
