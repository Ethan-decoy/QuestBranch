import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fauxProvider } from '@earendil-works/pi-ai'
import { ResearchStore } from '../src/desktop/store'
import { PiModels } from '../src/desktop/pi-models'
import { createNetwork, installHostFetch, type NetworkEntry } from '../src/desktop/network'
import { modelConnectionKey } from '../src/research/api-services'
import { defaultSettings, type Settings } from '../src/research/types'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
  vi.unstubAllGlobals()
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'qb-network-provider-'))
  const store = new ResearchStore(directory, { seed: false })
  cleanup.push(() => {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const entries: NetworkEntry[] = []
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({
      access_token: 'fixture-access',
      refresh_token: 'fixture-refresh',
      expires_in: 3600,
      scope: 'chatgpt.tokens.use.direct',
    }),
  )
  const network = createNetwork({
    fetch: transport,
    route: async () => 'system-proxy',
    transport: 'chromium',
    log: (entry) => entries.push(entry),
  })
  cleanup.push(() => network.shutdown())
  const restore = installHostFetch(network)
  cleanup.push(restore)
  return { store, entries, transport, network }
}

it('Pi 原生 OpenAI 续期使用宿主默认网络，并记录为 token-refresh', async () => {
  const { store, entries, transport, network } = fixture()
  const settings: Settings = {
    ...defaultSettings,
    provider: 'account',
    modelProvider: 'openai',
    baseUrl: '',
  }
  store.saveModelCredential(modelConnectionKey(settings), {
    type: 'oauth',
    access: 'expired-fixture-access',
    refresh: 'fixture-refresh',
    expires: 0,
    clientId: 'fixture-client',
    scopes: ['chatgpt.tokens.use.direct'],
  })
  const runtime = new PiModels(store, { network })
  cleanup.push(() => runtime.shutdown())
  const { models, provider } = runtime.collection(settings)
  expect((await models.getAuth(provider.id))?.auth.apiKey).toBe('fixture-access')
  expect(transport).toHaveBeenCalledTimes(1)
  expect(entries.at(-1)).toMatchObject({
    operation: 'token-refresh',
    provider: 'openai',
    route: 'system-proxy',
    outcome: 'completed',
  })
  expect(JSON.stringify(entries)).not.toContain('fixture-refresh')
})

it('Pi 登录使用宿主默认网络，连接失败可重新登录且日志保留 403 原因', async () => {
  const { store, entries, transport, network } = fixture()
  const faux = fauxProvider({ provider: 'fixture-account', models: [{ id: 'fixture-model' }] })
  const provider = {
    ...faux.provider,
    auth: {
      oauth: {
        name: 'Fixture account',
        login: async (interaction: { signal: AbortSignal }) => {
          // Deliberately use default fetch, exactly as Pi OAuth implementations do.
          const response = await fetch('https://auth.example.invalid/token', {
            method: 'POST',
            signal: interaction.signal,
          })
          const body = await response.json()
          if (!response.ok) throw new Error(`OAuth HTTP ${response.status}: ${body.error.code}`)
          return {
            type: 'oauth' as const,
            access: body.access_token,
            refresh: body.refresh_token,
            expires: Date.now() + 3600000,
          }
        },
        refresh: async () => {
          throw new Error('unused')
        },
        toAuth: async (credential: { access: string }) => ({ apiKey: credential.access }),
      },
    },
  }
  const runtime = new PiModels(store, { providers: [provider], network })
  cleanup.push(() => runtime.shutdown())
  const settings: Settings = { ...defaultSettings, provider: 'account', modelProvider: provider.id }
  transport.mockResolvedValueOnce(
    Response.json({ error: { code: 'unsupported_country_region_territory' } }, { status: 403 }),
  )
  const first = await runtime.auth.start(settings, 'oauth')
  await vi.waitFor(async () => expect((await runtime.auth.status(first.id)).status).toBe('failed'))
  expect((await runtime.auth.status(first.id)).message).toContain(
    'unsupported_country_region_territory',
  )
  expect(entries.at(-1)).toMatchObject({
    operation: 'auth-login',
    status: 403,
    serverCode: 'unsupported_country_region_territory',
  })
  const second = await runtime.auth.start(settings, 'oauth')
  await vi.waitFor(async () =>
    expect((await runtime.auth.status(second.id)).status).toBe('connected'),
  )
  expect(transport).toHaveBeenCalledTimes(2)
})
