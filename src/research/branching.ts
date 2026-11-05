import { z } from 'zod'
import type { Report, Snapshot, ViewState } from './types'

export const branchPrerequisite = '先生成研究报告'
export const BranchRequestSchema = z.object({
  parentId: z.string().min(1).max(200),
  sourceReportId: z.string().min(1, branchPrerequisite).max(200),
  requestId: z.string().trim().min(1).max(200),
  branches: z
    .array(
      z.object({
        question: z.string().trim().min(1, '请输入研究问题').max(6000),
        title: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .min(1)
    .max(20),
  relatedIds: z.array(z.string().min(1).max(200)).max(100).default([]),
  referenceReportIds: z.array(z.string().min(1).max(200)).max(20).default([]),
})
export type BranchRequest = z.input<typeof BranchRequestSchema>
export type BranchReceipt = {
  requestId: string
  workspaceId: string
  parentId: string
  sourceReportId: string
  fingerprint: string
  nodeIds: string[]
}

/** Use the version the reader selected, otherwise the latest saved version.
 * Running/failed attempts do not invalidate an earlier saved report. */
export function branchReport(
  snapshot: Pick<Snapshot, 'nodes' | 'reports'>,
  parentId: string | null | undefined,
  view?: Pick<ViewState, 'readers'> | null,
): Report | undefined {
  const parent = snapshot.nodes.find((node) => node.id === parentId)
  if (!parent || parent.removedAt) return undefined
  const reports = snapshot.reports.filter(
    (report) => report.nodeId === parent.id && report.workspaceId === parent.workspaceId,
  )
  return (
    reports.find((report) => report.id === view?.readers?.[parent.id]?.reportId) ?? reports.at(-1)
  )
}
