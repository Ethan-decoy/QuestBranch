import { randomUUID } from 'node:crypto'
import type {
  AuthEvent,
  AuthPrompt,
  CredentialStore,
  Models,
  Provider,
} from '@earendil-works/pi-ai'
import type { AuthSession, Settings } from '../research/types'
import { modelConnectionKey } from '../research/api-services'
import { ResearchStore } from './store'
import { defaultNetwork, type Network } from './network'

type Collection = { models: Models; provider: Provider; credentials: CredentialStore }
type Login = {
  value: AuthSession
  settings: Settings
  controller: AbortController
  task?: Promise<void>
  answer?: { id: string; resolve(value: string): void; reject(error: unknown): void }
}

// The UI receives a short-lived login interaction, never SDK credentials.
// Provider login/refresh protocols remain entirely in Pi AI.
export class PiAuth {
  private sessions = new Map<string, Login>()
  constructor(
    private readonly store: ResearchStore,
    private readonly collection: (settings: Settings) => Collection,
    private readonly openUrl?: (url: string) => Promise<unknown>,
    private readonly network: Network = defaultNetwork,
  ) {}
  get pending() {
    return [...this.sessions.values()].some((session) => session.value.status === 'pending')
  }
  async start(settings: Settings, type: 'oauth' | 'api_key'): Promise<AuthSession> {
    if (this.pending) throw new Error('已有账号连接正在进行，请先完成或取消')
    if ((settings.provider === 'account') !== (type === 'oauth'))
      throw new Error('登录方式与当前连接不匹配')
    const { models, provider } = this.collection(settings)
    if (type === 'oauth' ? !provider.auth.oauth : !provider.auth.apiKey?.login)
      throw new Error('当前提供商不支持此认证方式')
    // Retain only a few recent non-secret interaction results.
    if (this.sessions.size >= 8) this.sessions.delete(this.sessions.keys().next().value!)
    const session: Login = {
      value: {
        id: randomUUID(),
        provider: provider.id,
        status: 'pending',
        message: '正在准备连接…',
      },
      settings: { ...settings },
      controller: new AbortController(),
    }
    this.sessions.set(session.value.id, session)
    const signal = AbortSignal.any([session.controller.signal, AbortSignal.timeout(600000)])
    const secrets = new Set<string>()
    session.task = this.network.run(
      { operation: 'auth-login', provider: provider.id },
      async () => {
        try {
          await models.login(
            provider.id,
            type,
            {
              signal,
              prompt: (prompt) => this.prompt(session, prompt, signal, secrets),
              notify: (event) => this.notify(session, event),
            },
            { agentName: 'QuestBranch', getDeviceId: () => this.store.installationId() },
          )
          session.value = {
            id: session.value.id,
            provider: provider.id,
            status: 'connected',
            message: '已连接',
          }
        } catch (error) {
          let message = error instanceof Error ? error.message : '连接未完成'
          for (const secret of secrets)
            if (secret) message = message.replaceAll(secret, '[凭据已隐藏]')
          session.value = {
            id: session.value.id,
            provider: provider.id,
            status: session.controller.signal.aborted ? 'cancelled' : 'failed',
            message: session.controller.signal.aborted
              ? '已取消连接'
              : signal.aborted
                ? '连接超时，请重试'
                : message.slice(0, 1200),
          }
        } finally {
          session.answer?.reject(new DOMException('登录步骤已结束', 'AbortError'))
          session.answer = undefined
          secrets.clear()
        }
      },
    )
    return structuredClone(session.value)
  }
  private prompt(session: Login, prompt: AuthPrompt, signal: AbortSignal, secrets: Set<string>) {
    const promptSignal = prompt.signal ? AbortSignal.any([signal, prompt.signal]) : signal
    promptSignal.throwIfAborted()
    const id = randomUUID()
    session.value.prompt = {
      id,
      type: prompt.type,
      message: prompt.message,
      ...('placeholder' in prompt ? { placeholder: prompt.placeholder } : {}),
      ...(prompt.type === 'select'
        ? { options: prompt.options.map((option) => ({ ...option })) }
        : {}),
    }
    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        promptSignal.removeEventListener('abort', abort)
        if (session.value.prompt?.id === id) delete session.value.prompt
        if (session.answer?.id === id) session.answer = undefined
      }
      const abort = () => {
        cleanup()
        reject(promptSignal.reason)
      }
      session.answer = {
        id,
        resolve(value) {
          if (prompt.type === 'secret') secrets.add(value)
          cleanup()
          resolve(value)
        },
        reject(error) {
          cleanup()
          reject(error)
        },
      }
      promptSignal.addEventListener('abort', abort, { once: true })
      if (promptSignal.aborted) abort()
    })
  }
  private notify(session: Login, event: AuthEvent) {
    if (session.value.status !== 'pending') return
    if (event.type === 'progress' || event.type === 'info')
      session.value.message = event.message.slice(0, 2000)
    const rawUrl =
      event.type === 'auth_url'
        ? event.url
        : event.type === 'device_code'
          ? event.verificationUri
          : undefined
    if (event.type === 'device_code') session.value.userCode = event.userCode
    if (event.type === 'auth_url')
      session.value.message = event.instructions || '请在浏览器中完成授权'
    if (rawUrl) {
      const url = new URL(rawUrl)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return
      session.value.url = url.toString()
      void this.openUrl?.(url.toString()).catch(() => {
        if (session.value.status === 'pending') session.value.message = '请打开下方授权链接继续连接'
      })
    }
  }
  async status(id: string) {
    return structuredClone(this.get(id).value)
  }
  async respond(id: string, promptId: string, value: string) {
    const session = this.get(id)
    const prompt = session.value.prompt
    if (
      session.value.status !== 'pending' ||
      session.answer?.id !== promptId ||
      prompt?.id !== promptId
    )
      throw new Error('此登录步骤已结束，请使用当前步骤')
    if (value.length > 16000 || !value.trim()) throw new Error('请输入有效的登录信息')
    if (prompt.type === 'select' && !prompt.options?.some((option) => option.id === value))
      throw new Error('请选择当前步骤提供的选项')
    session.answer.resolve(value)
  }
  async cancel(id: string) {
    const session = this.get(id)
    if (session.value.status !== 'pending') return
    session.controller.abort()
    session.answer?.reject(new DOMException('已取消连接', 'AbortError'))
    await session.task
    if (session.value.status === 'pending') {
      session.value = {
        id,
        provider: session.value.provider,
        status: 'cancelled',
        message: '已取消连接',
      }
    }
  }
  async logout(settings: Settings) {
    for (const session of this.sessions.values()) {
      if (
        modelConnectionKey(session.settings) === modelConnectionKey(settings) &&
        session.value.status === 'pending'
      ) {
        await this.cancel(session.value.id)
        await session.task
      }
    }
    const { models, provider } = this.collection(settings)
    await models.logout(provider.id, { signal: AbortSignal.timeout(30000) })
  }
  private get(id: string) {
    const session = this.sessions.get(id)
    if (!session) throw new Error('连接会话已结束，请重新连接')
    return session
  }
  shutdown() {
    for (const session of this.sessions.values())
      if (session.value.status === 'pending') void this.cancel(session.value.id)
  }
}
