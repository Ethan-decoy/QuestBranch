import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { uiLocale } from '../../i18n'
import type { ResearchRun } from '../../research/types'
import { useApp } from '../state'
import { Feedback } from '../components'

export function RunDiagnostics({ run }: { run: ResearchRun }) {
  const { t } = useTranslation()
  const snapshot = useApp((s) => s.snapshot)!,
    changed = run.context.items
      .filter((item) => item.included)
      .filter((item) => {
        const latest = snapshot.reports.filter((r) => r.nodeId === item.nodeId).at(-1)
        return latest && latest.id !== item.reportId
      })
  return (
    <>
      <h4>
        {run.agent?.name === 'DeepSeek Harness' ? t('研究材料选择记录') : t('实际使用的上下文')}
      </h4>
      <p className="muted small-text">
        {t('约 {{used}} / {{budget}} tokens', {
          used: run.context.estimatedTokens.toLocaleString(uiLocale()),
          budget: run.context.budget.toLocaleString(uiLocale()),
        })}{' '}
        · {run.context.policy}
      </p>
      <ul className="context-items">
        <li>
          <Check size={12} /> {t('根问题、目标与全局约束')}
        </li>
        <li>
          <Check size={12} /> {t('当前问题、研究路径与本次指令')}
        </li>
        {run.context.items.map((item) => (
          <li key={item.reportId}>
            <span>{item.included ? <Check size={12} /> : <span>−</span>}</span>
            <div>
              {item.title}
              <small>
                {item.reason} ·{' '}
                {item.included ? (item.excerpted ? t('采用摘要') : t('采用全文')) : t('因预算省略')}
              </small>
              <code>{item.reportId.slice(0, 16)}</code>
            </div>
          </li>
        ))}
      </ul>
      {!!run.context.conversation?.includedMessageIds.length && (
        <p className="context-limitation">
          {t('承接本节点 {{count}} 轮对话；消息原文保存在“对话”中。', {
            count: run.context.conversation.includedMessageIds.length / 2,
          })}
        </p>
      )}
      {changed.length > 0 && (
        <Feedback tone="warning">
          <strong>{t('上游报告有更新')}</strong>
          {t('{{count}} 份上游报告已有新版本；本次记录仍保留研究当时采用的版本。', {
            count: changed.length,
          })}
        </Feedback>
      )}
      {run.context.limitations.map((item, i) => (
        <p className="context-limitation" key={i}>
          {item}
        </p>
      ))}
      <details className="raw-details">
        <summary>{t('查看实际发送的输入')}</summary>
        <pre>
          {run.agent?.input
            ? JSON.stringify(run.agent.input, null, 2)
            : run.agent?.name === 'DeepSeek Harness'
              ? t('此历史记录未保存原生请求，无法还原实际发送内容。')
              : run.session
                ? JSON.stringify(run.session, null, 2)
                : run.context.messages
                    .map((message) => `[${message.role}]\n${message.content}`)
                    .join('\n\n')}
        </pre>
      </details>
      <details className="raw-details">
        <summary>{t('查看模型原始输出')}</summary>
        <pre>{run.output || t('尚无输出')}</pre>
      </details>
    </>
  )
}
