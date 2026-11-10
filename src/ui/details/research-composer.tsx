import { useRef, useState, type RefObject } from 'react'
import { ArrowUp, LoaderCircle, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ResearchNode } from '../../research/types'
import { useApp } from '../state'
import { Button } from '../components'
import { ComposerModelPicker } from '../models/composer-picker'
import { shouldSendMessage, sendShortcutLabel, useShortcuts } from '../shortcuts'
import { runtimeLabel } from '../i18n-labels'

export function ResearchComposer({
  node,
  onSent,
  inputRef: input,
}: {
  node: ResearchNode
  onSent: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const { t } = useTranslation()
  const sendShortcut = useShortcuts((state) => state.sendMessage)
  const [selectionBusy, setSelectionBusy] = useState(false)
  const snapshot = useApp((state) => state.snapshot)!,
    view = useApp((state) => state.view)!,
    setView = useApp((state) => state.setView),
    open = useApp((state) => state.open),
    command = useApp((state) => state.command)
  const running = snapshot.runs
    .filter((run) => run.nodeId === node.id)
    .reverse()
    .find((run) => run.status === 'running')
  const draft = view.chatDrafts?.[node.id] ?? view.drafts[node.id] ?? ''
  const composing = useRef(false),
    compositionConfirmUntil = useRef(0)
  const start = async () => {
    if (selectionBusy || running) return
    if (snapshot.settings.backend === 'acp' ? !snapshot.settings.agent : !snapshot.settings.model) {
      open('models')
      return
    }
    try {
      if (!draft.trim()) {
        input.current?.focus()
        return
      }
      await command({ type: 'send-message', nodeId: node.id, message: draft })
      const current = useApp.getState()
      if (current.workspaceId === node.workspaceId && current.view)
        setView({
          chatDrafts: { ...current.view.chatDrafts, [node.id]: '' },
          drafts: { ...current.view.drafts, [node.id]: '' },
        })
      if (current.view?.selectedId === node.id) {
        onSent()
      }
    } catch {}
  }

  return (
    <div className="research-composer" role="region" aria-label={t('研究输入')}>
      <textarea
        ref={input}
        value={draft}
        onChange={(event) =>
          setView({ chatDrafts: { ...view.chatDrafts, [node.id]: event.target.value } })
        }
        placeholder={t('在这条分支上，你想聊些什么？')}
        aria-label={t('节点对话输入')}
        maxLength={12000}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
          compositionConfirmUntil.current = performance.now() + 50
        }}
        onKeyDown={(event) => {
          if (
            shouldSendMessage(
              event.nativeEvent,
              sendShortcut,
              composing.current || performance.now() < compositionConfirmUntil.current,
            )
          ) {
            event.preventDefault()
            if (!running) void start()
          }
        }}
      />
      <div className="composer-bottom">
        <ComposerModelPicker onBusyChange={setSelectionBusy} />
        {running && (
          <span className="composer-progress" role="status">
            <LoaderCircle className="spin" size={13} />
            <span>{runtimeLabel(running.phase)}</span>
          </span>
        )}
        {running ? (
          <Button
            className="composer-send"
            aria-label={t('停止回复')}
            title={t('停止回复')}
            onClick={() =>
              void command({ type: 'cancel-research', runId: running.id }).catch(() => {})
            }
          >
            <Square size={14} fill="currentColor" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            variant="primary"
            className="composer-send"
            aria-label={t('发送消息')}
            aria-keyshortcuts={sendShortcut === 'enter' ? 'Enter' : 'Control+Enter Meta+Enter'}
            title={t('发送消息（{{val}}）', { val: sendShortcutLabel(sendShortcut) })}
            onClick={() => void start()}
            disabled={!draft.trim() || selectionBusy}
          >
            <ArrowUp size={18} aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )
}
