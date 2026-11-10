import { z } from 'zod'
import { viewSchema } from './storage-schemas'
import { ReasoningEffortSchema, ApiProtocolSchema } from '../research/types'
import { AgentConfigSchema } from '../research/agent'

export const id = z.string().min(1).max(200),
  question = z.string().trim().min(1, '请输入研究问题').max(6000),
  key = z.string().max(1000).optional()
export const settingsSchema = z.object({
  sessionStrategy: z.enum(['auto', 'native', 'portable']).optional(),
  sessionInputBudget: z.number().int().min(4000).max(2000000).optional(),
  modelContextWindow: z.number().int().min(4000).max(2000000).optional(),
  backend: z.enum(['model', 'acp']).optional(),
  agent: AgentConfigSchema.optional(),
  provider: z.enum(['compatible', 'ollama', 'account']),
  modelProvider: z.string().min(1).max(200).optional(),
  baseUrl: z
    .string()
    .max(1000)
    .refine((value) => {
      if (!value) return true
      try {
        const url = new URL(value)
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        )
      } catch {
        return false
      }
    }, '服务地址应为不含密钥、查询参数或片段的 HTTP / HTTPS 地址'),
  model: z.string().max(200),
  apiProtocol: ApiProtocolSchema.optional(),
  maxOutputTokens: z.number().int().min(1).max(128000).optional(),
  anthropicWorkspaceId: z.string().trim().max(200).optional(),
  jsonMode: z.boolean(),
  contextBudget: z.number().int().min(4000).max(128000),
  apiKey: key,
  searchKey: key,
  clearApiKey: z.boolean().optional(),
  clearSearchKey: z.boolean().optional(),
  reasoningEffort: ReasoningEffortSchema.or(z.literal('')).optional(),
})
export const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create-workspace'),
    question,
    name: z.string().trim().max(100).optional(),
    constraints: z.string().max(6000).optional(),
  }),
  z.object({
    type: z.literal('create-node'),
    parentId: id,
    sourceReportId: id,
    question,
    requestId: id.optional(),
    relatedIds: z.array(id).max(10).optional(),
    referenceReportIds: z.array(id).max(20).optional(),
  }),
  z.object({ type: z.literal('edit-node'), nodeId: id, question }),
  z.object({ type: z.literal('remove-branch'), nodeId: id, requestId: id }),
  z.object({ type: z.literal('restore-branch'), nodeId: id, removalId: id }),
  z.object({ type: z.literal('save-view'), workspaceId: id, view: viewSchema }),
  z.object({
    type: z.literal('save-settings'),
    settings: settingsSchema,
  }),
  z.object({
    type: z.literal('start-research'),
    nodeId: id,
    instruction: z.string().trim().max(12000),
    reportIds: z.array(id).max(20).optional(),
    selectedReportId: id.optional(),
  }),
  z.object({ type: z.literal('cancel-research'), runId: id }),
  z.object({ type: z.literal('reset-agent-session'), nodeId: id }),
  z.object({
    type: z.literal('send-message'),
    nodeId: id,
    message: z.string().trim().min(1, '请输入对话内容').max(12000),
    selectedReportId: id.optional(),
  }),
  z.object({ type: z.literal('import-workspace'), data: z.unknown() }),
])
