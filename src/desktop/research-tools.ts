import { z } from 'zod'
import { BranchRequestSchema, branchReport } from '../research/branching'
import { ancestorPath } from '../research/context'
import type { ResearchStore } from './store'
import { ResearchOutputSchema } from '../research/types'

export type ResearchToolResult = {
  value: Record<string, unknown>
  summary: string
  undo?: { nodeId: string; removalId: string }
}
export type ResearchTool = {
  name: string
  title: string
  description: string
  parameters: z.ZodObject
  readOnly: boolean
  execute: (input: unknown) => ResearchToolResult
}

const reportInput = z.object({
  report_id: z.string().min(1).max(200),
  offset: z.number().int().min(0).optional(),
  max_chars: z.number().int().min(200).max(4000).optional(),
  section: z.enum(['markdown', 'sources']).optional(),
})
const inventoryInput = z.object({ offset: z.number().int().min(0).optional() })
const saveInput = ResearchOutputSchema.extend({ request_id: z.string().trim().min(1).max(200) })
const createInput = z.object({
  source_report_id: z.string().min(1).max(200),
  request_id: z.string().min(1).max(200),
  branches: BranchRequestSchema.shape.branches,
})
const removeInput = z.object({
  node_id: z.string().min(1).max(200),
  expected_title: z.string().min(1).max(1000),
  request_id: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
})
const restoreInput = z.object({
  node_id: z.string().min(1).max(200),
  removal_id: z.string().min(1).max(200),
})

/** Metadata is shared by execution and context budgeting, without opening a run. */
export const researchToolSpecifications = {
  qb_get_research: {
    name: 'qb_get_research',
    title: '读取研究与分支',
    readOnly: true,
    parameters: inventoryInput,
    description:
      '读取当前节点、分支的真实编号和标题、已移除子分支、已保存报告与确切来源版本。创建或移除之前先读取，不能猜编号。“1”优先作为标题精确匹配，不等同于第一个分支；目标不唯一时询问用户。',
  },
  qb_get_report: {
    name: 'qb_get_report',
    title: '读取研究报告',
    readOnly: true,
    parameters: reportInput,
    description:
      '按页读取当前研究已有报告或已纳入上下文的确切版本。返回 next_offset 时继续读取；section=sources 读取来源分页。不能读取其他研究空间。',
  },
  qb_create_branches: {
    name: 'qb_create_branches',
    title: '创建研究方向',
    readOnly: false,
    parameters: createInput,
    description:
      '依据当前节点已保存的 source_report_id 创建待研究子方向，返回真实节点。没有当前节点自己的报告时，先使用 qb_save_research 保存当前讨论的阶段报告并一并创建方向，不能使用祖先报告冒充当前节点报告。同次重试复用 request_id，不自动启动研究。',
  },
  qb_save_research: {
    name: 'qb_save_research',
    title: '保存报告与研究方向',
    readOnly: false,
    parameters: saveInput,
    description:
      '在当前节点保存完整阶段研究报告，并将 followups 中已明确的方向一并创建为待研究子分支。用户要求整理成果或构建已讨论的分支时使用；无需当前节点已有报告。仅保存报告时 followups=[]。保留共识、分歧、依据与未验证主张，不为通过校验编造研究。报告归属当前节点，祖先报告可作为参考，不能冒充当前节点成果。报告与子节点原子保存，成功返回 report_id 和 node_ids 后才能确认；同次重试复用 request_id，修改内容使用新编号。',
  },
  qb_remove_branch: {
    name: 'qb_remove_branch',
    title: '移除研究分支',
    readOnly: false,
    parameters: removeInput,
    description:
      '仅在用户明确要求移除时，移除当前研究的一条直接子分支及其后代。必须使用读取到的 node_id 和完全相同的 expected_title；request_id 是幂等键。保留原记录，可撤销；根节点或正在运行的子树不能移除。工具成功后才能声称已移除。',
  },
  qb_restore_branch: {
    name: 'qb_restore_branch',
    title: '恢复研究分支',
    readOnly: false,
    parameters: restoreInput,
    description: '根据已移除分支的 node_id 与 removal_id 撤销移除，恢复原节点及该次移除的后代。',
  },
} satisfies Record<string, Omit<ResearchTool, 'execute'>>

/** The same domain operations back model tool calls and the per-run MCP server. */
export function researchTools(
  store: ResearchStore,
  runId: string,
  signal: AbortSignal,
): ResearchTool[] {
  const run = store.run(runId),
    nodeId = run.nodeId,
    workspaceId = run.workspaceId
  const initial = store.snapshot()
  const selectedReportId =
    run.selectedReportId ?? branchReport(initial, nodeId, initial.views[workspaceId])?.id
  const active = () => {
    signal.throwIfAborted()
    if (store.run(runId).status !== 'running' || store.node(nodeId).removedAt)
      throw new Error('本次研究工具连接已结束')
  }
  const reports = () => {
    active()
    const included = new Set(
      run.context.items.filter((item) => item.included).map((item) => item.reportId),
    )
    return store
      .snapshot()
      .reports.filter(
        (report) =>
          report.workspaceId === workspaceId &&
          (report.nodeId === nodeId || included.has(report.id)),
      )
  }
  const child = (id: string) => {
    active()
    const node = store.node(id)
    if (node.workspaceId !== workspaceId || node.parentId !== nodeId)
      throw new Error('只能操作当前研究的直接子分支，请先读取研究中的真实节点编号')
    return node
  }
  return [
    {
      ...researchToolSpecifications.qb_get_research,
      execute(input) {
        active()
        const { offset = 0 } = inventoryInput.parse(input)
        const snapshot = store.snapshot(),
          available = reports()
        const selected =
          available.find((report) => report.id === selectedReportId) ??
          available.filter((report) => report.nodeId === nodeId).at(-1)
        return {
          summary: '已读取当前研究、报告版本和分支目录',
          value: {
            workspace: {
              id: workspaceId,
              name: snapshot.workspaces.find((workspace) => workspace.id === workspaceId)?.name,
            },
            current_node: {
              id: nodeId,
              title: store.node(nodeId).title,
              originReportId: store.node(nodeId).originReportId,
            },
            selected_report_id: selected?.id ?? null,
            can_save_research: run.mode === 'chat',
            path: ancestorPath(snapshot.nodes, nodeId).map(({ id, title }) => ({ id, title })),
            reports: available
              .slice(offset, offset + 4)
              .map(({ id, nodeId: owner, title, summary, createdAt }) => ({
                id,
                node_id: owner,
                title,
                summary: summary.slice(0, 200),
                summary_excerpted: summary.length > 200,
                created_at: createdAt,
                version:
                  snapshot.reports
                    .filter((report) => report.nodeId === owner)
                    .findIndex((report) => report.id === id) + 1,
                can_derive: owner === nodeId,
              })),
            children: snapshot.nodes
              .filter((node) => node.parentId === nodeId && !node.removedAt)
              .slice(offset, offset + 4)
              .map(({ id, title, originReportId }) => ({ id, title, originReportId })),
            removed_children: snapshot.nodes
              .filter((node) => node.parentId === nodeId && node.removedAt)
              .slice(offset, offset + 4)
              .map(({ id, title, removedAt, removalId }) => ({
                id,
                title,
                removed_at: removedAt,
                removal_id: removalId,
              })),
            next_offset:
              Math.max(
                available.length,
                snapshot.nodes.filter((node) => node.parentId === nodeId).length,
              ) >
              offset + 4
                ? offset + 4
                : null,
          },
        }
      },
    },
    {
      ...researchToolSpecifications.qb_get_report,
      execute(input) {
        const {
          report_id,
          offset = 0,
          max_chars = 2000,
          section = 'markdown',
        } = reportInput.parse(input)
        const report = reports().find((report) => report.id === report_id)
        if (!report) throw new Error('报告不在本次研究可读取的范围内')
        const content = section === 'markdown' ? report.markdown : JSON.stringify(report.sources)
        if (offset > content.length) throw new Error('报告分页位置超出正文范围')
        let end = Math.min(content.length, offset + max_chars)
        if (end < content.length && /[\uDC00-\uDFFF]/.test(content[end])) end--
        return {
          value: {
            report: {
              id: report.id,
              nodeId: report.nodeId,
              title: report.title,
              ...(section === 'markdown'
                ? { markdown: content.slice(offset, end) }
                : { sources_json: content.slice(offset, end) }),
            },
            section,
            offset,
            total_chars: content.length,
            next_offset: end < content.length ? end : null,
          },
          summary: `已读取《${report.title}》${end < content.length || offset ? '分页' : ''}`,
        }
      },
    },
    {
      ...researchToolSpecifications.qb_save_research,
      execute(input) {
        active()
        const { request_id, ...output } = saveInput.parse(input)
        const saved = store.saveResearch(runId, request_id, output)
        return {
          value: {
            request_id,
            report_id: saved.reportId,
            parent_id: nodeId,
            node_ids: saved.nodeIds,
          },
          summary: saved.nodeIds.length
            ? `已保存报告与 ${saved.nodeIds.length} 个研究方向`
            : '已保存研究报告',
        }
      },
    },
    {
      ...researchToolSpecifications.qb_create_branches,
      execute(input) {
        active()
        const { source_report_id, request_id, branches } = createInput.parse(input)
        const receipt = store.createBranches({
          parentId: nodeId,
          sourceReportId: source_report_id,
          requestId: request_id,
          branches,
        })
        return {
          value: {
            request_id: receipt.requestId,
            source_report_id: receipt.sourceReportId,
            parent_id: receipt.parentId,
            node_ids: receipt.nodeIds,
            nodes: receipt.nodeIds.map((id) => store.node(id)),
          },
          summary: `已保存 ${receipt.nodeIds.length} 个研究方向`,
        }
      },
    },
    {
      ...researchToolSpecifications.qb_remove_branch,
      execute(input) {
        const { node_id, expected_title, request_id } = removeInput.parse(input)
        const target = child(node_id)
        if (target.title !== expected_title)
          throw new Error('分支标题与编号不匹配，请重新读取并确认目标')
        const receipt = store.removeBranch(node_id, request_id)
        return {
          value: {
            removed: true,
            node_id,
            title: target.title,
            removal_id: receipt.removalId,
            node_ids: receipt.nodeIds,
          },
          summary: `已移除「${target.title}」`,
          undo: { nodeId: node_id, removalId: receipt.removalId },
        }
      },
    },
    {
      ...researchToolSpecifications.qb_restore_branch,
      execute(input) {
        const { node_id, removal_id } = restoreInput.parse(input)
        const target = child(node_id)
        store.restoreBranch(node_id, removal_id)
        return {
          value: { restored: true, node_id, title: target.title },
          summary: `已恢复「${target.title}」`,
        }
      },
    },
  ]
}
