import { useState } from 'react'
import { Check, CirclePause, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { uiLocale } from '../../i18n'
import type { ResearchRun } from '../../research/types'
import { useApp } from '../state'
import { Button, Feedback, SignalIcon } from '../components'
import { AgentActivity, ToolActivities } from '../agent-activity'
import { RunDiagnostics } from './run-diagnostics'

export function RunRecord({ run }: { run: ResearchRun }) {
  const { t } = useTranslation()
  const [reset, setReset] = useState(false)
  const command = useApp((state) => state.command)
  const settings = useApp((state) => state.snapshot?.settings)
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
      {run.recovery === 'agent-session' && settings?.backend === 'acp' && (
        <Button
          disabled={reset}
          onClick={() =>
            void command({ type: 'reset-agent-session', nodeId: run.nodeId })
              .then(() => setReset(true))
              .catch(() => {})
          }
          title={t('保留已有研究记录，下次发送时建立新的原生会话')}
        >
          {reset ? <Check size={13} /> : <Sparkles size={13} />}
          {t('重建智能体会话')}
        </Button>
      )}
      {import.meta.env.DEV && <RunDiagnostics run={run} />}
    </Container>
  )
}
