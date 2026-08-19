import { randomUUID } from "node:crypto";
import * as nodePty from "node-pty";
//#region src/mount-once.ts
/**
* Host single-instance guard shared by the plugin family. The family bundle
* (dsh-web-ui-all / dsh-skins) namespaces every child row id (web-ui-*), so
* the loader accepts a standalone install of the same package side by side;
* without this guard the second instance would still re-register the same
* webserver routes, tools, settings namespaces, and system-prompt sections
* and fail the boot. mountOnce makes the second host apply a no-op for the
* lifetime of the first instance (the browser half is already deduped by
* package name in the client module host).
*
* The registry rides a global symbol so two module instances of the same
* package (npm copy vs repository link) still share one verdict. cordis
* `ctx.effect` runs its callback immediately and treats the callback's
* return value as the fiber disposer, so the unmarker is returned, not run.
*/
const MOUNTED = Symbol.for("dsh-web-ui.mounted-plugins");
function mountedSet() {
	const registry = globalThis;
	return registry[MOUNTED] ??= /* @__PURE__ */ new Set();
}
/**
* Wrap a cordis plugin apply so the package runs at most once per process.
* The first mount registers normally and unmarks when its fiber disposes;
* any later mount of the same package name is a no-op.
* @param packageName - npm package identity shared by every install source.
* @param fn - the original plugin apply.
* @returns an apply of the same shape.
*/
function mountOnce(packageName, fn) {
	return ((...args) => {
		const mounted = mountedSet();
		if (mounted.has(packageName)) return;
		mounted.add(packageName);
		args[0]?.effect?.(() => () => {
			mounted.delete(packageName);
		});
		return fn(...args);
	});
}
//#endregion
//#region src/host/pty-service.ts
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
/** Default interactive shell for the platform. */
function defaultShell() {
	if (process.platform === "win32") return "powershell.exe";
	return process.env.SHELL ?? "/bin/bash";
}
/** Default args for an interactive login-less shell. */
function defaultArgs(shell) {
	if (process.platform === "win32") return [];
	return shell.endsWith("bash") ? [
		"--noprofile",
		"--norc",
		"-i"
	] : ["-i"];
}
/**
* The PTY registry. Every mutation goes through this class so the route
* layer stays a thin HTTP shape (the file-manager pattern). Output/exit
* callbacks are assignable so the SSE layer can bind them after construction.
*/
var PtyService = class {
	sessions = /* @__PURE__ */ new Map();
	/** Fired with raw PTY output chunks (UTF-8). Bound by the route layer. */
	onOutput = () => {};
	/** Fired once when a session exits. Bound by the route layer. */
	onExit = () => {};
	/** Open one session; returns the wire info immediately (output streams async). */
	spawn(req) {
		const id = randomUUID();
		const shell = req.shell ?? defaultShell();
		const args = req.args ?? defaultArgs(shell);
		const cols = req.cols ?? 80;
		const rows = req.rows ?? 24;
		const cwd = req.cwd ?? process.cwd();
		const pty = nodePty.spawn(shell, args, {
			name: "xterm-256color",
			cols,
			rows,
			cwd
		});
		const info = {
			id,
			title: req.name ?? shell,
			cwd,
			cols,
			rows,
			alive: true,
			exitCode: null
		};
		this.sessions.set(id, {
			info,
			pty
		});
		pty.onData((data) => {
			this.onOutput(id, data);
		});
		pty.onExit(({ exitCode }) => {
			this.sessions.delete(id);
			this.onExit(id, exitCode);
		});
		return info;
	}
	/** Write raw bytes (UTF-8) into a session. Returns false when unknown. */
	write(id, data) {
		const live = this.sessions.get(id);
		if (live === void 0) return false;
		try {
			live.pty.write(data);
		} catch {
			return false;
		}
		return true;
	}
	/** Resize a session. Returns false when unknown. */
	resize(id, cols, rows) {
		const live = this.sessions.get(id);
		if (live === void 0) return false;
		try {
			live.pty.resize(Math.max(2, cols), Math.max(2, rows));
			live.info.cols = cols;
			live.info.rows = rows;
		} catch {
			return false;
		}
		return true;
	}
	/** Deliver a signal (SIGINT/SIGHUP/SIGTERM/SIGKILL). Returns false when unknown. */
	signal(id, signal) {
		const live = this.sessions.get(id);
		if (live === void 0) return false;
		try {
			live.pty.kill(signal);
		} catch {
			return false;
		}
		return true;
	}
	/** Close a session forcefully (SIGHUP semantics via kill). Returns false when unknown. */
	close(id) {
		const live = this.sessions.get(id);
		if (live === void 0) return false;
		try {
			live.pty.kill();
		} catch {}
		return true;
	}
	/** The full session listing snapshot. */
	list() {
		return [...this.sessions.values()].map(({ info }) => ({ ...info }));
	}
	/** Close every session (route teardown). */
	dispose() {
		for (const live of this.sessions.values()) try {
			live.pty.kill();
		} catch {}
		this.sessions.clear();
	}
};
//#endregion
//#region src/host/loopback.ts
/** IPv4 127/8 predicate (four decimal octets, first == 127). */
function isIPv4Loopback(v4) {
	const parts = v4.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
function isLoopbackAddress(address) {
	if (address === void 0) return false;
	const normalized = address.toLowerCase();
	if (normalized === "::1") return true;
	if (normalized.startsWith("::ffff:")) return isIPv4Loopback(normalized.slice(7));
	return isIPv4Loopback(normalized);
}
/** Whether a normalized URL hostname names the loopback authority (localhost, [::1], 127/8). */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	return isIPv4Loopback(hostname);
}
/**
* Request-level trust fence: a loopback socket address AND a loopback Host
* header, plus browser same-origin markers. The socket address is
* authoritative; X-Forwarded-For is never trusted.
*/
function isLoopbackRequest(request) {
	if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL("http://" + host);
	} catch {
		return false;
	}
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/host/routes.ts
const OK = (value) => ({
	ok: true,
	value
});
const FAIL = (message, code = "internal") => ({
	ok: false,
	error: {
		code,
		message
	}
});
const MALFORMED = FAIL("malformed request");
/** Read a small JSON request body (bounded to 64 KiB). */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 65536) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf-8")));
			} catch {
				reject(/* @__PURE__ */ new Error("invalid JSON"));
			}
		});
		req.on("error", reject);
	});
}
function json(res, envelope, status = 200) {
	const body = JSON.stringify(envelope);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(body);
}
/**
* Register the /dsh-term routes.
* @param ctx - context carrying the webServer service.
* @param pty - the session registry.
* @returns route disposers.
*/
function registerTermRoutes(ctx, pty) {
	const subscribers = /* @__PURE__ */ new Set();
	const push = (event) => {
		for (const subscriber of subscribers) subscriber.res.write(`event: term\ndata: ${JSON.stringify(event)}\n\n`);
	};
	pty.onOutput = (id, data) => push({
		kind: "output",
		id,
		data
	});
	pty.onExit = (id, exitCode) => push({
		kind: "exit",
		id,
		exitCode
	});
	const handler = async (req, res) => {
		if (!isLoopbackRequest(req)) {
			json(res, FAIL("loopback-only", "forbidden"), 403);
			return;
		}
		const url = new URL(req.url ?? "/", "http://dsh-term.local");
		try {
			if (req.method === "GET" && url.pathname === "/dsh-term/list") {
				json(res, OK({ sessions: pty.list() }));
				return;
			}
			if (req.method !== "POST") {
				json(res, MALFORMED, 405);
				return;
			}
			let payload;
			try {
				payload = await readBody(req);
			} catch {
				json(res, MALFORMED, 400);
				return;
			}
			switch (url.pathname) {
				case "/dsh-term/spawn": {
					const request = payload;
					if (typeof request !== "object" || request === null) {
						json(res, MALFORMED, 400);
						return;
					}
					const session = pty.spawn({
						name: typeof request.name === "string" ? request.name : void 0,
						cwd: typeof request.cwd === "string" ? request.cwd : void 0,
						shell: typeof request.shell === "string" ? request.shell : void 0,
						args: Array.isArray(request.args) ? request.args.filter((a) => typeof a === "string") : void 0,
						cols: typeof request.cols === "number" ? request.cols : void 0,
						rows: typeof request.rows === "number" ? request.rows : void 0
					});
					push({
						kind: "start",
						session
					});
					json(res, OK(session));
					return;
				}
				case "/dsh-term/write": {
					const body = payload;
					if (typeof body?.id !== "string" || typeof body?.data !== "string") {
						json(res, MALFORMED, 400);
						return;
					}
					json(res, OK({ ok: pty.write(body.id, body.data) }));
					return;
				}
				case "/dsh-term/resize": {
					const body = payload;
					if (typeof body?.id !== "string" || typeof body?.cols !== "number" || typeof body?.rows !== "number") {
						json(res, MALFORMED, 400);
						return;
					}
					json(res, OK({ ok: pty.resize(body.id, body.cols, body.rows) }));
					return;
				}
				case "/dsh-term/signal": {
					const body = payload;
					if (typeof body?.id !== "string" || typeof body?.signal !== "string") {
						json(res, MALFORMED, 400);
						return;
					}
					json(res, OK({ ok: pty.signal(body.id, body.signal) }));
					return;
				}
				case "/dsh-term/close": {
					const body = payload;
					if (typeof body?.id !== "string") {
						json(res, MALFORMED, 400);
						return;
					}
					json(res, OK({ ok: pty.close(body.id) }));
					return;
				}
				default: json(res, MALFORMED, 404);
			}
		} catch (error) {
			ctx.logger.warn(`dsh-term: route failed: ${String(error)}`);
			json(res, FAIL("internal error"));
		}
	};
	const sse = (req, res) => {
		if (!isLoopbackRequest(req)) {
			res.writeHead(403).end("loopback-only");
			return;
		}
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-store",
			"connection": "keep-alive",
			"x-accel-buffering": "no"
		});
		res.write(": connected\n\n");
		const subscriber = { res };
		subscribers.add(subscriber);
		const heartbeat = setInterval(() => {
			if (subscriber.res.writableEnded) return;
			subscriber.res.write(": ping\n\n");
		}, 15e3);
		req.on("close", () => {
			clearInterval(heartbeat);
			subscribers.delete(subscriber);
		});
	};
	const disposers = [ctx.webServer.register({
		kind: "prefix",
		path: "/dsh-term",
		handler
	}), ctx.webServer.register({
		kind: "exact",
		path: "/dsh-term/events",
		handler: sse
	})];
	return () => {
		for (const dispose of disposers) dispose();
		for (const subscriber of subscribers) subscriber.res.end();
		subscribers.clear();
	};
}
//#endregion
//#region src/index.ts
/** Required services: the route registry. */
const inject = ["webServer"];
/** Model-facing announcement: plugin presence. */
const DSH_TERM_GUIDANCE = "本机已安装 dsh-term 插件（DSH Web GUI 的面板式终端）：用户可在聊天区打开本地终端（真实 PTY，默认 powershell/bash），多标签并存、会话持久；用户提到「终端 / 打开终端 / 执行命令」时即指本插件，请据此协作。";
/**
* Mount the PTY service and its routes.
* @param ctx - context carrying the webServer service.
*/
const apply = mountOnce("@lijian-ui/dsh-term", applyImpl);
function applyImpl(ctx) {
	const pty = new PtyService();
	ctx.effect(() => {
		const disposeRoutes = registerTermRoutes(ctx, pty);
		return () => {
			disposeRoutes();
			pty.dispose();
		};
	}, "dsh-term: routes + pty lifecycle");
}
//#endregion
export { DSH_TERM_GUIDANCE, apply, inject };
