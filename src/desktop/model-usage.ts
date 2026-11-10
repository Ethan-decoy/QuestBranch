import { createHash, randomUUID } from 'node:crypto'
import type { AssistantMessageEventStream, Model, Api } from '@earendil-works/pi-ai'
import { getModelCallContext } from 'sessionweave'
import type { ModelCall, TokenUsage } from '../research/usage'
import type { ResearchStore } from './store'

const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const measured = (usage: TokenUsage): TokenUsage | undefined =>
  Object.values(usage).some((value) => value !== undefined) ? usage : undefined

/** Pi normalizes absent usage to zero. Preserve positive measurements, not invented zero hits. */
export function piTokenUsage(usage: {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}): TokenUsage | undefined {
  const positive = (value: number) => (value > 0 ? count(value) : undefined)
  return measured({
    inputTokens: positive(usage.input + usage.cacheRead + usage.cacheWrite),
    uncachedInputTokens: positive(usage.input),
    cacheReadTokens: positive(usage.cacheRead),
    cacheWriteTokens: positive(usage.cacheWrite),
    outputTokens: positive(usage.output),
  })
}

/** Native wire measurements retain explicit zero and absent fields separately. */
export function nativeUsage(response: unknown, api: string): TokenUsage | undefined {
  const usage = object(object(response).usage)
  const details = object(usage.input_tokens_details)
  const anthropic = api === 'anthropic-messages'
  const input = count(usage.input_tokens)
  const read = count(anthropic ? usage.cache_read_input_tokens : details.cached_tokens)
  const write = count(anthropic ? usage.cache_creation_input_tokens : details.cache_write_tokens)
  return measured({
    inputTokens: anthropic
      ? input !== undefined && read !== undefined && write !== undefined
        ? input + read + write
        : undefined
      : input,
    uncachedInputTokens: anthropic
      ? input
      : input !== undefined && read !== undefined && write !== undefined && read + write <= input
        ? input - read - write
        : undefined,
    cacheReadTokens: read,
    cacheWriteTokens: write,
    outputTokens: count(usage.output_tokens),
    reasoningTokens: count(object(usage.output_tokens_details).reasoning_tokens),
  })
}

/** Opaque, stable routing hint; actor and memory never share a cache session identity. */
export function modelCacheKey(
  sessionId: string,
  model: Pick<Model<Api>, 'provider' | 'id' | 'api'>,
  phase: 'reply' | 'memory',
) {
  return (
    'qb-' +
    createHash('sha256')
      .update(JSON.stringify([sessionId, model.provider, model.id, model.api, phase]))
      .digest('hex')
      .slice(0, 48)
  )
}

type CallIdentity = Pick<ModelCall, 'phase' | 'provider' | 'model' | 'api' | 'billing' | 'source'>
/** Append at the model-call seam, independently of whether the research turn commits a reply. */
export class ModelUsageRecorder {
  constructor(
    private readonly store: ResearchStore,
    private readonly runId: string,
  ) {}
  start(identity: CallIdentity) {
    const sessionContext = getModelCallContext()
    const call: ModelCall = {
      ...identity,
      ...(sessionContext ? { sessionContext: { ...sessionContext } } : {}),
      id: randomUUID(),
      status: 'running',
      startedAt: new Date().toISOString(),
    }
    const run = this.store.run(this.runId)
    if ((run.modelCalls?.length ?? 0) >= 500)
      throw new Error('本轮模型调用达到上限；已有研究记录保留')
    this.store.saveRun({ ...run, modelCalls: [...(run.modelCalls ?? []), call] })
    return (
      status: Exclude<ModelCall['status'], 'running'>,
      usage?: TokenUsage,
      responseId?: string,
    ) => {
      // Shutdown records cancellation before closing SQLite; late provider completion is optional.
      if (!this.store.isOpen) return
      const current = this.store.run(this.runId)
      this.store.saveRun({
        ...current,
        modelCalls: current.modelCalls?.map((saved) =>
          saved.id === call.id
            ? {
                ...saved,
                status,
                finishedAt: new Date().toISOString(),
                ...(usage ? { usage } : {}),
                ...(responseId ? { responseId: responseId.slice(0, 200) } : {}),
              }
            : saved,
        ),
      })
    }
  }
  stream(identity: CallIdentity, signal: AbortSignal, generate: () => AssistantMessageEventStream) {
    signal.throwIfAborted()
    const finish = this.start(identity)
    let settled = false
    const cancelled = () => {
      if (!settled) finish('cancelled')
    }
    signal.addEventListener('abort', cancelled, { once: true })
    try {
      const stream = generate()
      void stream
        .result()
        .then((response) => {
          settled = true
          finish(
            signal.aborted || response.stopReason === 'aborted'
              ? 'cancelled'
              : response.stopReason === 'error' || response.stopReason === 'length'
                ? 'failed'
                : 'completed',
            piTokenUsage(response.usage),
            response.responseId,
          )
        })
        .catch(() => finish(signal.aborted ? 'cancelled' : 'failed'))
        .finally(() => signal.removeEventListener('abort', cancelled))
      if (signal.aborted) cancelled()
      return stream
    } catch (error) {
      signal.removeEventListener('abort', cancelled)
      finish(signal.aborted ? 'cancelled' : 'failed')
      throw error
    }
  }
}
