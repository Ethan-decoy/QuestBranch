import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { version } from '../../package.json'
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  CreateElicitationRequest,
  type ClientConnection,
  type SessionConfigOption,
  type SessionNotification,
  type McpCapabilities,
  type McpServer,
} from '@agentclientprotocol/sdk'
import {
  AgentConfigSchema,
  AgentResponseSchema,
  type AgentClient,
  type AgentConfig,
  type AgentConnection,
  type AgentRequest,
  type AgentResponse,
  type AgentRun,
} from '../research/agent'
import type { ContextPack } from '../research/types'

type LiveConnection = {
  child: ChildProcessWithoutNullStreams
  peer: ClientConnection
  state: AgentConnection
  config: AgentConfig
  mcpServers?: McpServer[]
  sessionId?: string
  pending: Map<string, (response: AgentResponse) => void>
  run: AgentRun
  output: string
  answer: string
  messageId?: string
  afterTool?: boolean
  changed?: (output: string, agent: AgentRun) => void
  idle?: ReturnType<typeof setTimeout>
  closing: boolean
  closed?: Promise<void>
}
const message = (error: unknown) => (error instanceof Error ? error.message : '智能体连接失败')
const unpacked = (path: string) => path.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

export function codexLaunch() {
  const require = createRequire(import.meta.url)
  const adapter = require.resolve('@agentclientprotocol/codex-acp/dist/index.js')
  const adapterRequire = createRequire(adapter)
  const codexRequire = createRequire(adapterRequire.resolve('@openai/codex/package.json'))
  const platform = `${process.platform}-${process.arch}`
  const triples: Record<string, string> = {
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-musl',
    'linux-arm64': 'aarch64-unknown-linux-musl',
  }
  if (!triples[platform]) throw new Error('此平台尚无内置 Codex，请配置自定义 ACP 程序')
  const vendor = dirname(codexRequire.resolve(`@openai/codex-${platform}/package.json`))
  const executable = unpacked(
    join(
      vendor,
      'vendor',
      triples[platform],
      'bin',
      process.platform === 'win32' ? 'codex.exe' : 'codex',
    ),
  )
  if (!existsSync(executable)) throw new Error('未找到内置 Codex 资源，请重新安装完整应用')
  return { command: process.execPath, args: [adapter], env: { CODEX_PATH: executable } }
}

function configOptions(options: SessionConfigOption[] = []): AgentConnection['options'] {
  return options.flatMap((option) =>
    option.type === 'select'
      ? [
          {
            id: option.id,
            name: option.name,
            category: option.category ?? undefined,
            value: option.currentValue,
            choices: option.options
              .flatMap((choice) => ('options' in choice ? choice.options : [choice]))
              .map(({ value, name }) => ({ value, name })),
          },
        ]
      : [],
  )
}

/** Owns the stdio process and protocol lifetime; domain/UI never handle ACP payloads. */
export class AcpAgents implements AgentClient {
  private connections = new Map<string, LiveConnection>()
  private readonly directory: string
  constructor(directory: string) {
    this.directory = resolve(directory)
  }
  get pending() {
    return [...this.connections.values()].some((entry) => entry.state.status === 'authenticating')
  }
  private entry(id: string) {
    const entry = this.connections.get(id)
    if (!entry || entry.closing) throw new Error('连接已结束，请重新连接智能体')
    return entry
  }
  private emit(entry: LiveConnection) {
    entry.run.name = entry.state.name
    entry.run.sessionId = entry.sessionId
    entry.run.configuration = Object.fromEntries(
      entry.state.options.map((option) => [option.id, option.value]),
    )
    entry.run.requests = entry.state.requests
    entry.changed?.(entry.output, structuredClone(entry.run))
  }
  private touch(entry: LiveConnection) {
    clearTimeout(entry.idle)
    if (entry.closing) return
    // Settings connections are disposable. Native login data stays in the agent.
    if (!entry.changed && entry.state.status !== 'authenticating')
      entry.idle = setTimeout(() => void this.disconnect(entry.state.id), 5 * 60_000).unref()
  }
  private async bounded<T>(entry: LiveConnection, promise: Promise<T>, ms = 30_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('智能体响应超时，请重新连接'))
            void this.disconnect(entry.state.id)
          }, ms)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  async connect(
    input: AgentConfig,
    signal?: AbortSignal,
    researchTools?: (capabilities?: McpCapabilities) => McpServer[],
  ): Promise<AgentConnection> {
    if (signal?.aborted) throw new Error('已取消研究')
    if (this.connections.size >= 6) throw new Error('请先结束已有智能体连接')
    const config = AgentConfigSchema.parse(input)
    const cwd = config.cwd || join(this.directory, 'agent-workspace')
    if (!isAbsolute(cwd)) throw new Error('工作目录应使用绝对路径')
    if (!config.cwd) mkdirSync(cwd, { recursive: true })
    const launch =
      config.kind === 'codex'
        ? codexLaunch()
        : {
            command: config.command?.trim() ?? '',
            args: config.args ?? [],
            env: {},
          }
    if (!launch.command) throw new Error('请填写 ACP 程序路径')
    const child = spawn(launch.command, launch.args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...launch.env,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
    })
    // stderr is diagnostic transport, never a chat message or raw user-facing log.
    child.stderr.resume()
    const state: AgentConnection = {
      id: randomUUID(),
      name: config.kind === 'codex' ? 'Codex' : 'ACP',
      status: 'login-required',
      authMethods: [],
      options: [],
      commands: [],
      requests: [],
    }
    const app = client({ name: 'questbranch' })
      .onNotification(methods.client.session.update, ({ params }) => this.update(entry, params))
      .onRequest(methods.client.session.requestPermission, async ({ params, signal }) => {
        const response = await this.ask(
          entry,
          {
            id: randomUUID(),
            connectionId: state.id,
            kind: 'permission',
            title: params.toolCall.title?.slice(0, 2000) || '智能体请求使用工具',
            options: params.options.map((option) => ({ id: option.optionId, name: option.name })),
            status: 'pending',
          },
          signal,
        )
        return {
          outcome: response.optionId
            ? { outcome: 'selected' as const, optionId: response.optionId }
            : { outcome: 'cancelled' as const },
        }
      })
      .onRequest(methods.client.elicitation.create, async ({ params, signal }) => {
        if (!CreateElicitationRequest.isUrl(params)) return { action: 'decline' as const }
        const response = await this.ask(
          entry,
          {
            id: params.elicitationId,
            connectionId: state.id,
            kind: 'url',
            title: params.message.slice(0, 2000),
            url: params.url,
            options: [],
            status: 'pending',
          },
          signal,
        )
        return { action: response.action ?? 'cancel' }
      })
      .onNotification(methods.client.elicitation.complete, ({ params }) => {
        const request = state.requests.find((request) => request.id === params.elicitationId)
        if (request) {
          request.status = 'resolved'
          this.emit(entry)
        }
      })
    const peer = app.connect(
      ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    )
    const entry: LiveConnection = {
      child,
      peer,
      state,
      config,
      pending: new Map(),
      run: { name: state.name, activities: [], requests: [] },
      output: '',
      answer: '',
      closing: false,
    }
    this.connections.set(state.id, entry)
    const cancelled = () => {
      void this.disconnect(state.id)
    }
    signal?.addEventListener('abort', cancelled, { once: true })
    const died = (error: Error) => {
      if (entry.closing) return
      state.status = 'failed'
      state.error = error.message
      peer.close(error)
      this.emit(entry)
    }
    child.once('error', died)
    child.once('exit', (code) => died(new Error(`智能体进程已退出（${code ?? '中断'}）`)))
    peer.signal.addEventListener(
      'abort',
      () => {
        if (!entry.closing && state.status !== 'failed') {
          state.status = 'failed'
          state.error = '智能体连接已关闭'
          this.emit(entry)
          void this.disconnect(state.id)
        }
      },
      { once: true },
    )
    try {
      const initialized = await this.bounded(
        entry,
        peer.agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: 'questbranch', version },
          clientCapabilities: { elicitation: { url: {} } },
        }),
      )
      if (initialized.protocolVersion !== PROTOCOL_VERSION)
        throw new Error('此智能体的 ACP 协议版本不受支持')
      entry.mcpServers = researchTools?.(initialized.agentCapabilities?.mcpCapabilities)
      state.name = (
        initialized.agentInfo?.title ||
        initialized.agentInfo?.name ||
        state.name
      ).slice(0, 200)
      state.authMethods = (initialized.authMethods ?? [])
        // This adapter's API-key method requires a private metadata extension.
        // API credentials remain available through Pi or the native CLI config.
        .filter((method) => config.kind !== 'codex' || method.id !== 'api-key')
        .map(({ id, name }) => ({ id, name }))
      await this.newSession(entry)
      this.touch(entry)
      return structuredClone(state)
    } catch (error) {
      await this.disconnect(state.id)
      throw new Error(state.error || message(error))
    } finally {
      signal?.removeEventListener('abort', cancelled)
    }
  }
  private async newSession(entry: LiveConnection) {
    try {
      const session = await this.bounded(
        entry,
        entry.peer.agent.request(methods.agent.session.new, {
          cwd: entry.config.cwd || join(this.directory, 'agent-workspace'),
          mcpServers: entry.mcpServers ?? [],
        }),
      )
      entry.sessionId = session.sessionId
      entry.state.options = configOptions(session.configOptions ?? [])
      entry.state.status = 'connected'
      entry.state.error = undefined
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === -32000) {
        entry.state.status = 'login-required'
      } else throw error
    }
  }
  async state(id: string) {
    const entry = this.entry(id)
    this.touch(entry)
    return structuredClone(entry.state)
  }
  async authenticate(id: string, methodId: string) {
    const entry = this.entry(id)
    if (entry.state.status === 'authenticating') throw new Error('登录正在进行')
    if (!entry.state.authMethods.some((method) => method.id === methodId))
      throw new Error('此登录方式不可用')
    clearTimeout(entry.idle)
    entry.state.status = 'authenticating'
    entry.state.error = undefined
    void this.bounded(
      entry,
      entry.peer.agent.request(methods.agent.authenticate, { methodId }),
      180_000,
    )
      .then(() => this.newSession(entry))
      .catch((error) => {
        entry.state.status = 'failed'
        entry.state.error = message(error)
      })
      .finally(() => {
        this.touch(entry)
        this.emit(entry)
      })
  }
  async configure(id: string, configId: string, value: string) {
    const entry = this.entry(id)
    if (!entry.sessionId || entry.state.status !== 'connected') throw new Error('请先连接智能体')
    const option = entry.state.options.find((option) => option.id === configId)
    if (!option || !option.choices.some((choice) => choice.value === value))
      throw new Error(`智能体配置已变化，请重新选择：${configId}`)
    const result = await this.bounded(
      entry,
      entry.peer.agent.request(methods.agent.session.setConfigOption, {
        sessionId: entry.sessionId,
        configId,
        value,
      }),
    )
    entry.state.options = configOptions(result.configOptions)
    this.touch(entry)
    return structuredClone(entry.state)
  }
  private ask(
    entry: LiveConnection,
    request: AgentRequest,
    signal: AbortSignal,
  ): Promise<AgentResponse> {
    if (entry.state.requests.length >= 100 || signal.aborted || entry.closing)
      return Promise.resolve({ action: 'cancel' })
    entry.state.requests.push(request)
    this.emit(entry)
    return new Promise((resolve) => {
      const finish = (response: AgentResponse) => {
        signal.removeEventListener('abort', cancel)
        entry.pending.delete(request.id)
        request.status = response.action === 'cancel' ? 'cancelled' : 'resolved'
        this.emit(entry)
        resolve(response)
      }
      const cancel = () => finish({ action: 'cancel' })
      entry.pending.set(request.id, finish)
      signal.addEventListener('abort', cancel, { once: true })
    })
  }
  async respond(id: string, requestId: string, input: AgentResponse) {
    const entry = this.entry(id),
      response = AgentResponseSchema.parse(input)
    const request = entry.state.requests.find(
      (request) => request.id === requestId && request.status === 'pending',
    )
    const resolve = entry.pending.get(requestId)
    if (!request || !resolve) throw new Error('此请求已结束')
    if (
      request.kind === 'permission' &&
      response.action !== 'cancel' &&
      !request.options.some((option) => option.id === response.optionId)
    )
      throw new Error('请选择智能体提供的选项')
    if (request.kind === 'url' && !response.action) throw new Error('请选择继续或取消')
    resolve(response)
  }
  private update(entry: LiveConnection, { sessionId, update }: SessionNotification) {
    if (entry.closing || (entry.sessionId && entry.sessionId !== sessionId)) return
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          if (
            update.messageId
              ? entry.messageId && update.messageId !== entry.messageId
              : entry.afterTool
          ) {
            entry.answer = ''
            if (entry.output) entry.output += '\n\n'
          }
          entry.afterTool = false
          entry.messageId = update.messageId ?? entry.messageId
          entry.answer = (entry.answer + update.content.text).slice(0, 180000)
          entry.output = (entry.output + update.content.text).slice(0, 180000)
        }
        break
      case 'tool_call':
      case 'tool_call_update': {
        entry.afterTool = true
        let activity = entry.run.activities.find((activity) => activity.id === update.toolCallId)
        if (!activity && entry.run.activities.length < 500) {
          activity = {
            id: update.toolCallId,
            title: '工具调用',
            kind: 'other',
            status: 'pending',
            content: '',
          }
          entry.run.activities.push(activity)
        }
        if (!activity) return
        if (update.title) activity.title = update.title.slice(0, 1000)
        if (update.kind) activity.kind = update.kind
        if (update.status) activity.status = update.status
        if (update.content)
          activity.content = update.content
            .flatMap((content) => {
              if (content.type === 'content' && content.content.type === 'text')
                return [content.content.text]
              if (content.type === 'diff') return [`文件变更：${content.path}`]
              return []
            })
            .join('\n')
            .slice(0, 20000)
        break
      }
      case 'available_commands_update':
        entry.state.commands = update.availableCommands.map(({ name, description }) => ({
          name,
          description,
        }))
        break
      case 'config_option_update':
        entry.state.options = configOptions(update.configOptions)
        break
    }
    this.emit(entry)
  }
  async run(
    config: AgentConfig,
    context: ContextPack,
    signal: AbortSignal,
    changed: (output: string, agent: AgentRun) => void,
    researchTools?: (capabilities?: McpCapabilities) => McpServer[],
  ) {
    if (signal.aborted) throw new Error('已取消研究')
    // Every turn reconstructs context from QB; hidden native history cannot duplicate it.
    const connection = await this.connect(config, signal, researchTools)
    const entry = this.entry(connection.id)
    clearTimeout(entry.idle)
    entry.changed = changed
    const cancel = () => {
      if (entry.sessionId)
        void entry.peer.agent
          .notify(methods.agent.session.cancel, { sessionId: entry.sessionId })
          .catch(() => {})
      void this.disconnect(connection.id)
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      if (signal.aborted) throw new Error('已取消研究')
      if (connection.status !== 'connected' || !entry.sessionId)
        throw new Error('请先在“模型与连接 → 智能体”登录此智能体')
      for (const [configId, value] of Object.entries(config.options ?? {})) {
        await this.configure(connection.id, configId, value)
      }
      this.emit(entry)
      const current = context.messages.at(-1)!.content
      const nativeCommand = /^\/[a-z][\w-]*(?:\s|$)/i.test(current)
      const text = nativeCommand
        ? current
        : context.messages.map((part) => `[${part.role}]\n${part.content}`).join('\n\n')
      const result = await this.bounded(
        entry,
        entry.peer.agent.request(methods.agent.session.prompt, {
          sessionId: entry.sessionId,
          prompt: [{ type: 'text', text }],
        }),
        30 * 60_000,
      )
      if (result.stopReason === 'cancelled' || signal.aborted) throw new Error('已取消研究')
      if (result.stopReason !== 'end_turn')
        throw new Error(`智能体未完成回复（${result.stopReason}）`)
      return {
        raw: entry.output,
        answer: entry.answer,
        agent: structuredClone(entry.run),
        model:
          entry.state.options.find((option) => option.category === 'model')?.value ||
          entry.state.name,
      }
    } catch (error) {
      throw new Error(entry.state.error || message(error))
    } finally {
      signal.removeEventListener('abort', cancel)
      await this.disconnect(connection.id)
    }
  }
  async disconnect(id: string) {
    const entry = this.connections.get(id)
    if (!entry) return
    if (entry.closing) return entry.closed
    entry.closing = true
    entry.closed = this.close(entry)
    return entry.closed
  }
  private async close(entry: LiveConnection) {
    clearTimeout(entry.idle)
    for (const resolve of [...entry.pending.values()]) resolve({ action: 'cancel' })
    entry.peer.close()
    // SDK close does not close the writer. EOF triggers adapter supervisor shutdown.
    entry.child.stdin.end()
    entry.child.stdout.resume()
    if (entry.child.exitCode === null && entry.child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          entry.child.kill()
          resolve()
        }, 4000).unref()
        entry.child.once('close', () => {
          clearTimeout(timer)
          resolve()
        })
        entry.child.once('error', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    this.connections.delete(entry.state.id)
  }
  shutdown() {
    for (const id of this.connections.keys()) void this.disconnect(id)
  }
}
