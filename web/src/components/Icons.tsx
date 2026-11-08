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
