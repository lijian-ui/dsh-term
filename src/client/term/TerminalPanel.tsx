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
 * A-version scope: pure user terminal. No agent integration, no SSH targets
 * yet — those are the B-version.
 * @module dsh-term/client/term/TerminalPanel
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TermEvent, TermSessionInfo } from '../../core/types.ts'
import type { TermApi } from './api.ts'
import { XTERM_CSS } from './xterm-styles.ts'
import css from './term.module.css'

/** One open tab: the wire info plus its live xterm handles. */
interface Tab {
  readonly sessionId: string
  readonly title: string
  readonly term: Terminal
  readonly fit: FitAddon
  readonly wrap: HTMLDivElement
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
      background: '#0e0e0e',
      foreground: '#ced3da',
      cursor: '#ced3da',
      selectionBackground: 'rgba(255,255,255,0.2)',
    }
  }
  return {
    background: '#ffffff',
    foreground: '#1f2329',
    cursor: '#1f2329',
    selectionBackground: 'rgba(22,93,255,0.25)',
    black: '#1f2329',
    red: '#d4393b',
    green: '#167c2e',
    yellow: '#b58900',
    blue: '#0a4d8c',
    magenta: '#a020a0',
    cyan: '#0379a6',
    white: '#5a5f66',
    brightBlack: '#6a6f76',
    brightRed: '#e5585a',
    brightGreen: '#1a9c3a',
    brightYellow: '#d6a200',
    brightBlue: '#1a6fcf',
    brightMagenta: '#c040c0',
    brightCyan: '#1aa0d6',
    brightWhite: '#2f353b',
  }
}

/** Current workspace cwd from the session list ('' when none). */
function currentCwd(ctx: ClientContext): string {
  const snapshot = ctx.sessions.list.getSnapshot()
  const sessionId = snapshot.current as SessionId | undefined
  const cwd = sessionId === undefined ? undefined : snapshot.byId[sessionId]?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : ''
}

/** The docked panel: header (title / tabs / new / collapse) + xterm stage. */
export function TerminalPanel({
  ctx, api, onClose,
}: { ctx: ClientContext; api: TermApi; onClose: () => void }): JSX.Element {
  const [tabs, setTabs] = useState<readonly Tab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  // xterm needs its core stylesheet; inject once when the panel mounts.
  useEffect(() => { adoptXtermStyles() }, [])

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
        const tab = tabsRef.current.find((t) => t.sessionId === event.id)
        tab?.term.write(event.data)
        return
      }
      if (event.kind === 'exit') {
        const tab = tabsRef.current.find((t) => t.sessionId === event.id)
        if (tab !== undefined) tab.term.write(`\r\n[dsh-term] 进程已退出（code ${event.exitCode}）\r\n`)
      }
    })
    return off
  }, [api])

  /** Create a tab: xterm instance + host spawn, then attach output routing. */
  const openTab = useCallback(async (): Promise<void> => {
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
      const tab = tabsRef.current.find((t) => t.term === term)
      if (tab !== undefined) void api.write(tab.sessionId, data)
    })

    let session: TermSessionInfo
    try {
      session = await api.spawn({
        cwd: currentCwd(ctx) || undefined,
        cols: term.cols,
        rows: term.rows,
      })
    } catch (error) {
      term.write(`\r\n[dsh-term] 启动失败: ${String(error)}\r\n`)
      return
    }
    const tab: Tab = { sessionId: session.id, title: session.title, term, fit, wrap }
    setTabs((prev) => [...prev, tab])
    setActive(session.id)
    // Sync the first real size back to the PTY (fit() before open may be off).
    void api.resize(session.id, term.cols, term.rows)
    term.focus()
  }, [api, ctx])

  // First tab on mount.
  useEffect(() => {
    if (tabs.length === 0) void openTab()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refit the active tab whenever the stage gets a size (window resize, tab
  // switch, or the docked column being shown after a collapse). A hidden
  // column reports 0 size, so fit is deferred until it becomes visible.
  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const refit = (): void => {
      const tab = tabsRef.current.find((t) => t.sessionId === active)
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
      const tab = tabsRef.current.find((t) => t.sessionId === active)
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

  const closeTab = (sessionId: string): void => {
    const tab = tabsRef.current.find((t) => t.sessionId === sessionId)
    if (tab !== undefined) {
      void api.close(sessionId)
      tab.term.dispose()
      tab.wrap.remove()
    }
    const next = tabsRef.current.filter((t) => t.sessionId !== sessionId)
    setTabs(next)
    if (active === sessionId) setActive(next[0]?.sessionId ?? null)
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

  return (
    <div className={css.col} data-dsh-term="">
      <div className={css.toolbar}>
        <span className={css.title}>终端</span>
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
              aria-label={`关闭 ${tab.title}`}
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
        <button type="button" className={css.addTab} title="新建终端" onClick={() => void openTab()}>+</button>
        <span className={css.spacer} />
        <button type="button" className={css.collapse} title="收起" onClick={onClose}>—</button>
      </div>
      <div className={css.stage} ref={stageRef}>
        {tabs.length === 0 && <div className={css.emptyHint}>点击 + 新建终端</div>}
      </div>
    </div>
  )
}
