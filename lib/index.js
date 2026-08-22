import { Service } from "@deepseek-ai/cordis";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { exec } from "node:child_process";
import { resolve } from "node:path";
import { homedir } from "node:os";
import * as nodePty from "node-pty";
//#region ../../node_modules/@deepseek-ai/dsh-settings/lib/index.js
/**
* Structural secret redaction for settings values. `role('secret')` fields are
* removed from a value before it crosses a wire boundary; a sidecar records
* each schema-declared secret position and whether it currently holds a value,
* so a configuration surface can render a write-only input without ever
* receiving the secret itself.
* @module @deepseek-ai/dsh-settings/redact
*/
/** Whether a value is a plain data object the walker may recurse into. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function walk(node, value, path, secrets) {
	if (node === void 0) return value;
	if (node.meta?.role === "secret") {
		secrets.push({
			path,
			set: value !== void 0
		});
		return;
	}
	switch (node.type) {
		case "object": {
			const properties = node.dict ?? {};
			const source = isRecord(value) ? value : void 0;
			const rebuilt = {};
			if (source !== void 0) for (const [key, entry] of Object.entries(source)) {
				if (key in properties) continue;
				rebuilt[key] = entry;
			}
			for (const [key, child] of Object.entries(properties)) {
				const stripped = walk(child, source?.[key], [...path, key], secrets);
				if (stripped !== void 0) rebuilt[key] = stripped;
			}
			return source === void 0 && Object.keys(rebuilt).length === 0 ? value : rebuilt;
		}
		case "dict": {
			if (!isRecord(value)) return value;
			const rebuilt = {};
			for (const [key, entry] of Object.entries(value)) {
				const stripped = walk(node.inner, entry, [...path, key], secrets);
				if (stripped !== void 0) rebuilt[key] = stripped;
			}
			return rebuilt;
		}
		case "array":
			if (!Array.isArray(value)) return value;
			return value.map((entry, index) => walk(node.inner, entry, [...path, String(index)], secrets));
		default: return value;
	}
}
/**
* Service Definition for the user-settings capability seam (`ctx.settings`). Providers store one raw document of
* per-namespace sections; plugins register a namespace schema and read the
* resolved value, which layers schema defaults, the registrant's composition
* `base`, and the user document section, in that order.
* @module @deepseek-ai/dsh-settings
*/
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
/**
* Brand a raw string as a {@link SettingsNamespace}.
* @param value - candidate namespace; lowercase kebab-case, as in plugin short names.
* @returns the branded namespace.
*/
function settingsNamespace(value) {
	if (!NAMESPACE_PATTERN.test(value)) throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`);
	return value;
}
/**
* Deep equality over JSON-compatible data (objects, arrays, primitives) — the
* Service Definition's single change-detection predicate, exported so the invariant
* companion checks exactly the implementation's relation.
* @param a - one JSON-compatible value.
* @param b - the other JSON-compatible value.
* @returns whether the two values are structurally equal.
*/
function deepEqualJson(a, b) {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((entry, index) => deepEqualJson(entry, b[index]));
	}
	const left = a;
	const right = b;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => key in right && deepEqualJson(left[key], right[key]));
}
/** Whether a value is a plain data object (not an array, null, or class instance). */
function isPlainObject(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
/** Apply one path op to a detached section, returning the next section. */
function applyPathOp(section, op) {
	const [head, ...rest] = op.path;
	if (head === void 0) {
		if (op.op === "unset") return {};
		if (!isPlainObject(op.value)) throw new TypeError("settings mutate: setting the section root requires a plain object");
		return { ...op.value };
	}
	if (rest.length === 0) {
		if (op.op === "set") return {
			...section,
			[head]: op.value
		};
		const { [head]: _removed, ...kept } = section;
		return kept;
	}
	const child = section[head];
	if (!isPlainObject(child)) {
		if (op.op === "unset") return section;
		return {
			...section,
			[head]: applyPathOp({}, {
				...op,
				path: rest
			})
		};
	}
	return {
		...section,
		[head]: applyPathOp(child, {
			...op,
			path: rest
		})
	};
}
/**
* Layer `over` onto `under`: plain objects merge recursively, every other
* value (arrays included) replaces the lower layer wholesale. `over` never
* carries `undefined` entries — sections come from parsed documents and write
* snapshots pass {@link cloneJsonShaped}, which strips them so a sparse patch
* cannot erase lower keys.
*/
function mergeLayers(under, over) {
	if (over === void 0) return under;
	if (!isPlainObject(under) || !isPlainObject(over)) return over;
	const merged = { ...under };
	for (const [key, value] of Object.entries(over)) merged[key] = key in merged ? mergeLayers(merged[key], value) : value;
	return merged;
}
/** Recursively freeze one resolved value so handed-out snapshots stay immutable. */
function deepFreeze(value) {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
	for (const entry of Object.values(value)) deepFreeze(entry);
	return Object.freeze(value);
}
Service.init;
//#endregion
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
const IS_WIN = process.platform === "win32";
/** Windows-only Git Bash locations. */
const GIT_BASH_CANDIDATES_WIN = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"];
/** macOS / Linux stock shells (always present on a normal desktop install). */
const UNIX_SHELL_PATHS = {
	zsh: "/bin/zsh",
	bash: "/bin/bash"
};
/** True if `name` resolves on PATH. Uses `where` on Windows, `command -v` on Unix. */
function commandExistsAsync(name) {
	const probe = IS_WIN ? `where ${name}` : `command -v ${name}`;
	return new Promise((r) => {
		exec(probe, {
			windowsHide: true,
			timeout: 5e3
		}, (err) => {
			r(!err);
		});
	});
}
/** Git Bash is only relevant on Windows (probed via launcher / bash / git). */
async function hasGitBash() {
	if (!IS_WIN) return false;
	if (await commandExistsAsync("git-bash.exe")) return true;
	if (await commandExistsAsync("bash.exe") && (await commandExistsAsync("git.exe") || GIT_BASH_CANDIDATES_WIN.some((p) => existsSync(p)))) return true;
	return GIT_BASH_CANDIDATES_WIN.some((p) => existsSync(p));
}
/** Map a ShellType to { command, args } for node-pty.spawn. */
function resolveShell(shell) {
	switch (shell) {
		case "powershell": return {
			command: "powershell.exe",
			args: ["-NoLogo"]
		};
		case "cmd": return {
			command: "cmd.exe",
			args: []
		};
		case "bash": return {
			command: IS_WIN ? "bash.exe" : UNIX_SHELL_PATHS.bash,
			args: ["--login", "-i"]
		};
		case "zsh": return {
			command: UNIX_SHELL_PATHS.zsh,
			args: ["-l", "-i"]
		};
		default:
			if (IS_WIN) {
				for (const c of GIT_BASH_CANDIDATES_WIN) if (existsSync(c)) return {
					command: c,
					args: ["--login", "-i"]
				};
				return {
					command: "bash",
					args: ["--login", "-i"]
				};
			}
			return {
				command: UNIX_SHELL_PATHS.bash,
				args: ["--login", "-i"]
			};
	}
}
/** Default shell kind for the platform. */
function defaultShellType() {
	if (IS_WIN) return "powershell";
	return existsSync(UNIX_SHELL_PATHS.zsh) ? "zsh" : "bash";
}
/**
* Resolve a spawn cwd that is guaranteed to be an existing directory.
* node-pty fails at spawn time (macOS: "posix_spawnp failed") if the cwd
* does not exist — which happens on a cross-platform machine when a stale
* Windows-style workspace path is still in the store, or when the renderer
* sends an empty/null cwd. Fall back to $HOME so the PTY always spawns.
*/
function resolveCwd(cwd) {
	const candidate = cwd && cwd.trim().length > 0 ? cwd.trim() : process.cwd();
	try {
		const abs = resolve(candidate);
		if (existsSync(abs) && statSync(abs).isDirectory()) return abs;
	} catch {}
	return homedir();
}
/**
* The PTY registry. Every mutation goes through this class so the route
* layer stays a thin HTTP shape (the file-manager pattern). Output/exit
* callbacks are assignable so the SSE layer can bind them after construction.
*/
var PtyService = class {
	sessions = /* @__PURE__ */ new Map();
	/** Cached available shells (computed once on first query). */
	availableShellsCache = null;
	/** Fired with raw PTY output chunks (UTF-8). Bound by the route layer. */
	onOutput = () => {};
	/** Fired once when a session exits. Bound by the route layer. */
	onExit = () => {};
	/** Fired when a session is detached (tab closed, PTY kept alive). */
	onDetach = () => {};
	/** Fired when a session is reattached. */
	onReattach = () => {};
	/**
	* Returns the shells actually available on this machine, so the browser
	* can hide options the user never installed (Git Bash) instead of letting
	* node-pty fail at spawn time. Results are cached after the first async
	* detection to avoid repeated `where` calls.
	*/
	async detectShells() {
		if (this.availableShellsCache !== null) return this.availableShellsCache;
		const available = [];
		if (await hasGitBash()) available.push("gitbash");
		if (IS_WIN) {
			if (await commandExistsAsync("powershell.exe") || await commandExistsAsync("pwsh.exe")) available.push("powershell");
			if (await commandExistsAsync("cmd.exe")) available.push("cmd");
		} else {
			if (existsSync(UNIX_SHELL_PATHS.zsh)) available.push("zsh");
			if (existsSync(UNIX_SHELL_PATHS.bash)) available.push("bash");
		}
		this.availableShellsCache = available.map((id) => ({
			id,
			labelKey: `ui.shell.${id}`
		}));
		return this.availableShellsCache;
	}
	/** Open one session; returns the wire info immediately (output streams async). */
	spawn(req) {
		const id = randomUUID();
		const shellType = req.shell ?? defaultShellType();
		const { command, args } = resolveShell(shellType);
		const finalArgs = req.args ?? args;
		const cols = req.cols ?? 80;
		const rows = req.rows ?? 24;
		const cwd = resolveCwd(req.cwd);
		const env = {
			...process.env,
			TERM: "xterm-256color",
			FORCE_COLOR: "1",
			...req.env ?? {}
		};
		const pty = nodePty.spawn(command, finalArgs, {
			name: "xterm-256color",
			cols,
			rows,
			cwd,
			env
		});
		const info = {
			id,
			title: req.name ?? shellType,
			cwd,
			cols,
			rows,
			alive: true,
			exitCode: null,
			shell: shellType,
			detached: false
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
	/**
	* Detach a session: mark it as detached but keep the PTY process alive.
	* This lets the user close a tab without losing a running command (e.g.
	* `npm install`); reopening re-attaches to the same session.
	*/
	detach(id) {
		const live = this.sessions.get(id);
		if (live === void 0) return false;
		const newInfo = {
			...live.info,
			detached: true
		};
		this.sessions.set(id, {
			info: newInfo,
			pty: live.pty
		});
		this.onDetach(id);
		return true;
	}
	/**
	* Reattach to a detached session: mark it as attached and return the info.
	* The caller creates a fresh xterm and starts routing SSE output to it.
	*/
	reattach(id) {
		const live = this.sessions.get(id);
		if (live === void 0) return null;
		const newInfo = {
			...live.info,
			detached: false
		};
		this.sessions.set(id, {
			info: newInfo,
			pty: live.pty
		});
		this.onReattach(newInfo);
		return newInfo;
	}
	/** Close a session forcefully (kill the PTY). Returns false when unknown. */
	close(id) {
		const live = this.sessions.get(id);
		if (live === void 0) return false;
		try {
			live.pty.kill();
		} catch {}
		this.sessions.delete(id);
		return true;
	}
	/** The full session listing snapshot (including detached sessions). */
	list() {
		return [...this.sessions.values()].map(({ info }) => ({ ...info }));
	}
	/** Only the detached sessions (for the "reopen" dropdown). */
	detachedList() {
		return [...this.sessions.values()].filter(({ info }) => info.detached).map(({ info }) => ({ ...info }));
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
			if (size > 64 * 1024) {
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
* @param getT - lazy translator getter (reflects current language).
* @returns route disposers.
*/
function registerTermRoutes(ctx, pty, getT) {
	const subscribers = /* @__PURE__ */ new Set();
	const push = (event) => {
		for (const subscriber of subscribers) subscriber.res.write(`event: term\ndata: ${JSON.stringify(event)}\n\n`);
	};
	pty.onOutput = (id, data) => push({
		kind: "output",
		id,
		data
	});
	pty.onExit = (id, exitCode) => {
		const msg = getT().t("msg.sessionExited", exitCode);
		push({
			kind: "exit",
			id,
			exitCode,
			message: msg
		});
	};
	pty.onDetach = (id) => push({
		kind: "detached",
		id
	});
	pty.onReattach = (session) => push({
		kind: "reattached",
		session
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
			if (req.method === "GET" && url.pathname === "/dsh-term/shells") {
				const shells = await pty.detectShells();
				json(res, OK({ shells }));
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
						shell: typeof request.shell === "string" && [
							"bash",
							"zsh",
							"powershell",
							"cmd",
							"gitbash"
						].includes(request.shell) ? request.shell : void 0,
						args: Array.isArray(request.args) ? request.args.filter((a) => typeof a === "string") : void 0,
						cols: typeof request.cols === "number" ? request.cols : void 0,
						rows: typeof request.rows === "number" ? request.rows : void 0,
						env: typeof request.env === "object" && request.env !== null ? Object.fromEntries(Object.entries(request.env).filter(([, v]) => typeof v === "string")) : void 0
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
				case "/dsh-term/detach": {
					const body = payload;
					if (typeof body?.id !== "string") {
						json(res, MALFORMED, 400);
						return;
					}
					json(res, OK({ ok: pty.detach(body.id) }));
					return;
				}
				case "/dsh-term/reattach": {
					const body = payload;
					if (typeof body?.id !== "string") {
						json(res, MALFORMED, 400);
						return;
					}
					const session = pty.reattach(body.id);
					if (session === null) {
						json(res, FAIL("session not found", "not_found"), 404);
						return;
					}
					json(res, OK(session));
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
//#region src/gateway/i18n.ts
const zh = {
	"msg.sessionExited": "[dsh-term] 进程已退出（code {0}）",
	"msg.spawnFailed": "[dsh-term] 启动失败: {0}",
	"ui.panel.title": "终端",
	"ui.panel.addTabTitle": "新建终端",
	"ui.panel.collapseTitle": "收起",
	"ui.panel.emptyHint": "点击 + 新建终端",
	"ui.dock.label": "终端",
	"ui.tab.closeAria": "关闭 {0}",
	"ui.panel.shellTitle": "Shell",
	"ui.shell.bash": "Bash",
	"ui.shell.zsh": "Zsh",
	"ui.shell.powershell": "PowerShell",
	"ui.shell.cmd": "命令提示符",
	"ui.shell.gitbash": "Git Bash"
};
const dicts = {
	zh,
	en: {
		"msg.sessionExited": "[dsh-term] Process exited (code {0})",
		"msg.spawnFailed": "[dsh-term] Spawn failed: {0}",
		"ui.panel.title": "Terminal",
		"ui.panel.addTabTitle": "New Terminal",
		"ui.panel.collapseTitle": "Collapse",
		"ui.panel.emptyHint": "Click + to create a terminal",
		"ui.dock.label": "Terminal",
		"ui.tab.closeAria": "Close {0}",
		"ui.panel.shellTitle": "Shell",
		"ui.shell.bash": "Bash",
		"ui.shell.zsh": "Zsh",
		"ui.shell.powershell": "PowerShell",
		"ui.shell.cmd": "Command Prompt",
		"ui.shell.gitbash": "Git Bash"
	}
};
var Translator = class {
	lang;
	constructor(lang) {
		this.lang = lang;
	}
	t(key, ...args) {
		let s = (dicts[this.lang] ?? zh)[key] ?? zh[key] ?? key;
		for (let i = 0; i < args.length; i++) s = s.replaceAll(`{${i}}`, String(args[i]));
		return s;
	}
};
function createTranslator(lang) {
	return new Translator(lang);
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
	/** Current language; resolved from dsh global settings. */
	let lang = "zh";
	createTranslator(lang);
	/** Resolve the user's language preference from dsh settings. */
	function resolveLang() {
		try {
			const settings = ctx.get("settings");
			if (!settings) return "zh";
			return settings.get(settingsNamespace("locale"))?.preference === "en" ? "en" : "zh";
		} catch {
			return "zh";
		}
	}
	ctx.effect(() => {
		lang = resolveLang();
		const disposeRoutes = registerTermRoutes(ctx, pty, () => createTranslator(lang));
		return () => {
			disposeRoutes();
			pty.dispose();
		};
	}, "dsh-term: routes + pty lifecycle");
	ctx.root.on("settings/updated", (ns, next) => {
		if (ns !== settingsNamespace("locale")) return;
		lang = next?.preference === "en" ? "en" : "zh";
	});
}
//#endregion
export { DSH_TERM_GUIDANCE, apply, inject };
