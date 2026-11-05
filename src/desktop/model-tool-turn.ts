import type { AgentActivity } from '../research/agent'
import type { ResearchRun } from '../research/types'
import type { ResearchTool } from './research-tools'

export type ModelProgress = {
  phase: string
  activities: AgentActivity[]
  toolCalls: NonNullable<ResearchRun['toolCalls']>
}
export type ModelToolRuntime = { tools: ResearchTool[]; progress: (value: ModelProgress) => void }
