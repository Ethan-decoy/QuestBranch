import { z } from 'zod'
import type { AgentClient, AgentConfig, AgentRun, AgentActivity } from './agent'

export const SourceSchema = z.object({
  id: z.string().max(200),
  title: z.string().max(1000),
  url: z
    .url()
    .max(4000)
    .refine((url) => /^https?:\/\//i.test(url), '资料链接应使用 HTTP 或 HTTPS'),
  excerpt: z.string().max(20000).default(''),
})
export type Source = z.infer<typeof SourceSchema>
export type Workspace = {
  id: string
  name: string
  question: string
  objective: string
  constraints: string
  rootId: string
  createdAt: string
  updatedAt: string
}
export type ResearchNode = {
  id: string
  workspaceId: string
  parentId: string | null
  removedAt?: string
  removalId?: string
  title: string
  question: string
  summary: string
  openQuestions: string[]
  color: string
  relatedIds: string[]
  createdAt: string
  updatedAt: string
  originReportId?: string
  referenceReportIds?: string[]
}
export type Report = {
  id: string
  workspaceId: string
  nodeId: string
  title: string
  markdown: string
  summary: string
  findings: string[]
  openQuestions: string[]
  sources: Source[]
  createdAt: string
  origin: 'ai' | 'import'
  model: string
  runId?: string
  saveRequest?: { id: string; fingerprint: string }
}
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export const ReasoningEffortSchema = z.enum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
])
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>
export const ModelCapabilitySchema = z.object({
  model: z.string().min(1),
  displayName: z.string().min(1),
  isDefault: z.boolean(),
  contextWindow: z.number().positive(),
  maxOutputTokens: z.number().positive(),
  defaultReasoningEffort: ReasoningEffortSchema,
  supportedReasoningEfforts: z
    .array(
      z.object({
        reasoningEffort: ReasoningEffortSchema,
        description: z.string(),
      }),
    )
    .min(1),
})
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>
export type ModelCatalog = {
  models: ModelCapability[]
  defaults: { model: string; reasoningEffort: ReasoningEffort }
}
export type ContextItem = {
  reportId: string
  nodeId: string
  title: string
  reason: string
  included: boolean
  excerpted: boolean
}
export type ContextPack = {
  policy: 'branch-v1'
  createdAt: string
  workspaceId: string
  nodeId: string
  path: string[]
  items: ContextItem[]
  sources: Source[]
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  conversation?: { includedMessageIds: string[]; omittedMessageIds: string[] }
  estimatedTokens: number
  budget: number
  limitations: string[]
}
export type ResearchRun = {
  session?: SessionTrace
  activities?: AgentActivity[]
  toolCalls?: { id: string; name: string; arguments: unknown; result?: unknown; error?: string }[]
  id: string
  workspaceId: string
  nodeId: string
  instruction: string
  status: RunStatus
  phase: string
  output: string
  error: string
  model: string
  reasoningEffort?: ReasoningEffort
  context: ContextPack
  createdAt: string
  finishedAt?: string
  reportId?: string
  mode?: 'chat'
  selectedReportId?: string
  // Historical runs retain their original adapter identity.
  provider?: Settings['provider'] | 'codex'
  api?: { protocol: string; baseUrl: string }
  codex?: { threadId: string; turnId?: string }
  pi?: { provider: string; api: string; responseId?: string }
  agent?: AgentRun
}
export type ConversationMessage = {
  id: string
  workspaceId: string
  nodeId: string
  runId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}
export type DetailTab = 'chat' | 'report' | 'sources' | 'records'
// Presentation memory only; reports, messages and research state keep their own ownership.
export type ReaderState = {
  tab: DetailTab
  reportId?: string
  scroll?: Record<string, number>
  composerOpen?: boolean // Legacy preference, ignored by the fixed input panel.
  overviewOpen?: boolean
  questionOpen?: boolean
}
export type GraphMode = 'horizontal' | 'mindmap'
export type GraphDetail = 'summary' | 'compact'
export type GraphScene = {
  mode: GraphMode
  detail: GraphDetail
  focusId?: string
  viewport?: { x: number; y: number; zoom: number }
  positions?: Record<string, { x: number; y: number }>
}
export type GraphFrame = Pick<GraphScene, 'mode' | 'detail' | 'focusId'> & {
  selectedId: string
  collapsed?: string[]
  viewport?: GraphScene['viewport']
}
export type ViewState = {
  revision?: number
  selectedId: string
  collapsed: string[]
  drafts: Record<string, string>
  chatDrafts?: Record<string, string>
  viewport?: { x: number; y: number; zoom: number }
  positions?: Record<string, { x: number; y: number }>
  readers?: Record<string, ReaderState>
  // Display organization never rewrites parentId, relatedIds or past research inputs.
  graph?: {
    mode?: GraphMode
    detail?: GraphDetail
    focusId?: string
    branchSides?: Record<string, 'left' | 'right'>
    // Presentation acknowledgment, independent of research progress or factual certainty.
    noticedNodeIds?: string[]
    history?: GraphFrame[]
    scenes?: GraphScene[]
  }
}
export const ApiProtocolSchema = z.enum(['openai-chat', 'openai-responses', 'anthropic-messages'])
export type ApiProtocol = z.infer<typeof ApiProtocolSchema>
export type Settings = {
  sessionStrategy?: 'auto' | 'native' | 'portable'
  sessionInputBudget?: number
  modelContextWindow?: number
  backend?: 'model' | 'acp'
  agent?: AgentConfig
  provider: 'account' | 'compatible' | 'ollama'
  // Pi provider ID, or "custom" for an explicitly configured compatible API.
  modelProvider?: string
  baseUrl: string
  apiProtocol?: ApiProtocol
  maxOutputTokens?: number
  anthropicWorkspaceId?: string
  model: string
  jsonMode: boolean
  contextBudget: number
  hasApiKey: boolean
  hasSearchKey: boolean
  reasoningEffort?: ReasoningEffort | ''
}
export type SessionTrace = {
  sessionId: string
  bootstrapMessageIds: string[]
  requests: {
    revision: number
    strategy: 'portable' | 'native'
    checkpointId: string | null
    origin: string
    modelId: string
    contextWindow: number
    inputTokens: number
    request: unknown
  }[]
}
export type ModelProvider = {
  id: string
  name: string
  apiKey: boolean
  apiKeyLogin: boolean
  oauth: boolean
  oauthName?: string
  subscription: boolean
  baseUrl?: string
}
export type ConnectionResult = {
  models: string[]
  modelDiscovery: 'catalog' | 'available' | 'unsupported'
  catalog: ModelCatalog
  status: 'configured' | 'login-required'
  provider: string
}
export type AuthSession = {
  id: string
  provider: string
  status: 'pending' | 'connected' | 'cancelled' | 'failed'
  message: string
  url?: string
  userCode?: string
  prompt?: {
    id: string
    type: 'text' | 'secret' | 'select' | 'manual_code'
    message: string
    placeholder?: string
    options?: { id: string; label: string; description?: string }[]
  }
}
export type SettingsInput = Omit<Settings, 'hasApiKey' | 'hasSearchKey'> & {
  apiKey?: string
  searchKey?: string
  clearApiKey?: boolean
  clearSearchKey?: boolean
}
export type Snapshot = {
  version: number
  workspaces: Workspace[]
  nodes: ResearchNode[]
  reports: Report[]
  runs: ResearchRun[]
  messages: ConversationMessage[]
  views: Record<string, ViewState>
  settings: Settings
  storage?: {
    directory: string
    database: string
    source?: 'default' | 'preference' | 'environment'
  }
}
export const ResearchOutputSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1500),
  findings: z.array(z.string()).max(20),
  openQuestions: z.array(z.string()).max(20),
  report: z.string().min(20).max(100000),
  followups: z
    .array(z.object({ title: z.string().min(1).max(100), question: z.string().min(1).max(3000) }))
    .max(8),
})
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>
export type AppCommand =
  | { type: 'create-workspace'; question: string; name?: string; constraints?: string }
  | {
      type: 'create-node'
      parentId: string
      sourceReportId: string
      question: string
      requestId?: string
      relatedIds?: string[]
      referenceReportIds?: string[]
    }
  | { type: 'edit-node'; nodeId: string; question: string }
  | { type: 'remove-branch'; nodeId: string; requestId: string }
  | { type: 'restore-branch'; nodeId: string; removalId: string }
  | { type: 'save-view'; workspaceId: string; view: ViewState }
  | { type: 'save-settings'; settings: SettingsInput }
  | {
      type: 'start-research'
      nodeId: string
      instruction: string
      reportIds?: string[]
      selectedReportId?: string
    }
  | { type: 'send-message'; nodeId: string; message: string; selectedReportId?: string }
  | { type: 'cancel-research'; runId: string }
  | { type: 'import-workspace'; data: unknown }
export interface ResearchClient {
  host?: {
    name: string
    version: string
    managePlugin(): Promise<void>
    models(nodeId: string): Promise<import('./agent').NativeModelState>
    selectModel(nodeId: string, selection: import('./agent').NativeModelSelection): Promise<void>
  }
  snapshot(): Promise<Snapshot>
  snapshot(sinceVersion: number): Promise<Snapshot | null>
  command(command: AppCommand): Promise<{ id?: string }>
  testConnection(settings?: SettingsInput): Promise<ConnectionResult>
  modelProviders(): Promise<ModelProvider[]>
  agent?: AgentClient
  auth: {
    start(settings: SettingsInput, type: 'oauth' | 'api_key'): Promise<AuthSession>
    status(id: string): Promise<AuthSession>
    respond(id: string, promptId: string, value: string): Promise<void>
    cancel(id: string): Promise<void>
    logout(settings: SettingsInput): Promise<void>
  }
  exportWorkspace(workspaceId: string): Promise<unknown>
  appearance?: { setTheme(theme: 'light' | 'dark' | 'system'): Promise<void> }
  storage?: {
    chooseDirectory(): Promise<{ directory: string; token: string } | null>
    relocate(token: string): Promise<void>
  }
}
export const defaultSettings: Settings = {
  provider: 'account',
  modelProvider: 'openai',
  baseUrl: '',
  model: '',
  jsonMode: true,
  contextBudget: 16000,
  hasApiKey: false,
  hasSearchKey: false,
}
export const palette = ['#4e806d', '#7186aa', '#b38a5b', '#a88092', '#7d8d61']
