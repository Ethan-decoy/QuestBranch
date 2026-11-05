import type { Context, AssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { OmModel } from 'sessionweave/om'

type V2 = Extract<OmModel, { specificationVersion: 'v2' }>
/** The OM SDK model uses the very same Pi model, credential resolver and host fetch. */
export function piOmModel(options: {
  modelId: string
  signal: AbortSignal
  stream(context: Context, maxTokens: number): AssistantMessageEventStream
}): V2 {
  return {
    specificationVersion: 'v2',
    provider: 'questbranch-pi',
    modelId: options.modelId,
    supportedUrls: {},
    async doGenerate() {
      throw new Error('OM 模型桥接使用流式生成')
    },
    async doStream(input) {
      const signals = [options.signal, ...(input.abortSignal ? [input.abortSignal] : [])]
      const signal = AbortSignal.any(signals)
      signal.throwIfAborted()
      const context: Context = { systemPrompt: '', messages: [] }
      for (const message of input.prompt) {
        if (message.role === 'system') context.systemPrompt += message.content + '\n'
        else if (message.role === 'user') {
          if (message.content.some((part) => part.type !== 'text'))
            throw new Error('OM 输入包含未支持的内容')
          context.messages.push({
            role: 'user',
            content: message.content
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join(''),
            timestamp: Date.now(),
          })
        } else if (message.role === 'assistant') {
          // OM prompts are text only. Refuse unsupported parts instead of discarding them.
          if (message.content.some((part) => part.type !== 'text'))
            throw new Error('OM 输入包含未支持的 assistant 内容')
          context.messages.push({
            role: 'assistant',
            content: message.content.map((part) => ({
              type: 'text',
              text: part.type === 'text' ? part.text : '',
            })),
            api: 'questbranch-om',
            provider: 'questbranch',
            model: options.modelId,
            stopReason: 'stop',
            timestamp: Date.now(),
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          })
        } else throw new Error('OM 输入不支持外部工具结果')
      }
      const upstream = options.stream(context, input.maxOutputTokens ?? 8192)
      return {
        stream: new ReadableStream({
          async start(controller) {
            try {
              controller.enqueue({ type: 'stream-start', warnings: [] })
              controller.enqueue({ type: 'text-start', id: 'om-text' })
              for await (const event of upstream) {
                signal.throwIfAborted()
                if (event.type === 'text_delta')
                  controller.enqueue({ type: 'text-delta', id: 'om-text', delta: event.delta })
              }
              const response = await upstream.result()
              signal.throwIfAborted()
              if (response.stopReason === 'error' || response.stopReason === 'aborted')
                throw new Error(response.errorMessage || 'OM 模型连接中断')
              if (response.content.some((part) => part.type === 'toolCall'))
                throw new Error('OM 模型返回了未提供的工具')
              controller.enqueue({ type: 'text-end', id: 'om-text' })
              controller.enqueue({
                type: 'finish',
                finishReason: response.stopReason === 'length' ? 'length' : 'stop',
                usage: {
                  inputTokens:
                    response.usage.input + response.usage.cacheRead + response.usage.cacheWrite,
                  outputTokens: response.usage.output,
                  totalTokens: response.usage.totalTokens,
                },
              })
              controller.close()
            } catch (error) {
              controller.error(error)
            }
          },
        }),
      }
    },
  }
}
