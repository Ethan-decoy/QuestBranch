import {
  createModels,
  createProvider,
  InMemoryCredentialStore,
  getSupportedThinkingLevels,
  validateToolCall,
  type Api,
  type Context,
  type Model,
  type Provider,
  type SimpleStreamOptions,
  type Tool,
} from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { z } from 'zod'
import type {
  ConnectionResult,
  ModelCatalog,
  ModelProvider,
  ReasoningEffort,
  Settings,
} from '../research/types'
import {
  apiBaseUrl,
  apiProtocol,
  modelConnectionKey,
  modelProviderId,
} from '../research/api-services'
import { resolveModelSelection } from '../research/model-catalog'
import { estimateTokens } from '../research/context'
import { ResearchStore } from './store'
import { PiCredentialStore } from './pi-credentials'
import { PiAuth } from './pi-auth'
import { defaultNetwork, type Network } from './network'
import { type ModelToolRuntime } from './model-tool-turn'
import { sessionTurn, type SessionTurn } from './session-turn'

export type ModelSelection = {
  model: string
  reasoningEffort: ReasoningEffort
  pi: { provider: string; api: string; responseId?: string }
}
export type ModelOutput = { raw: string; report?: unknown }

// Pi types stay inside this adapter. QB keeps the research context, history,
// report schema and persistence; no Agent runtime or execution tools are used.
export class PiModels {
  readonly auth: PiAuth
  private readonly builtins: readonly Provider[]
  private readonly network: Network
  private readonly unknownCapacity = new WeakSet<Model<Api>>()
  constructor(
    readonly store: ResearchStore,
    options: {
      providers?: readonly Provider[]
      openAuthUrl?: (url: string) => Promise<unknown>
      network?: Network
    } = {},
  ) {
    this.builtins = options.providers ?? builtinProviders()
    this.network = options.network ?? defaultNetwork
    this.auth = new PiAuth(
      store,
      (settings) => this.collection(settings),
      options.openAuthUrl,
      this.network,
    )
  }
  providers(): ModelProvider[] {
    return this.builtins
      .filter((provider) => provider.getModels().length > 0 || provider.refreshModels)
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        apiKey: !!provider.auth.apiKey,
        apiKeyLogin: !!provider.auth.apiKey?.login,
        oauth: !!provider.auth.oauth,
        oauthName: provider.auth.oauth?.name,
        subscription: !!provider.auth.oauth?.isSubscription,
        baseUrl: provider.baseUrl,
      }))
  }
  collection(settings: Settings, apiKey = '', ignoreStored = false) {
    const id = modelProviderId(settings)
    const native = id !== 'custom'
    const original = native ? this.builtins.find((provider) => provider.id === id) : undefined
    if (native && !original) throw new Error(`当前 Pi 版本未提供 ${id}，请重新选择提供商`)
    if (settings.provider === 'account' && !original?.auth.oauth)
      throw new Error('当前提供商没有账号登录通道，请选择 API 服务')
    const baseUrl =
      settings.baseUrl && settings.provider !== 'account'
        ? settings.baseUrl.replace(/\/+$/, '')
        : undefined
    const configuredProvider =
      original && baseUrl
        ? {
            ...original,
            baseUrl,
            getModels: () =>
              original.getModels().map((model) => ({
                ...model,
                baseUrl:
                  model.api === 'anthropic-messages' ? baseUrl.replace(/\/v1$/, '') : baseUrl,
              })),
            getAllModels: undefined,
          }
        : (original ?? this.customProvider(settings, apiKey))
    const oauth = configuredProvider.auth.oauth
    const provider: Provider = oauth
      ? {
          ...configuredProvider,
          auth: {
            ...configuredProvider.auth,
            oauth: {
              ...oauth,
              refresh: (credential, signal) =>
                this.network.run(
                  { operation: 'token-refresh', provider: configuredProvider.id },
                  () => oauth.refresh(credential, signal),
                ),
            },
          },
        }
      : configuredProvider
    const persistent = new PiCredentialStore(this.store, modelConnectionKey(settings), provider.id)
    const credentials = ignoreStored || apiKey ? new InMemoryCredentialStore() : persistent
    const ready = apiKey
      ? credentials.modify(provider.id, async () => {
          const current = ignoreStored ? undefined : await persistent.read(provider.id)
          return {
            type: 'api_key',
            key: apiKey,
            ...(current?.type === 'api_key' && current.env ? { env: current.env } : {}),
          }
        })
      : Promise.resolve()
    const models = createModels({
      credentials,
      // Only credentials explicitly configured in QB are resolved. No ambient
      // keys, CLI credential files or cloud profiles are discovered implicitly.
      authContext: { env: async () => undefined, fileExists: async () => false },
    })
    models.setProvider(provider)
    return { models, provider, credentials, ready }
  }
  private customModel(settings: Settings, id: string): Model<Api> {
    const protocol = apiProtocol(settings)
    const api = protocol === 'openai-chat' ? 'openai-completions' : protocol
    const known = this.builtins
      .flatMap((provider) => provider.getModels())
      .find((model) => model.id === id && model.api === api)
    const baseUrl = apiBaseUrl(settings)
    const result: Model<Api> = {
      ...(known ?? {
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: settings.modelContextWindow ?? 32768,
        maxTokens: settings.maxOutputTokens ?? 8192,
      }),
      id,
      name: known?.name ?? id,
      provider: 'questbranch',
      api,
      // The Anthropic SDK appends /v1/messages; old QB bases include /v1.
      baseUrl: api === 'anthropic-messages' ? baseUrl.replace(/\/v1$/, '') : baseUrl,
    }
    if (!known && !settings.modelContextWindow) this.unknownCapacity.add(result)
    return result
  }
  private customProvider(settings: Settings, apiKey: string): Provider {
    let discovery: ConnectionResult['modelDiscovery'] = 'available'
    const provider = createProvider({
      id: 'questbranch',
      name: settings.provider === 'ollama' ? 'Ollama' : '自定义服务',
      baseUrl: apiBaseUrl(settings),
      auth: {
        apiKey: {
          name: 'QB API Key',
          resolve: async ({ credential, signal }) => {
            signal.throwIfAborted()
            // Pi's SDK clients require a non-empty value even for keyless local
            // servers. The transport below strips this non-secret placeholder.
            return { auth: { apiKey: apiKey || credential?.key || 'qb-anonymous' } }
          },
        },
      },
      models: [],
      api: {
        'openai-completions': openAICompletionsApi(),
        'openai-responses': openAIResponsesApi(),
        'anthropic-messages': anthropicMessagesApi(),
      },
      fetchModels: async ({ credential, signal }) => {
        const key =
          apiKey ||
          (credential?.type === 'api_key' && credential.key !== 'qb-anonymous'
            ? (credential.key ?? '')
            : '')
        const headers: Record<string, string> =
          apiProtocol(settings) === 'anthropic-messages'
            ? { 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) }
            : key
              ? { Authorization: `Bearer ${key}` }
              : {}
        if (settings.anthropicWorkspaceId?.trim())
          headers['anthropic-workspace-id'] = settings.anthropicWorkspaceId.trim()
        const response = await this.network.fetch(apiBaseUrl(settings) + '/models', {
          headers,
          signal,
          redirect: 'error',
        })
        if ([404, 405, 501].includes(response.status)) {
          discovery = 'unsupported'
          return []
        }
        if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}`)
        const data = z
          .object({ data: z.array(z.object({ id: z.string().min(1).max(200) })).max(20000) })
          .parse(await response.json())
        return [...new Set(data.data.map((entry) => entry.id))].map((id) =>
          this.customModel(settings, id),
        )
      },
    })
    this.discovery.set(provider, () => discovery)
    return provider
  }
  private discovery = new WeakMap<Provider, () => ConnectionResult['modelDiscovery']>()
  private catalog(models: readonly Model<Api>[]): ModelCatalog {
    const capabilities = models.map((model, index) => {
      const levels = getSupportedThinkingLevels(model).map((level): ReasoningEffort =>
        level === 'off' ? 'none' : level,
      )
      const defaultReasoningEffort = levels.includes('medium') ? 'medium' : (levels[0] ?? 'none')
      return {
        model: model.id,
        displayName: model.name,
        isDefault: index === 0,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxTokens,
        defaultReasoningEffort,
        supportedReasoningEfforts: levels.map((reasoningEffort) => ({
          reasoningEffort,
          description: '',
        })),
      }
    })
    return {
      models: capabilities,
      defaults: {
        model: capabilities[0]?.model ?? '',
        reasoningEffort: capabilities[0]?.defaultReasoningEffort ?? 'none',
      },
    }
  }
  async connect(settings: Settings, apiKey = '', ignoreStored = false): Promise<ConnectionResult> {
    return this.network.run(
      { operation: 'model-discovery', provider: modelProviderId(settings) },
      () => this.connectProvider(settings, apiKey, ignoreStored),
    )
  }
  private async connectProvider(
    settings: Settings,
    apiKey: string,
    ignoreStored: boolean,
  ): Promise<ConnectionResult> {
    const { models, provider, credentials, ready } = this.collection(settings, apiKey, ignoreStored)
    await ready
    const signal = AbortSignal.timeout(30000)
    const credential = await credentials.read(provider.id, { signal })
    const configured =
      settings.provider === 'account'
        ? credential?.type === 'oauth'
        : !!apiKey || !!credential || modelProviderId(settings) === 'custom'
    try {
      if (configured && settings.provider === 'account')
        await models.getAuth(provider.id, { signal })
      if (configured) {
        const refreshed = await models.refresh({ providers: [provider.id], signal })
        signal.throwIfAborted()
        const error = refreshed.errors.get(provider.id)
        if (error) throw error
      }
      const listed = models.getModels(provider.id)
      return {
        models: listed.map((model) => model.id),
        catalog: this.catalog(listed),
        modelDiscovery: this.discovery.get(provider)?.() ?? 'catalog',
        status: configured ? 'configured' : 'login-required',
        provider: provider.id,
      }
    } catch (error) {
      throw this.redact(
        error,
        credential,
        apiKey,
        await credentials.read(provider.id).catch(() => undefined),
      )
    }
  }
  async generate(
    settings: Settings,
    apiKey: string,
    messages: { role: string; content: string }[],
    signal: AbortSignal,
    onChunk: (output: string) => void,
    schema?: z.ZodType,
    onModel?: (selection: ModelSelection) => void,
    toolRuntime?: ModelToolRuntime,
    turn?: SessionTurn,
  ): Promise<ModelOutput> {
    return this.network.run(
      { operation: 'model-stream', provider: modelProviderId(settings) },
      () =>
        this.generateResponse(
          settings,
          apiKey,
          messages,
          signal,
          onChunk,
          schema,
          onModel,
          toolRuntime,
          turn,
        ),
    )
  }
  private async generateResponse(
    settings: Settings,
    apiKey: string,
    messages: { role: string; content: string }[],
    signal: AbortSignal,
    onChunk: (output: string) => void,
    schema?: z.ZodType,
    onModel?: (selection: ModelSelection) => void,
    toolRuntime?: ModelToolRuntime,
    turn?: SessionTurn,
  ): Promise<ModelOutput> {
    const { models, provider, credentials, ready } = this.collection(settings, apiKey)
    await ready
    const controller = new AbortController()
    const requestSignal = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(900000)])
    const stored = await credentials.read(provider.id, { signal: requestSignal })
    let httpStatus: number | undefined
    if (settings.provider === 'account' && stored?.type !== 'oauth')
      throw new Error('请先连接此提供商的账号')
    if (
      settings.provider === 'compatible' &&
      modelProviderId(settings) !== 'custom' &&
      !apiKey &&
      !stored
    )
      throw new Error('请先配置此提供商的 API 凭据')
    try {
      const refreshed = await this.network.run(
        { operation: 'model-discovery', provider: provider.id },
        () =>
          models.refresh({
            providers: [provider.id],
            signal: requestSignal,
            allowNetwork:
              modelProviderId(settings) !== 'custom' &&
              !models.getModel(provider.id, settings.model),
          }),
      )
      const refreshError = refreshed.errors.get(provider.id)
      if (refreshError) throw refreshError
      let model = models.getModel(provider.id, settings.model)
      if (!model && modelProviderId(settings) === 'custom')
        model = this.customModel(settings, settings.model)
      // Manual IDs are allowed for native API connections. Their protocol and
      // conservative capabilities come from this Pi provider's catalog.
      if (!model && settings.provider === 'compatible' && modelProviderId(settings) !== 'custom') {
        const template = models.getModels(provider.id)[0]
        if (template)
          model = {
            ...template,
            id: settings.model,
            name: settings.model,
            reasoning: false,
            thinkingLevelMap: undefined,
          }
        if (model && !settings.modelContextWindow) this.unknownCapacity.add(model)
      }
      if (!model) throw new Error('当前提供商未提供所选模型，请重新连接并选择模型')
      if (turn && this.unknownCapacity.has(model))
        throw new Error(
          '此模型没有上下文容量资料，请在模型与连接的更多设置中填写厂商公布的模型上下文容量',
        )
      if (settings.modelContextWindow)
        model = { ...model, contextWindow: settings.modelContextWindow }
      const selection = resolveModelSelection(settings, this.catalog([model]))
      const selected: ModelSelection = {
        ...selection,
        pi: { provider: provider.id, api: model.api },
      }
      onModel?.(selected)
      const inputEstimate =
        estimateTokens(messages.map((message) => message.content).join('\n')) +
        (schema ? estimateTokens(JSON.stringify(z.toJSONSchema(schema))) : 0)
      const availableOutput = model.contextWindow - inputEstimate - 128
      const maxTokens = settings.maxOutputTokens ?? Math.min(8192, model.maxTokens, availableOutput)
      if (maxTokens > model.maxTokens)
        throw new Error(`当前模型最多输出 ${model.maxTokens} Token，请调整输出上限`)
      if (maxTokens < 256 || maxTokens > availableOutput)
        throw new Error('研究材料超出当前模型的上下文容量，请缩小本轮范围或选择更大上下文的模型')
      const context: Context = {
        systemPrompt: messages
          .filter((message) => message.role === 'system')
          .map((message) => message.content)
          .join('\n\n'),
        messages: messages
          .filter((message) => message.role !== 'system')
          .map((message) => {
            if (message.role === 'user')
              return { role: 'user' as const, content: message.content, timestamp: Date.now() }
            if (message.role === 'assistant')
              return {
                role: 'assistant' as const,
                content: [{ type: 'text' as const, text: message.content }],
                api: model.api,
                provider: model.provider,
                model: model.id,
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
                stopReason: 'stop' as const,
                timestamp: Date.now(),
              }
            throw new Error('上下文包含不支持的消息角色')
          }),
      }
      let reportTool: Tool | undefined
      if (schema && settings.jsonMode) {
        reportTool = {
          name: 'submit_research_report',
          description: '提交当前节点的完整研究报告。仅返回数据，不执行任何外部行动。',
          // Zod attaches non-enumerable Standard Schema metadata. Keep only
          // cloneable JSON Schema; Type.Unsafe would expose its functions when
          // Pi builds a strict provider schema.
          parameters: structuredClone(z.toJSONSchema(schema)),
          constrainedSampling: { type: 'json_schema', strict: 'prefer' },
        }
        context.tools = [reportTool]
        context.systemPrompt +=
          '\n请优先通过 submit_research_report 提交报告；若直接返回文本，仍须是约定的完整 JSON 对象。'
      }
      const options: SimpleStreamOptions = {
        signal: requestSignal,
        maxTokens,
        maxRetries: 0,
        onResponse: (response) => {
          httpStatus = response.status
        },
        timeoutMs: 240000,
        transport: 'sse',
        ...(apiKey ? { apiKey } : {}),
        ...(selection.reasoningEffort === 'none'
          ? {}
          : {
              reasoning:
                selection.reasoningEffort === 'ultra' ? undefined : selection.reasoningEffort,
            }),
        headers: settings.anthropicWorkspaceId
          ? { 'anthropic-workspace-id': settings.anthropicWorkspaceId }
          : undefined,
        fetch:
          model.api === 'google-generative-ai' || model.api === 'google-vertex'
            ? undefined
            : async (input, init) => {
                const headers = new Headers(
                  init?.headers ?? (input instanceof Request ? input.headers : undefined),
                )
                if (
                  modelProviderId(settings) === 'custom' &&
                  !apiKey &&
                  stored?.type !== 'api_key'
                ) {
                  headers.delete('authorization')
                  headers.delete('x-api-key')
                }
                const response = await this.network.fetch(input, {
                  ...init,
                  headers,
                  redirect: 'error',
                })
                httpStatus = response.status
                return response
              },
      }
      if (turn) {
        const resolved = await models.getAuth(provider.id, { signal: requestSignal })
        const key = apiKey || resolved?.auth.apiKey || ''
        const nativeHeaders: Record<string, string> = {
          ...Object.fromEntries(
            Object.entries(resolved?.auth.headers ?? {}).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          ),
          ...(key
            ? model.api === 'anthropic-messages'
              ? { 'x-api-key': key }
              : { Authorization: `Bearer ${key}` }
            : {}),
          ...(settings.anthropicWorkspaceId
            ? { 'anthropic-workspace-id': settings.anthropicWorkspaceId }
            : {}),
        }
        return await sessionTurn({
          store: this.store,
          turn,
          settings: { ...settings, reasoningEffort: selection.reasoningEffort },
          model: { ...model, baseUrl: resolved?.auth.baseUrl ?? model.baseUrl },
          schema,
          signal: requestSignal,
          onChunk,
          runtime: toolRuntime,
          onResponse: (response) =>
            onModel?.({
              ...selected,
              model: response.model ?? selected.model,
              pi: {
                ...selected.pi,
                ...(response.responseId ? { responseId: response.responseId } : {}),
              },
            }),
          network: this.network,
          nativeHeaders,
          stream: (context, maxTokens) =>
            models.streamSimple(model, context, { ...options, maxTokens }),
        })
      }
      if (toolRuntime) throw new Error('研究工具需要明确的持久会话归属')
      const stream = models.streamSimple(model, context, options)
      const blocks = new Map<number, string>()
      let raw = ''
      const publish = () => {
        const received = [...blocks.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, text]) => text)
          .join('\n\n')
        raw = received.slice(0, 180000)
        onChunk(raw)
        if (received.length > 180000) throw new Error('模型输出超出单次研究限制，已保存到原文上限')
      }
      for await (const event of stream) {
        if (event.type === 'text_delta' || event.type === 'toolcall_delta') {
          blocks.set(event.contentIndex, (blocks.get(event.contentIndex) ?? '') + event.delta)
          publish()
        } else if (event.type === 'text_end') {
          blocks.set(event.contentIndex, event.content)
          publish()
        } else if (event.type === 'toolcall_end' && !blocks.get(event.contentIndex)) {
          blocks.set(event.contentIndex, JSON.stringify(event.toolCall.arguments))
          publish()
        }
      }
      const response = await stream.result()
      requestSignal.throwIfAborted()
      if (response.stopReason === 'error' || response.stopReason === 'aborted')
        throw new Error(response.errorMessage || '模型连接中断，原文已保存')
      if (response.stopReason === 'length')
        throw new Error('模型输出达到长度上限，原文已保存。请缩小研究范围或提高输出上限。')
      if (!['stop', 'toolUse'].includes(response.stopReason))
        throw new Error('模型没有完成回复，原文已保存')
      const calls = response.content.filter((block) => block.type === 'toolCall')
      if (response.stopReason === 'toolUse' && !calls.length)
        throw new Error('模型返回了未完成的工具请求，原文已保存')
      if (calls.length && (!reportTool || calls.length !== 1 || calls[0].name !== reportTool.name))
        throw new Error('模型返回了本次研究未提供的工具请求，原文已保存')
      if (!raw.trim()) throw new Error('模型没有返回研究内容')
      onModel?.({
        ...selected,
        model: response.responseModel ?? response.model,
        pi: { ...selected.pi, ...(response.responseId ? { responseId: response.responseId } : {}) },
      })
      if (reportTool && calls[0]) validateToolCall([reportTool], calls[0])
      return {
        raw,
        // Pi may coerce tool argument types during validation. QB validates the
        // original arguments so text JSON and tool reports obey the same schema.
        ...(reportTool && calls[0] ? { report: structuredClone(calls[0].arguments) } : {}),
      }
    } catch (error) {
      const failure = this.redact(
        error,
        stored,
        apiKey,
        await credentials.read(provider.id).catch(() => undefined),
      )
      throw httpStatus && httpStatus >= 400
        ? new Error(`模型服务返回 HTTP ${httpStatus}：${failure.message}`)
        : failure
    } finally {
      controller.abort()
    }
  }
  private redact(error: unknown, credential: unknown, key = '', current?: unknown) {
    let message = error instanceof Error ? error.message : '模型连接失败'
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    const sessionErrors: Record<string, string> = {
      CAPABILITY_UNKNOWN:
        '尚未确认此连接的原生压缩能力；请核实服务支持情况，或在模型与连接中明确选择 OM 工作记忆。',
      UNSUPPORTED_STRATEGY: '此连接明确不支持所选原生会话策略，请选择原生优先或 OM 工作记忆。',
      CONTEXT_BUDGET:
        '固定研究材料、当前输入或完整工具组超出会话窗口；请调整材料范围或会话窗口。原文与旧记忆已保留。',
      OM_INPUT_TOO_LARGE:
        '一组完整对话或工具结果超过 OM 输入限制；原文与旧记忆已保留，可减少单次材料范围后继续。',
      OM_OUTPUT_INCOMPLETE: '会话记忆输出被截断，未替换旧记忆；原始研究记录仍保留。',
    }
    if (sessionErrors[code]) message = `[${code}] ${sessionErrors[code]}`
    const values: unknown[] = [key]
    for (const entry of [credential, current]) {
      const data = (entry ?? {}) as Record<string, unknown>
      values.push(data.key, data.access, data.refresh)
      if (data.env && typeof data.env === 'object') values.push(...Object.values(data.env))
    }
    for (const value of values)
      if (typeof value === 'string' && value.length > 3)
        message = message.replaceAll(value, '[凭据已隐藏]')
    if (
      /stream.*(?:ended|closed|incomplete)|before (?:message_stop|a terminal)|without finish_reason/i.test(
        message,
      )
    )
      message = `模型连接在回复完成前中断，原文已保存：${message}`
    return new Error(message.slice(0, 1600))
  }
  shutdown() {
    this.auth.shutdown()
  }
}
