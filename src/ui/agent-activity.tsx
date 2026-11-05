import { useState } from 'react'
import { Check, Circle, LoaderCircle, Search, Wrench, X, Undo2 } from 'lucide-react'
import type { AgentRequest, AgentRun, AgentActivity as Activity } from '../research/agent'
import { Button, Feedback } from './components'
import { client } from './client'
import { useApp } from './state'
import { useTranslation } from 'react-i18next'
import { runtimeLabel } from './i18n-labels'

export function AgentRequests({
  requests,
  live = true,
}: {
  requests: AgentRequest[]
  live?: boolean
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  const respond = async (
    request: AgentRequest,
    optionId?: string,
    action?: 'accept' | 'cancel',
  ) => {
    setBusy(request.id)
    setError('')
    try {
      await client.agent?.respond(request.connectionId, request.id, { optionId, action })
    } catch (error) {
      setError(error instanceof Error ? error.message : t('回应未能发送'))
    } finally {
      setBusy('')
    }
  }
  return (
    <>
      {requests
        .filter((request) => request.status === 'pending' && live)
        .map((request) => (
          <section key={request.id} className="agent-request" aria-label={t('智能体请求')}>
            <p>{request.title}</p>
            <div className="agent-request-actions">
              {request.kind === 'url' && (
                <>
                  {request.url && /^https?:\/\//i.test(request.url) && (
                    <a
                      className="button"
                      href={request.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('打开浏览器')}
                    </a>
                  )}
                  <Button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void respond(request, undefined, 'accept')}
                  >
                    {t('继续')}
                  </Button>
                </>
              )}
              {request.options.map((option) => (
                <Button
                  type="button"
                  key={option.id}
                  disabled={!!busy}
                  onClick={() => void respond(request, option.id)}
                >
                  {option.name}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                disabled={!!busy}
                onClick={() => void respond(request, undefined, 'cancel')}
              >
                {t('取消')}
              </Button>
            </div>
          </section>
        ))}
      {error && <Feedback tone="error">{error}</Feedback>}
    </>
  )
}

export function AgentActivity({ agent, live }: { agent?: AgentRun; live: boolean }) {
  const { t } = useTranslation()
  if (!agent) return null
  return (
    <div className="agent-activity" aria-label={t('智能体活动')}>
      <ToolActivities activities={agent.activities} live={live} />
      <AgentRequests requests={agent.requests} live={live} />
    </div>
  )
}
export function ToolActivities({
  activities = [],
  live,
}: {
  activities?: Activity[]
  live: boolean
}) {
  const { t } = useTranslation()
  const snapshot = useApp((state) => state.snapshot)
  const command = useApp((state) => state.command)
  const [busy, setBusy] = useState('')
  if (!activities.length) return null
  return (
    <div className="tool-activities" aria-label={t('研究工具调用')}>
      {activities.map((activity) => {
        const pending = ['pending', 'in_progress'].includes(activity.status)
        const undo = activity.undo
        const removable =
          undo &&
          snapshot?.nodes.some(
            (node) =>
              node.id === undo.nodeId && node.removalId === undo.removalId && node.removedAt,
          )
        return (
          <div key={activity.id} className="tool-activity-row">
            <details className="agent-tool" open={!!activity.undo}>
              <summary>
                {pending && live ? (
                  <LoaderCircle className="spin" size={13} />
                ) : activity.status === 'completed' ? (
                  <Check size={13} />
                ) : activity.status === 'failed' ? (
                  <X size={13} />
                ) : (
                  <Circle size={13} />
                )}
                {activity.kind === 'search' ? <Search size={13} /> : <Wrench size={13} />}
                <span>{runtimeLabel(activity.title)}</span>
              </summary>
              {activity.content && <pre>{activity.content}</pre>}
            </details>
            {removable && (
              <button
                className="button tool-undo"
                disabled={busy === activity.id}
                onClick={() => {
                  setBusy(activity.id)
                  void command({
                    type: 'restore-branch',
                    nodeId: undo.nodeId,
                    removalId: undo.removalId,
                  })
                    .catch(() => {})
                    .finally(() => setBusy(''))
                }}
              >
                <Undo2 size={13} />
                {t('撤销')}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
