import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { AgentConfig } from '../research/agent'
import type { ContextPack } from '../research/types'
import type { ResearchStore } from './store'

const savedSchema = z.object({
  sessionId: z.string().min(1).max(200),
  materialDigest: z.string().regex(/^(?:[a-f0-9]{64})?$/),
  bootstrapped: z.boolean(),
  lastRunId: z.string().min(1).max(200).optional(),
})
export type SavedAgentSession = z.infer<typeof savedSchema>
type BoundAgentSession = SavedAgentSession & { bindingId: string }
export type AgentSessionScope = {
  runId?: string
  load(): BoundAgentSession | undefined
  save(session: SavedAgentSession): void
}
export class AgentSessionRestoreError extends Error {
  constructor(
    message: string,
    readonly bindingId: string,
  ) {
    super(message)
  }
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Machine-local native identities. JSON imports never adopt an external agent's live session. */
export class AcpSessions {
  constructor(
    private readonly store: Pick<ResearchStore, 'agentWorkingDirectory' | 'agentSessionBindings'>,
  ) {}
  retire(nodeId: string, bindingId: string) {
    return this.store.agentSessionBindings.retire(nodeId, bindingId)
  }

  scope(nodeId: string, config: AgentConfig, runId?: string): AgentSessionScope {
    const connection = digest([
      config.kind,
      config.command ?? '',
      config.args ?? [],
      resolve(config.cwd || this.store.agentWorkingDirectory),
      Object.entries(config.options ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ])
    const bindings = this.store.agentSessionBindings
    return {
      runId,
      load: () => {
        const binding = bindings.load(nodeId, connection)
        if (!binding) return
        const session = savedSchema.parse(binding.payload)
        if (runId && session.bootstrapped) {
          if (!bindings.coversChats(nodeId, session.lastRunId, runId))
            throw new AgentSessionRestoreError(
              '此原生会话未覆盖节点中的新增对话；请明确重建会话以承接当前研究，已有记录保留。',
              binding.id,
            )
        }
        return { ...session, bindingId: binding.id }
      },
      save: (session) => {
        bindings.save(nodeId, connection, savedSchema.parse(session))
      },
    }
  }
}

export function agentPrompt(context: ContextPack, previous?: SavedAgentSession) {
  const current = context.messages.at(-1)!.content
  const command = /^\/[a-z][\w-]*(?:\s|$)/i.test(current)
  const materialDigest = digest(context.messages.slice(0, 2))
  const included = !command && (!previous || previous.materialDigest !== materialDigest)
  const historyIncluded = !command && !previous?.bootstrapped && context.messages.length > 3
  const parts = command
    ? [context.messages.at(-1)!]
    : [
        ...(included ? context.messages.slice(0, 2) : []),
        ...(historyIncluded ? context.messages.slice(2, -1) : []),
        context.messages.at(-1)!,
      ]
  const text = command
    ? current
    : (previous && included
        ? '以下为当前研究材料快照，替代此前的研究背景；历史讨论保留，当前图谱以本快照及本轮工具返回为准。\n\n'
        : '') + parts.map((part) => `[${part.role}]\n${part.content}`).join('\n\n')
  return { text, materialDigest, included, historyIncluded, command }
}
