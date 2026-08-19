/**
 * dsh-term panel: a multi-tab local terminal (real PTY via node-pty on the
 * host, bridged over /dsh-term/*). One xterm instance per tab; output lands
 * through a single EventSource routed by session id.
 *
 * Mounting: this component renders a DOCKED column (not a floating overlay).
 * The client entry (`index.ts`) appends that column as the last grid track of
 * the web shell's frame, beside the file-manager panels (preview/explorer)
 * when present. The panel itself only owns its inner content (header + stage).
 *
 * A-version scope: pure user terminal. No agent integration, no SSH targets
 * yet — those are the B-version.
 * @module dsh-term/client/term/TerminalPanel
 */
import type { JSX } from 'react';
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { TermApi } from './api.ts';
/** The docked panel: header (title / tabs / new / collapse) + xterm stage. */
export declare function TerminalPanel({ ctx, api, onClose, }: {
    ctx: ClientContext;
    api: TermApi;
    onClose: () => void;
}): JSX.Element;
//# sourceMappingURL=TerminalPanel.d.ts.map