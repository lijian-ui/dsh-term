/**
 * Browser-half bridge to the /dsh-term/* host routes: fetch envelope calls
 * plus one EventSource for the output/exit stream. Thin and stateless — the
 * panel owns all session state.
 * @module dsh-term/client/term/api
 */

import type { TermEvent, TermSessionInfo, TermSpawnRequest } from '../../core/types.ts'

/** Envelope mirror of the host route layer. */
type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const envelope = await response.json() as Envelope<T>
  if (!envelope.ok) throw new Error(envelope.error.message)
  return envelope.value
}

/** The stateless client bridge. */
export class TermApi {
  /** Open a session; returns the wire info. */
  spawn(request: TermSpawnRequest): Promise<TermSessionInfo> {
    return call<TermSessionInfo>('/dsh-term/spawn', request)
  }

  /** Deliver terminal input. */
  write(id: string, data: string): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('/dsh-term/write', { id, data })
  }

  /** Resize one session. */
  resize(id: string, cols: number, rows: number): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('/dsh-term/resize', { id, cols, rows })
  }

  /** Close one session. */
  close(id: string): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('/dsh-term/close', { id })
  }

  /** Current session listing (used on reconnect). */
  list(): Promise<{ sessions: readonly TermSessionInfo[] }> {
    return call<{ sessions: readonly TermSessionInfo[] }>('/dsh-term/list')
  }

  /**
   * Subscribe to the output/exit stream. Returns the unsubscribe.
   * @param onEvent - receives every pushed event.
   */
  subscribe(onEvent: (event: TermEvent) => void): () => void {
    const source = new EventSource('/dsh-term/events')
    source.addEventListener('term', (event) => {
      try {
        onEvent(JSON.parse((event as MessageEvent).data) as TermEvent)
      } catch {
        // Malformed frame: drop it; the stream stays alive.
      }
    })
    return () => { source.close() }
  }
}
