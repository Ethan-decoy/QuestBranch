import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { ResearchClient } from '../src/research/types'

const networkFetch = globalThis.fetch.bind(globalThis)
let directory: string
let base: string
let child: ChildProcess | undefined
let closed: Promise<void>
let log = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'qb-preview-test-'))
  const allocator = createServer()
  await new Promise<void>((done) => allocator.listen(0, '127.0.0.1', done))
  const address = allocator.address()
  if (!address || typeof address === 'string') throw new Error('No preview fixture port')
  const port = address.port
  await new Promise<void>((done) => allocator.close(() => done()))
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['--import', 'tsx', 'src/preview/server.ts', '--production'], {
    cwd: resolve('.'),
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      QUESTBRANCH_DATA_DIR: directory,
      TAVILY_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  closed = new Promise((done) => child!.once('close', () => done()))
  const record = (data: Buffer | Error) => {
    log = (log + String(data)).slice(-8000)
  }
  child.stdout!.on('data', record)
  child.stderr!.on('data', record)
  child.on('error', record)
  await vi.waitFor(
    async () => {
      expect(child!.exitCode, log).toBeNull()
      expect((await networkFetch(base + '/api/state')).ok).toBe(true)
    },
    { timeout: 20000, interval: 100 },
  )
}, 30000)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})
afterAll(async () => {
  if (child) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await closed
  }
  if (!directory) return
  const path = relative(tmpdir(), directory)
  if (
    !path ||
    path.startsWith('..') ||
    isAbsolute(path) ||
    !basename(directory).startsWith('qb-preview-test-')
  )
    throw new Error('Unexpected preview fixture cleanup path')
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}, 20000)

it('preview validates the failure run ID through the ACP reset HTTP route', async () => {
  const response = await networkFetch(base + '/api/agents/reset-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ runId: 'missing-run' }),
  })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: '研究记录不存在' })
})

it('browser ACP failure can be rebuilt and sent again while preserving its research history', async () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) =>
    networkFetch(new URL(String(input), base), init),
  )
  const { client } = await import('../src/ui/client')
  const resetSession = client.agent?.resetSession
  expect(resetSession).toBeTypeOf('function')
  const original = await client.snapshot()
  await client.command({
    type: 'save-settings',
    settings: {
      ...original.settings,
      backend: 'acp',
      agent: {
        kind: 'custom',
        command: process.execPath,
        args: [resolve('tests/fixtures/acp-agent.mjs'), 'session-failure'],
      },
    },
  })
  const first = await send(client, 'FIRST_BROWSER_TURN')
  expect(first.status, first.error).toBe('completed')
  const failed = await send(client, 'RESTORE_BROWSER_TURN')
  expect(failed.status).toBe('failed')
  expect(failed.recovery).toBe('agent-session')
  expect(failed.agentSessionBindingId).toBeDefined()
  expect(await resetSession!(failed.id)).toEqual({ id: failed.id })
  const rebuilt = await send(client, 'REBUILT_BROWSER_TURN')
  expect(rebuilt.status, rebuilt.error).toBe('completed')
  expect(rebuilt.agent?.sessionId).not.toBe(first.agent?.sessionId)
  const saved = await client.snapshot()
  expect(saved.reports).toEqual(original.reports)
  expect(saved.runs.find((run) => run.id === first.id)).toEqual(first)
  expect(saved.runs.find((run) => run.id === failed.id)).toMatchObject({
    status: 'failed',
    error: failed.error,
  })
  await expect(resetSession!(failed.id)).rejects.toThrow('没有可重建')
}, 30000)

async function send(client: ResearchClient, message: string) {
  const { id } = await client.command({ type: 'send-message', nodeId: 'visual', message })
  return vi.waitFor(
    async () => {
      const run = (await client.snapshot()).runs.find((value) => value.id === id)
      expect(run).toBeDefined()
      expect(run!.status).not.toBe('running')
      return run!
    },
    { timeout: 10000, interval: 50 },
  )
}
