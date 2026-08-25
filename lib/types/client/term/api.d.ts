/**
 * Browser-half bridge to the /dsh-term/* host routes: fetch envelope calls
 * plus one EventSource for the output/exit stream. Thin and stateless — the
 * panel owns all session state.
 * @module dsh-term/client/term/api
 */
import type { ShellInfo, TermEvent, TermSessionInfo, TermSpawnRequest } from '../../core/types.ts';
/** The stateless client bridge. */
export declare class TermApi {
    /** Open a session; returns the wire info. */
    spawn(request: TermSpawnRequest): Promise<TermSessionInfo>;
    /** Deliver terminal input. */
    write(id: string, data: string): Promise<{
        ok: boolean;
    }>;
    /** Resize one session. */
    resize(id: string, cols: number, rows: number): Promise<{
        ok: boolean;
    }>;
    /** Close one session (kill the PTY). */
    close(id: string): Promise<{
        ok: boolean;
    }>;
    /** Detach a session (keep the PTY alive, mark as detached). */
    detach(id: string): Promise<{
        ok: boolean;
    }>;
    /** Reattach to a detached session; returns the wire info. */
    reattach(id: string): Promise<TermSessionInfo>;
    /** List available shells on the host. */
    shells(): Promise<{
        shells: readonly ShellInfo[];
    }>;
    /** Current session listing (used on reconnect). */
    list(): Promise<{
        sessions: readonly TermSessionInfo[];
    }>;
    /**
     * Subscribe to the output/exit stream. Returns the unsubscribe.
     * @param onEvent - receives every pushed event.
     */
    subscribe(onEvent: (event: TermEvent) => void): () => void;
}
//# sourceMappingURL=api.d.ts.map