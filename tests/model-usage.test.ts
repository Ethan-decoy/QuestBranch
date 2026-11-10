import { describe, expect, it } from 'vitest'
import { nativeUsage, piTokenUsage } from '../src/desktop/model-usage'
import { ModelUsageRecorder } from '../src/desktop/model-usage'
import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { ResearchStore } from '../src/desktop/store'
import { buildContext } from '../src/research/context'

describe('模型用量事实', () => {
  it('退出时先保存取消状态，迟到的模型结果不向已关闭数据库写入', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'qb-usage-shutdown-'))
    const store = new ResearchStore(folder)
    try {
      store.saveRun({
        id: 'late-result',
        workspaceId: 'welcome-research',
        nodeId: 'visual',
        instruction: 'fixture',
        status: 'running',
        phase: 'fixture',
        output: '',
        error: '',
        model: 'fixture',
        context: buildContext(store.snapshot(), 'visual', 'fixture'),
        createdAt: new Date().toISOString(),
      })
      const controller = new AbortController(),
        source = createAssistantMessageEventStream()
      const stream = new ModelUsageRecorder(store, 'late-result').stream(
        {
          phase: 'reply',
          provider: 'fixture',
          model: 'fixture',
          api: 'fixture',
          billing: 'api',
          source: 'pi',
        },
        controller.signal,
        () => source,
      )
      controller.abort()
      expect(store.run('late-result').modelCalls![0].status).toBe('cancelled')
      store.close()
      source.push({
        type: 'error',
        reason: 'aborted',
        error: fauxAssistantMessage('', { stopReason: 'aborted' }),
      })
      source.end()
      await stream.result()
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      if (store.isOpen) store.close()
      if (!resolve(folder).startsWith(resolve(tmpdir()) + sep))
        throw new Error('Unexpected fixture path')
      rmSync(folder, { recursive: true, force: true })
    }
  })
  it('原生用量区分总输入和缓存，不把缓存加进总输入两次', () => {
    expect(
      nativeUsage(
        {
          usage: {
            input_tokens: 1000,
            output_tokens: 30,
            input_tokens_details: { cached_tokens: 900, cache_write_tokens: 20 },
            output_tokens_details: { reasoning_tokens: 10 },
          },
        },
        'openai-responses',
      ),
    ).toEqual({
      inputTokens: 1000,
      uncachedInputTokens: 80,
      cacheReadTokens: 900,
      cacheWriteTokens: 20,
      outputTokens: 30,
      reasoningTokens: 10,
    })
    expect(
      nativeUsage(
        {
          usage: {
            input_tokens: 100,
            output_tokens: 0,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 50,
          },
        },
        'anthropic-messages',
      ),
    ).toEqual({
      inputTokens: 350,
      uncachedInputTokens: 100,
      cacheReadTokens: 200,
      cacheWriteTokens: 50,
      outputTokens: 0,
    })
  })
  it('缺失用量与明确的零值不同，Pi 未报告的零缓存不能冒充实测', () => {
    expect(nativeUsage({}, 'openai-responses')).toBeUndefined()
    expect(
      nativeUsage(
        {
          usage: { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0 } },
        },
        'openai-responses',
      ),
    ).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })
    expect(piTokenUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeUndefined()
    expect(piTokenUsage({ input: 10, output: 20, cacheRead: 0, cacheWrite: 0 })).toEqual({
      inputTokens: 10,
      uncachedInputTokens: 10,
      outputTokens: 20,
    })
  })
})
