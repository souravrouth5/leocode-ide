import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { CheckIcon, FolderIcon, LeoCodeLogo, TerminalIcon } from "../../components/Icons"

export interface OnboardingStep {
  title: string
  intro: string
  points: string[]
  icon: "folder" | "terminal" | "trust"
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: "Your files live here",
    intro:
      "LeoCode keeps every project inside its own app-private workspace. Nothing is uploaded, and other apps cannot browse it.",
    points: [
      "Projects, drafts and settings survive app updates and restarts.",
      "Uninstalling LeoCode deletes this private storage. Export a workspace backup first.",
      "Grant storage access only when you want to open or save files in Downloads, Documents or an SD card."
    ],
    icon: "folder"
  },
  {
    title: "Keep LeoCode alive",
    intro:
      "Android may stop background work to save battery. Terminals and long installs survive when LeoCode is allowed to keep running.",
    points: [
      "Keep the “LeoCode is running” notification; its Stop all action ends terminals and jobs.",
      "MIUI / HyperOS: allow Autostart and set Battery saver to No restrictions.",
      "Android 12+: in Developer options, disable child-process restrictions if long jobs are killed."
    ],
    icon: "terminal"
  },
  {
    title: "Scripts and packages are powerful",
    intro:
      "Running a script or installing packages executes code with LeoCode's permissions. Only continue for projects you trust.",
    points: [
      "A script can read your files, start processes and use the network.",
      "pip runs package build code while installing into this project's .venv.",
      "LeoCode asks before each action and asks again when the script or requirements.txt changes."
    ],
    icon: "trust"
  }
]

interface Props {
  open: boolean
  step: number
  onStep: (step: number) => void
  onFinish: () => void
}

/**
 * Three mandatory first-run screens (Task 27).
 *
 * There is no close button and the backdrop does nothing: the only way out is
 * through the screens. The last screen requires an explicit acknowledgement, so
 * the trust warning cannot be dismissed by muscle memory. The Android back
 * button is handled by `handleBack`, which walks the steps instead of closing.
 */
export function Onboarding({ open, step, onStep, onFinish }: Props) {
  const [acknowledged, setAcknowledged] = useState(false)

  // Going back to the trust screen must require a fresh acknowledgement.
  useEffect(() => {
    if (step !== ONBOARDING_STEPS.length - 1) setAcknowledged(false)
  }, [step])

  if (!open) return null

  const current = ONBOARDING_STEPS[Math.min(step, ONBOARDING_STEPS.length - 1)]
  const last = step >= ONBOARDING_STEPS.length - 1
  const Icon = current.icon === "folder" ? FolderIcon : current.icon === "terminal" ? TerminalIcon : CheckIcon

  return createPortal(
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Welcome to LeoCode">
      <div className="onboarding-card">
        <div className="onboarding-brand">
          <LeoCodeLogo size={40} />
          <div>
            <div className="onboarding-name">LeoCode</div>
            <div className="onboarding-kicker">A small IDE that fits in your hand</div>
          </div>
        </div>

        <div className="onboarding-dots" aria-hidden="true">
          {ONBOARDING_STEPS.map((item, index) => (
            <span
              key={item.title}
              className={"onboarding-dot" + (index === step ? " active" : "")}
            />
          ))}
        </div>

        <div className="onboarding-icon">
          <Icon size={28} />
        </div>
        <h1 className="onboarding-title">{current.title}</h1>
        <p className="onboarding-intro">{current.intro}</p>
        <ul className="onboarding-points">
          {current.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>

        {last && (
          <label className="onboarding-ack">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              I understand that scripts and packages can read my files, start processes and use
              the network.
            </span>
          </label>
        )}

        <div className="onboarding-actions">
          {step > 0 && (
            <button className="btn ghost" onClick={() => onStep(step - 1)}>
              Back
            </button>
          )}
          {last ? (
            <button
              className="btn primary"
              disabled={!acknowledged}
              onClick={onFinish}
            >
              Start coding
            </button>
          ) : (
            <button className="btn primary" onClick={() => onStep(step + 1)}>
              Next
            </button>
          )}
        </div>

        <p className="onboarding-footnote">
          You can read these screens again from Settings → About → Show onboarding again.
        </p>
      </div>
    </div>,
    document.body
  )
}
