/**
 * /dsh-term/* route layer: JSON envelope (ok/error) for the PTY operations
 * and one SSE stream (output/exit/start events) per client. Loopback-fenced
 * like every other host route family — a terminal is arbitrary command
 * execution, so only same-origin browser clients may reach it.
 * @module dsh-term/host/routes
 */
import type { Context } from '@deepseek-ai/cordis';
import type { PtyService } from './pty-service.ts';
import type { Translator } from '../gateway/i18n.ts';
/**
 * Register the /dsh-term routes.
 * @param ctx - context carrying the webServer service.
 * @param pty - the session registry.
 * @param getT - lazy translator getter (reflects current language).
 * @returns route disposers.
 */
export declare function registerTermRoutes(ctx: Context, pty: PtyService, getT: () => Translator): () => void;
//# sourceMappingURL=routes.d.ts.map