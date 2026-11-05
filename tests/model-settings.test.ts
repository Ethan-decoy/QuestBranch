import { describe, expect, it, vi } from 'vitest'
import { resolveModelSelection } from '../src/research/model-catalog'
import {
  defaultSettings,
  type ModelCatalog,
  type ConnectionResult,
  type SettingsInput,
} from '../src/research/types'
import { createConnectionStore } from '../src/ui/provider-connection'
import { restoreAgentSelection } from '../src/ui/models/agent-selection'
import type { AgentConnection } from '../src/research/agent'

const settings: SettingsInput = {
  ...defaultSettings,
  provider: 'account',
  modelProvider: 'openai',
  model: '',
}
const catalog: ModelCatalog = {
  defaults: { model: 'model-a', reasoningEffort: 'low' },
  models: [
    {
      model: 'model-a',
      displayName: 'Model A',
      isDefault: true,
      defaultReasoningEffort: 'low',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      supportedReasoningEfforts: (['low', 'max'] as const).map((reasoningEffort) => ({
        reasoningEffort,
        description: 'Fixture capability',
      })),
    },
    {
      model: 'model-b',
      displayName: 'Model B',
      isDefault: false,
      defaultReasoningEffort: 'medium',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Fixture capability' }],
    },
  ],
}
function result(models: string[] = ['model-a']): ConnectionResult {
  return { models, catalog, modelDiscovery: 'catalog', status: 'configured', provider: 'openai' }
}
function deferred() {
  let resolve!: (value: ConnectionResult) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ConnectionResult>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
describe('统一模型设置', () => {
  it('默认设置继承有效配置，显式选择保留自己的强度', () => {
    expect(resolveModelSelection(settings, catalog)).toEqual(catalog.defaults)
    expect(resolveModelSelection({ model: 'model-a', reasoningEffort: 'low' }, catalog)).toEqual({
      model: 'model-a',
      reasoningEffort: 'low',
    })
  })
  it('不会静默替换已下架模型或不支持的思考强度', () => {
    expect(() => resolveModelSelection({ model: 'missing' }, catalog)).toThrow('重新选择模型')
    expect(() =>
      resolveModelSelection({ model: 'model-b', reasoningEffort: 'max' }, catalog),
    ).toThrow('不支持')
    expect(() => resolveModelSelection({ model: '', reasoningEffort: 'ultra' }, catalog)).toThrow(
      '不支持',
    )
  })
})
describe('连接状态连续性', () => {
  it('保留已有结果进行刷新，合并重复连接请求', async () => {
    const first = deferred(),
      second = deferred()
    const connect = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const store = createConnectionStore(connect)
    const one = store.getState().connect(settings)
    const two = store.getState().connect(settings)
    expect(one).toBe(two)
    first.resolve(result())
    await one
    expect(store.getState().status).toBe('connected')
    const refreshing = store.getState().connect(settings)
    expect(store.getState().status).toBe('connecting')
    expect(store.getState().result?.catalog).toEqual(catalog)
    second.resolve(result(['model-b']))
    await refreshing
    expect(connect).toHaveBeenCalledTimes(2)
    expect(store.getState().result?.models).toEqual(['model-b'])
  })
  it('地址或凭据变更后，旧请求的成功或失败不会覆盖新连接', async () => {
    const first = deferred(),
      second = deferred()
    const store = createConnectionStore(
      vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    )
    const old = store.getState().connect(settings)
    await Promise.resolve()
    store.getState().invalidate()
    const current = store.getState().connect({ ...settings, modelProvider: 'anthropic' })
    second.resolve(result(['new']))
    await current
    first.reject(new Error('old failure'))
    await old
    expect(store.getState().status).toBe('connected')
    expect(store.getState().result?.models).toEqual(['new'])
  })
})

describe('ACP 配置选择恢复', () => {
  const connection: AgentConnection = {
    id: 'fixture',
    name: 'Fixture',
    status: 'connected',
    authMethods: [],
    commands: [],
    requests: [],
    options: [
      {
        id: 'effort',
        name: '强度',
        category: 'thought_level',
        value: 'low',
        choices: [{ value: 'low', name: '低' }],
      },
      {
        id: 'model',
        name: '模型',
        category: 'model',
        value: 'a',
        choices: [
          { value: 'a', name: 'A' },
          { value: 'b', name: 'B' },
        ],
      },
    ],
  }
  it('重开后先恢复模型，再按该模型的真实档位恢复强度，与保存对象的字段顺序无关', async () => {
    let current = structuredClone(connection)
    const configure = vi.fn(async (_id: string, option: string, value: string) => {
      if (option === 'model')
        current.options = [
          {
            ...current.options[0],
            value: 'high',
            choices: [
              { value: 'high', name: '高' },
              { value: 'xhigh', name: '很高' },
            ],
          },
          { ...current.options[1], value },
        ]
      else current.options[0].value = value
      return structuredClone(current)
    })
    const restored = await restoreAgentSelection({ configure }, connection, {
      effort: 'xhigh',
      model: 'b',
    })
    expect(configure.mock.calls.map((call) => call.slice(1))).toEqual([
      ['model', 'b'],
      ['effort', 'xhigh'],
    ])
    expect(restored.options.map((option) => option.value)).toEqual(['xhigh', 'b'])
  })
  it('没有后端实际支持的档位时明确失败，不伪造选项或静默替换', async () => {
    const configure = vi.fn()
    await expect(
      restoreAgentSelection({ configure }, connection, { effort: 'unknown' }),
    ).rejects.toThrow('不支持')
    expect(configure).not.toHaveBeenCalled()
  })
})
