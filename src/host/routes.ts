/**
 * /dsh-term/* route layer: JSON envelope (ok/error) for the PTY operations
 * and one SSE stream (output/exit/start events) per client. Loopback-fenced
 * like every other host route family — a terminal is arbitrary command
 * execution, so only same-origin browser clients may reach it.
 * @module dsh-term/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { TermEvent, TermSpawnRequest } from '../core/types.ts'
import type { PtyService } from './pty-service.ts'
import { isLoopbackRequest } from './loopback.ts'

/** JSON envelope mirrors the file-manager panel shape. */
type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const OK = (value: unknown): Envelope<unknown> => ({ ok: true, value })
const FAIL = (message: string, code = 'internal'): Envelope<never> => ({ ok: false, error: { code, message } })
const MALFORMED = FAIL('malformed request')

/** One SSE subscriber. */
interface Subscriber {
  readonly res: ServerResponse
}

/** Read a small JSON request body (bounded to 64 KiB). */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf-8')))
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function json(res: ServerResponse, envelope: Envelope<unknown>, status = 200): void {
  const body = JSON.stringify(envelope)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Register the /dsh-term routes.
 * @param ctx - context carrying the webServer service.
 * @param pty - the session registry.
 * @returns route disposers.
 */
export function registerTermRoutes(ctx: Context, pty: PtyService): () => void {
  const subscribers = new Set<Subscriber>()
  const push = (event: TermEvent): void => {
    for (const subscriber of subscribers) {
      subscriber.res.write(`event: term\ndata: ${JSON.stringify(event)}\n\n`)
    }
  }

  pty.onOutput = (id, data) => push({ kind: 'output', id, data })
  pty.onExit = (id, exitCode) => push({ kind: 'exit', id, exitCode })

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isLoopbackRequest(req)) {
      json(res, FAIL('loopback-only', 'forbidden'), 403)
      return
    }
    const url = new URL(req.url ?? '/', 'http://dsh-term.local')
    try {
      if (req.method === 'GET' && url.pathname === '/dsh-term/list') {
        json(res, OK({ sessions: pty.list() }))
        return
      }
      if (req.method !== 'POST') {
        json(res, MALFORMED, 405)
        return
      }
      let payload: unknown
      try {
        payload = await readBody(req)
      } catch {
        json(res, MALFORMED, 400)
        return
      }
      switch (url.pathname) {
        case '/dsh-term/spawn': {
          const request = payload as Partial<TermSpawnRequest>
          if (typeof request !== 'object' || request === null) {
            json(res, MALFORMED, 400)
            return
          }
          const session = pty.spawn({
            name: typeof request.name === 'string' ? request.name : undefined,
            cwd: typeof request.cwd === 'string' ? request.cwd : undefined,
            shell: typeof request.shell === 'string' ? request.shell : undefined,
            args: Array.isArray(request.args) ? request.args.filter((a): a is string => typeof a === 'string') : undefined,
            cols: typeof request.cols === 'number' ? request.cols : undefined,
            rows: typeof request.rows === 'number' ? request.rows : undefined,
          })
          push({ kind: 'start', session })
          json(res, OK(session))
          return
        }
        case '/dsh-term/write': {
          const body = payload as { id?: unknown; data?: unknown }
          if (typeof body?.id !== 'string' || typeof body?.data !== 'string') {
            json(res, MALFORMED, 400)
            return
          }
          json(res, OK({ ok: pty.write(body.id, body.data) }))
          return
        }
        case '/dsh-term/resize': {
          const body = payload as { id?: unknown; cols?: unknown; rows?: unknown }
          if (typeof body?.id !== 'string' || typeof body?.cols !== 'number' || typeof body?.rows !== 'number') {
            json(res, MALFORMED, 400)
            return
          }
          json(res, OK({ ok: pty.resize(body.id, body.cols, body.rows) }))
          return
        }
        case '/dsh-term/signal': {
          const body = payload as { id?: unknown; signal?: unknown }
          if (typeof body?.id !== 'string' || typeof body?.signal !== 'string') {
            json(res, MALFORMED, 400)
            return
          }
          json(res, OK({ ok: pty.signal(body.id, body.signal) }))
          return
        }
        case '/dsh-term/close': {
          const body = payload as { id?: unknown }
          if (typeof body?.id !== 'string') {
            json(res, MALFORMED, 400)
            return
          }
          json(res, OK({ ok: pty.close(body.id) }))
          return
        }
        default:
          json(res, MALFORMED, 404)
      }
    } catch (error: unknown) {
      ctx.logger.warn(`dsh-term: route failed: ${String(error)}`)
      json(res, FAIL('internal error'))
    }
  }

  const sse = (req: IncomingMessage, res: ServerResponse): void => {
    if (!isLoopbackRequest(req)) {
      res.writeHead(403).end('loopback-only')
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write(': connected\n\n')
    const subscriber: Subscriber = { res }
    subscribers.add(subscriber)
    const heartbeat = setInterval(() => {
      if (subscriber.res.writableEnded) return
      subscriber.res.write(': ping\n\n')
    }, 15_000)
    req.on('close', () => {
      clearInterval(heartbeat)
      subscribers.delete(subscriber)
    })
  }

  const disposers = [
    ctx.webServer.register({ kind: 'prefix', path: '/dsh-term', handler }),
    ctx.webServer.register({ kind: 'exact', path: '/dsh-term/events', handler: sse }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
    for (const subscriber of subscribers) subscriber.res.end()
    subscribers.clear()
  }
}
