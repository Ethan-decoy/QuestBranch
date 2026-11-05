import type { Report } from './types'

export const defaultComparisonDimensions = ['核心结论', '适用条件', '证据与局限', '未解问题']

export function comparisonDimensions(input: string) {
  const dimensions = [
    ...new Set(
      input
        .split(/[\n;；]/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ]
  if (!dimensions.length) throw new Error('请填写至少一个共同维度')
  if (dimensions.length > 12 || dimensions.some((line) => line.length > 120))
    throw new Error('最多填写 12 个维度，每个不超过 120 字')
  return dimensions
}

export function comparisonInstruction(
  reports: readonly [Report, Report],
  dimensions: string[],
  instruction: string,
) {
  if (reports[0].id === reports[1].id) throw new Error('请选择两份不同的报告')
  if (reports[0].workspaceId !== reports[1].workspaceId)
    throw new Error('比较报告须属于同一研究空间')
  const selected = reports
    .map(
      (report, index) =>
        `${index ? 'B' : 'A'}：「${report.title}」；报告 ID：${report.id}；保存时间：${report.createdAt}`,
    )
    .join('\n')
  const result = `比较材料（仅以以下选定报告版本作为方案依据，其他背景材料不能替换它们）：\n${selected}\n\n共同维度：\n${dimensions.map((dimension, index) => `${index + 1}. ${dimension}`).join('\n')}\n\n在完整研究报告中按上述相同维度生成 GFM Markdown 比较表，列为「共同维度」「方案 A」「方案 B」「一致、冲突与互补」。各方案单元格区分结论、适用条件、未知项和依据，引用选定报告 ID 与材料中已有的真实来源；仅有摘要或材料未覆盖的内容明确标为待核查，不补造证据，不自动评分。表后形成阶段性综合、分歧和后续问题，保留原报告观点与版本归属。\n\n补充指令：\n${instruction.trim() || '围绕当前研究目标综合分析。'}`
  if (result.length > 12000) throw new Error('综合研究指令过长，请精简维度或补充指令')
  return result
}
