/**
 * AnimatedDock — the terminal dock button rendered into the conversation
 * session header (the `conversation.session.header.utilities` slot, ordered to
 * the LEFT of the official "Session log" button).
 *
 * Each plugin owns its own dock button independently: dsh-term renders this
 * terminal button, dsh-file-manager renders its own file-panel button. The two
 * are fully decoupled — install either alone and you get just its button;
 * install both and both buttons appear side by side with shared magnification
 * (coordinated through window CustomEvents, see DockItem.tsx).
 *
 * Clicking broadcasts `dsh-dock:toggle-terminal` (handled in dsh-term index);
 * the open state is mirrored back through `dsh-dock:terminal-state`.
 * @module dsh-term/client/AnimatedDock
 */
import { useEffect, useState, type ReactElement } from 'react'
import { DockItem } from './DockItem.tsx'
import { getT } from '../i18n-seat.ts'

const EV = {
  toggleTerminal: 'dsh-dock:toggle-terminal',
  terminalState: 'dsh-dock:terminal-state',
} as const

export function AnimatedDock(): ReactElement {
  const t = getT()
  const [active, setActive] = useState(false)
  useEffect(() => {
    const onState = (e: Event): void => setActive(Boolean((e as CustomEvent).detail))
    window.addEventListener(EV.terminalState, onState)
    return () => window.removeEventListener(EV.terminalState, onState)
  }, [])
  return (
    <DockItem
      active={active}
      label={t('ui.dock.label')}
      onClick={() => window.dispatchEvent(new CustomEvent(EV.toggleTerminal))}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    </DockItem>
  )
}
