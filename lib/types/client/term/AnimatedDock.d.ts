/**
 * AnimatedDock — a macOS-style magnification button group rendered into the
 * conversation session header (the `conversation.session.header.utilities`
 * slot, ordered to the LEFT of the official "Session log" button).
 *
 * This is a faithful port of the 21st.dev "Animated Dock" component: it uses
 * framer-motion's `useMotionValue` + `useSpring` + `useTransform` so each
 * circular icon scales toward the cursor with real spring physics — the
 * buttery feel you can't get from a CSS transition. Magnification is driven by
 * `transform: scale()` (NOT `width`), so it never reflows the layout and the
 * dock stays perfectly stable under the cursor.
 * Icons come from lucide-react. The dock itself is a frosted-glass pill.
 *
 * Two entries wire to the two right-side panels through window CustomEvents
 * (a cross-plugin bridge so this component never imports the file-manager
 * bundle):
 *
 *   - terminal -> `dsh-dock:toggle-terminal`   (handled in dsh-term index)
 *   - file     -> `dsh-dock:toggle-filepanel`  (handled in dsh-file-manager)
 *
 * Active (open) state is mirrored back through `dsh-dock:terminal-state` /
 * `dsh-dock:filepanel-state` so the icons highlight in lockstep with the
 * actual panels.
 * @module dsh-term/client/AnimatedDock
 */
import { type ReactElement } from 'react';
export declare function AnimatedDock(): ReactElement;
//# sourceMappingURL=AnimatedDock.d.ts.map