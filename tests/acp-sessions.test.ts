import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { ResearchStore } from '../src/desktop/store'
import { AcpSessions, agentPrompt } from '../src/desktop/acp-sessions'
import { buildContext } from '../src/research/context'
import type { AgentConfig } from '../src/research/agent'

const stores: ResearchStore[] = [],
  folders: string[] = []
function setup(seed = true) {
  const directory = mkdtempSync(join(tmpdir(), 'qb-acp-session-'))
  folders.push(directory)
  const store = new ResearchStore(directory, { seed })
  stores.push(store)
  return { store, directory }
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const folder of folders.splice(0)) {
    const absolute = resolve(folder)
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !absolute.includes('qb-acp-session-'))
      throw new Error('Unsafe fixture path')
    rmSync(absolute, { recursive: true, force: true })
  }
})
it('原生会话按节点、程序、目录与配置隔离，配置键顺序不改变身份，关闭重开可恢复', () => {
  const { store, directory } = setup()
  const config: AgentConfig = {
    kind: 'custom',
    command: 'fixture',
    cwd: directory,
    options: { model: 'a', effort: 'low' },
  }
  const saved = { sessionId: 'native-session', materialDigest: 'a'.repeat(64), bootstrapped: true }
  new AcpSessions(store).scope('visual', config).save(saved)
  expect(
    new AcpSessions(store)
      .scope('visual', { ...config, options: { effort: 'low', model: 'a' } })
      .load(),
  ).toEqual(saved)
  expect(new AcpSessions(store).scope('context', config).load()).toBeUndefined()
  expect(
    new AcpSessions(store).scope('visual', { ...config, options: { model: 'b' } }).load(),
  ).toBeUndefined()
  expect(
    new AcpSessions(store).scope('visual', { ...config, command: 'another' }).load(),
  ).toBeUndefined()
  expect(
    new AcpSessions(store).scope('visual', { ...config, cwd: join(directory, 'other') }).load(),
  ).toBeUndefined()
  store.close()
  stores.splice(stores.indexOf(store), 1)
  const reopened = new ResearchStore(directory)
  stores.push(reopened)
  expect(new AcpSessions(reopened).scope('visual', config).load()).toEqual(saved)
  const copy = setup(false).store
  const id = copy.importWorkspace(reopened.exportWorkspace('welcome-research'))
  expect(id).toBe('welcome-research')
  expect(new AcpSessions(copy).scope('visual', config).load()).toBeUndefined()
  const reports = reopened.snapshot().reports
  new AcpSessions(reopened).scope('visual', config).retire()
  expect(new AcpSessions(reopened).scope('visual', config).load()).toBeUndefined()
  expect(reopened.snapshot().reports).toEqual(reports)
})
it('恢复只追加本轮输入或材料更新，原生命令保持纯正文', () => {
  const { store } = setup()
  store.saveSettings({ ...store.settings(), backend: 'acp', agent: { kind: 'codex' } })
  const context = buildContext(store.snapshot(), 'visual', 'CURRENT', [], 'chat')
  context.messages.splice(
    2,
    0,
    { role: 'user', content: 'LEGACY_QUESTION' },
    { role: 'assistant', content: 'LEGACY_ANSWER' },
  )
  const first = agentPrompt(context)
  expect(first.text).toContain('LEGACY_QUESTION')
  const previous = { sessionId: 'native', materialDigest: first.materialDigest, bootstrapped: true }
  expect(agentPrompt(context, previous).text).toBe('[user]\nCURRENT')
  context.messages[1].content += '\nNEW_MATERIAL'
  const updated = agentPrompt(context, previous)
  expect(updated.text).toContain('NEW_MATERIAL')
  expect(updated.text).not.toContain('LEGACY_QUESTION')
  expect(updated.historyIncluded).toBe(false)
  expect(
    agentPrompt(buildContext(store.snapshot(), 'visual', '/compact', [], 'chat'), previous).text,
  ).toBe('/compact')
})

it('节点在其他连接新增对话后，不恢复缺失这段讨论的旧线程', () => {
  const { store } = setup()
  const context = buildContext(store.snapshot(), 'visual', '原始讨论', [], 'chat')
  const base = {
    workspaceId: 'welcome-research',
    nodeId: 'visual',
    mode: 'chat' as const,
    instruction: '讨论',
    status: 'completed' as const,
    phase: '完成',
    output: '完整答复',
    error: '',
    model: 'fixture',
    context,
    createdAt: new Date().toISOString(),
  }
  store.saveRun({ ...base, id: 'native-covered' })
  const config: AgentConfig = { kind: 'codex' }
  new AcpSessions(store).scope('visual', config).save({
    sessionId: 'native-id',
    materialDigest: 'a'.repeat(64),
    bootstrapped: true,
    lastRunId: 'native-covered',
  })
  expect(new AcpSessions(store).scope('visual', config, 'current').load()?.sessionId).toBe(
    'native-id',
  )
  store.saveRun({ ...base, id: 'another-connection' })
  expect(() => new AcpSessions(store).scope('visual', config, 'current').load()).toThrow('新增对话')
  expect(new AcpSessions(store).scope('visual', config).load()?.sessionId).toBe('native-id')
  new AcpSessions(store).scope('visual', config).retire()
  expect(store.snapshot().messages).toHaveLength(4)
})
