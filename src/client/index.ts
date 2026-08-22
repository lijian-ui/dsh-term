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

/** Augment the locale namespace map so ctx.locale.register/bind accept 'dsh-term'. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Terminal panel copy. */
    'dsh-term': 'ui.panel.title' | 'ui.panel.addTabTitle' | 'ui.panel.collapseTitle' | 'ui.panel.emptyHint' | 'ui.tab.closeAria' | 'msg.sessionExited' | 'msg.spawnFailed' | 'ui.dock.label' | 'ui.panel.shellTitle' | 'ui.shell.bash' | 'ui.shell.zsh' | 'ui.shell.powershell' | 'ui.shell.cmd' | 'ui.shell.gitbash' | 'ui.panel.reopenTitle' | 'ui.panel.backgroundSessions' | 'ui.panel.noBackground' | 'ui.panel.addToChat'
  }
}
import { zh as clientZh, en as clientEn } from './client-i18n.ts'
import { TermApi } from './term/api.ts'
import { TerminalPanel } from './term/TerminalPanel.tsx'
import { AnimatedDock } from './term/AnimatedDock.tsx'
import { bindI18n } from './i18n-seat.ts'

/** Required services: sessions (for the workspace cwd), conversation (for add-to-chat). */
export const inject = ['sessions', 'locale', 'slots', 'conversation']

/** Cross-plugin event names shared with the AnimatedDock header group. */
const EV = {
  toggleTerminal: 'dsh-dock:toggle-terminal',
  terminalState: 'dsh-dock:terminal-state',
} as const

/** Terminal column width bounds and persistence. */
const MIN_TERM_WIDTH = 200
const MAX_TERM_WIDTH = 600
const DEFAULT_TERM_WIDTH = 300
const TERM_WIDTH_KEY = 'dsh-term-width-px'
const TERM_HANDLE_WIDTH = 8

function readTermWidth(): number {
  try {
    const raw = localStorage.getItem(TERM_WIDTH_KEY)
    if (raw === null) return DEFAULT_TERM_WIDTH
    const v = Number(raw)
    if (!Number.isFinite(v) || v < MIN_TERM_WIDTH || v > MAX_TERM_WIDTH) return DEFAULT_TERM_WIDTH
    return v
  } catch { return DEFAULT_TERM_WIDTH }
}

function writeTermWidth(v: number): void {
  try { localStorage.setItem(TERM_WIDTH_KEY, String(Math.round(v))) } catch { /* best-effort */ }
}

/** Inject the drag-handle visual styles once. */
function adoptHandleStyles(): void {
  const id = 'dsh-term-handle-style'
  if (document.getElementById(id) !== null) return
  const tag = document.createElement('style')
  tag.id = id
  tag.textContent = '.dsh-term-handle{touch-action:none;cursor:col-resize}'
  document.head.appendChild(tag)
}

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
  // Register client-side bilingual dictionaries.
  const I18N_NS = 'dsh-term'
  ctx.effect(
    () => ctx.locale.register(I18N_NS, { zh: clientZh, en: clientEn }),
    'dsh-term: client dictionaries'
  )
  const t = ctx.locale.bind(I18N_NS)
  bindI18n(t)  // publish to module-level seat for use by components outside slots

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
      col.style.display = 'none'
      frame.appendChild(col)

      // Keep the terminal the rightmost column even if file-manager appends
      // its preview/explorer columns after this plugin mounts.
      const keepLast = new MutationObserver(() => {
        if (col !== frame.lastElementChild) frame.appendChild(col)
      })
      keepLast.observe(frame, { childList: true })


      // Open/closed state. Closed by default (the column is a docked track).
      let terminalOpen = false
      let terminalWidth = readTermWidth()

      // The drag handle on the terminal column's left edge (drag left = wider).
      adoptHandleStyles()
      const handle = document.createElement('div')
      handle.className = 'dsh-term-handle'
      handle.style.position = 'absolute'
      handle.style.top = '0'
      handle.style.bottom = '0'
      handle.style.width = `${TERM_HANDLE_WIDTH}px`
      handle.style.marginLeft = `${-TERM_HANDLE_WIDTH / 2}px`
      handle.style.zIndex = '30'
      handle.style.cursor = 'col-resize'
      handle.style.display = 'none'
      frame.appendChild(handle)

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
        if (terminalOpen) tokens.push('[dsh-term]', `${terminalWidth}px`)
        const next = tokens.join(' ')
        if (next !== frame.style.gridTemplateColumns) {
          frame.style.gridTemplateColumns = next
        }
        // Keep the drag handle glued to the terminal column's left edge.
        if (terminalOpen) {
          const frameRect = frame.getBoundingClientRect()
          const colRect = col.getBoundingClientRect()
          const leftEdge = colRect.left - frameRect.left
          handle.style.left = `${Math.round(leftEdge)}px`
        }
        handle.style.display = terminalOpen ? 'block' : 'none'
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
        reconcileGrid()
        window.dispatchEvent(new CustomEvent(EV.terminalState, { detail: open }))
      }
      const onToggleTerminal = (): void => setVisible(!terminalOpen)
      window.addEventListener(EV.toggleTerminal, onToggleTerminal)

      // Drag the handle to resize the terminal column (left = wider).
      handle.addEventListener('pointerdown', (event: PointerEvent): void => {
        if (event.button !== 0) return
        event.preventDefault()
        handle.setPointerCapture(event.pointerId)
        const startX = event.clientX
        const startWidth = terminalWidth
        let rafId: number | null = null
        let pendingWidth: number | null = null
        let latestWidth = startWidth

        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
        frame.setAttribute('data-dragging', '')
        handle.setAttribute('data-dragging', '')

        const flush = (): void => {
          if (pendingWidth === null) return
          latestWidth = pendingWidth
          terminalWidth = pendingWidth
          reconcileGrid()
        }

        const computeWidth = (clientX: number): number => {
          const deltaX = startX - clientX
          return Math.min(MAX_TERM_WIDTH, Math.max(MIN_TERM_WIDTH, startWidth + deltaX))
        }

        const finish = (clientX: number | null): void => {
          handle.removeEventListener('pointermove', onMove)
          handle.removeEventListener('pointerup', onUp)
          handle.removeEventListener('pointercancel', onCancel)
          try { handle.releasePointerCapture(event.pointerId) } catch { /* already released */ }
          document.body.style.userSelect = ''
          document.body.style.cursor = ''
          frame.removeAttribute('data-dragging')
          handle.removeAttribute('data-dragging')
          if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
          flush()
          const finalWidth = clientX === null ? latestWidth : computeWidth(clientX)
          terminalWidth = finalWidth
          reconcileGrid()
          writeTermWidth(finalWidth)
        }

        const onMove = (e: PointerEvent): void => {
          if (e.buttons === 0) { finish(e.clientX); return }
          pendingWidth = computeWidth(e.clientX)
          if (rafId === null) {
            rafId = requestAnimationFrame(() => { rafId = null; flush() })
          }
        }
        const onUp = (e: PointerEvent): void => finish(e.clientX)
        const onCancel = (): void => finish(null)

        handle.addEventListener('pointermove', onMove)
        handle.addEventListener('pointerup', onUp)
        handle.addEventListener('pointercancel', onCancel)
      })

      root.render(createElement(TerminalPanel, { ctx, api, onClose: () => setVisible(false), t }))

      disposeFrame = () => {
        keepLast.disconnect()
        styleObserver.disconnect()
        window.removeEventListener(EV.toggleTerminal, onToggleTerminal)
        root.unmount()
        col.remove()
        handle.remove()
      }
    })
    return () => {
      offWait()
      disposeFrame?.()
    }
  }, 'dsh-term: panel mount')
}
