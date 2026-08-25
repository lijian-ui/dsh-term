/**
 * dsh-term browser half: mounts the terminal as a DOCKED column in the web
 * shell's right side — appended as the 6th grid track of the frame, beside
 * the file-manager panels (preview/explorer) when present. This mirrors how
 * file-manager extends the frame grid, so the two panels sit side by side.
 *
 * The frame is a CSS grid with `grid-auto-flow: row` (the default). A bare
 * `appendChild` of a 6th child would WRAP to a 2nd row (off-screen) — so we
 * must EXTEND `grid-template-columns` explicitly, the same way file-manager
 * does. We append a `[dsh-term]` named 6th track after file-manager's 5
 * tracks; the center column is `minmax(0,1fr)`, so it absorbs the 300px and
 * the grid never overflows on wide screens. file-manager ignores any grid
 * string that is not 3 (shell) or 5 (its own) tracks, so our 6-track write is
 * left alone by it — we just re-assert it whenever file-manager rewrites the
 * grid (drag / resize / collapse).
 *
 * Every DOM/runtime failure is logged, never thrown — the web shell fails the
 * whole boot when a plugin apply throws.
 * @module dsh-term/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Augment the locale namespace map so ctx.locale.register/bind accept 'dsh-term'. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Terminal panel copy. */
        'dsh-term': 'ui.panel.title' | 'ui.panel.addTabTitle' | 'ui.panel.collapseTitle' | 'ui.panel.emptyHint' | 'ui.tab.closeAria' | 'msg.sessionExited' | 'msg.spawnFailed' | 'ui.dock.label' | 'ui.panel.shellTitle' | 'ui.shell.bash' | 'ui.shell.zsh' | 'ui.shell.powershell' | 'ui.shell.cmd' | 'ui.shell.gitbash' | 'ui.panel.reopenTitle' | 'ui.panel.backgroundSessions' | 'ui.panel.noBackground' | 'ui.panel.addToChat';
    }
}
/** Required services: sessions (for the workspace cwd), conversation (for add-to-chat). */
export declare const inject: string[];
/** Apply the browser half. */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map