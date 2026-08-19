/**
 * AnimatedDock — a macOS-style magnification button group rendered into the
 * conversation session header (the `conversation.session.header.utilities`
 * slot, ordered to the LEFT of the official "Session log" button).
 *
 * This is a faithful port of the 21st.dev "Animated Dock" component: it uses
 * framer-motion's `useMotionValue` + `useSpring` + `useTransform` so each
 * circular icon scales toward the cursor with real spring physics — the
 * buttery feel you can't get from a CSS transition. Magnification is driven by
 * `transform: scale()` (NOT `width`), so it never reflows the layout and the
 * dock stays perfectly stable under the cursor.
 * Icons come from lucide-react. The dock itself is a frosted-glass pill.
 *
 * Two entries wire to the two right-side panels through window CustomEvents
 * (a cross-plugin bridge so this component never imports the file-manager
 * bundle):
 *
 *   - terminal -> `dsh-dock:toggle-terminal`   (handled in dsh-term index)
 *   - file     -> `dsh-dock:toggle-filepanel`  (handled in dsh-file-manager)
 *
 * Active (open) state is mirrored back through `dsh-dock:terminal-state` /
 * `dsh-dock:filepanel-state` so the icons highlight in lockstep with the
 * actual panels.
 * @module dsh-term/client/AnimatedDock
 */

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion'
import { Terminal, FolderOpen } from 'lucide-react'
import styles from './animated-dock.module.css'

/** Cross-plugin event names (kept as literals to avoid cross-bundle imports). */
const EV = {
  toggleTerminal: 'dsh-dock:toggle-terminal',
  toggleFile: 'dsh-dock:toggle-filepanel',
  terminalState: 'dsh-dock:terminal-state',
  fileState: 'dsh-dock:filepanel-state',
} as const

/** Resting / peak icon size (px). */
const BASE = 40
const MAX = 58
/** Magnification factor at the cursor (MAX / BASE). Driven via CSS `scale()`
 *  so it never reflows the layout — this is what removed the old "jitter". */
const MAX_SCALE = MAX / BASE
/** Cursor distance (px) over which magnification falls to zero. */
const DIST = 120
/** Spring tuning. Near-critically damped (ratio ≈ 0.94) so the icon settles
 *  smoothly with essentially no overshoot. The old `damping: 0.35` was
 *  effectively zero damping and caused the wild oscillation. */
const DAMPING = 28
const STIFFNESS = 220

export function AnimatedDock(): ReactElement {
  const mouseX = useMotionValue<number>(Infinity)
  const [terminalActive, setTerminalActive] = useState(false)
  const [fileActive, setFileActive] = useState(false)

  // Mirror the real panel open-state back into the icon highlight.
  useEffect(() => {
    const onTerm = (e: Event): void => setTerminalActive(Boolean((e as CustomEvent).detail))
    const onFile = (e: Event): void => setFileActive(Boolean((e as CustomEvent).detail))
    window.addEventListener(EV.terminalState, onTerm)
    window.addEventListener(EV.fileState, onFile)
    return () => {
      window.removeEventListener(EV.terminalState, onTerm)
      window.removeEventListener(EV.fileState, onFile)
    }
  }, [])

  return (
    <motion.div
      className={styles.dock}
      onMouseMove={(e) => mouseX.set(e.clientX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      aria-label="工具坞"
    >
      <DockItem
        mouseX={mouseX}
        active={terminalActive}
        label="终端"
        onClick={() => window.dispatchEvent(new CustomEvent(EV.toggleTerminal))}
      >
        <Terminal size={20} strokeWidth={2} />
      </DockItem>
      <DockItem
        mouseX={mouseX}
        active={fileActive}
        label="文件面板"
        onClick={() => window.dispatchEvent(new CustomEvent(EV.toggleFile))}
      >
        <FolderOpen size={20} strokeWidth={2} />
      </DockItem>
    </motion.div>
  )
}

/** A single magnifying icon. Its `scale` is a spring driven by cursor distance.
 *  Because we animate `transform` (not `width`), the layout never reflows, so
 *  there is no neighbour-push feedback loop and the dock stays rock-steady. */
function DockItem(props: {
  mouseX: MotionValue<number>
  active: boolean
  label: string
  onClick: () => void
  children: ReactNode
}): ReactElement {
  const ref = useRef<HTMLButtonElement>(null)
  const distance = useTransform(props.mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: BASE }
    return val - bounds.x - bounds.width / 2
  })
  const scale = useSpring(
    useTransform(distance, [-DIST, 0, DIST], [1, MAX_SCALE, 1]),
    { damping: DAMPING, stiffness: STIFFNESS },
  )
  return (
    <motion.button
      ref={ref}
      type="button"
      style={{ scale }}
      className={`${styles.item}${props.active ? ` ${styles.active}` : ''}`}
      onClick={props.onClick}
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.label}
    >
      <span className={styles.tooltip}>{props.label}</span>
      {props.children}
    </motion.button>
  )
}
