import type { Report, ResearchNode, ResearchRun } from '../research/types'

type StatusSnapshot = {
  runs: Pick<ResearchRun, 'nodeId' | 'status' | 'mode'>[]
  reports: Pick<Report, 'nodeId'>[]
}
export type ResearchStatus = {
  key: 'pending' | 'discussed' | 'running' | 'ready' | 'failed' | 'interrupted'
  label: string
}

// This describes available research and the latest run, never factual certainty
// or completion of the question. A cancelled run leaves existing work available.
export function nodeStatus(
  node: Pick<ResearchNode, 'id'>,
  snapshot: StatusSnapshot,
): ResearchStatus {
  const run = snapshot.runs.findLast((candidate) => candidate.nodeId === node.id)
  if (run?.status === 'running')
    return { key: 'running', label: run.mode === 'chat' ? '讨论中' : '研究中' }
  if (run?.status === 'failed') return { key: 'failed', label: '需要重试' }
  if (run?.status === 'interrupted') return { key: 'interrupted', label: '已中断' }
  if (snapshot.reports.some((report) => report.nodeId === node.id))
    return { key: 'ready', label: '已有认识' }
  if (
    snapshot.runs.some(
      (candidate) =>
        candidate.nodeId === node.id &&
        candidate.mode === 'chat' &&
        candidate.status === 'completed',
    )
  )
    return { key: 'discussed', label: '已开展讨论' }
  return { key: 'pending', label: '待研究' }
}
