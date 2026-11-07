import { app } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopPackage } from './desktop-package.mjs'

mkdirSync(resolve('artifacts/conversation-actions'), { recursive: true })
const folder = mkdtempSync(resolve('artifacts/conversation-actions/check-'))
const profile = join(folder, 'profile')
mkdirSync(profile)
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
process.env.QUESTBRANCH_DATA_DIR = join(folder, 'research')
for (const name of [
  'ELECTRON_RENDERER_URL',
  'TAVILY_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
])
  delete process.env[name]
const packageRoot = process.argv.find((arg) => arg.startsWith('--package-root='))?.slice(15)
const appRoot = packageRoot ? desktopPackage(packageRoot).archive : resolve('.')
const cases = [],
  sockets = new Set()
let serial = 0,
  finished = false
const report = {
  title: '隔离验收报告',
  summary: '用户明确生成的报告。',
  findings: ['发送和生成报告分别触发。'],
  openQuestions: [],
  report: '# 隔离验收报告\n\n这是用户主动生成的阶段性报告，保留原有分支和研究记录。',
  followups: [],
}
const server = createServer(async (request, response) => {
  if (request.url.endsWith('/models'))
    return response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const reportMode = body.tools?.some(
    (tool) => (tool.name ?? tool.function?.name) === 'submit_research_report',
  )
  const user = body.messages.filter((message) => message.role === 'user').at(-1)?.content ?? ''
  const results = body.messages.filter((message) => message.role === 'tool')
  const emit = (delta, reason = null) =>
    response.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`,
    )
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const end = () => {
    emit({}, 'stop')
    response.end('data: [DONE]\n\n')
  }
  if (reportMode) {
    emit({ content: JSON.stringify(report) })
    return end()
  }
  if (user.includes('整理阶段报告并创建方向')) {
    const saved = results.some((result) => {
      try {
        return JSON.parse(result.content).request_id === 'fixture-save-report'
      } catch {
        return false
      }
    })
    if (!saved) {
      emit({
        tool_calls: [
          {
            index: 0,
            id: `call_${++serial}`,
            type: 'function',
            function: {
              name: 'qb_save_research',
              arguments: JSON.stringify({
                ...report,
                request_id: 'fixture-save-report',
                followups: [
                  { title: '字体研究', question: '如何改善长报告的文字阅读体验？' },
                  { title: '图标研究', question: '如何保证图标操作含义清晰？' },
                ],
              }),
            },
          },
        ],
      })
      emit({}, 'tool_calls')
      return response.end('data: [DONE]\n\n')
    }
    emit({ content: '阶段报告与两个研究方向已保存。' })
    return end()
  }
  if (user.includes('慢慢回复')) {
    emit({ content: '这段回复已经开始，接下来等待停止。' })
    return
  }
  if (user.includes('删除分支的1')) {
    let name, args
    if (!results.length) {
      name = 'qb_get_research'
      args = {}
    } else if (results.length === 1) {
      const current = JSON.parse(results[0].content)
      const target = current.children.find((node) => node.title === '1')
      assert(target, 'The fixture must read the actual node ID')
      name = 'qb_remove_branch'
      args = { node_id: target.id, expected_title: '1', request_id: 'fixture-remove-one' }
    }
    if (name) {
      await new Promise((done) => setTimeout(done, 450))
      emit({
        tool_calls: [
          {
            index: 0,
            id: `call_${++serial}`,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      })
      emit({}, 'tool_calls')
      return response.end('data: [DONE]\n\n')
    }
    emit({ content: '已移除标题为“1”的分支。' })
    await new Promise((done) => setTimeout(done, 900))
    emit({ content: '原研究记录保留，可以撤销。' })
    return end()
  }
  emit({ content: '只对话，不自动生成报告。' })
  end()
})
server.on('connection', (socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
const deadline = setTimeout(() => {
  console.error('Conversation action verification timed out')
  app.exit(1)
}, 60000)
app.on('browser-window-created', (_, window) => {
  let rendererFailure
  window.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error') rendererFailure ??= new Error(`Renderer error: ${message}`)
  })
  window.webContents.on('render-process-gone', (_, details) => {
    rendererFailure ??= new Error(`Renderer exited: ${details.reason}`)
  })
  window.setTitle('QuestBranch · 对话行为隔离验收')
  window.setContentSize(1440, 960)
  window.webContents.once('did-finish-load', async () => {
    const evaluate = async (fn, value) => {
      if (rendererFailure) throw rendererFailure
      const result = await window.webContents.executeJavaScript(
        `(async () => { try { return { value: await (${fn.toString()})(${JSON.stringify(value) ?? ''}) } } catch (error) { return { error: String(error), stack: error.stack } } })()`,
      )
      if (result.error) throw new Error(`${result.error}\n${result.stack}\n${fn.toString()}`)
      return result.value
    }
    const until = async (read) => {
      const end = Date.now() + 12000
      while (Date.now() < end) {
        const value = await read()
        if (value) return value
        await new Promise((done) => setTimeout(done, 35))
      }
      throw new Error('Conversation UI condition timed out')
    }
    const snapshot = () => evaluate(() => window.questbranch.snapshot())
    const command = (value) => evaluate((value) => window.questbranch.command(value), value)
    const clickText = (text, selector = 'button') =>
      evaluate(
        ({ text, selector }) => {
          const element = [...document.querySelectorAll(selector)].find(
            (element) =>
              element.textContent.trim() === text || element.getAttribute('aria-label') === text,
          )
          if (!element || element.disabled) throw new Error(`Unavailable control: ${text}`)
          element.click()
        },
        { text, selector },
      )
    const fill = (text) =>
      evaluate((text) => {
        const field = document.querySelector('.research-composer textarea')
        field.focus()
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
          field,
          text,
        )
        field.dispatchEvent(new Event('input', { bubbles: true }))
      }, text)
    const capture = async (name) => {
      window.show()
      window.focus()
      window.webContents.focus()
      await evaluate(async () => {
        const finite = document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        await Promise.all(finite.map((animation) => animation.finished.catch(() => {})))
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
      await new Promise((done) => setTimeout(done, 160))
      writeFileSync(join(folder, name + '.png'), (await window.webContents.capturePage()).toPNG())
    }
    try {
      await until(() => evaluate(() => !!document.querySelector('.research-composer textarea')))
      window.show()
      window.focus()
      window.webContents.focus()
      let current = await snapshot()
      await command({
        type: 'save-settings',
        settings: {
          ...current.settings,
          backend: 'model',
          provider: 'compatible',
          modelProvider: 'custom',
          apiProtocol: 'openai-chat',
          baseUrl,
          model: 'fixture-model',
          modelContextWindow: 128000,
          sessionStrategy: 'portable',
          apiKey: 'fixture-key',
          reasoningEffort: 'none',
        },
      })
      const workspace = current.workspaces[0],
        root = workspace.rootId
      await evaluate(() => document.querySelector('.root-link').click())
      const source = current.reports.find((report) => report.nodeId === root)
      const target = await command({
        type: 'create-node',
        parentId: root,
        sourceReportId: source.id,
        question: '1',
      })
      await until(() =>
        evaluate(() =>
          [...document.querySelectorAll('.branch-title')].some((item) => item.textContent === '1'),
        ),
      )
      const before = await snapshot(),
        beforeReports = before.reports.length
      await clickText('研究报告', '[role="tab"]')
      await fill('中文输入确认')
      const initialRuns = (await snapshot()).runs.length
      await evaluate(() => {
        const field = document.querySelector('.research-composer textarea')
        field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        field.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        )
        field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        field.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        )
      })
      await new Promise((done) => setTimeout(done, 100))
      assert.equal((await snapshot()).runs.length, initialRuns)
      await fill('第一行')
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['shift'] })
      window.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: ['shift'] })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['shift'] })
      await until(() =>
        evaluate(() => document.querySelector('.research-composer textarea').value.includes('\n')),
      )
      assert.equal((await snapshot()).runs.length, initialRuns)
      await fill('删除分支的1')
      assert.equal(
        await evaluate(() => document.querySelector('.composer-send').textContent.trim()),
        '',
      )
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
      await until(() => evaluate(() => !!document.querySelector('.composer-progress .spin')))
      assert.equal(
        await evaluate(() => document.querySelector('.composer-send').getAttribute('aria-label')),
        '停止回复',
      )
      await until(() =>
        evaluate(() =>
          document.querySelector('.composer-progress')?.textContent.includes('正在回复'),
        ),
      )
      await capture('01-speaking-light')
      await until(async () =>
        (await snapshot()).runs.some(
          (run) => run.nodeId === root && run.mode === 'chat' && run.status === 'completed',
        ),
      )
      await until(() => evaluate(() => !!document.querySelector('.tool-undo')))
      await until(() =>
        evaluate(
          () =>
            document.querySelector('.composer-send').getAttribute('aria-label') === '发送消息' &&
            !document.querySelector('.composer-progress'),
        ),
      )
      current = await snapshot()
      assert.equal(current.reports.length, beforeReports)
      assert(current.nodes.find((node) => node.id === target.id).removedAt)
      assert.equal(
        await evaluate(() =>
          [...document.querySelectorAll('.branch-title')].some((item) => item.textContent === '1'),
        ),
        false,
      )
      assert.equal(
        await evaluate(
          (id) => !!document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`),
          target.id,
        ),
        false,
      )
      assert(
        await evaluate(
          () =>
            document.querySelector('.conversation').textContent.includes('读取研究与分支') &&
            document.querySelector('.conversation').textContent.includes('移除研究分支'),
        ),
      )
      assert.equal(
        await evaluate(() =>
          document.querySelector('[role="tab"][aria-selected="true"]').textContent.trim(),
        ),
        '对话',
      )
      await capture('02-removed-tool-chain-light')
      cases.push('sending from report tab remains chat; real graph removal and public tool chain')
      cases.push(
        'Enter sends; Shift+Enter inserts a newline; IME confirmation does not send; icon controls have accessible labels',
      )
      await clickText('撤销', '.tool-undo')
      await until(() =>
        evaluate(() =>
          [...document.querySelectorAll('.branch-title')].some((item) => item.textContent === '1'),
        ),
      )
      assert(!(await snapshot()).nodes.find((node) => node.id === target.id).removedAt)
      cases.push('undo restores original node and report ownership')
      await clickText('研究报告', '[role="tab"]')
      assert(
        await evaluate(
          () =>
            ![...document.querySelectorAll('button')].some((button) =>
              ['整理为报告', '生成报告'].includes(button.textContent.trim()),
            ),
        ),
      )
      await fill('整理阶段报告并创建方向')
      await clickText('发送消息', '.composer-bottom .button')
      await until(async () => (await snapshot()).reports.length === beforeReports + 1)
      await until(() =>
        evaluate(
          () =>
            document.querySelector('.composer-send').getAttribute('aria-label') === '发送消息' &&
            !document.querySelector('.composer-progress'),
        ),
      )
      const savedReport = (await snapshot()).reports.find((entry) => entry.title === report.title)
      assert(savedReport)
      assert.equal(
        (await snapshot()).nodes.filter((node) => node.originReportId === savedReport.id).length,
        2,
      )
      assert(
        await evaluate(() =>
          document.querySelector('.conversation').textContent.includes('保存报告与研究方向'),
        ),
      )
      await clickText('研究报告', '[role="tab"]')
      await until(() =>
        evaluate(() =>
          document.querySelector('.report-markdown')?.textContent.includes('隔离验收报告'),
        ),
      )
      await capture('03-saved-report-and-directions')
      cases.push(
        'chat save tool atomically persists the report and two directions; no report-generation buttons',
      )
      await fill('慢慢回复')
      await clickText('发送消息', '.composer-bottom .button')
      await until(() =>
        evaluate(() =>
          document.querySelector('.conversation')?.textContent.includes('这段回复已经开始'),
        ),
      )
      await clickText('停止回复', '.composer-bottom .button')
      await until(() =>
        evaluate(
          () =>
            document.querySelector('.composer-send').getAttribute('aria-label') === '发送消息' &&
            !document.querySelector('.composer-progress'),
        ),
      )
      const stopped = (await snapshot()).runs.filter((run) => run.mode === 'chat').at(-1)
      assert.equal(stopped.status, 'cancelled')
      assert(stopped.output.includes('这段回复已经开始'))
      cases.push('stop aborts actual streaming; partial reply and graph edits remain')
      await evaluate(() => {
        localStorage.setItem('questbranch-theme', 'dark')
        location.reload()
      })
      await until(() =>
        evaluate(
          () =>
            document.documentElement.dataset.theme === 'dark' &&
            !!document.querySelector('.research-composer textarea'),
        ),
      )
      window.setContentSize(1050, 760)
      window.webContents.setZoomFactor(1.25)
      await new Promise((done) => setTimeout(done, 350))
      const metrics = await evaluate(() => {
        const composer = document.querySelector('.research-composer').getBoundingClientRect()
        return {
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          height: innerHeight,
          bottom: composer.bottom,
          composerHeight: composer.height,
        }
      })
      assert(metrics.scrollWidth <= metrics.width + 1)
      assert(metrics.bottom <= metrics.height + 1)
      await capture('03-dark-narrow-stopped')
      const final = await snapshot()
      const completed = final.runs.find((run) => run.mode === 'chat' && run.status === 'completed')
      assert(completed.toolCalls.some((call) => call.name === 'qb_remove_branch'))
      cases.push('dark narrow window at 125% zoom; persisted calls and stopped state after reload')
      const exported = await evaluate((id) => window.questbranch.exportWorkspace(id), workspace.id)
      const session = exported.modelSessions.sessions.find((entry) => entry.owner.nodeId === root)
      assert(session)
      const rootRuns = final.runs.filter((run) => run.nodeId === root)
      assert(rootRuns.every((run) => run.session?.sessionId === session.owner.sessionId))
      assert.equal(
        new Set(session.state.messages.map((message) => message.id)).size,
        session.state.messages.length,
      )
      assert.equal(session.state.messages.filter((message) => message.role === 'tool').length, 3)
      assert.equal(session.state.messages.at(-1).role, 'user')
      assert.equal(session.results.length, 3)
      assert.equal(JSON.stringify(exported).includes('fixture-key'), false)
      cases.push(
        'packaged SW persists the same node session, complete tools and receipts; cancelled draft excluded',
      )
      const openSessionSettings = async () => {
        await evaluate(() => document.querySelector('[aria-label="模型与连接"]').click())
        await until(() => evaluate(() => !!document.querySelector('.advanced-settings summary')))
        await evaluate(() => {
          document.querySelector('.advanced-settings').open = true
          const field = [...document.querySelectorAll('.field')].find((field) =>
            field.textContent.includes('持续会话'),
          )
          if (!field || field.querySelectorAll('option').length !== 3)
            throw new Error('Missing session policy control')
          field.scrollIntoView({ block: 'center' })
        })
        assert(await evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      }
      await openSessionSettings()
      await capture('04-session-settings-dark-narrow')
      await evaluate(() => document.querySelector('[aria-label="关闭对话框"]').click())
      window.setContentSize(1440, 960)
      window.webContents.setZoomFactor(1)
      await evaluate(() => {
        localStorage.setItem('questbranch-theme', 'light')
        location.reload()
      })
      await until(() =>
        evaluate(
          () =>
            document.documentElement.dataset.theme === 'light' &&
            !!document.querySelector('.research-composer textarea'),
        ),
      )
      await openSessionSettings()
      await capture('05-session-settings-light')
      cases.push(
        'session strategy and separate material/window controls remain usable in both themes and narrow viewport',
      )
      const policy = () =>
        evaluate(() => {
          const field = [...document.querySelectorAll('.field')]
            .find((field) => field.textContent.includes('持续会话'))
            ?.querySelector('select')
          return (
            field && { value: field.value, options: [...field.options].map((item) => item.value) }
          )
        })
      const chooseMode = (title) =>
        evaluate((title) => {
          const button = [...document.querySelectorAll('.provider-options button')].find(
            (button) => button.querySelector('strong').textContent === title,
          )
          if (!button || button.disabled) return false
          button.click()
          return true
        }, title)
      await until(() => chooseMode('账号登录'))
      await until(async () => (await policy())?.value === 'portable')
      assert.deepEqual((await policy()).options, ['portable'])
      await until(() =>
        evaluate(() => {
          const field = [...document.querySelectorAll('.field')]
            .find((field) => field.textContent.trim().startsWith('提供商'))
            ?.querySelector('select')
          if (!field || field.disabled) return false
          const target = [...field.options].find((option) => option.value !== field.value)
          if (!target) throw new Error('Expected another Pi account provider')
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(
            field,
            target.value,
          )
          field.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        }),
      )
      assert.equal((await policy()).value, 'portable')
      await until(() => chooseMode('API 服务'))
      await until(async () => (await policy())?.value === 'auto')
      assert.deepEqual((await policy()).options, ['auto', 'native', 'portable'])
      cases.push('account mode and provider changes select OM; API mode retains native priority')
      await evaluate(() => document.querySelector('[aria-label="关闭对话框"]').click())
      await command({
        type: 'save-settings',
        settings: {
          ...final.settings,
          provider: 'account',
          modelProvider: 'openai',
          model: '',
          baseUrl: '',
          sessionStrategy: 'auto',
        },
      })
      await evaluate(() => location.reload())
      await until(() => evaluate(() => !!document.querySelector('.research-composer textarea')))
      assert.equal((await snapshot()).settings.sessionStrategy, 'portable')
      await evaluate(() => document.querySelector('[aria-label="模型与连接"]').click())
      await until(async () => (await policy())?.value === 'portable')
      assert.deepEqual((await policy()).options, ['portable'])
      await evaluate(() => {
        document.querySelector('.advanced-settings').open = true
        document.querySelector('.advanced-settings').scrollIntoView({ block: 'center' })
      })
      await capture('06-account-session-default')
      cases.push('saved account auto resolves to OM after reload and is displayed as OM')
      await evaluate(() => document.querySelector('[aria-label="关闭对话框"]').click())
      await command({ type: 'save-settings', settings: final.settings })
      await evaluate(() => location.reload())
      await until(() => evaluate(() => !!document.querySelector('[aria-label="发送消息"]')))
      const chooseValue = (label, value) =>
        evaluate(
          ({ label, value }) => {
            const field = document.querySelector(`select[aria-label="${label}"]`)
            if (!field || field.disabled) throw new Error(`Unavailable select: ${label}`)
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(
              field,
              value,
            )
            field.dispatchEvent(new Event('change', { bubbles: true }))
          },
          { label, value },
        )
      const shortcuts = async () => {
        await evaluate(() => document.querySelector('[aria-label="设置"]').click())
        await clickText('快捷键', '[role="tab"]')
        await until(() =>
          evaluate(() => !!document.querySelector('select[aria-label="发送消息快捷键"]')),
        )
      }
      await shortcuts()
      await chooseValue('发送消息快捷键', 'mod-enter')
      await until(() =>
        evaluate(
          () =>
            !!document.querySelector('.settings-modal') &&
            document.querySelector('select[aria-label="发送消息快捷键"]')?.value === 'mod-enter',
        ),
      )
      await evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      await capture('07-shortcuts-light')
      await evaluate(() => document.querySelector('[aria-label="关闭对话框"]').click())
      await evaluate(() => location.reload())
      await until(() =>
        evaluate(() => document.querySelector('.composer-send')?.title.includes('Ctrl + Enter')),
      )
      const beforeShortcutSend = (await snapshot()).runs.length
      await fill('组合键模式换行')
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
      window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
      await until(() =>
        evaluate(() => document.querySelector('.research-composer textarea').value.includes('\n')),
      )
      assert.equal((await snapshot()).runs.length, beforeShortcutSend)
      window.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: 'Enter',
        modifiers: ['control'],
      })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] })
      await until(async () => (await snapshot()).runs.length === beforeShortcutSend + 1)
      await until(async () => !(await snapshot()).runs.some((run) => run.status === 'running'))
      await shortcuts()
      assert.equal(
        await evaluate(() => document.querySelector('select[aria-label="发送消息快捷键"]').value),
        'mod-enter',
      )
      await chooseValue('发送消息快捷键', 'enter')
      await evaluate(() => document.querySelector('[aria-label="关闭对话框"]').click())
      cases.push(
        'shortcut settings persist after reload; Enter inserts newline in modifier mode and Ctrl+Enter sends',
      )

      await command({
        type: 'save-settings',
        settings: {
          ...final.settings,
          modelProvider: 'openai',
          model: 'fixture-model',
          reasoningEffort: '',
          apiKey: 'fixture-native-key',
          baseUrl,
        },
      })
      const nativeCatalog = await evaluate(() => window.questbranch.testConnection())
      // Setup changes the connection outside the UI; reload before interacting with its catalog.
      await evaluate(() => location.reload())
      await until(() => evaluate(() => !!document.querySelector('[aria-label="选择模型"]')))
      const candidate = nativeCatalog.catalog.models.find(
        (entry) => entry.supportedReasoningEfforts.length > 1,
      )
      assert(candidate, 'Expected a native catalog model with actual reasoning options')
      await evaluate(() => document.querySelector('[aria-label="选择模型"]').click())
      await until(() =>
        evaluate(() => document.querySelector('select[aria-label="聊天模型"]')?.disabled === false),
      )
      const displayedModels = await evaluate(() =>
        [...document.querySelector('select[aria-label="聊天模型"]').options].map(
          (option) => option.value,
        ),
      )
      assert(
        displayedModels.includes(candidate.model),
        JSON.stringify({ expected: candidate.model, displayedModels }),
      )
      await chooseValue('聊天模型', candidate.model)
      await until(async () => (await snapshot()).settings.model === candidate.model)
      const level =
        candidate.supportedReasoningEfforts.find(
          (entry) =>
            entry.reasoningEffort === 'high' &&
            entry.reasoningEffort !== candidate.defaultReasoningEffort,
        ) ??
        candidate.supportedReasoningEfforts.find(
          (entry) => entry.reasoningEffort !== candidate.defaultReasoningEffort,
        )
      await until(() =>
        evaluate(() => !document.querySelector('select[aria-label="聊天思考强度"]').disabled),
      )
      await chooseValue('聊天思考强度', level.reasoningEffort)
      await until(async () => (await snapshot()).settings.reasoningEffort === level.reasoningEffort)
      await capture('08-model-picker-light')
      await evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      await until(() => evaluate(() => !document.querySelector('.composer-picker')))
      cases.push(
        'composer selects Pi catalog models and actual reasoning levels without opening the connection dialog',
      )

      await command({
        type: 'save-settings',
        settings: {
          ...final.settings,
          backend: 'acp',
          agent: {
            kind: 'custom',
            name: 'Fixture ACP',
            command: process.execPath,
            args: [resolve('tests/fixtures/acp-agent.mjs'), 'picker'],
            cwd: folder,
            options: { model: 'fixture-model', reasoning_effort: 'low' },
          },
        },
      })
      await evaluate(() => location.reload())
      await until(() => evaluate(() => !!document.querySelector('[aria-label="选择思考强度"]')))
      await evaluate(() => document.querySelector('[aria-label="选择思考强度"]').click())
      await until(() =>
        evaluate(
          () =>
            document.querySelector('select[aria-label="聊天模型"]')?.disabled === false &&
            document.querySelector('select[aria-label="聊天思考强度"]')?.disabled === false,
        ),
      )
      await chooseValue('聊天模型', 'fixture-deep')
      await until(async () => (await snapshot()).settings.agent.options.model === 'fixture-deep')
      assert.equal((await snapshot()).settings.agent.options.reasoning_effort, 'high')
      await until(() =>
        evaluate(() => !document.querySelector('select[aria-label="聊天思考强度"]').disabled),
      )
      await chooseValue('聊天思考强度', 'xhigh')
      await until(
        async () => (await snapshot()).settings.agent.options.reasoning_effort === 'xhigh',
      )
      await capture('09-agent-picker-light')
      await evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      await until(() => evaluate(() => !document.querySelector('.composer-picker')))
      await fill('用刚才选择的模型继续对话')
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
      await until(
        async () =>
          (await snapshot()).runs.at(-1)?.model === 'fixture-deep' &&
          (await snapshot()).runs.at(-1)?.status === 'completed',
      )
      assert.equal((await snapshot()).runs.at(-1).agent.configuration.reasoning_effort, 'xhigh')
      cases.push(
        'composer uses ACP-provided model and thought_level options; the next actual agent run receives both',
      )
      window.setContentSize(1050, 760)
      window.webContents.setZoomFactor(1.25)
      await evaluate(() => {
        localStorage.setItem('questbranch-theme', 'dark')
        location.reload()
      })
      await until(() => evaluate(() => !!document.querySelector('[aria-label="选择思考强度"]')))
      await evaluate(() => document.querySelector('[aria-label="选择思考强度"]').click())
      await until(() =>
        evaluate(
          () => document.querySelector('select[aria-label="聊天思考强度"]')?.disabled === false,
        ),
      )
      assert.equal(
        await evaluate(() => document.querySelector('select[aria-label="聊天思考强度"]').value),
        'xhigh',
      )
      const pickerBounds = await evaluate(() => {
        const bounds = document.querySelector('.composer-picker').getBoundingClientRect()
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          width: innerWidth,
          height: innerHeight,
        }
      })
      assert(
        pickerBounds.left >= 0 &&
          pickerBounds.top >= 0 &&
          pickerBounds.right <= pickerBounds.width + 1 &&
          pickerBounds.bottom <= pickerBounds.height + 1,
      )
      await capture('10-agent-picker-dark-narrow')
      cases.push(
        'model picker remains within the dark narrow viewport at 125% zoom; selection persists',
      )
      writeFileSync(
        join(folder, 'result.json'),
        JSON.stringify(
          {
            folder,
            appRoot,
            cases,
            metrics,
            reportsBefore: beforeReports,
            reportsAfter: final.reports.length,
            isolatedDatabase: true,
            noRealModelOrAccount: true,
          },
          null,
          2,
        ),
      )
      console.log(`Conversation actions verified (${cases.length} cases): ${folder}`)
      finished = true
      clearTimeout(deadline)
      for (const socket of sockets) socket.destroy()
      server.close()
      app.quit()
    } catch (error) {
      await capture('failed').catch(() => {})
      console.error(error.stack)
      clearTimeout(deadline)
      for (const socket of sockets) socket.destroy()
      server.close()
      app.exit(1)
    }
  })
})
process.on('exit', () => {
  if (!finished) process.exitCode = 1
})
await import(pathToFileURL(join(appRoot, 'out/main/index.js')).href)
