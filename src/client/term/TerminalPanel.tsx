/**
 * dsh-term panel: a multi-tab local terminal (real PTY via node-pty on the
 * host, bridged over /dsh-term/*). One xterm instance per tab; output lands
 * through a single EventSource routed by session id.
 *
 * Mounting: this component renders a DOCKED column (not a floating overlay).
 * The client entry (`index.ts`) appends that column as the last grid track of
 * the web shell's frame, beside the file-manager panels (preview/explorer)
 * when present. The panel itself only owns its inner content (header + stage).
 *
 * Features: shell selector with availability detection, terminal reuse
 * (close detaches — PTY keeps running; reopen re-attaches), 16-color ANSI
 * palette, safe cwd fallback, selection → add to conversation.
 * @module dsh-term/client/term/TerminalPanel
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ShellInfo, ShellType, TermEvent, TermSessionInfo } from '../../core/types.ts'
import type { TermApi } from './api.ts'
import { appendToConversationDraft } from './chat-helper.ts'
import { XTERM_CSS } from './xterm-styles.ts'
import css from './term.module.css'

/** Injected props for the panel. */
interface PanelProps {
  ctx: ClientContext
  api: TermApi
  onClose: () => void
  t: TranslateNS<'dsh-term'>
}

/** One open tab: the wire info plus its live xterm handles. */
interface Tab {
  readonly sessionId: string
  readonly title: string
  readonly term: Terminal
  readonly fit: FitAddon
  readonly wrap: HTMLDivElement
}

/** Floating "Add to chat" button state. */
interface FloatBtn {
  readonly top: number
  readonly left: number
  readonly content: string
}

/** All shell kinds in display order (used when detection fails). */
const FALLBACK_SHELLS: readonly ShellType[] = ['zsh', 'bash', 'gitbash', 'powershell', 'cmd']

/** 16-color ANSI palette for dark backgrounds (One Dark inspired). */
const DARK_PALETTE: Record<string, string> = {
  black: '#282c34',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#ef6e7e',
  brightGreen: '#a3d978',
  brightYellow: '#f0c674',
  brightBlue: '#7ab8f5',
  brightMagenta: '#d68adf',
  brightCyan: '#6fd0dc',
  brightWhite: '#d7dae0',
}

/** 16-color ANSI palette for light backgrounds (Nord inspired). */
const LIGHT_PALETTE: Record<string, string> = {
  black: '#3b4252',
  red: '#bf616a',
  green: '#a3be8c',
  yellow: '#ebcb8b',
  blue: '#81a1c1',
  magenta: '#b48ead',
  cyan: '#8fbcbb',
  white: '#4c566a',
  brightBlack: '#4c566a',
  brightRed: '#bf616a',
  brightGreen: '#a3be8c',
  brightYellow: '#ebcb8b',
  brightBlue: '#81a1c1',
  brightMagenta: '#b48ead',
  brightCyan: '#8fbcbb',
  brightWhite: '#2e3440',
}

/** Inject the xterm core styles once (idempotent). */
const XTERM_STYLE_ID = 'dsh-term-xterm-style'
function adoptXtermStyles(): void {
  if (document.getElementById(XTERM_STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = XTERM_STYLE_ID
  tag.textContent = XTERM_CSS
  document.head.appendChild(tag)
}

/** Terminal theme matching the shell's light/dark marker. */
function themeOf(): Record<string, string> {
  const dark = document.body.dataset.dsDarkTheme !== undefined
  if (dark) {
    return {
      background: 'var(--dsw-alias-bg-base)',
      foreground: 'var(--dsw-alias-label-secondary)',
      cursor: 'var(--dsw-alias-label-secondary)',
      selectionBackground: 'rgba(255,255,255,0.2)',
      ...DARK_PALETTE,
    }
  }
  return {
    background: 'var(--dsw-alias-bg-base)',
    foreground: 'var(--dsw-alias-label-primary)',
    cursor: 'var(--dsw-alias-label-primary)',
    selectionBackground: 'rgba(22,93,255,0.25)',
    ...LIGHT_PALETTE,
  }
}

/** Current workspace cwd from the session list ('' when none). */
function currentCwd(ctx: ClientContext): string {
  const snapshot = ctx.sessions.list.getSnapshot()
  const sessionId = snapshot.current as SessionId | undefined
  const cwd = sessionId === undefined ? undefined : snapshot.byId[sessionId]?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : ''
}

/** The docked panel: header (title / shell / tabs / new / reopen / collapse) + xterm stage. */
export function TerminalPanel({
  ctx, api, onClose, t,
}: PanelProps): JSX.Element {
  // This panel is rendered via createRoot (not a slot outlet), so it must
  // explicitly subscribe to locale revision to re-render on language switch.
  useSyncExternalStore(
    (cb: () => void) => ctx.locale.subscribe(cb),
    () => ctx.locale.getSnapshot().revision,
  )

  const [tabs, setTabs] = useState<readonly Tab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [shells, setShells] = useState<readonly ShellInfo[] | null>(null)
  const [selectedShell, setSelectedShell] = useState<ShellType>('bash')
  const [detachedSessions, setDetachedSessions] = useState<readonly TermSessionInfo[]>([])
  const [showReopen, setShowReopen] = useState(false)
  const [reopenLeft, setReopenLeft] = useState(6)
  const [floatBtn, setFloatBtn] = useState<FloatBtn | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const floatBtnRef = useRef<HTMLButtonElement | null>(null)

  // xterm needs its core stylesheet; inject once when the panel mounts.
  useEffect(() => { adoptXtermStyles() }, [])

  // Detect available shells on mount; default to the first available.
  useEffect(() => {
    let cancelled = false
    void api.shells().then((result) => {
      if (cancelled) return
      const list = result.shells
      setShells(list)
      if (list.length > 0) {
        const isWin = navigator.userAgent.includes('Windows')
        const preferred: ShellType = isWin ? 'powershell' : 'zsh'
        const initial = list.some((s) => s.id === preferred)
          ? preferred
          : list[0].id
        setSelectedShell(initial)
      }
    }).catch(() => {
      if (!cancelled) setShells(FALLBACK_SHELLS.map((id) => ({ id, labelKey: `ui.shell.${id}` })))
    })
    return () => { cancelled = true }
  }, [api])

  // Keep every open tab's xterm theme in lockstep with the shell dark marker
  // (the shell toggles body[data-ds-dark-theme] — CSS only can't reach xterm).
  useEffect(() => {
    const applyTheme = (): void => {
      const theme = themeOf()
      for (const tab of tabsRef.current) tab.term.options.theme = theme
    }
    applyTheme()
    const obs = new MutationObserver(applyTheme)
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => obs.disconnect()
  }, [])

  // One global stream subscription; route frames to the right tab by id.
  useEffect(() => {
    const off = api.subscribe((event: TermEvent) => {
      if (event.kind === 'output') {
        const tab = tabsRef.current.find((tb) => tb.sessionId === event.id)
        tab?.term.write(event.data)
        return
      }
      if (event.kind === 'exit') {
        const tab = tabsRef.current.find((tb) => tb.sessionId === event.id)
        if (tab !== undefined) tab.term.write(`\r\n${event.message ?? `\r\n[dsh-term] Process exited (code ${event.exitCode})`}\r\n`)
        setDetachedSessions((prev) => prev.filter((s) => s.id !== event.id))
        return
      }
      if (event.kind === 'detached') {
        // The host marked a session as detached; update our list.
        // The closeTab caller already updates local state; this is a no-op
        // for the tab that initiated the detach, but catches external detaches.
        return
      }
      if (event.kind === 'reattached') {
        setDetachedSessions((prev) => prev.filter((s) => s.id !== event.session.id))
        return
      }
    })
    return off
  }, [api])

  /** Create a tab: xterm instance + host spawn, then attach output routing. */
  const openTab = useCallback(async (shell?: ShellType): Promise<void> => {
    if (stageRef.current === null) return
    const wrap = document.createElement('div')
    wrap.className = css.termWrap
    stageRef.current.appendChild(wrap)
    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      cursorBlink: true,
      theme: themeOf(),
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(wrap)
    try {
      fit.fit()
    } catch {
      // Not yet in the DOM layout; the first resize below will fit it.
    }
    // Route typed input straight to the host.
    term.onData((data) => {
      const tab = tabsRef.current.find((tb) => tb.term === term)
      if (tab !== undefined) void api.write(tab.sessionId, data)
    })

    let session: TermSessionInfo
    try {
      session = await api.spawn({
        shell: shell ?? selectedShell,
        cwd: currentCwd(ctx) || undefined,
        cols: term.cols,
        rows: term.rows,
      })
    } catch (error) {
      term.write(`\r\n${t('msg.spawnFailed', { 0: String(error) })}\r\n`)
      return
    }
    const tab: Tab = { sessionId: session.id, title: session.title, term, fit, wrap }
    setTabs((prev) => [...prev, tab])
    setActive(session.id)
    // Sync the first real size back to the PTY (fit() before open may be off).
    void api.resize(session.id, term.cols, term.rows)
    term.focus()
  }, [api, ctx, selectedShell, t])

  /** Reattach to a detached session: create a fresh xterm and wire it up. */
  const reopenTab = useCallback(async (sessionId: string): Promise<void> => {
    if (stageRef.current === null) return
    let session: TermSessionInfo
    try {
      session = await api.reattach(sessionId)
    } catch {
      return
    }
    const wrap = document.createElement('div')
    wrap.className = css.termWrap
    stageRef.current.appendChild(wrap)
    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      cursorBlink: true,
      theme: themeOf(),
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(wrap)
    try { fit.fit() } catch { /* deferred */ }
    term.onData((data) => {
      const tab = tabsRef.current.find((tb) => tb.term === term)
      if (tab !== undefined) void api.write(tab.sessionId, data)
    })
    const tab: Tab = { sessionId: session.id, title: session.title, term, fit, wrap }
    setTabs((prev) => [...prev, tab])
    setActive(session.id)
    void api.resize(session.id, term.cols, term.rows)
    setShowReopen(false)
    term.focus()
  }, [api])

  // First tab on mount (wait until shells are detected so we use the right one).
  useEffect(() => {
    if (tabs.length === 0 && shells !== null) void openTab()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shells])

  // Refit the active tab whenever the stage gets a size (window resize, tab
  // switch, or the docked column being shown after a collapse). A hidden
  // column reports 0 size, so fit is deferred until it becomes visible.
  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const refit = (): void => {
      const tab = tabsRef.current.find((tb) => tb.sessionId === active)
      if (tab === undefined) return
      try {
        tab.fit.fit()
        void api.resize(tab.sessionId, tab.term.cols, tab.term.rows)
      } catch {
        // Measurement race on first paint; the next resize retry handles it.
      }
    }
    const observer = new ResizeObserver(refit)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [active, api])

  // Apply the active marker on the DOM wrappers (display toggling).
  useEffect(() => {
    for (const tab of tabsRef.current) {
      tab.wrap.classList.toggle(css.termWrapActive, tab.sessionId === active)
    }
    if (active !== null) {
      const tab = tabsRef.current.find((tb) => tb.sessionId === active)
      if (tab !== undefined) {
        try {
          tab.fit.fit()
          void api.resize(tab.sessionId, tab.term.cols, tab.term.rows)
        } catch {
          // Ignore measurement races on first paint.
        }
        tab.term.focus()
      }
    }
  }, [active, api, tabs])

  /** Close a tab: detach the PTY (keep it alive) and dispose the xterm locally. */
  const closeTab = (sessionId: string): void => {
    const tab = tabsRef.current.find((tb) => tb.sessionId === sessionId)
    if (tab !== undefined) {
      void api.detach(sessionId)
      tab.term.dispose()
      tab.wrap.remove()
    }
    const next = tabsRef.current.filter((tb) => tb.sessionId !== sessionId)
    setTabs(next)
    if (active === sessionId) setActive(next[0]?.sessionId ?? null)
    // Track the detached session for the reopen dropdown.
    setDetachedSessions((prev) => {
      if (prev.some((s) => s.id === sessionId)) return prev
      const tab2 = tabsRef.current.find((tb) => tb.sessionId === sessionId)
      if (tab2 === undefined) return prev
      return [...prev, { id: sessionId, title: tab2.title, cwd: '', cols: 80, rows: 24, alive: true, exitCode: null, shell: 'bash', detached: true }]
    })
  }

  /** Kill a detached session permanently (remove from background list). */
  const killDetached = (sessionId: string): void => {
    void api.close(sessionId)
    setDetachedSessions((prev) => prev.filter((s) => s.id !== sessionId))
  }

  // Panel teardown: kill every host session and dispose the xterm instances.
  useEffect(() => {
    const current = tabsRef.current
    return () => {
      for (const tab of current) {
        void api.close(tab.sessionId)
        tab.term.dispose()
        tab.wrap.remove()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Selection → floating "Add to chat" button. xterm renders to canvas so
  // there is no DOM selection; we read term.getSelection() on mouseup inside
  // the terminal body and position the button at the pointer.
  useEffect(() => {
    const stage = stageRef.current
    const panel = panelRef.current
    if (stage === null || panel === null) return

    const onMouseUp = (e: MouseEvent): void => {
      if (floatBtnRef.current !== null && floatBtnRef.current.contains(e.target as Node)) return
      requestAnimationFrame(() => {
        const tab = tabsRef.current.find((tb) => tb.sessionId === active)
        const sel = tab?.term.getSelection() ?? ''
        if (!sel.trim()) {
          setFloatBtn(null)
          return
        }
        const panelRect = panel.getBoundingClientRect()
        const top = Math.max(e.clientY - panelRect.top, 44)
        const left = Math.min(
          Math.max(e.clientX - panelRect.left, 70),
          panelRect.width - 70,
        )
        setFloatBtn({ top, left, content: sel })
      })
    }

    const onDocMouseDown = (e: MouseEvent): void => {
      if (floatBtnRef.current !== null && floatBtnRef.current.contains(e.target as Node)) return
      setFloatBtn(null)
    }

    stage.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onDocMouseDown)
    return () => {
      stage.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onDocMouseDown)
    }
  }, [active])

  // Hide the float button when the selection is cleared by xterm.
  useEffect(() => {
    const tab = tabs.find((tb) => tb.sessionId === active)
    if (tab === undefined) return
    const d = tab.term.onSelectionChange(() => {
      if (!tab.term.hasSelection()) setFloatBtn(null)
    })
    return () => d.dispose()
  }, [active, tabs])

  // Close the reopen dropdown on outside click.
  useEffect(() => {
    if (!showReopen) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest(`[data-reopen-dropdown]`) !== null) return
      if (target.closest(`[data-reopen-btn]`) !== null) return
      setShowReopen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showReopen])

  const shellOptions = shells ?? FALLBACK_SHELLS.map((id) => ({ id, labelKey: `ui.shell.${id}` }))

  return (
    <div className={css.col} data-dsh-term="" ref={panelRef}>
      <div className={css.toolbar}>
        <span className={css.title}>{t('ui.panel.title')}</span>
        <span className={css.tabDivider} />
        <select
          className={css.shellSelect}
          value={selectedShell}
          onChange={(e) => {
            const next = e.target.value as ShellType
            if (next === selectedShell) return
            setSelectedShell(next)
            if (active !== null) closeTab(active)
            void openTab(next)
          }}
          title={t('ui.panel.shellTitle')}
          disabled={shells === null}
        >
          {shellOptions.map((s) => (
            <option key={s.id} value={s.id}>{t(s.labelKey as 'ui.shell.bash')}</option>
          ))}
        </select>
        <span className={css.tabDivider} />
        {tabs.map((tab) => (
          <button
            key={tab.sessionId}
            type="button"
            className={`${css.tab}${tab.sessionId === active ? ` ${css.tabActive}` : ''}`}
            onClick={() => setActive(tab.sessionId)}
            title={tab.title}
          >
            <span>{tab.title}</span>
            <span
              role="button"
              aria-label={t('ui.tab.closeAria', { 0: tab.title })}
              className={css.tabClose}
              onClick={(event) => {
                event.stopPropagation()
                closeTab(tab.sessionId)
              }}
            >
              ×
            </span>
          </button>
        ))}
        <button type="button" className={css.addTab} title={t('ui.panel.addTabTitle')} onClick={() => void openTab()}>+</button>
        {detachedSessions.length > 0 && (
          <button
            type="button"
            data-reopen-btn=""
            className={css.reopenBtn}
            title={t('ui.panel.reopenTitle')}
            onClick={(e) => {
              setReopenLeft(e.currentTarget.offsetLeft)
              setShowReopen((v) => !v)
            }}
          >
            ↻{detachedSessions.length}
          </button>
        )}
        {showReopen && detachedSessions.length > 0 && (
          <div data-reopen-dropdown="" className={css.reopenDropdown} style={{ left: reopenLeft }}>
            <div className={css.reopenHeader}>{t('ui.panel.backgroundSessions')}</div>
            {detachedSessions.map((s) => (
              <div key={s.id} className={css.reopenItem}>
                <button
                  type="button"
                  className={css.reopenItemBtn}
                  onClick={() => void reopenTab(s.id)}
                >
                  <span>{s.title}</span>
                </button>
                <button
                  type="button"
                  className={css.reopenItemKill}
                  title="×"
                  onClick={() => killDetached(s.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <span className={css.spacer} />
        <button type="button" className={css.collapse} title={t('ui.panel.collapseTitle')} onClick={onClose}>—</button>
      </div>
      <div className={css.stage} ref={stageRef}>
        {tabs.length === 0 && <div className={css.emptyHint}>{t('ui.panel.emptyHint')}</div>}
      </div>
      {floatBtn !== null && (
        <button
          ref={floatBtnRef}
          className={css.addToChatBtn}
          style={{ top: floatBtn.top, left: floatBtn.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            appendToConversationDraft(ctx, floatBtn.content.replace(/\s+$/, ''))
            setFloatBtn(null)
            const tab = tabsRef.current.find((tb) => tb.sessionId === active)
            tab?.term.clearSelection()
          }}
          title={t('ui.panel.addToChat')}
        >
          {t('ui.panel.addToChat')}
        </button>
      )}
    </div>
  )
}
