import { z } from 'zod'

export type NativeModelSelection = { provider: string; model: string; reasoningEffort?: string }
export type NativeModelCatalog = {
  default: NativeModelSelection
  groups: {
    id: string
    name: string
    models: {
      id: string
      name: string
      reasoning?: { efforts: { id: string; name: string }[]; defaultEffort?: string }
    }[]
  }[]
  failures: { id: string; name: string; message: string }[]
}
export type NativeModelState = { catalog: NativeModelCatalog; selection: NativeModelSelection }

export const AgentConfigSchema = z.object({
  kind: z.enum(['codex', 'custom']),
  command: z.string().trim().max(2000).optional(),
  args: z.array(z.string().max(4000)).max(60).optional(),
  cwd: z.string().trim().max(2000).optional(),
  options: z.record(z.string().max(200), z.string().max(1000)).optional(),
  name: z.string().max(200).optional(),
})
export type AgentConfig = z.infer<typeof AgentConfigSchema>
export const AgentActivitySchema = z.object({
  id: z.string().max(200),
  title: z.string().max(1000),
  kind: z.string().max(100),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
  content: z.string().max(20000),
  undo: z.object({ nodeId: z.string().max(200), removalId: z.string().max(200) }).optional(),
})
export type AgentActivity = z.infer<typeof AgentActivitySchema>
export const AgentRequestSchema = z.object({
  id: z.string().max(200),
  connectionId: z.string().max(200),
  kind: z.enum(['permission', 'url']),
  title: z.string().max(2000),
  url: z.string().max(4000).optional(),
  options: z.array(z.object({ id: z.string().max(200), name: z.string().max(500) })).max(30),
  status: z.enum(['pending', 'resolved', 'cancelled']),
})
export type AgentRequest = z.infer<typeof AgentRequestSchema>
export const AgentResponseSchema = z.object({
  optionId: z.string().max(200).optional(),
  action: z.enum(['accept', 'decline', 'cancel']).optional(),
})
export type AgentResponse = z.infer<typeof AgentResponseSchema>
export type AgentOption = {
  id: string
  name: string
  category?: string
  value: string
  choices: { value: string; name: string }[]
}
export type AgentConnection = {
  id: string
  name: string
  status: 'connected' | 'login-required' | 'authenticating' | 'failed'
  authMethods: { id: string; name: string }[]
  options: AgentOption[]
  commands: { name: string; description: string }[]
  requests: AgentRequest[]
  error?: string
}
const agentPromptBlocks = z
  .array(z.object({ type: z.literal('text'), text: z.string().max(400000) }))
  .max(100)

export const AgentRunSchema = z.object({
  sessionOrigin: z.enum(['new', 'resumed', 'loaded', 'stateless']).optional(),
  usage: z
    .object({
      contextTokens: z.number().finite().nonnegative(),
      contextWindow: z.number().finite().positive(),
      cost: z
        .object({ amount: z.number().finite().nonnegative(), currency: z.string().max(20) })
        .optional(),
    })
    .optional(),
  name: z.string().max(200),
  sessionId: z.string().max(200).optional(),
  waitingForResponse: z.boolean().optional(),
  configuration: z.record(z.string().max(200), z.string().max(1000)).optional(),
  activities: z.array(AgentActivitySchema).max(500),
  requests: z.array(AgentRequestSchema).max(100),
  input: z
    .object({
      request: z.union([
        z.object({ sessionId: z.string().min(1).max(200), prompt: agentPromptBlocks }),
        // DSH uses this wire shape. Older ACP records used the same fields locally.
        z.object({
          sessionId: z.string().min(1).max(200),
          requestId: z.string().min(1).max(200),
          content: agentPromptBlocks,
        }),
      ]),
      correlationId: z.string().min(1).max(200).optional(),
      submittedAt: z.iso.datetime(),
      acceptedAt: z.iso.datetime().optional(),
      materials: z.object({
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        previousDigest: z.string().regex(/^(?:[a-f0-9]{64})?$/),
        included: z.boolean(),
        historyIncluded: z.boolean(),
      }),
    })
    .optional(),
})
export type AgentRun = z.infer<typeof AgentRunSchema>

export function agentRequestDetails(agent: AgentRun | undefined) {
  if (!agent?.input) return
  const { request, correlationId } = agent.input
  if ('prompt' in request || agent.name === 'DeepSeek Harness') return { request, correlationId }
  return {
    request: { sessionId: request.sessionId, prompt: request.content },
    correlationId: request.requestId,
  }
}

export type AgentClient = {
  connect(config: AgentConfig): Promise<AgentConnection>
  state(id: string): Promise<AgentConnection>
  authenticate(id: string, methodId: string): Promise<void>
  configure(id: string, configId: string, value: string): Promise<AgentConnection>
  respond(id: string, requestId: string, response: AgentResponse): Promise<void>
  disconnect(id: string): Promise<void>
  resetSession?(runId: string): Promise<{ id: string }>
}
