import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'

export function reportHeadings(markdown: string) {
  let fence = ''
  return markdown.split('\n').flatMap((text, index) => {
    const marker = text.trim().match(/^(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''
      return []
    }
    if (fence) return []
    const heading = text.match(/^ {0,3}(#{1,3})\s+(.+?)(?:\s+#+)?\s*$/)
    return heading
      ? [{ line: index + 1, level: heading[1].length, title: heading[2].replace(/[*_`]/g, '') }]
      : []
  })
}

export function ReportMarkdown({ children }: { children: string }) {
  const { t } = useTranslation()
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        h1: ({ node, children }) => (
          <h1 tabIndex={-1} data-line={node?.position?.start.line}>
            {children}
          </h1>
        ),
        h2: ({ node, children }) => (
          <h2 tabIndex={-1} data-line={node?.position?.start.line}>
            {children}
          </h2>
        ),
        h3: ({ node, children }) => (
          <h3 tabIndex={-1} data-line={node?.position?.start.line}>
            {children}
          </h3>
        ),
        table: ({ children }) => (
          <div
            className="table-scroll"
            role="region"
            aria-label={t('报告表格，可横向滚动')}
            tabIndex={0}
          >
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {children}
    </Markdown>
  )
}
