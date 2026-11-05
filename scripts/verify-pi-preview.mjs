import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Isolated backend smoke test. Native API-key setup is local interaction only;
// no external provider is contacted and no personal QB profile is opened.
const artifacts = resolve('artifacts')
mkdirSync(artifacts, { recursive: true })
const directory = mkdtempSync(join(artifacts, 'pi-preview-verification-'))
const allocator = createServer()
await new Promise((done) => allocator.listen(0, '127.0.0.1', done))
const port = allocator.address().port
await new Promise((done) => allocator.close(done))
const base = `http://127.0.0.1:${port}`
let child
let log = ''
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/preview/server.ts', '--production'], {
    cwd: resolve('.'),
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      QUESTBRANCH_DATA_DIR: join(directory, 'research'),
      TAVILY_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (data) => {
    log = (log + data).slice(-16000)
  })
  child.stderr.on('data', (data) => {
    log = (log + data).slice(-16000)
  })
  try {
    await poll(async () => {
      if (child.exitCode !== null) throw new Error(`Preview exited: ${log}`)
      return fetch(base + '/api/state')
        .then((response) => response.ok)
        .catch(() => false)
    })
  } catch (error) {
    throw new Error(`Preview did not start: ${log}`, { cause: error })
  }
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((done) => child.once('exit', done))
  child.kill()
  await exited
}
async function request(path, body) {
  const response = await fetch(
    base + '/api/' + path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: base },
          body: JSON.stringify(body),
        },
  )
  const data = await response.json()
  assert.ok(response.ok, data.error)
  return data
}
async function poll(fn) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const result = await fn()
    if (result) return result
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error('Preview verification timed out')
}
try {
  await start()
  const providers = await request('providers')
  assert.ok(providers.some((provider) => provider.id === 'openai' && provider.oauth))
  const original = await request('state')
  const api = {
    ...original.settings,
    provider: 'compatible',
    modelProvider: 'openai',
    model: 'gpt-4',
    baseUrl: '',
  }
  const denied = await fetch(base + '/api/auth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.invalid' },
    body: JSON.stringify({ settings: api, type: 'api_key' }),
  })
  assert.equal(denied.status, 403)
  const session = await request('auth/start', { settings: api, type: 'api_key' })
  const pending = await poll(async () => {
    const state = await request(`auth/status?id=${encodeURIComponent(session.id)}`)
    return state.prompt ? state : false
  })
  assert.equal(pending.prompt.type, 'secret')
  await request('auth/respond', {
    id: session.id,
    promptId: pending.prompt.id,
    value: 'preview-fixture-secret',
  })
  await poll(
    async () =>
      (await request(`auth/status?id=${encodeURIComponent(session.id)}`)).status === 'connected',
  )
  await request('command', { type: 'save-settings', settings: api })
  const workspace = await request('command', {
    type: 'create-workspace',
    question: '隔离的浏览器 Pi 验收研究',
  })
  assert.ok(workspace.id)
  assert.equal((await request('state')).settings.hasApiKey, true)
  assert.ok(!JSON.stringify(await request('state')).includes('preview-fixture-secret'))
  await stop()
  await start()
  const reopened = await request('state')
  assert.equal(reopened.settings.hasApiKey, true)
  assert.ok(reopened.workspaces.some((entry) => entry.id === workspace.id))
  assert.equal((await request('test', { settings: api })).status, 'configured')
  assert.equal(
    (await request('test', { settings: { ...api, provider: 'account' } })).status,
    'login-required',
  )
  await request('auth/logout', { settings: api })
  assert.equal((await request('state')).settings.hasApiKey, false)
  writeFileSync(
    join(directory, 'verified.json'),
    JSON.stringify(
      {
        providers: providers.length,
        localAuthSetup: true,
        restartPersistence: true,
        accountApiSeparation: true,
        originGuard: true,
        logout: true,
        directory,
      },
      null,
      2,
    ),
  )
  console.log(`Pi browser backend verified: ${directory}`)
} finally {
  await stop()
}
