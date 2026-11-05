import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createNetwork,
  installHostFetch,
  isLoopback,
  type NetworkEntry,
} from '../src/desktop/network'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture(timeoutMs = 500) {
  const entries: NetworkEntry[] = []
  const remote = vi.fn<typeof fetch>(async () => Response.json({ ok: true }))
  const local = vi.fn<typeof fetch>(async () => Response.json({ local: true }))
  const route = vi.fn(async () => 'system-proxy' as const)
  const network = createNetwork({
    fetch: remote,
    localFetch: local,
    route,
    transport: 'chromium',
    log: (entry) => entries.push(entry),
    timeoutMs,
  })
  return { network, remote, local, route, entries }
}

describe('宿主网络策略', () => {
  it('同一入口供显式依赖与 SDK 默认 fetch 使用，并隔离并发操作的诊断归属', async () => {
    const { network, remote, entries } = fixture()
    const previous = globalThis.fetch
    const restore = installHostFetch(network)
    try {
      await Promise.all([
        network.run({ operation: 'auth-login', provider: 'openai' }, async () => {
          await Promise.resolve()
          await (await fetch('https://auth.example.invalid/token?code=secret')).json()
        }),
        network.run({ operation: 'model-stream', provider: 'anthropic' }, async () => {
          await (await network.fetch('https://api.example.invalid/messages')).json()
        }),
      ])
      expect(remote).toHaveBeenCalledTimes(2)
      expect(entries.filter((entry) => entry.event === 'finished')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'auth-login',
            provider: 'openai',
            route: 'system-proxy',
          }),
          expect.objectContaining({
            operation: 'model-stream',
            provider: 'anthropic',
            route: 'system-proxy',
          }),
        ]),
      )
    } finally {
      restore()
      network.shutdown()
    }
    expect(globalThis.fetch).toBe(previous)
  })

  it.each([
    'http://localhost:1455/auth/callback',
    'http://127.0.0.1:9123/mcp',
    'http://127.0.0.2:11434/v1/models',
    'http://[::1]:1455/callback',
    'http://[::ffff:127.0.0.1]:9123/mcp',
    'http://test.localhost:8080/',
  ])('本机请求 %s 保持直连', async (url) => {
    const { network, remote, local, route, entries } = fixture()
    expect(isLoopback(new URL(url))).toBe(true)
    await (await network.fetch(url)).json()
    expect(local).toHaveBeenCalledTimes(1)
    expect(remote).not.toHaveBeenCalled()
    expect(route).not.toHaveBeenCalled()
    expect(entries.at(-1)?.route).toBe('local-direct')
    network.shutdown()
  })

  it('代理失败不会重试直连，也不会记录错误文本里的凭据', async () => {
    const { network, remote, local, entries } = fixture()
    remote.mockRejectedValue(
      new Error('password-in-url; net::ERR_PROXY_CONNECTION_FAILED; bearer-secret'),
    )
    await expect(network.fetch('https://api.example.invalid')).rejects.toThrow(
      'ERR_PROXY_CONNECTION_FAILED',
    )
    expect(local).not.toHaveBeenCalled()
    expect(remote).toHaveBeenCalledTimes(1)
    expect(entries.at(-1)).toMatchObject({
      outcome: 'failed',
      errorCode: 'ERR_PROXY_CONNECTION_FAILED',
    })
    expect(JSON.stringify(entries)).not.toMatch(/password-in-url|bearer-secret/)
    network.shutdown()
  })

  it('403 保留状态、请求 ID 与允许的错误码，日志没有查询、头、错误详情或正文', async () => {
    const { network, remote, entries } = fixture()
    remote.mockResolvedValue(
      Response.json(
        {
          error: { code: 'unsupported_country_region_territory', message: 'token-response-secret' },
        },
        { status: 403, headers: { 'x-request-id': 'req-fixture-123' } },
      ),
    )
    const response = await network.run({ operation: 'auth-login', provider: 'openai' }, () =>
      network.fetch('https://auth.example.invalid/token?code=callback-secret', {
        method: 'POST',
        headers: { Authorization: 'Bearer access-secret' },
        body: 'refresh_token=refresh-secret',
      }),
    )
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('token-response-secret')
    expect(entries.at(-1)).toMatchObject({
      status: 403,
      requestId: 'req-fixture-123',
      outcome: 'failed',
      serverCode: 'unsupported_country_region_territory',
    })
    expect(JSON.stringify(entries)).not.toMatch(
      /callback-secret|access-secret|refresh-secret|token-response-secret|Authorization|refresh_token/,
    )
    expect(remote.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' })
    network.shutdown()
  })

  it('流式结果逐块读取，调用方取消会中止传输并结束计时', async () => {
    const { network, remote, entries } = fixture()
    const caller = new AbortController()
    let transportSignal: AbortSignal | null | undefined
    remote.mockImplementation(async (_input, init) => {
      transportSignal = init?.signal
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: first\n\n'))
            init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), {
              once: true,
            })
          },
        }),
      )
    })
    const response = await network.fetch('https://api.example.invalid/stream', {
      signal: caller.signal,
    })
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('first')
    expect(entries.at(-1)?.event).toBe('headers')
    caller.abort()
    await expect(reader.read()).rejects.toThrow()
    expect(transportSignal?.aborted).toBe(true)
    expect(entries.at(-1)).toMatchObject({ outcome: 'cancelled', errorCode: 'ABORTED' })
    network.shutdown()
  })

  it('超时包含响应体阶段，停滞的流不会无限等待', async () => {
    const { network, remote, entries } = fixture(35)
    remote.mockImplementation(
      async (_input, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), {
                once: true,
              })
            },
          }),
        ),
    )
    const response = await network.fetch('https://api.example.invalid/stream')
    await expect(response.text()).rejects.toThrow('超时')
    expect(entries.at(-1)?.outcome).toBe('timeout')
    network.shutdown()
  })

  it('PAC 解析停滞时也能取消，不会再发出请求', async () => {
    const { network, route, remote, entries } = fixture(35)
    route.mockImplementation(() => new Promise(() => {}))
    await expect(network.fetch('https://api.example.invalid')).rejects.toThrow('超时')
    expect(remote).not.toHaveBeenCalled()
    expect(entries.at(-1)?.outcome).toBe('timeout')
    network.shutdown()
  })

  it('已取消的请求不发出网络连接，退出会取消剩余请求', async () => {
    const { network, remote, entries } = fixture()
    await expect(
      network.fetch('https://api.example.invalid', { signal: AbortSignal.abort() }),
    ).rejects.toThrow()
    expect(remote).not.toHaveBeenCalled()
    expect(entries.at(-1)?.outcome).toBe('cancelled')
    remote.mockImplementation(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
    )
    const pending = network.fetch('https://api.example.invalid/slow')
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(remote).toHaveBeenCalledTimes(1))
    network.shutdown()
    await rejected
    await expect(network.fetch('https://api.example.invalid')).rejects.toThrow('已关闭')
  })

  it('SDK 在终止事件后释放响应体，不误记为用户取消', async () => {
    const { network, remote, entries } = fixture()
    const cancel = vi.fn()
    remote.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
            },
            cancel,
          }),
        ),
    )
    const response = await network.fetch('https://api.example.invalid/stream')
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(entries.at(-1)).toMatchObject({ outcome: 'released' })
    expect(entries.at(-1)?.errorCode).toBeUndefined()
    network.shutdown()
  })

  it.each(['file:///secret.txt', 'https://user:password@example.invalid/'])(
    '拒绝非 API 地址 %s',
    async (url) => {
      const { network, remote } = fixture()
      await expect(network.fetch(url)).rejects.toThrow()
      expect(remote).not.toHaveBeenCalled()
      network.shutdown()
    },
  )
})
