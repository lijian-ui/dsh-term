/**
 * Conversation integration helper: append terminal selection text to the
 * active session's composer draft. Mirrors file-manager's appendToDraft
 * pattern — resolves the session-scoped input facade and calls setDraft.
 * @module dsh-term/client/term/chat-helper
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * Append `text` to the current session's composer draft.
 * Returns false when there is no active session or the conversation service
 * is unavailable.
 */
export declare function appendToConversationDraft(ctx: ClientContext, text: string): boolean;
//# sourceMappingURL=chat-helper.d.ts.map