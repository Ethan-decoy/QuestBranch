import type { ModelCatalog, ReasoningEffort, Settings } from './types'

export const effortLabels: Record<ReasoningEffort, string> = {
  none: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
  ultra: '旧版档位，请重新选择',
}

export function resolveModelSelection(
  settings: Pick<Settings, 'model' | 'reasoningEffort'>,
  catalog: ModelCatalog,
) {
  const model = settings.model || catalog.defaults.model
  const capability = catalog.models.find((entry) => entry.model === model)
  if (!capability) throw new Error(`当前目录未提供模型 ${model}，请重新选择模型`)
  const reasoningEffort = settings.reasoningEffort || capability.defaultReasoningEffort
  if (
    !capability.supportedReasoningEfforts.some((entry) => entry.reasoningEffort === reasoningEffort)
  )
    throw new Error('当前模型不支持所选思考强度，请重新选择')
  return { model, reasoningEffort }
}
