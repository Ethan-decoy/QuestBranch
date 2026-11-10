import { ChevronDown, CircleHelp, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Report } from '../../research/types'

export function ReportOverview({
  report,
  open,
  onOpenChange,
}: {
  report: Report
  open: boolean
  onOpenChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <details
      className="report-overview"
      open={open}
      onToggle={(event) => {
        const enabled = event.currentTarget.open
        if (enabled !== open) onOpenChange(enabled)
      }}
    >
      <summary>
        <Sparkles size={13} />
        {t('概览')}
        <ChevronDown size={11} className="disclosure-marker" />
      </summary>
      <section className="insight-box">
        <div className="section-label">
          <Sparkles size={14} />
          {t('阶段认识')}
        </div>
        <p>{report.summary}</p>
      </section>
      {report.openQuestions.length > 0 && (
        <section className="open-questions">
          <div className="section-label">
            <CircleHelp size={14} />
            {t('尚待弄清')}
          </div>
          <ul>
            {report.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}
    </details>
  )
}
