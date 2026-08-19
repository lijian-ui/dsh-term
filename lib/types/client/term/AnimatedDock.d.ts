/**
 * AnimatedDock — the terminal dock button rendered into the conversation
 * session header (the `conversation.session.header.utilities` slot, ordered to
 * the LEFT of the official "Session log" button).
 *
 * Each plugin owns its own dock button independently: dsh-term renders this
 * terminal button, dsh-file-manager renders its own file-panel button. The two
 * are fully decoupled — install either alone and you get just its button;
 * install both and both buttons appear side by side with shared magnification
 * (coordinated through window CustomEvents, see DockItem.tsx).
 *
 * Clicking broadcasts `dsh-dock:toggle-terminal` (handled in dsh-term index);
 * the open state is mirrored back through `dsh-dock:terminal-state`.
 * @module dsh-term/client/AnimatedDock
 */
import { type ReactElement } from 'react';
export declare function AnimatedDock(): ReactElement;
//# sourceMappingURL=AnimatedDock.d.ts.map