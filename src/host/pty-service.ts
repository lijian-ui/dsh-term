/**
 * PTY session service for dsh-term: a framework-free registry over node-pty.
 *
 * A "pure user terminal" (A-version) needs no dsh agent ownership — every
 * session is a plain node-pty child process keyed by a host-minted id, with
 * byte streams bridged to the browser over the /dsh-term/* HTTP layer. This
 * deliberately does NOT use the official @deepseek-ai/dsh-terminal service:
 * that registry requires an exact `Agent` owner (model-facing semantics) and
 * its resolution path from a user-initiated web route is unverified; node-pty
 * is already present in the desktop tree (ABI-matched, verified loadable) and
 * gives full control over multi-tab local shells.
 * @module dsh-term/host/pty-service
 */

import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { exec } from 'node:child_process'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import * as nodePty from 'node-pty'
import type { ShellInfo, ShellType, TermSessionInfo, TermSpawnRequest } from '../core/types.ts'

/** Live session plus its pty handle (service-private). */
interface LiveSession {
  readonly info: TermSessionInfo
  readonly pty: nodePty.IPty
}

const IS_WIN = process.platform === 'win32'

/** Windows-only Git Bash locations. */
const GIT_BASH_CANDIDATES_WIN = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
]

/** macOS / Linux stock shells (always present on a normal desktop install). */
const UNIX_SHELL_PATHS: Record<'zsh' | 'bash', string> = {
  zsh: '/bin/zsh',
  bash: '/bin/bash',
}

/** All shell kinds in display order. */
const ALL_SHELLS: readonly ShellType[] = ['zsh', 'bash', 'gitbash', 'powershell', 'cmd']

/** True if `name` resolves on PATH. Uses `where` on Windows, `command -v` on Unix. */
function commandExistsAsync(name: string): Promise<boolean> {
  const probe = IS_WIN ? `where ${name}` : `command -v ${name}`
  return new Promise((r) => {
    exec(probe, { windowsHide: true, timeout: 5000 }, (err) => { r(!err) })
  })
}

/** Git Bash is only relevant on Windows (probed via launcher / bash / git). */
async function hasGitBash(): Promise<boolean> {
  if (!IS_WIN) return false
  if (await commandExistsAsync('git-bash.exe')) return true
  if (
    (await commandExistsAsync('bash.exe')) &&
    ((await commandExistsAsync('git.exe')) ||
      GIT_BASH_CANDIDATES_WIN.some((p) => existsSync(p)))
  ) {
    return true
  }
  return GIT_BASH_CANDIDATES_WIN.some((p) => existsSync(p))
}

/** Map a ShellType to { command, args } for node-pty.spawn. */
function resolveShell(shell: ShellType): { command: string; args: string[] } {
  switch (shell) {
    case 'powershell':
      return { command: 'powershell.exe', args: ['-NoLogo'] }
    case 'cmd':
      return { command: 'cmd.exe', args: [] }
    case 'bash':
      return { command: IS_WIN ? 'bash.exe' : UNIX_SHELL_PATHS.bash, args: ['--login', '-i'] }
    case 'zsh':
      return { command: UNIX_SHELL_PATHS.zsh, args: ['-l', '-i'] }
    case 'gitbash':
    default: {
      if (IS_WIN) {
        for (const c of GIT_BASH_CANDIDATES_WIN) {
          if (existsSync(c)) return { command: c, args: ['--login', '-i'] }
        }
        return { command: 'bash', args: ['--login', '-i'] }
      }
      return { command: UNIX_SHELL_PATHS.bash, args: ['--login', '-i'] }
    }
  }
}

/** Default shell kind for the platform. */
export function defaultShellType(): ShellType {
  if (IS_WIN) return 'powershell'
  return existsSync(UNIX_SHELL_PATHS.zsh) ? 'zsh' : 'bash'
}

/**
 * Resolve a spawn cwd that is guaranteed to be an existing directory.
 * node-pty fails at spawn time (macOS: "posix_spawnp failed") if the cwd
 * does not exist — which happens on a cross-platform machine when a stale
 * Windows-style workspace path is still in the store, or when the renderer
 * sends an empty/null cwd. Fall back to $HOME so the PTY always spawns.
 */
function resolveCwd(cwd?: string): string {
  const candidate = cwd && cwd.trim().length > 0 ? cwd.trim() : process.cwd()
  try {
    const abs = resolve(candidate)
    if (existsSync(abs) && statSync(abs).isDirectory()) return abs
  } catch { /* fall through to home */ }
  return homedir()
}

/**
 * The PTY registry. Every mutation goes through this class so the route
 * layer stays a thin HTTP shape (the file-manager pattern). Output/exit
 * callbacks are assignable so the SSE layer can bind them after construction.
 */
export class PtyService {
  private readonly sessions = new Map<string, LiveSession>()
  /** Cached available shells (computed once on first query). */
  private availableShellsCache: readonly ShellInfo[] | null = null

  /** Fired with raw PTY output chunks (UTF-8). Bound by the route layer. */
  onOutput: (sessionId: string, data: string) => void = () => {}
  /** Fired once when a session exits. Bound by the route layer. */
  onExit: (sessionId: string, exitCode: number) => void = () => {}
  /** Fired when a session is detached (tab closed, PTY kept alive). */
  onDetach: (sessionId: string) => void = () => {}
  /** Fired when a session is reattached. */
  onReattach: (session: TermSessionInfo) => void = () => {}

  /**
   * Returns the shells actually available on this machine, so the browser
   * can hide options the user never installed (Git Bash) instead of letting
   * node-pty fail at spawn time. Results are cached after the first async
   * detection to avoid repeated `where` calls.
   */
  async detectShells(): Promise<readonly ShellInfo[]> {
    if (this.availableShellsCache !== null) return this.availableShellsCache
    const available: ShellType[] = []
    if (await hasGitBash()) available.push('gitbash')
    if (IS_WIN) {
      if (await commandExistsAsync('powershell.exe') || await commandExistsAsync('pwsh.exe')) available.push('powershell')
      if (await commandExistsAsync('cmd.exe')) available.push('cmd')
    } else {
      if (existsSync(UNIX_SHELL_PATHS.zsh)) available.push('zsh')
      if (existsSync(UNIX_SHELL_PATHS.bash)) available.push('bash')
    }
    this.availableShellsCache = available.map((id) => ({ id, labelKey: `ui.shell.${id}` }))
    return this.availableShellsCache
  }

  /** Open one session; returns the wire info immediately (output streams async). */
  spawn(req: TermSpawnRequest): TermSessionInfo {
    const id = randomUUID()
    const shellType: ShellType = req.shell ?? defaultShellType()
    const { command, args } = resolveShell(shellType)
    const finalArgs = req.args ?? args
    const cols = req.cols ?? 80
    const rows = req.rows ?? 24
    const cwd = resolveCwd(req.cwd)
    const env = { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1', ...(req.env ?? {}) }
    const pty = nodePty.spawn(command, finalArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    })
    const info: TermSessionInfo = {
      id,
      title: req.name ?? shellType,
      cwd,
      cols,
      rows,
      alive: true,
      exitCode: null,
      shell: shellType,
      detached: false,
    }
    this.sessions.set(id, { info, pty })
    pty.onData((data) => { this.onOutput(id, data) })
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.onExit(id, exitCode)
    })
    return info
  }

  /** Write raw bytes (UTF-8) into a session. Returns false when unknown. */
  write(id: string, data: string): boolean {
    const live = this.sessions.get(id)
    if (live === undefined) return false
    try { live.pty.write(data) } catch { return false }
    return true
  }

  /** Resize a session. Returns false when unknown. */
  resize(id: string, cols: number, rows: number): boolean {
    const live = this.sessions.get(id)
    if (live === undefined) return false
    try {
      live.pty.resize(Math.max(2, cols), Math.max(2, rows))
      live.info.cols = cols
      live.info.rows = rows
    } catch { return false }
    return true
  }

  /** Deliver a signal (SIGINT/SIGHUP/SIGTERM/SIGKILL). Returns false when unknown. */
  signal(id: string, signal: string): boolean {
    const live = this.sessions.get(id)
    if (live === undefined) return false
    try { live.pty.kill(signal as Parameters<typeof live.pty.kill>[0]) } catch { return false }
    return true
  }

  /**
   * Detach a session: mark it as detached but keep the PTY process alive.
   * This lets the user close a tab without losing a running command (e.g.
   * `npm install`); reopening re-attaches to the same session.
   */
  detach(id: string): boolean {
    const live = this.sessions.get(id)
    if (live === undefined) return false
    const newInfo: TermSessionInfo = { ...live.info, detached: true }
    this.sessions.set(id, { info: newInfo, pty: live.pty })
    this.onDetach(id)
    return true
  }

  /**
   * Reattach to a detached session: mark it as attached and return the info.
   * The caller creates a fresh xterm and starts routing SSE output to it.
   */
  reattach(id: string): TermSessionInfo | null {
    const live = this.sessions.get(id)
    if (live === undefined) return null
    const newInfo: TermSessionInfo = { ...live.info, detached: false }
    this.sessions.set(id, { info: newInfo, pty: live.pty })
    this.onReattach(newInfo)
    return newInfo
  }

  /** Close a session forcefully (kill the PTY). Returns false when unknown. */
  close(id: string): boolean {
    const live = this.sessions.get(id)
    if (live === undefined) return false
    try { live.pty.kill() } catch { /* already dead */ }
    this.sessions.delete(id)
    return true
  }

  /** The full session listing snapshot (including detached sessions). */
  list(): readonly TermSessionInfo[] {
    return [...this.sessions.values()].map(({ info }) => ({ ...info }))
  }

  /** Only the detached sessions (for the "reopen" dropdown). */
  detachedList(): readonly TermSessionInfo[] {
    return [...this.sessions.values()]
      .filter(({ info }) => info.detached)
      .map(({ info }) => ({ ...info }))
  }

  /** Close every session (route teardown). */
  dispose(): void {
    for (const live of this.sessions.values()) {
      try { live.pty.kill() } catch { /* ignore */ }
    }
    this.sessions.clear()
  }
}
