import type { Snapshot } from '../research/types'
import { ancestorPath } from '../research/context'
import i18next from '../i18n'

export type ResearchSearchHit = {
  kind: 'node' | 'report' | 'source'
  nodeId: string
  reportId?: string
  sourceId?: string
  title: string
  excerpt: string
  path: string
  label: string
  query: string
}
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
function excerpt(text: string, query: string) {
  const content = normalize(text),
    start = Math.max(0, content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) - 45)
  return `${start ? '…' : ''}${content.slice(start, start + 150)}${content.length > start + 150 ? '…' : ''}`
}

/** Local text search retains exact report/source identity, including historical report versions. */
export function searchResearch(
  snapshot: Snapshot,
  workspaceId: string,
  input: string,
  kind: ResearchSearchHit['kind'] | 'all' = 'all',
) {
  const query = normalize(input),
    lower = query.toLocaleLowerCase(),
    nodes = snapshot.nodes.filter((node) => node.workspaceId === workspaceId && !node.removedAt),
    byId = new Map(nodes.map((node) => [node.id, node])),
    hits: ResearchSearchHit[] = []
  const matches = (text: string) => normalize(text).toLocaleLowerCase().includes(lower)
  const push = (hit: Omit<ResearchSearchHit, 'path' | 'query'>) => {
    if (hits.length >= 60) return
    hits.push({
      ...hit,
      query,
      path: ancestorPath(nodes, hit.nodeId)
        .map((node) => node.title)
        .join(' / '),
    })
  }
  if (kind === 'all' || kind === 'node')
    for (const node of nodes) {
      const text = `${node.title}\n${node.question}\n${node.summary}`
      if (matches(text))
        push({
          kind: 'node',
          nodeId: node.id,
          title: node.title,
          excerpt: excerpt(text, query),
          label: i18next.t('研究'),
        })
    }
  // Empty input is a node directory, not an exhaustive list of every stored paragraph.
  if (!query) return hits
  const versions = new Map<string, number>()
  for (const report of snapshot.reports) {
    if (!byId.has(report.nodeId) || report.workspaceId !== workspaceId) continue
    const version = (versions.get(report.nodeId) ?? 0) + 1
    versions.set(report.nodeId, version)
    if ((kind === 'all' || kind === 'report') && matches(`${report.title}\n${report.markdown}`))
      push({
        kind: 'report',
        nodeId: report.nodeId,
        reportId: report.id,
        title: report.title,
        excerpt: excerpt(report.markdown, query),
        label: i18next.t('报告 · v{{version}}', { version }),
      })
    if (kind === 'all' || kind === 'source')
      for (const source of report.sources)
        if (matches(`${source.title}\n${source.url}\n${source.excerpt}`))
          push({
            kind: 'source',
            nodeId: report.nodeId,
            reportId: report.id,
            sourceId: source.id,
            title: source.title,
            excerpt: excerpt(source.excerpt || source.url, query),
            label: i18next.t('来源 · 报告 v{{version}}', { version }),
          })
  }
  return hits
}
