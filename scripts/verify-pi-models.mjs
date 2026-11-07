import { app, safeStorage } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopPackage, option } from './desktop-package.mjs'

// All requests stay on this process's mock server. Never use a person's QB
// profile, account credentials, or research content for this check.
const artifacts = resolve('artifacts')
mkdirSync(artifacts, { recursive: true })
const root = mkdtempSync(join(artifacts, 'pi-models-verification-'))
const profile = join(root, 'profile')
mkdirSync(profile)
app.setPath('userData', profile)
app.disableHardwareAcceleration()
process.env.QUESTBRANCH_DATA_DIR = join(root, 'research')
for (const name of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'TAVILY_API_KEY'])
  delete process.env[name]
const requests = []
const packaged = process.argv.includes('--packaged')
const appRoot = packaged ? desktopPackage(option('package-root')).archive : resolve('.')
const sdkVersions = Object.fromEntries(
  ['@earendil-works/pi-ai'].map((name) => {
    const path = join(appRoot, 'node_modules', name, 'package.json')
    if (packaged) assert.ok(path.startsWith(appRoot + sep), `SDK is missing from package: ${name}`)
    return [name, JSON.parse(readFileSync(path, 'utf8')).version]
  }),
)
const report = {
  title: 'API 协议验收',
  summary: '统一保存当前分支的研究成果。',
  findings: ['三种协议延续同一研究。'],
  openQuestions: [],
  report: '## 协议验收\n\n本报告由本机固定响应生成，用于验证设置、协议和研究保存闭环。',
  followups: [],
}
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.headers.host, `127.0.0.1:${server.address().port}`)
    if (request.url.endsWith('/models')) {
      if (request.url.startsWith('/generation-only')) {
        response.writeHead(404).end()
        return
      }
      if (request.url.startsWith('/denied')) {
        response
          .writeHead(401, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: { message: 'invalid fixture-key' } }))
        return
      }
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
      return
    }
    const buffers = []
    for await (const buffer of request) buffers.push(buffer)
    const body = JSON.parse(Buffer.concat(buffers).toString('utf8'))
    const pathname = new URL(request.url, 'http://localhost').pathname
    const native = pathname.endsWith('/messages'),
      responses = pathname.endsWith('/responses')
    assert.ok(native || responses || pathname.endsWith('/chat/completions'))
    const local = request.url.startsWith('/ollama/')
    assert.equal(
      native ? request.headers['x-api-key'] : request.headers.authorization,
      local ? undefined : native ? 'fixture-key' : 'Bearer fixture-key',
    )
    if (native) assert.equal(request.headers['anthropic-version'], '2023-06-01')
    assert.equal(body.model, 'fixture-model')
    const structured = !!body.tools?.some(
      (tool) => (tool.name ?? tool.function?.name) === 'submit_research_report',
    )
    const text = structured
      ? JSON.stringify(report)
      : '这是一条本机模拟回复，保存在发起讨论的节点。'
    requests.push({ path: request.url, structured, native, responses })
    const events = native
      ? [
          {
            type: 'message_start',
            message: {
              id: 'msg-fixture',
              model: 'fixture-model',
              role: 'assistant',
              content: [],
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 20 },
          },
          { type: 'message_stop' },
        ]
      : responses
        ? [
            {
              type: 'response.created',
              response: {
                id: 'resp-fixture',
                created_at: 1,
                model: 'fixture-model',
                status: 'in_progress',
              },
            },
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: {
                type: 'message',
                id: 'msg-fixture',
                role: 'assistant',
                content: [],
                status: 'in_progress',
              },
            },
            {
              type: 'response.output_text.delta',
              item_id: 'msg-fixture',
              output_index: 0,
              delta: text,
            },
            {
              type: 'response.output_item.done',
              output_index: 0,
              item: {
                type: 'message',
                id: 'msg-fixture',
                role: 'assistant',
                content: [{ type: 'output_text', text, annotations: [] }],
                status: 'completed',
              },
            },
            { type: 'response.completed', response: { status: 'completed' } },
          ]
        : [
            { choices: [{ delta: { content: text } }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }] },
          ]
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(
      events
        .map(
          (event) => `event: ${event.type ?? 'message'}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`,
        )
        .join(''),
    )
  } catch (error) {
    response
      .writeHead(500, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: { message: error.message } }))
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
let completed = false
const timeout = setTimeout(() => {
  console.error('API settings verification timed out')
  app.exit(1)
}, 60000)
app.on('browser-window-created', (_, window) => {
  window.setContentSize(1440, 960)
  window.webContents.once('did-finish-load', async () => {
    const evaluate = (fn, value) =>
      window.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value) ?? ''})`)
    const poll = async (fn, value) => {
      const started = Date.now()
      while (Date.now() - started < 10000) {
        const result = await evaluate(fn, value)
        if (result) return result
        await new Promise((done) => setTimeout(done, 50))
      }
      throw new Error(`UI condition timed out: ${fn}`)
    }
    const click = (text) =>
      evaluate((text) => {
        const button = [...document.querySelectorAll('button')].find(
          (button) => button.textContent.trim() === text,
        )
        if (!button) throw new Error(`Button missing: ${text}`)
        button.click()
      }, text)
    const select = (index, value) =>
      evaluate(
        ({ index, value }) => {
          const element = document.querySelectorAll('.modal select')[index]
          element.value = value
          element.dispatchEvent(new Event('change', { bubbles: true }))
        },
        { index, value },
      )
    const input = (label, value) =>
      evaluate(
        ({ label, value }) => {
          const field = [...document.querySelectorAll('.modal .field')].find(
            (field) => field.childNodes[0].textContent.trim() === label,
          )
          const element = field?.querySelector('input')
          if (!element) throw new Error(`Input missing: ${label}`)
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
            element,
            value,
          )
          element.dispatchEvent(new Event('input', { bubbles: true }))
        },
        { label, value },
      )
    const snapshot = () => evaluate(() => window.questbranch.snapshot())
    const command = (command) => evaluate((command) => window.questbranch.command(command), command)
    const capture = async (name) => {
      await new Promise((done) => setTimeout(done, 450))
      writeFileSync(join(root, name), (await window.webContents.capturePage()).toPNG())
    }
    const open = async () => {
      await evaluate(() => document.querySelector('[aria-label="模型与连接"]').click())
      await poll(() => !!document.querySelector('.models-modal'))

      await poll(() => !!document.querySelector('.provider-options'))
    }
    try {
      await poll(() => document.querySelectorAll('.research-card').length > 0)
      await open()
      assert.deepEqual(
        await evaluate(() =>
          [...document.querySelectorAll('.provider-options strong')].map(
            (element) => element.textContent,
          ),
        ),
        ['账号登录', 'API 服务', 'Ollama'],
      )
      const providers = await evaluate(() => window.questbranch.modelProviders())
      assert.ok(providers.some((provider) => provider.id === 'openai' && provider.oauth))
      assert.ok(providers.some((provider) => provider.id === 'anthropic' && provider.oauth))
      assert.ok(providers.some((provider) => provider.id === 'github-copilot' && provider.oauth))
      assert.ok(
        !(await evaluate(() => document.querySelector('.modal').textContent.includes('程序路径'))),
      )
      await capture('account-settings-light.png')
      for (const [id, protocol] of [
        ['anthropic', 'anthropic-messages'],
        ['openai', 'openai-responses'],
        ['deepseek', 'openai-chat'],
        ['custom-chat', 'openai-chat'],
        ['custom-responses', 'openai-responses'],
        ['custom-anthropic', 'anthropic-messages'],
        ['ollama', 'openai-chat'],
      ]) {
        if (id !== 'anthropic') await open()
        if (id === 'ollama') {
          await evaluate(() =>
            [...document.querySelectorAll('.provider-options button')]
              .find((button) => button.querySelector('strong')?.textContent === 'Ollama')
              .click(),
          )
        } else {
          await evaluate(() => document.querySelectorAll('.provider-options button')[1].click())
          await poll(() => !document.querySelector('.provider-options button:disabled'))
          await select(0, id.startsWith('custom-') ? 'custom' : id)
          if (id.startsWith('custom-')) await select(1, protocol)
          else
            await evaluate(() => {
              document.querySelector('.advanced-settings').open = true
            })
        }
        await capture(`preset-${id}.png`)
        await input('服务地址', id === 'ollama' ? baseUrl.replace('/v1', '/ollama') : baseUrl)
        if (id !== 'ollama') await input('API Key', 'fixture-key')
        await click('连接服务')
        await poll(() => document.querySelector('.provider-status.connected'))
        assert.ok(
          await evaluate(() => document.querySelectorAll('#available-models option').length > 0),
        )
        await input('模型', 'fixture-model')
        // Fixture deployments have no native compaction or real catalog capacity.
        // Configure their explicit OM window through the same UI as a user.
        await evaluate(() => {
          document.querySelector('.advanced-settings').open = true
          const field = [...document.querySelectorAll('.modal .field')].find(
            (field) => field.childNodes[0].textContent.trim() === '持续会话',
          )
          const element = field.querySelector('select')
          element.value = 'portable'
          element.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await input('模型上下文容量', '128000')
        await click('保存更改')
        await poll(() => !document.querySelector('.modal'))
        assert.equal(
          (await snapshot()).settings.provider,
          id === 'ollama' ? 'ollama' : 'compatible',
        )
        for (const mode of ['chat', 'report']) {
          const run = await command(
            mode === 'chat'
              ? { type: 'send-message', nodeId: 'visual', message: '本机隔离协议验收' }
              : { type: 'start-research', nodeId: 'visual', instruction: '整理本机验收报告' },
          )
          const status = await poll(async (id) => {
            const run = (await window.questbranch.snapshot()).runs.find((run) => run.id === id)
            return run.status === 'running'
              ? false
              : { status: run.status, error: run.error, pi: run.pi }
          }, run.id)
          assert.equal(status.status, 'completed', status.error)
          assert.equal(status.pi.api, protocol === 'openai-chat' ? 'openai-completions' : protocol)
        }
      }
      await open()
      await evaluate(() =>
        [...document.querySelectorAll('.provider-options button')]
          .find((button) => button.querySelector('strong')?.textContent === 'API 服务')
          .click(),
      )
      await poll(() => !document.querySelector('.provider-options button:disabled'))
      await select(0, 'anthropic')
      await input('模型', 'fixture-model')
      await capture('api-settings-1440.png')
      window.setContentSize(1050, 700)
      await capture('api-settings-1050.png')
      assert.ok(await evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await evaluate(() => document.querySelector('[aria-label="关闭对话框"]').click())
      await command({
        type: 'save-settings',
        settings: {
          ...(await snapshot()).settings,
          provider: 'compatible',
          modelProvider: 'custom',
          apiProtocol: 'openai-chat',
          baseUrl: baseUrl.replace('/v1', '/generation-only'),
          model: 'fixture-model',
        },
      })
      // This command bypasses the UI's normal save-and-refresh path. Reload to
      // read the persisted settings rather than racing background polling.
      const loaded = new Promise((done) => window.webContents.once('did-finish-load', done))
      window.webContents.reload()
      await loaded
      await poll(() => document.querySelectorAll('.research-card').length > 0)
      window.setContentSize(1440, 960)
      await open()
      await click('连接服务')
      await poll(() =>
        document.querySelector('.provider-account small')?.textContent.includes('未提供模型目录'),
      )
      await capture('manual-model.png')
      await input('服务地址', baseUrl.replace('/v1', '/denied'))
      await input('API Key', 'fixture-key')
      await click('连接服务')
      await poll(() => !!document.querySelector('.modal .inline-error'))
      const error = await evaluate(() => document.querySelector('.modal .inline-error').textContent)
      assert.ok(error.includes('401') && !error.includes('fixture-key'))
      // Exercise the actual Pi login interaction and encrypted desktop storage
      // using an API-key prompt. This step makes no external network request.
      await select(0, 'openai')
      await poll(() => !document.querySelector('.provider-options button:disabled'))
      await evaluate(() => {
        document.querySelector('.advanced-settings').open = true
      })
      await click('配置认证参数')
      await poll(() => document.querySelector('.auth-interaction input[type="password"]'))
      await capture('api-credential-prompt-light.png')
      await evaluate(() => {
        const element = document.querySelector('.auth-interaction input')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
          element,
          'pi-desktop-fixture-secret',
        )
        element.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await click('继续')
      await poll(
        () =>
          !document.querySelector('.auth-interaction') &&
          document.querySelector('.provider-status.connected'),
      )
      assert.ok(!JSON.stringify(await snapshot()).includes('pi-desktop-fixture-secret'))
      await click('配置认证参数')
      await poll(() => document.querySelector('.auth-interaction'))
      await click('取消连接')
      await poll(() => !document.querySelector('.auth-interaction'))
      await evaluate(() => document.querySelector('[aria-label="关闭对话框"]').click())
      await evaluate(() => localStorage.setItem('questbranch-theme', 'dark'))
      const themeLoaded = new Promise((done) => window.webContents.once('did-finish-load', done))
      window.webContents.reload()
      await themeLoaded
      await poll(
        () =>
          document.documentElement.dataset.theme === 'dark' &&
          document.querySelectorAll('.research-card').length > 0,
      )
      window.setContentSize(1440, 960)
      await open()
      await evaluate(() => document.querySelectorAll('.provider-options button')[0].click())
      await poll(() => !document.querySelector('.provider-options button:disabled'))
      const account = await evaluate(async () => {
        const saved = (await window.questbranch.snapshot()).settings
        return window.questbranch.testConnection({
          ...saved,
          provider: 'account',
          modelProvider: 'openai',
          baseUrl: '',
          model: '',
        })
      })
      assert.equal(
        account.status,
        'login-required',
        'A saved API key must never become an account login',
      )
      const model = account.catalog.models.find(
        (model) => model.supportedReasoningEfforts.length > 2,
      )
      assert.ok(model)
      await select(1, model.model)
      assert.deepEqual(
        await evaluate(() =>
          [...document.querySelectorAll('.model-selection-row select')[1].options].map(
            (option) => option.value,
          ),
        ),
        ['', ...model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort)],
      )
      await capture('account-settings-dark.png')
      window.setContentSize(1050, 700)
      await capture('account-settings-dark-1050.png')
      const final = await snapshot()
      assert.equal(final.messages.length, 14)
      assert.equal(final.runs.filter((run) => run.status === 'completed').length, 14)
      assert.equal(requests.length, 14)
      writeFileSync(
        join(root, 'verified.json'),
        JSON.stringify(
          {
            requests,
            sdkVersions,
            completedRuns: 14,
            credentialStorage: {
              encryptionAvailable: safeStorage.isEncryptionAvailable(),
              backend:
                process.platform === 'linux'
                  ? safeStorage.getSelectedStorageBackend()
                  : process.platform,
            },
            accountCatalog: true,
            nativeCredentialPromptAndCancel: true,
            accountApiSeparation: true,
            reasoningCapabilities: true,
            lightAndDark: true,
            modelListFallback: true,
            authenticationError: true,
            narrowLayout: true,
            directory: root,
          },
          null,
          2,
        ),
      )
      console.log(`API service UI and local HTTP roundtrips verified: ${root}`)
      completed = true
      clearTimeout(timeout)
      server.close()
      app.quit()
    } catch (error) {
      await capture('failure.png')
      console.error(error.stack)
      clearTimeout(timeout)
      server.close()
      app.exit(1)
    }
  })
})
process.on('exit', () => {
  if (!completed) process.exitCode = 1
})
await import(pathToFileURL(join(appRoot, 'out/main/index.js')).href)
