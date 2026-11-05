import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type OAuthAuth,
} from '@earendil-works/pi-ai'
import { ResearchStore } from '../src/desktop/store'
import { PiModels } from '../src/desktop/pi-models'
import { PiCredentialStore } from '../src/desktop/pi-credentials'
import { ResearchService } from '../src/desktop/service'
import { modelConnectionKey } from '../src/research/api-services'
import { defaultSettings, ResearchOutputSchema, type Settings } from '../src/research/types'

const stores: ResearchStore[] = []
const directories: string[] = []
const runtimes: PiModels[] = []
function store(seed = true) {
  vi.stubEnv('TAVILY_API_KEY', '')
  const directory = mkdtempSync(join(tmpdir(), 'qb-pi-test-'))
  directories.push(directory)
  const db = new ResearchStore(directory, { seed })
  stores.push(db)
  return db
}
function fixture(db: ResearchStore, login?: OAuthAuth['login']) {
  const faux = fauxProvider({
    tokensPerSecond: Infinity,
    tokenSize: { min: 4096, max: 4096 },
    provider: 'fixture-account',
    models: [{ id: 'fixture-model', reasoning: true, contextWindow: 128000, maxTokens: 16384 }],
  })
  const refresh = vi.fn(async () => ({
    type: 'oauth' as const,
    access: 'refreshed-access-secret',
    refresh: 'refreshed-refresh-secret',
    expires: Date.now() + 3600000,
  }))
  const oauth: OAuthAuth = {
    name: 'Fixture subscription',
    isSubscription: true,
    login:
      login ??
      (async () => ({
        type: 'oauth',
        access: 'fixture-access-secret',
        refresh: 'fixture-refresh-secret',
        expires: Date.now() + 3600000,
      })),
    refresh,
    toAuth: async (credential) => ({ apiKey: credential.access }),
  }
  const provider = { ...faux.provider, auth: { ...faux.provider.auth, oauth } }
  const opened = vi.fn(async (_url: string) => {})
  const runtime = new PiModels(db, { providers: [provider], openAuthUrl: opened })
  runtimes.push(runtime)
  const settings: Settings = {
    ...defaultSettings,
    provider: 'account',
    modelProvider: provider.id,
    model: 'fixture-model',
    sessionStrategy: 'portable',
  }
  return { runtime, provider, faux, settings, refresh, opened }
}
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.shutdown()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const db of stores.splice(0)) db.close()
  for (const directory of directories.splice(0)) {
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('qb-pi-test-'))
      throw new Error('Unexpected Pi test cleanup path')
    rmSync(target, { recursive: true, force: true })
  }
})

describe('Pi 账号授权与持久凭据', () => {
  it('支持授权链接、设备码和多步输入，令牌加密保存且不返回界面或研究导出', async () => {
    const db = store()
    const { runtime, settings, opened } = fixture(db, async (interaction, options) => {
      expect(options?.agentName).toBe('QuestBranch')
      expect(options?.getDeviceId?.()).toBe(db.installationId())
      interaction.notify({ type: 'auth_url', url: 'https://login.example.invalid/authorize' })
      expect(
        await interaction.prompt({
          type: 'select',
          message: '选择地区',
          options: [{ id: 'global', label: 'Global' }],
        }),
      ).toBe('global')
      interaction.notify({
        type: 'device_code',
        userCode: 'ABCD-1234',
        verificationUri: 'https://login.example.invalid/device',
      })
      expect(await interaction.prompt({ type: 'manual_code', message: '输入授权码' })).toBe(
        'fixture-code',
      )
      return {
        type: 'oauth',
        access: 'fixture-access-secret',
        refresh: 'fixture-refresh-secret',
        expires: Date.now() + 3600000,
      }
    })
    const service = new ResearchService(db, runtime)
    const started = await service.auth.start(settings, 'oauth')
    let state = await service.auth.status(started.id)
    await vi.waitFor(async () => {
      state = await service.auth.status(started.id)
      expect(state.prompt?.type).toBe('select')
    })
    expect(state.url).toBe('https://login.example.invalid/authorize')
    await expect(service.auth.respond(started.id, 'stale-prompt', 'global')).rejects.toThrow(
      '已结束',
    )
    await service.auth.respond(started.id, state.prompt!.id, 'global')
    await vi.waitFor(async () => {
      state = await service.auth.status(started.id)
      expect(state.prompt?.type).toBe('manual_code')
    })
    expect(state.userCode).toBe('ABCD-1234')
    await service.auth.respond(started.id, state.prompt!.id, 'fixture-code')
    await vi.waitFor(async () => {
      state = await service.auth.status(started.id)
      expect(state.status).toBe('connected')
    })
    expect(opened).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(state)).not.toContain('secret')
    expect(JSON.stringify(db.snapshot())).not.toContain('fixture-access-secret')
    expect(JSON.stringify(db.exportWorkspace('welcome-research'))).not.toContain(
      'fixture-refresh-secret',
    )
    const file = new DatabaseSync(join(db.directory, 'research.sqlite'))
    expect(JSON.stringify(file.prepare('SELECT * FROM settings').all())).not.toContain(
      'fixture-access-secret',
    )
    file.close()
    const reopened = new ResearchStore(db.directory, { recoverRuns: false })
    stores.push(reopened)
    const restored = fixture(reopened)
    expect((await restored.runtime.connect(settings)).status).toBe('configured')
    await restored.runtime.auth.logout(settings)
    expect((await restored.runtime.connect(settings)).status).toBe('login-required')
    service.shutdown()
  })
  it('取消和单步取消会结束输入，迟到的登录结果不能保存令牌', async () => {
    const db = store()
    let finish!: (value: {
      type: 'oauth'
      access: string
      refresh: string
      expires: number
    }) => void
    const { runtime, settings } = fixture(
      db,
      async () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const started = await runtime.auth.start(settings, 'oauth')
    await runtime.auth.cancel(started.id)
    finish({
      type: 'oauth',
      access: 'late-access-secret',
      refresh: 'late-refresh-secret',
      expires: Date.now() + 3600000,
    })
    await vi.waitFor(async () =>
      expect((await runtime.auth.status(started.id)).status).toBe('cancelled'),
    )
    expect(db.readModelCredential(modelConnectionKey(settings))).toBeUndefined()
    expect((await runtime.connect(settings)).status).toBe('login-required')

    const another = fixture(db, async (interaction) => {
      const controller = new AbortController()
      const input = interaction.prompt({
        type: 'manual_code',
        message: '可选手工码',
        signal: controller.signal,
      })
      controller.abort()
      await expect(input).rejects.toBeDefined()
      return {
        type: 'oauth',
        access: 'callback-access',
        refresh: 'callback-refresh',
        expires: Date.now() + 3600000,
      }
    })
    const callback = await another.runtime.auth.start(settings, 'oauth')
    await vi.waitFor(async () =>
      expect((await another.runtime.auth.status(callback.id)).status).toBe('connected'),
    )
    expect((await another.runtime.auth.status(callback.id)).prompt).toBeUndefined()
  })
  it('授权页面没有回调时受既有超时约束，超时后可以重新发起登录', async () => {
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
    const deadline = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((milliseconds) =>
        milliseconds === 600000 ? deadline.signal : nativeTimeout(milliseconds),
      )
    const db = store()
    const { runtime, settings } = fixture(db, async (interaction) => {
      interaction.notify({ type: 'auth_url', url: 'https://login.example.invalid/authorize' })
      return new Promise(() => {})
    })
    const started = await runtime.auth.start(settings, 'oauth')
    expect(runtime.auth.pending).toBe(true)
    deadline.abort(new DOMException('Fixture deadline', 'TimeoutError'))
    await vi.waitFor(async () => {
      expect(await runtime.auth.status(started.id)).toMatchObject({
        status: 'failed',
        message: '连接超时，请重试',
      })
    })
    expect(runtime.auth.pending).toBe(false)
    expect(db.readModelCredential(modelConnectionKey(settings))).toBeUndefined()
    timeout.mockRestore()
    const restarted = await runtime.auth.start(settings, 'oauth')
    expect(restarted.id).not.toBe(started.id)
    await runtime.auth.cancel(restarted.id)
    expect((await runtime.auth.status(restarted.id)).status).toBe('cancelled')
  })
  it('无法启动外部浏览器时保留继续授权的链接，并允许取消', async () => {
    const db = store()
    const { runtime, settings, opened } = fixture(db, async (interaction) => {
      interaction.notify({ type: 'auth_url', url: 'https://login.example.invalid/authorize' })
      await interaction.prompt({ type: 'manual_code', message: '输入授权码' })
      throw new Error('Fixture must be cancelled')
    })
    opened.mockRejectedValueOnce(new Error('Fixture browser unavailable'))
    const started = await runtime.auth.start(settings, 'oauth')
    await vi.waitFor(async () => {
      expect(await runtime.auth.status(started.id)).toMatchObject({
        status: 'pending',
        url: 'https://login.example.invalid/authorize',
        message: '请打开下方授权链接继续连接',
      })
    })
    await runtime.auth.cancel(started.id)
    expect(runtime.auth.pending).toBe(false)
    expect(db.readModelCredential(modelConnectionKey(settings))).toBeUndefined()
  })
  it('过期令牌只刷新一次，失败时保留原凭据且不回退到环境中的 API Key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'unrelated-environment-secret')
    const db = store()
    const { runtime, settings, refresh } = fixture(db)
    db.saveModelCredential(modelConnectionKey(settings), {
      type: 'oauth',
      access: 'expired-access',
      refresh: 'expired-refresh',
      expires: 1,
    })
    await Promise.all([runtime.connect(settings), runtime.connect(settings)])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(db.readModelCredential(modelConnectionKey(settings))).toMatchObject({
      access: 'refreshed-access-secret',
    })
    db.saveModelCredential(modelConnectionKey(settings), {
      type: 'oauth',
      access: 'expired-access',
      refresh: 'expired-refresh',
      expires: 1,
    })
    refresh.mockRejectedValue(new Error('fixture refresh failed'))
    await expect(runtime.connect(settings)).rejects.toThrow()
    expect(db.readModelCredential(modelConnectionKey(settings))).toMatchObject({
      refresh: 'expired-refresh',
    })
  })
  it('不同连接分别保存凭据，两个存储实例的修改与退出串行，undefined 不表示删除', async () => {
    const db = store()
    const second = new ResearchStore(db.directory, { recoverRuns: false })
    stores.push(second)
    const one = new PiCredentialStore(db, 'fixture-scope', 'fixture')
    const two = new PiCredentialStore(second, 'fixture-scope', 'fixture')
    await one.modify('fixture', async () => ({
      type: 'oauth',
      access: 'fixture-access',
      refresh: 'fixture-refresh',
      expires: 1,
      revision: 0,
    }))
    await Promise.all(
      [one, two].map((credentials) =>
        credentials.modify('fixture', async (current) => {
          if (current?.type !== 'oauth') throw new Error('Expected OAuth fixture')
          await new Promise((resolve) => setTimeout(resolve, 15))
          return { ...current, revision: Number(current.revision) + 1 }
        }),
      ),
    )
    expect(await one.read('fixture')).toMatchObject({ revision: 2 })
    await one.modify('fixture', async () => undefined)
    expect(await one.read('fixture')).toMatchObject({ revision: 2 })
    await two.delete('fixture')
    expect(await one.read('fixture')).toBeUndefined()
    const other = new PiCredentialStore(db, 'other-scope', 'fixture')
    expect(await other.read('fixture')).toBeUndefined()
    expect(
      readFileSync(join(db.directory, 'research.sqlite')).includes(Buffer.from('fixture-access')),
    ).toBe(false)
  })
  it('旧 Codex 设置转换为账号连接，历史会话和原文保持可导出', () => {
    const db = store()
    expect(db.settings().sessionStrategy).toBe('portable')
    const original = db.snapshot()
    const connection = new DatabaseSync(join(db.directory, 'research.sqlite'))
    connection.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(
      'preferences',
      JSON.stringify({
        ...defaultSettings,
        provider: 'codex',
        modelProvider: undefined,
        baseUrl: 'https://unused.invalid/v1',
        codexPath: 'D:\\old\\codex.exe',
        model: 'legacy-model',
      }),
    )
    connection.close()
    expect(db.settings()).toMatchObject({
      provider: 'account',
      modelProvider: 'openai',
      model: 'legacy-model',
      baseUrl: '',
    })
    expect(db.settings()).not.toHaveProperty('codexPath')
    expect(db.snapshot().nodes).toEqual(original.nodes)
    expect(db.snapshot().reports).toEqual(original.reports)
  })
  it.each([undefined, 'auto'] as const)(
    '账号连接的旧默认策略 %s 可直接对话，重开后沿用 OM 和原会话',
    async (sessionStrategy) => {
      const db = store()
      const { runtime, settings, faux, provider } = fixture(db)
      // Replay preferences written before account-specific session defaults existed.
      const connection = new DatabaseSync(join(db.directory, 'research.sqlite'))
      connection
        .prepare('INSERT OR REPLACE INTO settings VALUES (?,?)')
        .run('preferences', JSON.stringify({ ...settings, sessionStrategy }))
      connection.close()
      db.saveModelCredential(modelConnectionKey(settings), {
        type: 'oauth',
        access: 'fixture-access',
        refresh: 'fixture-refresh',
        expires: Date.now() + 3600000,
      })
      faux.setResponses([fauxAssistantMessage('账号已承接研究。')])
      const service = new ResearchService(db, runtime)
      try {
        const started = await service.command({
          type: 'send-message',
          nodeId: 'visual',
          message: '继续讨论',
        })
        await vi.waitFor(() => expect(db.run(started.id!).status).not.toBe('running'), {
          timeout: 15000,
        })
        const first = db.run(started.id!)
        expect(first.status, first.error).toBe('completed')
        expect(db.settings().sessionStrategy).toBe('portable')
        expect(first.session!.requests[0].strategy).toBe('portable')
        expect(faux.state.callCount).toBe(1)
        db.saveSettings({ ...db.settings(), sessionStrategy: 'auto' })

        const reopened = new ResearchStore(db.directory, { seed: false })
        stores.push(reopened)
        const next = new PiModels(reopened, { providers: [provider] })
        runtimes.push(next)
        expect(reopened.settings().sessionStrategy).toBe('portable')
        faux.setResponses([fauxAssistantMessage('重开后继续。')])
        const resumed = new ResearchService(reopened, next)
        try {
          const second = await resumed.command({
            type: 'send-message',
            nodeId: 'visual',
            message: '接着说',
          })
          await vi.waitFor(() => expect(reopened.run(second.id!).status).not.toBe('running'), {
            timeout: 15000,
          })
          const run = reopened.run(second.id!)
          expect(run.status, run.error).toBe('completed')
          expect(run.session!.sessionId).toBe(first.session!.sessionId)
          const state = await reopened.sessions.load(first.session!.sessionId)
          expect(state!.messages.filter((message) => message.role === 'assistant')).toHaveLength(2)
          expect(state!.messages.map((message) => message.text)).toContain('账号已承接研究。')
        } finally {
          resumed.shutdown()
        }
      } finally {
        service.shutdown()
      }
    },
  )
  it('账号的显式 native 选择不会被默认策略覆盖，也不会改发 API 请求', async () => {
    const db = store()
    const { runtime, settings, faux } = fixture(db)
    db.saveSettings({ ...settings, sessionStrategy: 'native' })
    db.saveModelCredential(modelConnectionKey(settings), {
      type: 'oauth',
      access: 'fixture-access',
      refresh: 'fixture-refresh',
      expires: Date.now() + 3600000,
    })
    const network = vi.spyOn(globalThis, 'fetch')
    const service = new ResearchService(db, runtime)
    try {
      const started = await service.command({
        type: 'send-message',
        nodeId: 'visual',
        message: '仅允许原生',
      })
      await vi.waitFor(() => expect(db.run(started.id!).status).not.toBe('running'), {
        timeout: 15000,
      })
      expect(db.settings().sessionStrategy).toBe('native')
      expect(db.run(started.id!).error).toContain('CAPABILITY_UNKNOWN')
      expect(faux.state.callCount).toBe(0)
      expect(network).not.toHaveBeenCalled()
    } finally {
      service.shutdown()
    }
  })
})

describe('Pi 报告工具与模型能力', () => {
  const report = {
    title: 'Pi 研究报告',
    summary: '保留研究结构与原文。',
    findings: ['调用通过 Pi，研究由 QB 保存。'],
    openQuestions: ['如何继续？'],
    report: '## 当前认识\n\n这是隔离测试中的完整报告，研究节点与报告归属继续由 QB 保存。',
    followups: [],
  }
  it('输出超限时保留可恢复的原文前缀，不生成报告或破坏导出恢复', async () => {
    const db = store()
    const { runtime, settings, faux } = fixture(db)
    db.saveSettings(settings)
    db.saveModelCredential(modelConnectionKey(settings), {
      type: 'oauth',
      access: 'fixture-access',
      refresh: 'fixture-refresh',
      expires: Date.now() + 3600000,
    })
    faux.setResponses([fauxAssistantMessage('字'.repeat(181000))])
    const service = new ResearchService(db, runtime)
    const run = await service.command({
      type: 'send-message',
      nodeId: 'visual',
      message: '测试长输出',
    })
    await vi.waitFor(() => expect(db.run(run.id!).status).toBe('failed'), { timeout: 5000 })
    expect(db.run(run.id!).output).toHaveLength(180000)
    expect(db.run(run.id!).error).toContain('原文上限')
    const restored = store(false)
    restored.importWorkspace(db.exportWorkspace('welcome-research'))
    expect(restored.run(run.id!).output).toBe(db.run(run.id!).output)
    service.shutdown()
  })
  it('刷新后的新访问令牌同样从模型错误中隐藏', async () => {
    const db = store()
    const { runtime, settings, faux } = fixture(db)
    db.saveModelCredential(modelConnectionKey(settings), {
      type: 'oauth',
      access: 'old-access',
      refresh: 'old-refresh',
      expires: 1,
    })
    faux.setResponses([
      fauxAssistantMessage('已有原文', {
        stopReason: 'error',
        errorMessage: 'upstream echoed refreshed-access-secret',
      }),
    ])
    await expect(
      runtime.generate(
        settings,
        '',
        [{ role: 'user', content: '讨论' }],
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('[凭据已隐藏]')
  })
  it('完整工具结果经统一校验保存，工具参数原文在报告之前留存', async () => {
    const db = store()
    const { runtime, settings, faux } = fixture(db)
    db.saveModelCredential(modelConnectionKey(settings), {
      type: 'oauth',
      access: 'fixture-access',
      refresh: 'fixture-refresh',
      expires: Date.now() + 3600000,
    })
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('submit_research_report', report), {
        stopReason: 'toolUse',
        responseId: 'fixture-response',
      }),
    ])
    db.saveSettings(settings)
    const service = new ResearchService(db, runtime)
    const started = await service.command({
      type: 'start-research',
      nodeId: 'visual',
      instruction: '整理报告',
    })
    await vi.waitFor(() => expect(db.run(started.id!).status).toBe('completed'))
    const run = db.run(started.id!)
    expect(JSON.parse(run.output)).toEqual(report)
    expect(run.pi).toMatchObject({ provider: 'fixture-account', responseId: 'fixture-response' })
    expect(db.snapshot().reports.find((entry) => entry.runId === run.id)?.nodeId).toBe('visual')
    service.shutdown()
  })
  it('无效工具参数保留原文，禁止其他工具请求，也不静默忽略不支持的思考档位', async () => {
    const db = store()
    const { runtime, settings, faux } = fixture(db)
    db.saveModelCredential(modelConnectionKey(settings), {
      type: 'oauth',
      access: 'fixture-access',
      refresh: 'fixture-refresh',
      expires: Date.now() + 3600000,
    })
    for (const response of [
      fauxAssistantMessage(
        fauxToolCall('submit_research_report', { ...report, followups: 'invalid' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(fauxToolCall('execute_shell', { command: 'never-executed' }), {
        stopReason: 'toolUse',
      }),
    ]) {
      faux.setResponses([response])
      const chunks: string[] = []
      await expect(
        runtime.generate(
          settings,
          '',
          [{ role: 'user', content: '报告' }],
          new AbortController().signal,
          (raw) => chunks.push(raw),
          ResearchOutputSchema,
        ),
      ).rejects.toThrow()
      expect(chunks.at(-1)).toContain(
        response.content[0].type === 'toolCall'
          ? Object.keys(response.content[0].arguments)[0]
          : 'unreachable',
      )
    }
    await expect(
      runtime.generate(
        { ...settings, reasoningEffort: 'ultra' },
        '',
        [{ role: 'user', content: '讨论' }],
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('不支持')
  })
  it('工具报告的原始字段同样经过 QB 严格校验，不采用 SDK 的类型强制转换', async () => {
    const db = store()
    const { runtime, settings, faux } = fixture(db)
    db.saveSettings(settings)
    db.saveModelCredential(modelConnectionKey(settings), {
      type: 'oauth',
      access: 'fixture-access',
      refresh: 'fixture-refresh',
      expires: Date.now() + 3600000,
    })
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('submit_research_report', { ...report, title: 123 }), {
        stopReason: 'toolUse',
      }),
    ])
    const service = new ResearchService(db, runtime)
    const run = await service.command({
      type: 'start-research',
      nodeId: 'visual',
      instruction: '整理报告',
    })
    await vi.waitFor(() => expect(db.run(run.id!).status).toBe('failed'))
    expect(JSON.parse(db.run(run.id!).output).title).toBe(123)
    expect(db.snapshot().reports).toHaveLength(3)
    service.shutdown()
  })
})
