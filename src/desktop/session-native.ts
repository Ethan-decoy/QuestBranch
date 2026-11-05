import { createHash } from 'node:crypto'
import type { Model, Api } from '@earendil-works/pi-ai'
import {
  confirmedNativeCapability,
  type ModelProfile,
  type NativeAdapter,
  type NativeRequest,
  type NativeTransport,
} from 'sessionweave'
import {
  createAnthropicNativeAdapter,
  createOpenAINativeAdapter,
  resolveAnthropicNativeCapability,
} from 'sessionweave/native'
import type { Settings } from '../research/types'
import { modelConnectionKey, sessionStrategy } from '../research/api-services'
import type { Network } from './network'

const verified = new WeakMap<Network, Map<string, { until: number; evidence: string }>>()

/** Exact deployment capability checks; network/auth failures are never an unsupported result. */
export async function resolveSessionNative(options: {
  settings: Settings
  model: Model<Api>
  profile: ModelProfile
  network: Network
  headers: Record<string, string>
  signal: AbortSignal
}): Promise<NativeAdapter | undefined> {
  const { settings, model, profile, network, signal } = options
  if (sessionStrategy(settings) === 'portable') return
  if (settings.provider === 'account') {
    // Subscription transports are owned by Pi. Their token is not an API credential.
    profile.nativeCompaction = {
      status: 'unknown',
      reason: '此账号连接尚未接入原生压缩；请在模型与连接中选择 OM 工作记忆。',
    }
    return
  }
  const endpoint = model.baseUrl.replace(/\/+$/, '')
  const backend = {
    provider: model.provider,
    model: model.id,
    endpoint,
    apiVersion: model.api === 'anthropic-messages' ? '2023-06-01' : 'responses-v1',
    scope: createHash('sha256').update(modelConnectionKey(settings)).digest('hex'),
  }
  const cache = verified.get(network) ?? new Map<string, { until: number; evidence: string }>()
  verified.set(network, cache)
  const cacheKey = createHash('sha256')
    .update(JSON.stringify([backend, options.headers]))
    .digest('hex')
  const post =
    (path: string): NativeTransport =>
    async (request, providedSignal) => {
      const response = await network.fetch(endpoint + path, {
        method: 'POST',
        headers: { ...options.headers, ...request.headers, 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
        redirect: 'error',
        signal: providedSignal ?? signal,
      })
      const data = await response.json()
      if (!response.ok) {
        cache.delete(cacheKey)
        throw new Error(
          `会话原生接口 HTTP ${response.status}：${JSON.stringify(data).slice(0, 1000)}`,
        )
      }
      return data
    }
  if (model.api === 'openai-completions') {
    const binding = {
      ...backend,
      protocol: 'openai.chat',
      capability: 'no-native-compaction-in-chat-completions@1',
    }
    profile.backend = binding
    profile.nativeCompaction = {
      status: 'unsupported',
      binding,
      evidence:
        'Selected Chat Completions protocol has no compaction/state endpoint; explicit Responses is a different protocol.',
    }
    return
  }
  if (model.api !== 'openai-responses' && model.api !== 'anthropic-messages') return
  const count = async (request: NativeRequest) => {
    const body = { ...request.body }
    delete body.max_output_tokens
    delete body.max_tokens
    delete body.store
    delete body.context_management
    delete body.include
    const path =
      model.api === 'openai-responses' ? '/responses/input_tokens' : '/v1/messages/count_tokens'
    const result = (await post(path)({ body, headers: request.headers }, signal)) as {
      input_tokens?: unknown
    }
    if (!Number.isInteger(result.input_tokens) || Number(result.input_tokens) < 0)
      throw new Error('原生输入计数接口没有返回有效 input_tokens；保留现有会话')
    return Number(result.input_tokens)
  }
  const adapter =
    model.api === 'openai-responses'
      ? createOpenAINativeAdapter({
          backend,
          mode: 'on-demand',
          generate: post('/responses'),
          compact: post('/responses/compact'),
          countTokens: count,
        })
      : createAnthropicNativeAdapter({
          backend,
          mode: 'on-demand',
          generate: post('/v1/messages'),
          countTokens: count,
        })
  // Run settings are part of the counted request, never injected by the transport afterwards.
  const build = adapter.build.bind(adapter)
  adapter.build = (input) => {
    const request = build(input)
    if (model.api === 'openai-responses') request.body.include = ['reasoning.encrypted_content']
    if (
      model.api === 'openai-responses' &&
      model.reasoning &&
      settings.reasoningEffort &&
      settings.reasoningEffort !== 'ultra'
    )
      request.body.reasoning = {
        effort:
          settings.reasoningEffort === 'none'
            ? (model.thinkingLevelMap?.off ?? 'none')
            : (model.thinkingLevelMap?.[settings.reasoningEffort] ?? settings.reasoningEffort),
      }
    if (model.api === 'anthropic-messages' && model.reasoning) {
      if (settings.reasoningEffort === 'none') request.body.thinking = { type: 'disabled' }
      else if (
        model.compat &&
        'forceAdaptiveThinking' in model.compat &&
        model.compat.forceAdaptiveThinking
      ) {
        request.body.thinking = { type: 'adaptive' }
        request.body.output_config = { effort: settings.reasoningEffort ?? 'medium' }
      } else
        throw new Error(
          '此原生适配器暂不提供预算式思考；可明确选择 OM 工作记忆以沿用 Pi 的思考配置',
        )
    }
    return request
  }
  profile.backend = adapter.binding
  const known = cache.get(cacheKey)
  if (known && known.until > Date.now()) {
    profile.nativeCompaction = confirmedNativeCapability(adapter, known.evidence)
    return adapter
  }
  if (model.api === 'anthropic-messages') {
    const response = await network.fetch(endpoint + '/v1/models/' + encodeURIComponent(model.id), {
      headers: {
        ...options.headers,
        'anthropic-version': backend.apiVersion,
        'anthropic-beta': 'compact-2026-09-04',
      },
      signal,
      redirect: 'error',
    })
    const data = await response.json()
    if (!response.ok)
      throw new Error(
        `读取原生会话能力 HTTP ${response.status}：${JSON.stringify(data).slice(0, 1000)}`,
      )
    profile.nativeCompaction = resolveAnthropicNativeCapability(adapter, data)
  } else {
    // A successful real compaction resource confirms this exact deployment; no brand inference.
    const probe = await adapter.compact!(
      {
        body: {
          model: model.id,
          instructions: 'Preserve the provided text.',
          input: [{ role: 'user', content: 'Capability check.' }],
        },
        headers: {},
      },
      signal,
    )
    await count({
      body: { model: model.id, instructions: 'Capability check.', input: probe.state.input! },
      headers: {},
    })
    profile.nativeCompaction = confirmedNativeCapability(
      adapter,
      'Validated /responses/compact resource and effective /responses/input_tokens on the selected endpoint/model/scope.',
    )
  }
  if (profile.nativeCompaction?.status === 'supported') {
    if (cache.size >= 100) cache.clear()
    cache.set(cacheKey, {
      until: Date.now() + 1800000,
      evidence: profile.nativeCompaction.evidence,
    })
  }
  return profile.nativeCompaction.status === 'supported' ? adapter : undefined
}
