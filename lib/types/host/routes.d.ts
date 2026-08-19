/**
 * /dsh-term/* route layer: JSON envelope (ok/error) for the PTY operations
 * and one SSE stream (output/exit/start events) per client. Loopback-fenced
 * like every other host route family — a terminal is arbitrary command
 * execution, so only same-origin browser clients may reach it.
 * @module dsh-term/host/routes
 */
import type { Context } from '@deepseek-ai/cordis';
import type { PtyService } from './pty-service.ts';
/**
 * Register the /dsh-term routes.
 * @param ctx - context carrying the webServer service.
 * @param pty - the session registry.
 * @returns route disposers.
 */
export declare function registerTermRoutes(ctx: Context, pty: PtyService): () => void;
//# sourceMappingURL=routes.d.ts.map