import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ResearchStore, type CredentialCodec } from '../src/desktop/store'
import { ResearchService } from '../src/desktop/service'
import { PiModels } from '../src/desktop/pi-models'
import { defaultSettings, ResearchOutputSchema, type Settings } from '../src/research/types'
import { connectionKey } from '../src/ui/provider-connection'
import { modelConnectionKey } from '../src/research/api-services'
import { apiEvents, apiStream } from './fixtures/api-stream'

const connections = ['openai-chat', 'openai-responses', 'anthropic-messages', 'ollama'] as const
type Connection = (typeof connections)[number]
function stream(connection: Connection, text: string, ending?: string) {
  return apiStream(connection === 'ollama' ? 'openai-chat' : connection, text, ending)
}

const stores: ResearchStore[] = [],
  directories: string[] = []
function store(seed = true, codec?: CredentialCodec) {
  vi.stubEnv('TAVILY_API_KEY', '')
  const directory = mkdtempSync(join(tmpdir(), 'qb-api-test-'))
  directories.push(directory)
  const db = new ResearchStore(directory, { seed, codec })
  stores.push(db)
  return db
}
function settings(protocol: Connection): Settings {
  return {
    ...defaultSettings,
    provider: protocol === 'ollama' ? 'ollama' : 'compatible',
    modelProvider: 'custom',
    apiProtocol: protocol === 'ollama' ? 'openai-chat' : protocol,
    baseUrl:
      protocol === 'ollama' ? 'http://127.0.0.1:8199/custom' : 'http://127.0.0.1:8199/custom/v1',
    model: 'fixture-model',
    modelContextWindow: 128000,
    sessionStrategy: 'portable',
    jsonMode: true,
  }
}
const report = {
  title: '协议验证报告',
  summary: '统一接口保留研究归属。',
  findings: ['不同协议可以延续同一研究。'],
  openQuestions: ['如何继续比较？'],
  report: '## 当前认识\n\n这是隔离的协议验证报告，确保研究结果属于发起研究的节点。',
  followups: [{ title: '后续方向', question: '这个方向还有哪些未解决的问题？' }],
}
// Exercise the actual Pi adapter with isolated stores and provider streams.
async function generate(...args: Parameters<PiModels['generate']>) {
  return (await new PiModels(store()).generate(...args)).raw
}
async function listModels(settings: Settings, apiKey: string) {
  return (await new PiModels(store()).connect(settings, apiKey)).models
}
async function connectService(settings: Settings, apiKey: string) {
  return new PiModels(store()).connect(settings, apiKey)
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const db of stores.splice(0)) db.close()
  for (const directory of directories.splice(0)) {
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('qb-api-test-'))
      throw new Error('Unexpected API test cleanup path')
    rmSync(target, { recursive: true, force: true })
  }
})

describe('API 协议契约', () => {
  it.each([
    ['openai', 'openai-responses'],
    ['anthropic', 'anthropic-messages'],
    ['deepseek', 'openai-chat'],
  ] as const)(
    '原生 %s 使用可克隆报告 Schema，而不携带 Zod 运行时函数',
    async (provider, protocol) => {
      const db = store()
      const runtime = new PiModels(db)
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => apiStream(protocol, JSON.stringify(report))),
      )
      const native = { ...settings(protocol), modelProvider: provider }
      const connection = await runtime.connect(native, 'fixture-key')
      const output = await runtime.generate(
        { ...native, model: connection.catalog.models[0].model },
        'fixture-key',
        [{ role: 'user', content: '报告' }],
        new AbortController().signal,
        () => {},
        ResearchOutputSchema,
      )
      expect(output.raw).toBe(JSON.stringify(report))
    },
  )
  it.each([1, 2, 3, 7, 11, 31])(
    'Anthropic UTF-8 与 CRLF 跨 %s 字节的数据块也能完整返回',
    async (chunkSize) => {
      for (const newline of ['\r\n', '\n', '\r']) {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () =>
            apiStream('anthropic-messages', '完整中文与 emoji 🌿', undefined, chunkSize, newline),
          ),
        )
        expect(
          await generate(
            { ...settings('anthropic-messages'), jsonMode: false },
            '',
            [{ role: 'user', content: '讨论' }],
            new AbortController().signal,
            () => {},
          ),
        ).toBe('完整中文与 emoji 🌿')
      }
    },
  )
  it.each(connections)(
    '%s 只使用所选服务，不回退环境中的密钥、地址或默认网关',
    async (protocol) => {
      vi.stubEnv('OPENAI_API_KEY', 'unrelated-environment-key')
      vi.stubEnv('ANTHROPIC_API_KEY', 'unrelated-anthropic-key')
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'unrelated-oauth-token')
      vi.stubEnv('AI_GATEWAY_API_KEY', 'unrelated-gateway-key')
      vi.stubEnv('OPENAI_BASE_URL', 'https://unused.invalid/v1')
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://unused.invalid/v1')
      const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        stream(protocol, '当前服务的回复'),
      )
      vi.stubGlobal('fetch', fetcher)
      expect(
        await generate(
          { ...settings(protocol), jsonMode: false },
          '',
          [{ role: 'user', content: '讨论' }],
          new AbortController().signal,
          () => {},
        ),
      ).toBe('当前服务的回复')
      expect(fetcher).toHaveBeenCalledTimes(1)
      const [url, init] = fetcher.mock.calls[0]
      expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:8199\/custom\/v1\//)
      const headers = new Headers(init?.headers)
      expect(headers.has('authorization')).toBe(false)
      expect(headers.has('x-api-key')).toBe(false)
      expect(init?.redirect).toBe('error')
    },
  )
  it.each(connections)('%s 请求保留上下文角色，正确处理流与报告格式', async (protocol) => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      stream(protocol, JSON.stringify(report)),
    )
    vi.stubGlobal('fetch', fetcher)
    const messages = [
      { role: 'system', content: '根目标与约束' },
      { role: 'user', content: '先前问题' },
      { role: 'assistant', content: '先前认识' },
      { role: 'user', content: '继续深入' },
    ]
    const chunks: string[] = []
    expect(
      await generate(
        {
          ...settings(protocol),
          maxOutputTokens: 4096,
          anthropicWorkspaceId: 'workspace-fixture',
        },
        'fixture-key',
        messages,
        new AbortController().signal,
        (text) => chunks.push(text),
        ResearchOutputSchema,
      ),
    ).toBe(JSON.stringify(report))
    expect(chunks.at(-1)).toBe(JSON.stringify(report))
    const [url, init] = fetcher.mock.calls[0],
      body = JSON.parse(init!.body as string),
      headers = new Headers(init!.headers)
    const root = 'http://127.0.0.1:8199/custom/v1'
    expect(init!.redirect).toBe('error')
    expect(body).toMatchObject({ model: 'fixture-model', stream: true })
    expect(body.tools).toHaveLength(1)
    expect(body).not.toHaveProperty('reasoning_effort')
    if (protocol === 'anthropic-messages') {
      expect(String(url).split('?')[0]).toBe(root + '/messages')
      expect(headers.get('x-api-key')).toBe('fixture-key')
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('anthropic-version')).toBe('2023-06-01')
      expect(headers.get('anthropic-workspace-id')).toBe('workspace-fixture')
      expect(JSON.stringify(body.system)).toContain('根目标与约束')
      expect(body.messages.map((message: { role: string }) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
      ])
      expect(JSON.stringify(body.messages)).toContain('继续深入')
      expect(body.max_tokens).toBe(4096)
      expect(body.tools[0].name).toBe('submit_research_report')
    } else {
      expect(headers.get('authorization')).toBe('Bearer fixture-key')
      expect(headers.get('anthropic-version')).toBeNull()
      if (protocol === 'openai-responses') {
        expect(url).toBe(root + '/responses')
        expect(JSON.stringify(body.input)).toContain('根目标与约束')
        expect(JSON.stringify(body.input)).toContain('先前认识')
        expect(JSON.stringify(body.input)).toContain('继续深入')
        expect(body.store).toBe(false)
        expect(body.max_output_tokens).toBe(4096)
        expect(body.tools[0].name).toBe('submit_research_report')
        expect(body).not.toHaveProperty('messages')
      } else {
        expect(url).toBe(root + '/chat/completions')
        expect(body.messages.map((message: { role: string }) => message.role)).toEqual([
          'system',
          'user',
          'assistant',
          'user',
        ])
        expect(JSON.stringify(body.messages)).toContain('根目标与约束')
        expect(body.tools[0].function.name).toBe('submit_research_report')
      }
    }
  })
  it.each(connections)('%s 不把断流、截断或流内错误当作完成', async (protocol) => {
    for (const ending of ['disconnect', 'limit', 'error']) {
      const partial: string[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => stream(protocol, '已有片段', ending)),
      )
      await expect(
        generate(
          { ...settings(protocol), jsonMode: false },
          '',
          [{ role: 'user', content: '继续' }],
          new AbortController().signal,
          (text) => partial.push(text),
        ),
      ).rejects.toThrow(
        ending === 'error' ? 'fixture overload' : ending === 'limit' ? '长度上限' : '中断',
      )
      expect(partial.at(-1)).toBe('已有片段')
    }
  })
  it('原生 Claude 模型发现沿用相同认证；缺少列表可手填，鉴权失败仍报错', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ data: [{ id: 'claude-fixture' }] }),
    )
    vi.stubGlobal('fetch', fetcher)
    expect(await listModels(settings('anthropic-messages'), 'fixture-key')).toEqual([
      'claude-fixture',
    ])
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('x-api-key')).toBe('fixture-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    )
    expect(await connectService({ ...settings('openai-chat'), model: '' }, '')).toMatchObject({
      modelDiscovery: 'unsupported',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: { message: 'bad key' } }, { status: 401 })),
    )
    await expect(connectService(settings('anthropic-messages'), 'bad-key')).rejects.toThrow(
      'HTTP 401',
    )
  })
  it('Ollama 的旧地址和已带 v1 的地址均保留路径前缀，发现与生成使用相同入口', async () => {
    for (const baseUrl of [
      'http://127.0.0.1:8199/custom',
      'http://127.0.0.1:8199/custom/v1',
      'http://127.0.0.1:8199/custom/v1/',
    ]) {
      const fetcher = vi.fn(async (url: string | URL | Request) =>
        String(url).endsWith('/models')
          ? Response.json({ data: [{ id: 'fixture-model' }] })
          : stream('ollama', '本地研究'),
      )
      vi.stubGlobal('fetch', fetcher)
      const local = {
        ...settings('ollama'),
        baseUrl,
        jsonMode: false,
        apiProtocol: 'anthropic-messages' as const,
      }
      expect(await listModels(local, '')).toEqual(['fixture-model'])
      expect(
        await generate(
          local,
          '',
          [{ role: 'user', content: '问题' }],
          new AbortController().signal,
          () => {},
        ),
      ).toBe('本地研究')
      expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
        'http://127.0.0.1:8199/custom/v1/models',
        'http://127.0.0.1:8199/custom/v1/chat/completions',
      ])
      expect(local.baseUrl).toBe(baseUrl)
    }
  })
  it('SDK 取消信号传到请求，并保留取消前收到的原文', async () => {
    const abort = new AbortController(),
      chunks: string[] = []
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  apiEvents('openai-responses', '已经收到的片段', 'disconnect')
                    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                    .join(''),
                ),
              )
              requestSignal?.addEventListener(
                'abort',
                () => controller.error(requestSignal?.reason),
                { once: true },
              )
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      }),
    )
    const generation = generate(
      { ...settings('openai-responses'), jsonMode: false },
      'fixture-key',
      [{ role: 'user', content: '讨论' }],
      abort.signal,
      (text) => chunks.push(text),
    )
    const rejected = expect(generation).rejects.toThrow()
    await vi.waitFor(() => expect(chunks.at(-1)).toBe('已经收到的片段'))
    abort.abort()
    await rejected
    expect(requestSignal?.aborted).toBe(true)
    expect(chunks.at(-1)).toBe('已经收到的片段')
  })
  it('SDK 的 HTTP 错误保留状态码，且不自动重试或更换协议', async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { error: { message: 'fixture rate limit', type: 'rate_limit_error' } },
        { status: 429 },
      ),
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(
      generate(
        { ...settings('openai-chat'), jsonMode: false },
        'fixture-key',
        [{ role: 'user', content: '讨论' }],
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('HTTP 429')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('原生 Google 使用 Pi 的独立协议，按模型能力传递思考设置', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          `data: ${JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: 'Google 本地固定响应' }], role: 'model' },
                finishReason: 'STOP',
                index: 0,
              },
            ],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
            modelVersion: 'gemini-2.5-flash',
          })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    )
    vi.stubGlobal('fetch', fetcher)
    const runtime = new PiModels(store())
    const chunks: string[] = []
    const result = await runtime.generate(
      {
        ...defaultSettings,
        provider: 'compatible',
        modelProvider: 'google',
        baseUrl: 'http://127.0.0.1:8199',
        model: 'gemini-2.5-flash',
        reasoningEffort: 'low',
      },
      'google-fixture-key',
      [{ role: 'user', content: '讨论' }],
      new AbortController().signal,
      (raw) => chunks.push(raw),
    )
    expect(result.raw).toBe('Google 本地固定响应')
    expect(chunks.at(-1)).toBe(result.raw)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('统一研究流程与凭据归属', () => {
  it.each(connections)(
    '%s 的结构化报告校验失败仍保留原文，不创建报告或后续节点',
    async (protocol) => {
      const db = store(),
        service = new ResearchService(db)
      db.saveSettings(settings(protocol))
      for (const raw of [
        '这不是 JSON',
        JSON.stringify({ ...report, followups: '错误的字段类型' }),
        JSON.stringify({ ...report, title: '长'.repeat(201) }),
      ]) {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => stream(protocol, raw)),
        )
        const research = await service.command({
          type: 'start-research',
          nodeId: 'visual',
          instruction: '整理报告',
        })
        await vi.waitFor(() => expect(db.run(research.id!).status).toBe('failed'))
        expect(db.run(research.id!).output).toBe(raw)
        expect(db.snapshot().reports).toHaveLength(3)
        expect(db.snapshot().nodes).toHaveLength(8)
      }
      service.shutdown()
    },
  )
  it.each(connections)('%s 完成对话、报告、分支和导出恢复，保留协议归属', async (protocol) => {
    const db = store(),
      service = new ResearchService(db)
    db.saveSettings({ ...settings(protocol), apiKey: 'fixture-key' })
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string),
        structured = body.tools?.some(
          (tool: { name?: string; function?: { name: string } }) =>
            (tool.name ?? tool.function?.name) === 'submit_research_report',
        )
      return stream(
        protocol,
        structured ? JSON.stringify(report) : '只在当前节点讨论，不自动生成报告。',
      )
    })
    vi.stubGlobal('fetch', fetcher)
    const conversation = await service.command({
      type: 'send-message',
      nodeId: 'visual',
      message: '先讨论',
    })
    await vi.waitFor(() => expect(db.run(conversation.id!).status).toBe('completed'))
    expect(db.snapshot().reports).toHaveLength(3)
    expect(
      db
        .snapshot()
        .messages.find(
          (message) => message.runId === conversation.id && message.role === 'assistant',
        )?.content,
    ).toContain('只在当前节点讨论')
    const research = await service.command({
      type: 'start-research',
      nodeId: 'visual',
      instruction: '整理报告',
    })
    db.saveView('welcome-research', {
      selectedId: 'context',
      collapsed: [],
      drafts: { context: '其他节点的草稿' },
    })
    await vi.waitFor(() => expect(db.run(research.id!).status).toBe('completed'))
    const completed = db.run(research.id!)
    expect(completed.pi).toMatchObject({
      provider: 'questbranch',
      api: protocol === 'ollama' || protocol === 'openai-chat' ? 'openai-completions' : protocol,
    })
    expect(db.snapshot().reports.find((value) => value.id === completed.reportId)?.nodeId).toBe(
      'visual',
    )
    expect(
      db
        .snapshot()
        .nodes.some(
          (node) => node.parentId === 'visual' && node.question === report.followups[0].question,
        ),
    ).toBe(true)
    const exported = db.exportWorkspace('welcome-research'),
      restored = store(false)
    restored.importWorkspace(exported)
    const recovered = restored.exportWorkspace('welcome-research')
    expect(recovered.modelSessions).toEqual({
      version: 1,
      sessions: [],
      archives: [exported.modelSessions],
    })
    expect({ ...recovered, modelSessions: exported.modelSessions }).toEqual(exported)
    expect(JSON.stringify(exported)).not.toContain('fixture-key')
    service.shutdown()
  })
  it('有效 JSON 被截断时仍保留原文并标为失败，不产生报告', async () => {
    const db = store(),
      service = new ResearchService(db)
    db.saveSettings(settings('anthropic-messages'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream('anthropic-messages', JSON.stringify(report), 'limit')),
    )
    const research = await service.command({
      type: 'start-research',
      nodeId: 'visual',
      instruction: '继续',
    })
    await vi.waitFor(() => expect(db.run(research.id!).status).toBe('failed'))
    expect(db.run(research.id!).output).toBe(JSON.stringify(report))
    expect(db.run(research.id!).error).toContain('长度上限')
    expect(db.snapshot().reports).toHaveLength(3)
    service.shutdown()
  })
  it('即使 JSON 完整，工具请求尚未返回完整参数也不能保存成功报告', async () => {
    const db = store()
    const service = new ResearchService(db)
    db.saveSettings(settings('openai-chat'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream('openai-chat', JSON.stringify(report), 'tool')),
    )
    const run = await service.command({
      type: 'start-research',
      nodeId: 'visual',
      instruction: '继续',
    })
    await vi.waitFor(() => expect(db.run(run.id!).status).toBe('failed'))
    expect(db.run(run.id!).error).toContain('未完成的工具')
    expect(db.run(run.id!).output).toBe(JSON.stringify(report))
    expect(db.snapshot().reports).toHaveLength(3)
    service.shutdown()
  })
  it('相同 URL 更换协议不复用密钥和连接状态，连接预览也不保存配置', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const db = store(),
      service = new ResearchService(db)
    const chat = settings('openai-chat'),
      native = settings('anthropic-messages')
    db.saveSettings({ ...chat, apiKey: 'original-key' })
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ data: [] }))
    vi.stubGlobal('fetch', fetcher)
    await service.testConnection(native)
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('x-api-key')).toBe(false)
    expect(db.settings().apiProtocol).toBe('openai-chat')
    expect(connectionKey(chat)).not.toBe(connectionKey(native))
    db.saveSettings(native)
    expect(db.credentials().apiKey).toBe('')
    db.saveSettings(chat)
    expect(db.credentials().apiKey).toBe('original-key')
    service.shutdown()
  })
  it('旧版未记录协议的密钥仍可用，首次更换协议后固定旧归属', () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const codec: CredentialCodec = {
      encrypt: (value) => Buffer.from(value).toString('base64'),
      decrypt: (value) => Buffer.from(value, 'base64').toString(),
    }
    const db = store(true, codec),
      chat = settings('openai-chat')
    const legacy = new DatabaseSync(join(db.directory, 'research.sqlite'))
    legacy
      .prepare('INSERT OR REPLACE INTO settings VALUES (?,?)')
      .run('apiKey', codec.encrypt('legacy-key'))
    legacy.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run('apiKeyOrigin', chat.baseUrl)
    const preferences = { ...chat, modelProvider: undefined, apiProtocol: undefined }
    legacy
      .prepare("INSERT OR REPLACE INTO settings VALUES ('preferences',?)")
      .run(JSON.stringify(preferences))
    legacy.close()
    expect(db.credentials().apiKey).toBe('legacy-key')
    db.saveSettings(settings('anthropic-messages'))
    expect(db.credentials().apiKey).toBe('')
    db.saveSettings(chat)
    expect(db.credentials().apiKey).toBe('legacy-key')
    expect(db.readModelCredential(modelConnectionKey(chat))).toMatchObject({
      type: 'api_key',
      key: 'legacy-key',
    })
  })
  it('保存模型设置或更换密钥不会丢失 Pi 配置的云平台参数', () => {
    const db = store()
    const configured = {
      ...defaultSettings,
      provider: 'compatible' as const,
      modelProvider: 'google-vertex',
      baseUrl: '',
      model: 'gemini-2.5-flash',
    }
    const scope = modelConnectionKey(configured)
    db.saveModelCredential(scope, {
      type: 'api_key',
      key: 'fixture-key',
      env: { GOOGLE_CLOUD_PROJECT: 'fixture-project', GOOGLE_CLOUD_LOCATION: 'us-central1' },
    })
    db.saveSettings(configured)
    expect(db.readModelCredential(scope)).toMatchObject({
      key: 'fixture-key',
      env: { GOOGLE_CLOUD_PROJECT: 'fixture-project' },
    })
    db.saveSettings({ ...configured, apiKey: 'replacement-key' })
    expect(db.readModelCredential(scope)).toMatchObject({
      key: 'replacement-key',
      env: { GOOGLE_CLOUD_PROJECT: 'fixture-project' },
    })
    db.saveSettings({ ...configured, apiProtocol: 'anthropic-messages', model: 'another-model' })
    expect(db.credentials().apiKey).toBe('replacement-key')
  })
})
