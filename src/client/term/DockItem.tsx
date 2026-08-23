/**
 * DockItem — a round dock button for the conversation session header.
 * Each plugin owns its own DockItem copy (terminal in dsh-term, file-panel in
 * dsh-file-manager). Hover scales the button up via pure CSS — no JS event
 * coordination, no shared motion value.
 * @module dsh-term/client/DockItem
 */
import { type ReactElement, type ReactNode } from 'react'

const STYLE_ID = 'dsh-dock-item-style'

function ensureStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = '.dsh-dock-item{width:32px;height:32px;border:none;border-radius:9999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;position:relative;transition:transform .15s ease,background .18s ease;display:inline-flex;align-items:center;justify-content:center}.dsh-dock-item:hover{transform:scale(1.15);background:var(--dsw-alias-bg-layer-1)}.dsh-dock-item-active{background:var(--dsw-alias-state-business-primary)}.dsh-dock-tooltip{position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);padding:2px 8px;font-size:12px;line-height:1.4;white-space:nowrap;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;opacity:0;pointer-events:none;transition:opacity .15s}.dsh-dock-item:hover .dsh-dock-tooltip{opacity:1}'
  document.head.appendChild(tag)
}

ensureStyle()

export function DockItem(props: {
  active: boolean
  label: string
  onClick: () => void
  children: ReactNode
}): ReactElement {
  return (
    <button
      type="button"
      className={`dsh-dock-item${props.active ? ' dsh-dock-item-active' : ''}`}
      onClick={props.onClick}
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.label}
    >
      <span className="dsh-dock-tooltip">{props.label}</span>
      {props.children}
    </button>
  )
}
