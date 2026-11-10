import { z } from 'zod'

const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const TokenUsageSchema = z.object({
  inputTokens: tokens.optional(),
  uncachedInputTokens: tokens.optional(),
  cacheReadTokens: tokens.optional(),
  cacheWriteTokens: tokens.optional(),
  outputTokens: tokens.optional(),
  reasoningTokens: tokens.optional(),
})
export type TokenUsage = z.infer<typeof TokenUsageSchema>
export const ModelCallSchema = z.object({
  id: z.string().min(1).max(200),
  phase: z.enum(['reply', 'memory', 'compaction']),
  provider: z.string().max(200),
  model: z.string().max(200),
  api: z.string().max(100),
  billing: z.enum(['api', 'subscription', 'local']),
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
  responseId: z.string().max(200).optional(),
  source: z.enum(['pi', 'native']),
  sessionContext: z
    .object({
      sessionId: z.string().min(1).max(512),
      sourceRevision: z.number().int().nonnegative(),
      checkpointId: z.string().max(512).nullable(),
      phase: z.enum(['summary', 'working-memory', 'observer', 'reflector', 'native-compaction']),
      modelId: z.string().max(512).optional(),
      throughId: z.string().max(512).optional(),
      callId: z.string().max(512).optional(),
    })
    .optional(),
  usage: TokenUsageSchema.optional(),
})
export type ModelCall = z.infer<typeof ModelCallSchema>
