import logoUrl from "../assets/logo.png"

interface Props {
  size?: number
  className?: string
}

function svg(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true
  }
}

export function FolderIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h7A1.5 1.5 0 0 1 19 9.5v8A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  )
}

export function FileIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M6 3.5h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" />
      <path d="M13 3.5v5h5" />
    </svg>
  )
}

export function CodeIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />
    </svg>
  )
}

export function TerminalIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </svg>
  )
}

export function GitIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="17" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M7 8.2v3.3a2 2 0 0 0 2 2h3M17 8.2v3.3a2 2 0 0 1-2 2h-3" />
    </svg>
  )
}

export function SettingsIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.96 4.5H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </svg>
  )
}

export function SaveIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M5 4.5h11l3 3v12H5z" />
      <path d="M8.5 4.5v5h6v-5M8.5 19v-6h7v6" />
    </svg>
  )
}

export function RefreshIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M20 11a8 8 0 1 0-2.3 6.3" />
      <path d="M20 4.5V11h-6" />
    </svg>
  )
}

export function PlusIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="m9.5 6 6 6-6 6" />
    </svg>
  )
}

export function ChevronUpIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="m6 14.5 6-6 6 6" />
    </svg>
  )
}

export function XIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

export function CheckIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  )
}

export function MoreIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SunIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </svg>
  )
}

export function MoonIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z" />
    </svg>
  )
}

export function MonitorIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <rect x="3" y="4.5" width="18" height="12" rx="1.6" />
      <path d="M8 20h8M12 16.5V20" />
    </svg>
  )
}

export function TrashIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" />
    </svg>
  )
}

export function PencilIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M14.5 7.5 16.5 9.5" />
    </svg>
  )
}

export function SearchIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5" />
    </svg>
  )
}

export function PlayIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M8 4.8v14.4L19.5 12 8 4.8z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function StopIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function UndoIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M9 7 4.5 11.5 9 16" />
      <path d="M4.5 11.5h9a5.5 5.5 0 0 1 0 11H9" />
    </svg>
  )
}

export function RedoIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="m15 7 4.5 4.5L15 16" />
      <path d="M19.5 11.5h-9a5.5 5.5 0 0 0 0 11H15" />
    </svg>
  )
}

export function CpuIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M9 9h6v6H9zM9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4" />
    </svg>
  )
}

export function LeoCodeLogo({ size = 24, className }: Props) {
  return (
    <img
      src={logoUrl}
      alt="LeoCode Logo"
      width={size}
      height={size}
      className={className}
      style={{
        borderRadius: Math.round(size * 0.28),
        objectFit: "cover",
        display: "inline-block",
        verticalAlign: "middle",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)"
      }}
    />
  )
}


export function SparklesIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="m12 3-1.9 4.6L5.5 9.5l4.6 1.9L12 16l1.9-4.6 4.6-1.9-4.6-1.9z" />
      <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
    </svg>
  )
}

export function MenuIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  )
}

export function SidebarIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  )
}

export function FilePlusIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  )
}

export function FolderPlusIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  )
}

export function TypeIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  )
}

export function PaletteIcon({ size = 20, className }: Props) {
  return (
    <svg {...svg(size, className)}>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z" />
    </svg>
  )
}


