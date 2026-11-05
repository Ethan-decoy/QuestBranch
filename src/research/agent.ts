import { z } from 'zod'

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
export const AgentRunSchema = z.object({
  name: z.string().max(200),
  sessionId: z.string().max(200).optional(),
  configuration: z.record(z.string().max(200), z.string().max(1000)).optional(),
  activities: z.array(AgentActivitySchema).max(500),
  requests: z.array(AgentRequestSchema).max(100),
})
export type AgentRun = z.infer<typeof AgentRunSchema>
export type AgentClient = {
  connect(config: AgentConfig): Promise<AgentConnection>
  state(id: string): Promise<AgentConnection>
  authenticate(id: string, methodId: string): Promise<void>
  configure(id: string, configId: string, value: string): Promise<AgentConnection>
  respond(id: string, requestId: string, response: AgentResponse): Promise<void>
  disconnect(id: string): Promise<void>
}
