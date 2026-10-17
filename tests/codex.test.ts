import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { CodexAdapter } from '../src/desktop/codex'
import { ResearchStore } from '../src/desktop/store'
import { buildContext } from '../src/research/context'
import { defaultSettings } from '../src/research/types'

const directories: string[] = []
const settings = {
  ...defaultSettings,
  provider: 'codex' as const,
  model: '',
  codexPath: process.execPath,
}
function fixture(scenario = 'normal') {
  const directory = mkdtempSync(join(tmpdir(), 'qb-codex-test-'))
  directories.push(directory)
  const store = new ResearchStore(directory)
  const context = buildContext(store.snapshot(), 'visual', '讨论研究画布', [], 'chat')
  store.close()
  const adapter = new CodexAdapter(directory, (_file, _args, cwd) =>
    spawn(process.execPath, [resolve('tests/fixtures/codex-server.cjs'), scenario], {
      cwd,
      stdio: 'pipe',
      windowsHide: true,
    }),
  )
  return { adapter, context }
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory)
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !basename(target).startsWith('qb-codex-test-')
    )
      throw new Error('Unexpected test cleanup path')
    rmSync(target, { recursive: true, force: true })
  }
})
describe('Codex 本地研究连接', () => {
  it('只接受 ChatGPT 登录，展示原始额度窗口', async () => {
    const { adapter } = fixture()
    const result = await adapter.test(settings)
    expect(result.account?.type).toBe('chatgpt')
    expect(result.models).toEqual(['fixture-codex'])
    expect(result.usage?.[0].usedPercent).toBe(27)
    await expect(fixture('api-key').adapter.test(settings)).rejects.toThrow('ChatGPT')
  })
  it('处理分块中文和通知顺序，最终回复不混入进度消息', async () => {
    const { adapter, context } = fixture()
    const chunks: string[] = []
    const sessions: string[] = []
    const result = await adapter.generate(
      settings,
      context,
      new AbortController().signal,
      (text) => chunks.push(text),
      (session) => sessions.push(session.threadId),
    )
    expect(result).toBe('这是一段分块到达的节点对话。')
    expect(chunks.join('')).not.toContain('Visible progress')
    expect(sessions).toEqual(['fixture-thread', 'fixture-thread'])
  })
  it('取消对话和进程退出均能结束等待', async () => {
    const { adapter, context } = fixture('slow')
    const controller = new AbortController()
    await expect(
      adapter.generate(
        settings,
        context,
        controller.signal,
        () => {},
        (session) => {
          if (session.turnId) controller.abort()
        },
      ),
    ).rejects.toThrow()
    const exited = fixture('exit')
    await expect(
      exited.adapter.generate(
        settings,
        exited.context,
        new AbortController().signal,
        () => {},
        () => {},
      ),
    ).rejects.toThrow('退出')
  })
  it('执行工具不属于研究连接，发现请求时终止对话', async () => {
    const { adapter, context } = fixture('tool')
    await expect(
      adapter.generate(
        settings,
        context,
        new AbortController().signal,
        () => {},
        () => {},
      ),
    ).rejects.toThrow('执行工具')
  })
})
