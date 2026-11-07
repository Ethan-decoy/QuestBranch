import { uiLocale } from '../i18n'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useRef } from 'react'
import { LoaderCircle, MessageSquare, FileText, Sparkles, CornerDownLeft } from 'lucide-react'
import { useApp } from './state'
import { Button, Feedback } from './components'
import { AgentActivity, ToolActivities } from './agent-activity'
import { useTranslation } from 'react-i18next'
import { runtimeLabel } from './i18n-labels'
import { client } from './client'

export function Conversation({
  nodeId,
  onReadReport,
  onUseSuggestion,
  hasDraft,
}: {
  nodeId: string
  onReadReport: () => void
  onUseSuggestion: (message: string) => void
  hasDraft: boolean
}) {
  const { t } = useTranslation()
  const snapshot = useApp((state) => state.snapshot)!
  const messages = snapshot.messages.filter((message) => message.nodeId === nodeId)
  const runs = snapshot.runs.filter((run) => run.nodeId === nodeId)
  const reports = snapshot.reports.filter((report) => report.nodeId === nodeId)
  const latest = runs.at(-1)
  const activityVersion = JSON.stringify([
    latest?.agent?.activities.map((activity) => [
      activity.id,
      activity.status,
      activity.content.length,
    ]),
    latest?.agent?.requests.map((request) => [request.id, request.status]),
    latest?.activities?.map((activity) => [activity.id, activity.status, activity.content.length]),
  ])
  const root = useRef<HTMLElement>(null),
    follow = useRef(true),
    lastContent = useRef({ length: messages.length, output: latest?.output, activityVersion })
  useEffect(() => {
    const container = root.current?.closest('.detail-body')
    if (!container) return
    const scroll = () => {
      follow.current = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    }
    // An empty conversation can overflow at large text sizes. It has no older
    // message position to preserve, so its first reply should still be followed.
    if (messages.length) scroll()
    container.addEventListener('scroll', scroll)
    return () => container.removeEventListener('scroll', scroll)
  }, [nodeId])
  useEffect(() => {
    const next = { length: messages.length, output: latest?.output, activityVersion }
    if (
      lastContent.current.length === next.length &&
      lastContent.current.output === next.output &&
      lastContent.current.activityVersion === activityVersion
    )
      return
    lastContent.current = next
    const container = root.current?.closest('.detail-body')
    if (container && follow.current) container.scrollTop = container.scrollHeight
  }, [nodeId, messages.length, latest?.output, activityVersion])
  return (
    <section ref={root} className="conversation" aria-label={t('节点对话')}>
      {!messages.length && (
        <div className="conversation-empty">
          <MessageSquare size={25} strokeWidth={1.4} />
          <h3>{reports.length ? t('承接已有研究，继续对话') : t('从这个问题开始')}</h3>
          <p>
            {reports.length
              ? t('可以从已有报告继续提问。')
              : t('先讨论问题，再通过对话保存报告与研究方向。')}
          </p>
          {!reports.length && (
            <div className="research-start-actions">
              <Button variant="ghost" onClick={() => useApp.getState().open('models')}>
                <Sparkles size={14} />
                {client.host ? t('选择 DSH 模型') : t('选择模型或智能体')}
              </Button>
              {!hasDraft && (
                <Button
                  title={t('填入可修改的提问，不会自动发送')}
                  onClick={() =>
                    onUseSuggestion(
                      t(
                        '请围绕当前问题明确研究目标与约束，提出可独立深入的方向。将这份研究计划保存为阶段报告，并建立待研究方向；暂时不要继续研究子分支。',
                      ),
                    )
                  }
                >
                  <CornerDownLeft size={14} />
                  {t('填入示例提问')}
                </Button>
              )}
            </div>
          )}
          {!!reports.length && (
            <Button onClick={onReadReport}>
              <FileText size={14} />
              {t('阅读已有的 {{length}} 份报告', { length: reports.length })}
            </Button>
          )}
        </div>
      )}
      {messages.map((message) => {
        const run = runs.find((run) => run.id === message.runId)
        const assistant = message.role === 'assistant'
        const content = assistant && run?.status === 'running' ? run.output : message.content
        return (
          <article className={`chat-message ${message.role}`} key={message.id}>
            <div className="chat-message-meta">
              <strong>
                {assistant
                  ? run?.agent?.name || (run?.provider === 'codex' ? 'Codex' : 'AI')
                  : t('你')}
              </strong>
              <span>
                {assistant
                  ? run?.model
                  : new Date(message.createdAt).toLocaleTimeString(uiLocale(), {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
              </span>
            </div>
            {assistant && <AgentActivity agent={run?.agent} live={run?.status === 'running'} />}
            {assistant && (
              <ToolActivities activities={run?.activities} live={run?.status === 'running'} />
            )}
            {content && (
              <div className="chat-message-content markdown">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                    img: () => null,
                  }}
                >
                  {content}
                </Markdown>
              </div>
            )}
            {assistant && run?.status === 'running' && (
              <div className="chat-progress" role="status">
                <LoaderCircle className="spin" size={13} />
                {runtimeLabel(run.phase)}
              </div>
            )}
            {assistant &&
              run?.error &&
              (run.status === 'interrupted' || run.status === 'cancelled' ? (
                <p className="context-limitation">{run.error}</p>
              ) : (
                <Feedback tone="error">{run.error}</Feedback>
              ))}
            {assistant && (run?.status === 'cancelled' || run?.status === 'interrupted') && (
              <small
                className={
                  run.status === 'interrupted'
                    ? 'chat-interrupted is-unexpected'
                    : 'chat-interrupted'
                }
              >
                {run.status === 'cancelled'
                  ? t('这次回复已停止，已有内容保留。')
                  : t('应用关闭时回复中断，已有内容保留。')}
              </small>
            )}
          </article>
        )
      })}
    </section>
  )
}
