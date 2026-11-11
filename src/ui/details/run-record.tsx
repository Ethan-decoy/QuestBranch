import { useState } from 'react'
import { Check, CirclePause, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { uiLocale } from '../../i18n'
import type { ResearchRun } from '../../research/types'
import { useApp } from '../state'
import { Button, Feedback, SignalIcon } from '../components'
import { AgentActivity, ToolActivities } from '../agent-activity'
import { RunDiagnostics } from './run-diagnostics'
import { client } from '../client'

export function RunRecord({ run }: { run: ResearchRun }) {
  const { t } = useTranslation()
  const [reset, setReset] = useState<'idle' | 'pending' | 'done'>('idle')
  const refresh = useApp((state) => state.refresh)
  const setError = useApp((state) => state.setError)
  const resetSession = client.agent?.resetSession
  const rebuildSession = async () => {
    if (!resetSession) return
    setReset('pending')
    try {
      const result = await resetSession(run.id)
      if (result?.id !== run.id) throw new Error(t('操作未完成'))
      setReset('done')
      await refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : t('操作未完成'))
      setReset('idle')
    }
  }
  const Container = import.meta.env.DEV ? 'details' : 'article',
    Header = import.meta.env.DEV ? 'summary' : 'div'
  return (
    <Container className="run-record">
      <Header className="run-record-summary">
        <div>
          <span className={`record-icon ${run.status}`}>
            {run.status === 'failed' ? (
              <SignalIcon tone="error" size={18} />
            ) : run.status === 'interrupted' ? (
              <CirclePause size={14} />
            ) : (
              <Sparkles size={14} />
            )}
          </span>
          <div>
            <strong>{run.instruction || t('研究当前问题')}</strong>
            <small>
              {new Date(run.createdAt).toLocaleString(uiLocale(), {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              · {run.model}
              {run.reasoningEffort ? ` · ${run.reasoningEffort}` : ''}
            </small>
          </div>
        </div>
        <span className={`record-state ${run.status}`}>
          {run.status === 'completed'
            ? t('已完成')
            : run.status === 'running'
              ? run.mode === 'chat'
                ? t('回复中')
                : t('生成报告中')
              : run.status === 'cancelled'
                ? t('已取消')
                : run.status === 'interrupted'
                  ? t('已中断')
                  : t('未完成')}
        </span>
      </Header>
      {run.error &&
        (run.status === 'interrupted' || run.status === 'cancelled' ? (
          <p className="context-limitation">{run.error}</p>
        ) : (
          <Feedback tone="error">{run.error}</Feedback>
        ))}
      <AgentActivity agent={run.agent} live={run.status === 'running'} />
      <ToolActivities activities={run.activities} live={run.status === 'running'} />
      {resetSession && (run.agentSessionBindingId || reset === 'done') && (
        <Button
          disabled={reset !== 'idle'}
          aria-busy={reset === 'pending'}
          onClick={() => void rebuildSession()}
          title={t('保留已有研究记录，下次使用此连接时建立新会话')}
        >
          {reset === 'done' ? <Check size={13} /> : <Sparkles size={13} />}
          {t('重建智能体会话')}
        </Button>
      )}
      {import.meta.env.DEV && <RunDiagnostics run={run} />}
    </Container>
  )
}
