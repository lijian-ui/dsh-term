/**
 * Wire types shared between the host half and the browser half of dsh-term.
 * Pure data — no runtime imports (keeps the client bundle purity gate happy).
 * @module dsh-term/core/types
 */

/** One live PTY session as the browser knows it. */
export interface TermSessionInfo {
  /** Stable session id (the wire handle). */
  readonly id: string
  /** User-facing tab title (defaults to the shell name). */
  readonly title: string
  /** Session cwd (absolute). */
  readonly cwd: string
  /** PTY size at last resize. */
  cols: number
  rows: number
  /** Whether the shell process is still alive. */
  readonly alive: boolean
  /** POSIX exit code when the session ended (null while alive). */
  readonly exitCode: number | null
}

/** Request: open a new PTY session. */
export interface TermSpawnRequest {
  /** Optional session display name. */
  name?: string
  /** Working directory (defaults to the session's workspace cwd). */
  cwd?: string
  /** Shell executable (defaults to the platform shell). */
  shell?: string
  /** Shell arguments (defaults to an interactive login-less profile). */
  args?: string[]
  /** Initial terminal size. */
  cols?: number
  rows?: number
}

/** Request: deliver terminal input. */
export interface TermWriteRequest {
  readonly id: string
  /** Raw bytes to write into the PTY (UTF-8 string; xterm emits UTF-8). */
  readonly data: string
}

/** Request: resize one session. */
export interface TermResizeRequest {
  readonly id: string
  readonly cols: number
  readonly rows: number
}

/** Request: signal one session. */
export interface TermSignalRequest {
  readonly id: string
  /** PTY signal name (e.g. `SIGHUP`, `SIGINT`, `SIGTERM`, `SIGKILL`). */
  readonly signal: 'SIGHUP' | 'SIGINT' | 'SIGTERM' | 'SIGKILL'
}

/** The full session listing snapshot. */
export interface TermListResponse {
  readonly sessions: readonly TermSessionInfo[]
}

/** One output chunk pushed over the SSE change stream. */
export type TermEvent =
  | { readonly kind: 'output'; readonly id: string; readonly data: string }
  | { readonly kind: 'exit'; readonly id: string; readonly exitCode: number }
  | { readonly kind: 'start'; readonly session: TermSessionInfo }
  | { readonly kind: 'closed'; readonly id: string }

/** The workspace-gated session id (host-minted; the wire carries only this). */
export type TermSessionId = string
