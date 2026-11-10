import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Report } from '../../research/types'
import { EmptyState, ExternalLink } from '../components'

export function ReportSources({ report }: { report: Report | undefined }) {
  const { t } = useTranslation()
  return (
    <>
      {report && (
        <div className="source-report">
          <FileText size={13} />
          {report.title}
        </div>
      )}
      {report?.sources.length ? (
        report.sources.map((source, i) => (
          <div className="source-card" key={source.id} data-source-id={source.id}>
            <span className="source-number">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <ExternalLink href={source.url}>{source.title}</ExternalLink>
              <small>{safeDomain(source.url)}</small>
              <p>{source.excerpt}</p>
            </div>
          </div>
        ))
      ) : (
        <EmptyState title={t('暂无外部来源')}>{t('此报告未引用外部资料。')}</EmptyState>
      )}
    </>
  )
}
function safeDomain(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
