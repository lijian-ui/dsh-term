/**
 * Conversation integration helper: append terminal selection text to the
 * active session's composer draft. Mirrors file-manager's appendToDraft
 * pattern — resolves the session-scoped input facade and calls setDraft.
 * @module dsh-term/client/term/chat-helper
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Append `text` to the current session's composer draft.
 * Returns false when there is no active session or the conversation service
 * is unavailable.
 */
export function appendToConversationDraft(ctx: ClientContext, text: string): boolean {
  const snapshot = ctx.sessions.list.getSnapshot()
  const sessionId = snapshot.current as SessionId | undefined
  if (sessionId === undefined) return false
  const actx = ctx.sessions.scope(sessionId)
  if (actx === undefined) return false
  const conversation = (ctx as unknown as { get(name: string): unknown }).get('conversation') as { input: { for(c: unknown): { state: { getSnapshot(): { draft: string } }; setDraft(s: string): void } } } | undefined
  if (conversation === undefined) return false
  const input = conversation.input.for(actx as unknown as ClientContext)
  const draft = input.state.getSnapshot().draft
  input.setDraft(draft.trim() === '' ? text : `${draft}\n${text}`)
  return true
}