import type { ViewState } from '../research/types'

/** Suggestions only fill an empty draft on the node the user is still viewing. */
export function suggestChatDraft(view: ViewState | null, nodeId: string, message: string) {
  if (!view || view.selectedId !== nodeId || !message.trim()) return null
  const draft = view.chatDrafts?.[nodeId] ?? view.drafts[nodeId] ?? ''
  if (draft.trim()) return null
  return { chatDrafts: { ...view.chatDrafts, [nodeId]: message } }
}
