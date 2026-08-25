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
import type { ShellInfo, ShellType, TermSessionInfo, TermSpawnRequest } from '../core/types.ts';
/** Default shell kind for the platform. */
export declare function defaultShellType(): ShellType;
/**
 * The PTY registry. Every mutation goes through this class so the route
 * layer stays a thin HTTP shape (the file-manager pattern). Output/exit
 * callbacks are assignable so the SSE layer can bind them after construction.
 */
export declare class PtyService {
    private readonly sessions;
    /** Cached available shells (computed once on first query). */
    private availableShellsCache;
    /** Fired with raw PTY output chunks (UTF-8). Bound by the route layer. */
    onOutput: (sessionId: string, data: string) => void;
    /** Fired once when a session exits. Bound by the route layer. */
    onExit: (sessionId: string, exitCode: number) => void;
    /** Fired when a session is detached (tab closed, PTY kept alive). */
    onDetach: (sessionId: string) => void;
    /** Fired when a session is reattached. */
    onReattach: (session: TermSessionInfo) => void;
    /**
     * Returns the shells actually available on this machine, so the browser
     * can hide options the user never installed (Git Bash) instead of letting
     * node-pty fail at spawn time. Results are cached after the first async
     * detection to avoid repeated `where` calls.
     */
    detectShells(): Promise<readonly ShellInfo[]>;
    /** Open one session; returns the wire info immediately (output streams async). */
    spawn(req: TermSpawnRequest): TermSessionInfo;
    /** Write raw bytes (UTF-8) into a session. Returns false when unknown. */
    write(id: string, data: string): boolean;
    /** Resize a session. Returns false when unknown. */
    resize(id: string, cols: number, rows: number): boolean;
    /** Deliver a signal (SIGINT/SIGHUP/SIGTERM/SIGKILL). Returns false when unknown. */
    signal(id: string, signal: string): boolean;
    /**
     * Detach a session: mark it as detached but keep the PTY process alive.
     * This lets the user close a tab without losing a running command (e.g.
     * `npm install`); reopening re-attaches to the same session.
     */
    detach(id: string): boolean;
    /**
     * Reattach to a detached session: mark it as attached and return the info.
     * The caller creates a fresh xterm and starts routing SSE output to it.
     */
    reattach(id: string): TermSessionInfo | null;
    /** Close a session forcefully (kill the PTY). Returns false when unknown. */
    close(id: string): boolean;
    /** The full session listing snapshot (including detached sessions). */
    list(): readonly TermSessionInfo[];
    /** Only the detached sessions (for the "reopen" dropdown). */
    detachedList(): readonly TermSessionInfo[];
    /** Close every session (route teardown). */
    dispose(): void;
}
//# sourceMappingURL=pty-service.d.ts.map