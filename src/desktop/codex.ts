import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import type { ConnectionResult, ContextPack, Settings } from '../research/types'

type Packet = {
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { message?: string }
}
type Launcher = (file: string, args: string[], directory: string) => ChildProcessWithoutNullStreams

// Codex owns login and inference. QB speaks its local JSONL protocol and never reads auth files.
class Rpc {
  private buffer = ''
  private next = 0
  private closed = false
  private closing?: Promise<void>
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  readonly listeners = new Set<(packet: Packet) => void>()
  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      if (this.buffer.length > 2_000_000)
        return this.fail(new Error('Codex 返回的数据超过连接限制'))
      let end: number
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end)
        this.buffer = this.buffer.slice(end + 1)
        if (!line.trim()) continue
        try {
          const packet = JSON.parse(line) as Packet
          if (packet.id !== undefined && packet.method) {
            // Research connections have no approval UI or executable dynamic tools.
            this.write({
              id: packet.id,
              error: {
                code: -32601,
                message: 'QuestBranch research connection does not provide this capability',
              },
            })
          } else if (typeof packet.id === 'number') {
            const pending = this.pending.get(packet.id)
            if (pending) {
              clearTimeout(pending.timer)
              this.pending.delete(packet.id)
              if (packet.error) pending.reject(new Error(packet.error.message ?? 'Codex 请求失败'))
              else pending.resolve(packet.result)
            }
          } else for (const listener of this.listeners) listener(packet)
        } catch {
          this.fail(new Error('Codex 返回了无效的协议数据'))
        }
      }
    })
    // stderr can contain host diagnostics; never expose it or authentication details in QB.
    child.stderr.resume()
    child.stdin.on('error', () => this.fail(new Error('Codex 连接已关闭')))
    child.once('error', () => this.fail(new Error('无法启动 Codex，请检查程序路径')))
    child.once('exit', () => this.fail(new Error('Codex 进程已退出，请重新连接')))
  }
  private write(packet: unknown) {
    this.child.stdin.write(JSON.stringify(packet) + '\n')
  }
  request<T>(method: string, params: unknown = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Codex 连接已关闭'))
    return new Promise((resolve, reject) => {
      const id = ++this.next
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex ${method} 响应超时`))
      }, 30000)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.write({ id, method, params })
    })
  }
  notify(method: string) {
    this.write({ method, params: {} })
  }
  private fail(error: Error) {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    for (const listener of this.listeners)
      listener({ method: 'qb/disconnected', params: { message: error.message } })
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.fail(new Error('Codex 连接已结束'))
    this.closing = new Promise((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        resolve()
        return
      }
      const kill = setTimeout(() => this.child.kill(), 1500)
      this.child.once('close', () => {
        clearTimeout(kill)
        resolve()
      })
      this.child.stdin.end()
    })
    return this.closing
  }
}

export function findCodex(configured = ''): string {
  if (configured) {
    if (
      !isAbsolute(configured) ||
      !existsSync(configured) ||
      (process.platform === 'win32' && !configured.toLowerCase().endsWith('.exe'))
    )
      throw new Error('请填写 Codex 原生程序的完整路径（Windows 为 codex.exe）')
    return configured
  }
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue
    const file = join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex')
    if (existsSync(file)) return file
  }
  if (process.platform === 'win32') {
    const root = join(homedir(), 'AppData', 'Local', 'OpenAI', 'Codex', 'bin')
    if (existsSync(root)) {
      const folders = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      for (const folder of folders)
        if (existsSync(join(folder, 'codex.exe'))) return join(folder, 'codex.exe')
    }
  }
  if (
    process.platform === 'darwin' &&
    existsSync('/Applications/Codex.app/Contents/Resources/codex')
  )
    return '/Applications/Codex.app/Contents/Resources/codex'
  throw new Error('未找到 Codex。请先安装并登录 Codex，或在设置中填写 Codex 程序路径。')
}

const launch: Launcher = (file, args, cwd) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/(?:API_KEY|TOKEN|PASSWORD|SECRET)$/i.test(name),
    ),
  )
  return spawn(file, args, { cwd, env, windowsHide: true, stdio: 'pipe', shell: false })
}
const disabledFeatures = [
  'shell_tool',
  'unified_exec',
  'shell_snapshot',
  'js_repl',
  'code_mode',
  'code_mode_host',
  'multi_agent',
  'multi_agent_v2',
  'apps',
  'plugins',
  'hooks',
  'memories',
  'view_image',
  'sleep_tool',
  'tool_suggest',
  'apply_patch_freeform',
  'apply_patch_streaming_events',
]
type AccountReply = { account: { type: string; planType?: string; email?: string | null } | null }
type ModelReply = { data: { model: string; isDefault?: boolean }[] }
type Item = { type: string; id: string; text?: string; phase?: string | null }
type QuotaWindow = NonNullable<ConnectionResult['usage']>[number]

export class CodexAdapter {
  constructor(
    private readonly directory: string,
    private readonly launcher: Launcher = launch,
  ) {}
  private async connect(settings: Settings) {
    const cwd = join(this.directory, 'codex-research')
    mkdirSync(cwd, { recursive: true })
    const args = [
      'app-server',
      '--listen',
      'stdio://',
      ...disabledFeatures.flatMap((name) => ['-c', `features.${name}=false`]),
    ]
    const rpc = new Rpc(this.launcher(findCodex(settings.codexPath), args, cwd))
    try {
      await rpc.request('initialize', {
        clientInfo: { name: 'questbranch', title: 'QuestBranch', version: '0.2.0' },
        capabilities: { experimentalApi: true },
      })
      rpc.notify('initialized')
      const identity = await rpc.request<AccountReply>('account/read', { refreshToken: false })
      if (identity.account?.type !== 'chatgpt')
        throw new Error(
          '请先在 Codex 登录 ChatGPT 账号，再返回 QB 测试连接。此连接使用 Codex 账号额度。',
        )
      return {
        rpc,
        cwd,
        account: {
          type: 'chatgpt' as const,
          plan: identity.account.planType ?? 'unknown',
          email: identity.account.email ?? null,
        },
      }
    } catch (error) {
      await rpc.close()
      throw error
    }
  }
  async test(settings: Settings): Promise<ConnectionResult> {
    const { rpc, account } = await this.connect(settings)
    try {
      const models = await rpc.request<ModelReply>('model/list', { limit: 100 })
      let usage: ConnectionResult['usage']
      try {
        const limits = await rpc.request<{
          rateLimitsByLimitId?: Record<
            string,
            { primary?: QuotaWindow | null; secondary?: QuotaWindow | null }
          >
          rateLimits?: { primary?: QuotaWindow | null; secondary?: QuotaWindow | null }
        }>('account/rateLimits/read')
        const bucket = limits.rateLimitsByLimitId?.codex ?? limits.rateLimits
        const windows = [bucket?.primary, bucket?.secondary].filter(
          (window): window is QuotaWindow => !!window && typeof window.usedPercent === 'number',
        )
        if (windows.length) usage = windows
      } catch {
        /* A login can be valid while usage information is temporarily unavailable. */
      }
      return {
        models: models.data.map((model) => model.model),
        account,
        ...(usage ? { usage } : {}),
      }
    } finally {
      await rpc.close()
    }
  }
  async generate(
    settings: Settings,
    context: ContextPack,
    signal: AbortSignal,
    onChunk: (output: string) => void,
    onSession: (session: { model: string; threadId: string; turnId?: string }) => void,
    outputSchema?: unknown,
  ): Promise<string> {
    signal.throwIfAborted()
    const { rpc, cwd } = await this.connect(settings)
    let threadId = '',
      turnId = ''
    const interrupt = () => {
      if (threadId && turnId)
        void rpc.request('turn/interrupt', { threadId, turnId }).catch(() => {})
      void rpc.close()
    }
    signal.addEventListener('abort', interrupt, { once: true })
    try {
      signal.throwIfAborted()
      const configured = await rpc.request<{ config: { mcp_servers?: Record<string, unknown> } }>(
        'config/read',
        { includeLayers: false },
      )
      const thread = await rpc.request<{
        thread: { id: string }
        model: string
        modelProvider: string
      }>('thread/start', {
        ...(settings.model ? { model: settings.model } : {}),
        modelProvider: 'openai',
        cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
        baseInstructions: context.messages
          .filter((message) => message.role === 'system')
          .map((message) => message.content)
          .join('\n\n'),
        developerInstructions: '',
        config: {
          forced_login_method: 'chatgpt',
          web_search: 'disabled',
          project_doc_max_bytes: 0,
          include_environment_context: false,
          include_apps_instructions: false,
          include_collaboration_mode_instructions: false,
          features: Object.fromEntries(disabledFeatures.map((name) => [name, false])),
          mcp_servers: Object.fromEntries(
            Object.keys(configured.config.mcp_servers ?? {}).map((name) => [
              name,
              { enabled: false },
            ]),
          ),
        },
      })
      if (thread.modelProvider !== 'openai')
        throw new Error('Codex 未使用 ChatGPT 对应的模型提供方，研究已停止')
      threadId = thread.thread.id
      onSession({ model: thread.model, threadId })
      const items = new Map<string, Item>()
      const visible = () => {
        const messages = [...items.values()].filter(
          (item) => item.type === 'agentMessage' && item.phase !== 'commentary',
        )
        const final = messages.filter((item) => item.phase === 'final_answer')
        return (outputSchema && final.length ? final : messages)
          .map((item) => item.text ?? '')
          .join('\n\n')
      }
      let settle: (error?: Error) => void = () => {}
      const completed = new Promise<void>((resolve, reject) => {
        settle = (error) => (error ? reject(error) : resolve())
      })
      void completed.catch(() => {})
      const listener = (packet: Packet) => {
        const params = packet.params ?? {}
        if (packet.method === 'qb/disconnected') return settle(new Error(String(params.message)))
        if (params.threadId !== threadId) return
        if (packet.method === 'item/started' || packet.method === 'item/completed') {
          const item = params.item as Item
          if (
            [
              'commandExecution',
              'fileChange',
              'mcpToolCall',
              'dynamicToolCall',
              'collabAgentToolCall',
            ].includes(item.type)
          ) {
            settle(new Error('Codex 请求了研究连接未开放的执行工具，本次研究已停止'))
            interrupt()
            return
          }
          if (item.type === 'agentMessage') {
            items.set(item.id, item)
            onChunk(visible())
          }
        } else if (packet.method === 'item/agentMessage/delta') {
          const id = String(params.itemId),
            previous = items.get(id)
          items.set(id, {
            type: 'agentMessage',
            id,
            ...previous,
            text: (previous?.text ?? '') + String(params.delta ?? ''),
          })
          const output = visible()
          if (output.length > 180000) {
            settle(new Error('Codex 输出超出单次研究限制'))
            interrupt()
          } else onChunk(output)
        } else if (packet.method === 'turn/completed') {
          const turn = params.turn as {
            status: string
            error?: { message?: string }
            items?: Item[]
          }
          for (const item of turn.items ?? [])
            if (item.type === 'agentMessage') items.set(item.id, item)
          if (turn.status === 'completed') settle()
          else settle(new Error(turn.error?.message ?? 'Codex 对话已中断'))
        } else if (packet.method === 'error' && params.willRetry !== true) {
          settle(new Error((params.error as { message?: string })?.message ?? 'Codex 研究失败'))
        }
      }
      rpc.listeners.add(listener)
      const timeout = setTimeout(() => {
        settle(new Error('Codex 研究超过十分钟，已有输出已保留'))
        interrupt()
      }, 600000)
      try {
        const turn = await rpc.request<{ turn: { id: string } }>('turn/start', {
          threadId,
          input: [
            {
              type: 'text',
              text: context.messages
                .filter((message) => message.role !== 'system')
                .map((message) => `[${message.role}]\n${message.content}`)
                .join('\n\n'),
              text_elements: [],
            },
          ],
          ...(outputSchema ? { outputSchema } : {}),
        })
        turnId = turn.turn.id
        onSession({ model: thread.model, threadId, turnId })
        await completed
        signal.throwIfAborted()
        const output = visible()
        if (!output.trim()) throw new Error('Codex 没有返回对话内容')
        onChunk(output)
        return output
      } finally {
        clearTimeout(timeout)
        rpc.listeners.delete(listener)
      }
    } finally {
      signal.removeEventListener('abort', interrupt)
      await rpc.close()
    }
  }
}
