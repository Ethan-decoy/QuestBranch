import { app, session, shell } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Production desktop entry + real Chromium proxy transport, isolated profile,
// synthetic credentials and local fixture responses. No model/account is used.
mkdirSync(resolve('artifacts/network'), { recursive: true })
const folder = mkdtempSync(resolve('artifacts/network/check-'))
const profile = join(folder, 'profile')
mkdirSync(profile)
app.setPath('userData', profile)
app.disableHardwareAcceleration()
process.env.QUESTBRANCH_DATA_DIR = join(folder, 'research')
for (const name of [
  'ELECTRON_RENDERER_URL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'TAVILY_API_KEY',
])
  delete process.env[name]
const packageRoot = process.argv.find((value) => value.startsWith('--package-root='))?.slice(15)
const appRoot = packageRoot ? join(resolve(packageRoot), 'resources/app.asar') : resolve('.')
const previousFetch = globalThis.fetch
const opened = []
shell.openExternal = async (url) => {
  opened.push(url)
}
const cases = []
const requests = []
const sockets = new Set()
let rejectToken = false
const proxy = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const parts = []
  for await (const chunk of request) parts.push(chunk)
  const body = Buffer.concat(parts).toString()
  const proxied = request.url.startsWith('http://research.qb.invalid/')
  requests.push({ path: url.pathname, proxied, cookie: !!request.headers.cookie })
  response.setHeader('x-request-id', 'req-local-fixture')
  if (url.pathname === '/oauth/token') {
    response.setHeader('content-type', 'application/json')
    if (rejectToken) {
      response.writeHead(403).end(
        JSON.stringify({
          error: {
            code: 'unsupported_country_region_territory',
            message: 'PRIVATE-TOKEN-DETAIL',
          },
        }),
      )
    } else {
      const refresh = new URLSearchParams(body).get('grant_type') === 'refresh_token'
      response.end(
        JSON.stringify({
          access_token: 'PRIVATE-FIXTURE-ACCESS',
          refresh_token: 'PRIVATE-FIXTURE-REFRESH',
          id_token: 'PRIVATE-FIXTURE-ID',
          scope: 'chatgpt.tokens.use.direct',
          expires_in: refresh ? 3600 : 1,
        }),
      )
    }
  } else if (url.pathname.endsWith('/models')) {
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
  } else if (url.pathname.endsWith('/chat/completions')) {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const event of [
      { choices: [{ delta: { content: '通过系统网络继续研究。' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ])
      response.write(`data: ${JSON.stringify(event)}\n\n`)
    response.end('data: [DONE]\n\n')
  } else if (url.pathname === '/stall') {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: first\n\n')
  } else
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ local: true }))
})
proxy.on('connection', (socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
})
await new Promise((done) => proxy.listen(0, '127.0.0.1', done))
const proxyPort = proxy.address().port
let finished = false
const deadline = setTimeout(() => {
  console.error('Network verification timed out')
  app.exit(1)
}, 55000)
app.on('browser-window-created', (_, window) => {
  window.webContents.once('did-finish-load', async () => {
    const evaluate = (fn, value) =>
      window.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value) ?? ''})`)
    const call = (method, ...args) =>
      evaluate(
        ({ method, args }) => {
          const path = method.split('.')
          const owner = path.length === 2 ? window.questbranch[path[0]] : window.questbranch
          return owner[path.at(-1)](...args)
        },
        { method, args },
      )
    const until = async (read) => {
      const end = Date.now() + 10000
      while (Date.now() < end) {
        const value = await read()
        if (value) return value
        await new Promise((done) => setTimeout(done, 30))
      }
      throw new Error('Desktop network condition timed out')
    }
    const system = session.fromPartition('questbranch-network')
    const configure = async (port) => {
      await system.setProxy({ mode: 'fixed_servers', proxyRules: `127.0.0.1:${port}` })
      await system.closeAllConnections()
    }
    const logPath = join(profile, 'logs/network.log')
    const entries = () =>
      readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    try {
      assert.notEqual(
        globalThis.fetch,
        previousFetch,
        'Desktop bootstrap must install its transport',
      )
      await configure(proxyPort)
      await system.cookies.set({
        url: 'http://research.qb.invalid',
        name: 'fixture-cookie',
        value: 'PRIVATE-FIXTURE-COOKIE',
      })
      // Intercept only this synthetic OAuth endpoint, forwarding it to the local
      // proxy fixture. All other HTTPS destinations are denied during the test.
      // No certificate override or real browser authorization is involved.
      await system.protocol.handle('https', async (request) => {
        const url = new URL(request.url)
        assert.equal(url.hostname, 'auth.openai.com')
        assert.equal(url.pathname, '/api/accounts/oauth/token')
        return system.fetch('http://research.qb.invalid/oauth/token', {
          method: request.method,
          headers: request.headers,
          body: await request.text(),
          signal: request.signal,
          redirect: 'error',
        })
      })
      const snapshot = await call('snapshot')
      const settings = {
        ...snapshot.settings,
        backend: 'model',
        provider: 'compatible',
        modelProvider: 'custom',
        apiProtocol: 'openai-chat',
        baseUrl: 'http://research.qb.invalid/v1',
        model: 'fixture-model',
        modelContextWindow: 128000,
        sessionStrategy: 'portable',
        apiKey: 'PRIVATE-FIXTURE-API-KEY',
        searchKey: '',
        jsonMode: false,
        reasoningEffort: 'none',
      }
      const catalog = await call('testConnection', settings)
      assert(catalog.models.includes('fixture-model'))
      await call('command', { type: 'save-settings', settings })
      const workspace = await call('command', {
        type: 'create-workspace',
        question: '隔离网络验收',
      })
      const created = (await call('snapshot')).workspaces.find((value) => value.id === workspace.id)
      const run = await call('command', {
        type: 'send-message',
        nodeId: created.rootId,
        message: 'PRIVATE-RESEARCH-PROMPT',
      })
      await until(async () => {
        const current = (await call('snapshot')).runs.find((value) => value.id === run.id)
        assert.notEqual(current?.status, 'failed', current?.error)
        return current?.status === 'completed'
      })
      assert(requests.filter((request) => request.proxied).length >= 2)
      assert(!requests.some((request) => request.cookie))
      cases.push('production desktop model discovery and SSE via a real proxy')

      const account = {
        ...settings,
        provider: 'account',
        modelProvider: 'openai',
        baseUrl: '',
        apiKey: undefined,
      }
      const login = async () => {
        const started = await call('auth.start', account, 'oauth')
        const pending = await until(async () => {
          const current = await call('auth.status', started.id)
          assert.equal(current.status, 'pending', current.message)
          return current.prompt?.type === 'manual_code' && current.url ? current : null
        })
        const state = new URL(pending.url).searchParams.get('state')
        assert(state)
        await call(
          'auth.respond',
          started.id,
          pending.prompt.id,
          `http://127.0.0.1:1455/auth/callback?code=PRIVATE-FIXTURE-CODE&state=${encodeURIComponent(state)}&client_id=fixture-client`,
        )
        return until(async () => {
          const value = await call('auth.status', started.id)
          return value.status !== 'pending' ? value : null
        })
      }
      const connected = await login()
      assert.equal(connected.status, 'connected', connected.message)
      // The synthetic first token expires inside Pi's refresh margin, exercising
      // actual native token rotation through QB's credential/transport adapter.
      assert.equal((await call('testConnection', account)).status, 'configured')
      assert(
        entries().some(
          (entry) => entry.operation === 'auth-login' && entry.outcome === 'completed',
        ),
      )
      assert(
        entries().some(
          (entry) => entry.operation === 'token-refresh' && entry.outcome === 'completed',
        ),
      )
      assert(opened.length > 0)
      cases.push('native Pi OAuth login and refresh through desktop bootstrap; browser stubbed')
      await call('auth.logout', account)
      rejectToken = true
      const failed = await login()
      assert.equal(failed.status, 'failed')
      assert(failed.message.includes('unsupported_country_region_territory'))
      assert(
        entries().some(
          (entry) =>
            entry.operation === 'auth-login' &&
            entry.status === 403 &&
            entry.serverCode === 'unsupported_country_region_territory',
        ),
      )
      cases.push('OAuth 403 records request metadata and allowlisted reason')

      const abort = new AbortController()
      const stream = await fetch('http://research.qb.invalid/stall', { signal: abort.signal })
      const reader = stream.body.getReader()
      assert(new TextDecoder().decode((await reader.read()).value).includes('first'))
      abort.abort()
      await assert.rejects(reader.read())
      cases.push('Chromium SSE cancellation closes the response')
      const reservation = createServer()
      await new Promise((done) => reservation.listen(0, '127.0.0.1', done))
      const deadPort = reservation.address().port
      await new Promise((done) => reservation.close(done))
      await configure(deadPort)
      await assert.rejects(
        fetch('http://research.qb.invalid/unreachable'),
        /ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED/,
      )
      assert.equal(
        await (
          await fetch(`http://127.0.0.1:${proxyPort}/local`)
        )
          .json()
          .then((value) => value.local),
        true,
      )
      cases.push('failed proxy has no application direct fallback; loopback stays direct')

      system.protocol.unhandle('https')
      await system.setProxy({ mode: 'system' })
      await system.closeAllConnections()
      let systemProbe
      if (process.argv.includes('--system-probe')) {
        const response = await fetch('https://auth.openai.com/api/accounts/oauth/token', {
          method: 'GET',
          signal: AbortSignal.timeout(12000),
        })
        await response.body?.cancel()
        assert.notEqual(response.status, 403, 'The previous system-proxy bypass still reproduces')
        systemProbe = { method: 'GET', status: response.status, noAuthentication: true }
        cases.push('current system proxy reaches the OAuth endpoint with an unauthenticated GET')
      }
      const text = readFileSync(logPath, 'utf8')
      for (const secret of [
        'PRIVATE-FIXTURE-ACCESS',
        'PRIVATE-FIXTURE-REFRESH',
        'PRIVATE-FIXTURE-API-KEY',
        'PRIVATE-FIXTURE-CODE',
        'PRIVATE-RESEARCH-PROMPT',
        'PRIVATE-TOKEN-DETAIL',
      ])
        assert(!text.includes(secret), `Diagnostic disclosure: ${secret}`)
      assert(entries().some((entry) => entry.route === 'local-direct'))
      cases.push(
        'persisted diagnostic log excludes credentials, callback codes and research content',
      )
      writeFileSync(
        join(folder, 'result.json'),
        JSON.stringify(
          {
            folder,
            appRoot,
            cases,
            systemProbe,
            credentials: 'synthetic; no account or model usage',
            requests: requests.length,
            logEntries: entries().length,
            versions: process.versions,
          },
          null,
          2,
        ),
      )
      console.log(`Network verification passed (${cases.length} cases): ${folder}`)
      finished = true
      clearTimeout(deadline)
      for (const socket of sockets) socket.destroy()
      proxy.close()
      app.quit()
    } catch (error) {
      console.error(error.stack)
      clearTimeout(deadline)
      for (const socket of sockets) socket.destroy()
      proxy.close()
      app.exit(1)
    }
  })
})
process.on('exit', () => {
  if (!finished) process.exitCode = 1
})
await import(pathToFileURL(join(appRoot, 'out/main/index.js')).href)
