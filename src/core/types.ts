/**
 * Wire types shared between the host half and the browser half of dsh-term.
 * Pure data — no runtime imports (keeps the client bundle purity gate happy).
 * @module dsh-term/core/types
 */

/** Shell kinds the user can pick from in the panel dropdown. */
export type ShellType = 'bash' | 'zsh' | 'powershell' | 'cmd' | 'gitbash'

/** One shell option surfaced to the browser (id + display label key). */
export interface ShellInfo {
  readonly id: ShellType
  /** i18n key suffix, e.g. 'bash' → t('ui.shell.bash'). */
  readonly labelKey: string
}

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
  /** Shell kind this session was spawned with. */
  readonly shell: ShellType
  /** Whether the session is detached (tab closed but PTY still running). */
  readonly detached: boolean
}

/** Request: open a new PTY session. */
export interface TermSpawnRequest {
  /** Optional session display name. */
  name?: string
  /** Working directory (defaults to the session's workspace cwd, fallback homedir). */
  cwd?: string
  /** Shell kind (defaults to the platform default). */
  shell?: ShellType
  /** Shell arguments (defaults to an interactive login-less profile). */
  args?: string[]
  /** Initial terminal size. */
  cols?: number
  rows?: number
  /** Extra environment variables merged into the PTY env. */
  env?: Record<string, string>
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
  | { readonly kind: 'exit'; readonly id: string; readonly exitCode: number; readonly message?: string }
  | { readonly kind: 'start'; readonly session: TermSessionInfo }
  | { readonly kind: 'closed'; readonly id: string }
  | { readonly kind: 'detached'; readonly id: string }
  | { readonly kind: 'reattached'; readonly session: TermSessionInfo }

/** The workspace-gated session id (host-minted; the wire carries only this). */
export type TermSessionId = string
