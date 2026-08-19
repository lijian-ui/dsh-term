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
import * as nodePty from 'node-pty'
import type { TermSessionInfo, TermSpawnRequest } from '../core/types.ts'

/** Live session plus its pty handle (service-private). */
interface LiveSession {
  readonly info: TermSessionInfo
  readonly pty: nodePty.IPty
}

/** Default interactive shell for the platform. */
export function defaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL ?? '/bin/bash'
}

/** Default args for an interactive login-less shell. */
export function defaultArgs(shell: string): string[] {
  if (process.platform === 'win32') return []
  const base = shell.endsWith('bash') ? ['--noprofile', '--norc', '-i'] : ['-i']
  return base
}

/**
 * The PTY registry. Every mutation goes through this class so the route
 * layer stays a thin HTTP shape (the file-manager pattern). Output/exit
 * callbacks are assignable so the SSE layer can bind them after construction.
 */
export class PtyService {
  private readonly sessions = new Map<string, LiveSession>()

  /** Fired with raw PTY output chunks (UTF-8). Bound by the route layer. */
  onOutput: (sessionId: string, data: string) => void = () => {}
  /** Fired once when a session exits. Bound by the route layer. */
  onExit: (sessionId: string, exitCode: number) => void = () => {}

  /** Open one session; returns the wire info immediately (output streams async). */
  spawn(req: TermSpawnRequest): TermSessionInfo {
    const id = randomUUID()
    const shell = req.shell ?? defaultShell()
    const args = req.args ?? defaultArgs(shell)
    const cols = req.cols ?? 80
    const rows = req.rows ?? 24
    const cwd = req.cwd ?? process.cwd()
    const pty = nodePty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
    })
    const info: TermSessionInfo = {
      id,
      title: req.name ?? shell,
      cwd,
      cols,
      rows,
      alive: true,
      exitCode: null,
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

  /** Close a session forcefully (SIGHUP semantics via kill). Returns false when unknown. */
  close(id: string): boolean {
    const live = this.sessions.get(id)
    if (live === undefined) return false
    try { live.pty.kill() } catch { /* already dead */ }
    return true
  }

  /** The full session listing snapshot. */
  list(): readonly TermSessionInfo[] {
    return [...this.sessions.values()].map(({ info }) => ({ ...info }))
  }

  /** Close every session (route teardown). */
  dispose(): void {
    for (const live of this.sessions.values()) {
      try { live.pty.kill() } catch { /* ignore */ }
    }
    this.sessions.clear()
  }
}
