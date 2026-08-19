# @lijian-ui/dsh-term

Panel-style local terminal for the DSH web GUI.

- **Real PTY sessions** via [`node-pty`](https://github.com/microsoft/node-pty) — a genuine local shell, not a curated command runner.
- **Multi-tab terminal panel** built on [xterm.js](https://xtermjs.org/), docked in the right-side panel (alongside `@lijian-ui/dsh-file-manager`).
- **Workspace cwd** — each session starts in the current workspace root.
- **Hot-pluggable** — loaded as a profile bundle; no changes to DSH source are required.

> This is the **A edition**: local user terminal only. A planned **B edition** adds SSH connections and per-session shell selection.

## Install

```bash
dsh plugin add @lijian-ui/dsh-term
```

Or add `@lijian-ui/dsh-term` to your profile's `bundles` / `dependencies` and reference it from `cordis.yml`.

## Behavior

- Default state is **collapsed** (closed). Open it from the right-side panel launcher (the "终端" button) — it docks as the rightmost column next to the file-manager panel.
- Sessions are managed by a host-side service (`src/host/pty-service.ts`) exposed over loopback-only HTTP + SSE routes (`src/host/routes.ts`). The client renders them with xterm.js and syncs resize/input.

## Development

```bash
npm install
npm run build      # tsc -b && tsdown -> lib/
npm run watch      # rebuild on change
npm test           # vitest
```

## License

Apache-2.0
