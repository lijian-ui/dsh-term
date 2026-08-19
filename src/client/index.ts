/**
 * dsh-term browser half: mounts the terminal as a DOCKED column in the web
 * shell's right side — appended as the 6th grid track of the frame, beside
 * the file-manager panels (preview/explorer) when present. This mirrors how
 * file-manager extends the frame grid, so the two panels sit side by side.
 *
 * The frame is a CSS grid with `grid-auto-flow: row` (the default). A bare
 * `appendChild` of a 6th child would WRAP to a 2nd row (off-screen) — so we
 * must EXTEND `grid-template-columns` explicitly, the same way file-manager
 * does. We append a `[dsh-term]` named 6th track after file-manager's 5
 * tracks; the center column is `minmax(0,1fr)`, so it absorbs the 300px and
 * the grid never overflows on wide screens. file-manager ignores any grid
 * string that is not 3 (shell) or 5 (its own) tracks, so our 6-track write is
 * left alone by it — we just re-assert it whenever file-manager rewrites the
 * grid (drag / resize / collapse).
 *
 * Every DOM/runtime failure is logged, never thrown — the web shell fails the
 * whole boot when a plugin apply throws.
 * @module dsh-term/client
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-slots SlotMap merge (keeps bundle purity gates calm).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: merges the conversation header slots (incl.
// `conversation.session.header.utilities`) onto the SlotMap so we can register
// the header tool-dock against the official, typed slot.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TermApi } from './term/api.ts'
import { TerminalPanel } from './term/TerminalPanel.tsx'
import { AnimatedDock } from './term/AnimatedDock.tsx'

/** Required services: sessions (for the workspace cwd). */
export const inject = ['sessions']

/** Cross-plugin event names shared with the AnimatedDock header group. */
const EV = {
  toggleTerminal: 'dsh-dock:toggle-terminal',
  terminalState: 'dsh-dock:terminal-state',
} as const

/** Width of the docked terminal column, in px (the 6th grid track). */
const TERMINAL_WIDTH = 300

/** Locate the frame grid (same heuristic file-manager uses). */
function findFrame(): HTMLElement | null {
  const stamped = document.querySelector<HTMLElement>('[data-dsh-frame]')
  if (stamped !== null) return stamped
  return document.querySelector<HTMLElement>('[class*="sidebarCol"]')?.parentElement ?? null
}

/**
 * Run `cb` once the frame exists. The shell mounts late (and may rebuild), so
 * wait via a body-level MutationObserver when it is not present yet.
 */
function whenFrameReady(cb: (frame: HTMLElement) => void): () => void {
  const existing = findFrame()
  if (existing !== null) {
    cb(existing)
    return () => {}
  }
  const obs = new MutationObserver(() => {
    const frame = findFrame()
    if (frame !== null) {
      obs.disconnect()
      cb(frame)
    }
  })
  obs.observe(document.body, { childList: true, subtree: true })
  return () => obs.disconnect()
}

/** Inject the launcher button styles once (the button is a raw DOM node). */
function adoptLauncherStyles(): void {
  const id = 'dsh-term-launcher-style'
  if (document.getElementById(id) !== null) return
  const tag = document.createElement('style')
  tag.id = id
  tag.textContent = `
.dsh-term-launcher {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 40;
  height: 30px;
  padding: 0 14px;
  border-radius: 6px;
  border: 1px solid var(--aion-bg-3, #e5e6eb);
  background: var(--aion-bg-1, #ffffff);
  color: var(--aion-fg-1, #1f2329);
  font-size: 13px;
  font-family: var(--aion-font-sans, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.dsh-term-launcher:hover {
  background: var(--aion-bg-2, #f2f3f5);
}`
  document.head.appendChild(tag)
}

/**
 * Parse a `grid-template-columns` string into raw tokens. Named lines
 * (`[name]`) and sizes are separate tokens — we keep them split so the
 * terminal marker can be stripped reliably. Spaces inside `minmax(...)` /
 * `repeat(...)` are preserved (not split).
 */
function tokenizeGrid(input: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let current = ''
  for (const char of input) {
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    if (char === ' ' && depth === 0) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current !== '') tokens.push(current)
  return tokens
}

/** Remove the terminal's `[dsh-term]` marker line and its following size token. */
function stripTerminalTrack(tokens: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === '[dsh-term]') {
      i += 1 // skip the size that follows the marker
      continue
    }
    out.push(tokens[i])
  }
  return out
}

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  // 会话页 header 工具坞：紧贴「Session log」左侧的放大按钮组
  ctx.inject(['slots'], (scope: ClientContext) => {
    scope.slots.inject('conversation.session.header.utilities', () =>
      scope.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'dsh-dock',
        order: -1,
        inject: () => ({}),
      }, AnimatedDock))
  })

  ctx.effect(() => {
    let disposeFrame: (() => void) | undefined
    const offWait = whenFrameReady((frame) => {
      // The terminal column: appended as the LAST child of the frame grid, so
      // it docks to the far right, beside file-manager's explorer. It becomes
      // the 6th explicit grid track (sized by our `[dsh-term] 300px` write),
      // not an implicit row — that is what makes it visible on the same row.
      const col = document.createElement('div')
      col.dataset.dshTermCol = ''
      col.style.minWidth = '0'
      col.style.height = '100%'
      frame.appendChild(col)

      // Keep the terminal the rightmost column even if file-manager appends
      // its preview/explorer columns after this plugin mounts.
      const keepLast = new MutationObserver(() => {
        if (col !== frame.lastElementChild) frame.appendChild(col)
      })
      keepLast.observe(frame, { childList: true })

      // Re-open button (after a collapse). Hidden while the column is open.
      adoptLauncherStyles()
      const launcher = document.createElement('button')
      launcher.type = 'button'
      launcher.className = 'dsh-term-launcher'
      launcher.textContent = '终端'
      launcher.setAttribute('aria-label', '打开终端')
      launcher.style.display = 'none'
      document.body.appendChild(launcher)

      // Open/closed state. Closed by default (the column is a docked track).
      let terminalOpen = false

      /**
       * Re-assert the frame grid: keep file-manager's tracks, append our
       * `[dsh-term] 300px` track when open, strip it when collapsed.
       * file-manager only acts on 3- or 5-track grids, so our 6-track write is
       * never clobbered by it — but file-manager DOES overwrite us on every
       * drag/resize/collapse, so we re-run on any frame style change.
       */
      const reconcileGrid = (): void => {
        const inline = frame.style.gridTemplateColumns
        if (inline.trim() === '') return
        let tokens = tokenizeGrid(inline)
        tokens = stripTerminalTrack(tokens)
        const hasFilemgr = frame.querySelector('[data-filemgr-explorer-col]') !== null
        const baseLen = hasFilemgr ? 5 : 3
        // Wait while file-manager has not finalized its 5-track grid yet
        // (e.g. the shell's own 3-track write landed before file-manager
        // re-applied). Touching it now would desync file-manager's width math.
        if (tokens.length !== baseLen) return
        if (terminalOpen) tokens.push('[dsh-term]', `${TERMINAL_WIDTH}px`)
        const next = tokens.join(' ')
        if (next !== frame.style.gridTemplateColumns) {
          frame.style.gridTemplateColumns = next
        }
      }

      // Re-assert after file-manager rewrites the grid (drag / resize / collapse).
      const styleObserver = new MutationObserver(() => reconcileGrid())
      styleObserver.observe(frame, { attributes: true, attributeFilter: ['style'] })
      // First pass (frame may already carry file-manager's 5-track grid).
      reconcileGrid()

      const api = new TermApi()
      const root = createRoot(col)
      const setVisible = (open: boolean): void => {
        terminalOpen = open
        col.style.display = open ? 'flex' : 'none'
        launcher.style.display = open ? 'none' : 'flex'
        reconcileGrid()
        window.dispatchEvent(new CustomEvent(EV.terminalState, { detail: open }))
      }
      const onToggleTerminal = (): void => setVisible(!terminalOpen)
      window.addEventListener(EV.toggleTerminal, onToggleTerminal)
      launcher.addEventListener('click', () => setVisible(true))
      root.render(createElement(TerminalPanel, { ctx, api, onClose: () => setVisible(false) }))

      disposeFrame = () => {
        keepLast.disconnect()
        styleObserver.disconnect()
        window.removeEventListener(EV.toggleTerminal, onToggleTerminal)
        root.unmount()
        col.remove()
        launcher.remove()
      }
    })
    return () => {
      offWait()
      disposeFrame?.()
    }
  }, 'dsh-term: panel mount')
}
