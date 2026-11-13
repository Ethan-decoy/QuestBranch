// Actual fixed Windows directory package, fresh profile/database and a deterministic
// ACP agent. No daily database, global agent config, login or paid model is used.
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import assert from 'node:assert/strict'
import { desktopPackage } from './desktop-package.mjs'

const option = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const root = resolve('artifacts/branching-mcp')
mkdirSync(root, { recursive: true })
const previous = option('reopen')
const folder = previous ? resolve(previous) : mkdtempSync(join(root, 'check-'))
assert(folder.startsWith(root + sep), 'Only isolated verification folders may be opened')
const profile = join(folder, 'profile'),
  research = join(folder, 'research'),
  codexHome = join(folder, 'codex-home')
for (const directory of [profile, research, codexHome]) mkdirSync(directory, { recursive: true })
const evidence = previous
  ? JSON.parse(readFileSync(join(folder, 'result.json'), 'utf8'))
  : { cases: [], folder }
const packaged = desktopPackage(option('package-root'))
const executable = resolve(option('executable') ?? packaged.executable)
console.log(`Verification folder: ${folder}`)
const fixture = resolve('tests/fixtures/acp-agent.mjs')
const portServer = createServer()
await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve))
const port = portServer.address().port
await new Promise((resolve) => portServer.close(resolve))
const env = { ...process.env, CODEX_HOME: codexHome, QUESTBRANCH_DATA_DIR: research }
if (process.argv.includes('--saved-location')) delete env.QUESTBRANCH_DATA_DIR
for (const key of [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'TAVILY_API_KEY',
  'CODEX_CONFIG',
  'CODEX_PATH',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
])
  delete env[key]
const child = spawn(
  executable,
  [
    `--user-data-dir=${profile}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    '--disable-gpu',
    // Another verification window must not suspend this isolated UI's polling.
    '--disable-backgrounding-occluded-windows',
  ],
  { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
)
async function quitOwnedApp() {
  if (process.platform === 'darwin') {
    // Closing the last window intentionally keeps a macOS app running. Use its
    // native Quit Apple event, addressed to this test's exact bundle path.
    execFileSync('osascript', ['-e', `tell application ${JSON.stringify(packaged.root)} to quit`])
  } else await evaluate(() => window.close()).catch(() => {})
}
let logs = '',
  socket,
  evaluate,
  request
let childStopped = false,
  launchError
child.stdout.on('data', (data) => {
  logs += data
})
child.stderr.on('data', (data) => {
  logs += data
})
const exited = new Promise((resolve) => {
  child.once('exit', (code) => {
    childStopped = true
    resolve(code)
  })
  child.once('error', (error) => {
    launchError = error
    childStopped = true
    resolve(null)
  })
})
const pause = (ms = 75) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(read) {
  const end = Date.now() + 25_000
  while (Date.now() < end) {
    if (launchError) throw launchError
    if (childStopped)
      throw new Error(`Isolated EXE exited before verification completed (code ${child.exitCode})`)
    const value = await read()
    if (value) return value
    await pause()
  }
  throw new Error('Packaged research verification timed out')
}
const snapshot = () => evaluate(() => window.questbranch.snapshot())
const command = (input) => evaluate((input) => window.questbranch.command(input), input)
const click = (selector) =>
  evaluate((selector) => {
    const element = document.querySelector(selector)
    if (!element || element.disabled) throw new Error(`Unavailable control: ${selector}`)
    element.click()
  }, selector)
const clickText = (text, selector = 'button') =>
  evaluate(
    ({ text, selector }) => {
      const element = [...document.querySelectorAll(selector)].find(
        (element) => element.textContent.trim() === text,
      )
      if (!element || element.disabled) throw new Error(`Unavailable control: ${text}`)
      element.click()
    },
    { text, selector },
  )
const fill = (selector, value) =>
  evaluate(
    ({ selector, value }) => {
      const element = document.querySelector(selector)
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
      element.dispatchEvent(
        new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
      )
    },
    { selector, value },
  )
async function configure(scenario) {
  const current = await snapshot()
  await command({
    type: 'save-settings',
    settings: {
      ...current.settings,
      backend: 'acp',
      model: '',
      agent: {
        kind: 'custom',
        // The launch override may be an AppImage container, rather than a Node
        // executable. Run the external protocol fixture with the packaged engine;
        // the application itself still starts through the real container launcher.
        command: packaged.executable,
        args: [fixture, scenario],
        name: `Fixture ${scenario}`,
      },
    },
  })
}
async function run(input) {
  const { id } = await command(input)
  return finish(id)
}
async function finish(id) {
  const result = await until(async () => {
    const run = (await snapshot()).runs.find((run) => run.id === id)
    return run && run.status !== 'running' ? run : null
  })
  assert.equal(result.status, 'completed', result.error)
  return result
}
async function capture(name) {
  await evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await pause(100)
  const image = await request('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(folder, `${name}.png`), Buffer.from(image.data, 'base64'))
}
try {
  const page = await until(async () => {
    try {
      return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
        (page) => page.type === 'page',
      )
    } catch {
      return null
    }
  })
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let serial = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    }
  })
  request = async (method, params = {}) => {
    const id = ++serial,
      response = new Promise((resolve) => pending.set(id, resolve))
    socket.send(JSON.stringify({ id, method, params }))
    let timer
    const result = await Promise.race([
      response,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`CDP timed out: ${method}`)), 30_000)
      }),
    ]).finally(() => clearTimeout(timer))
    if (result.error) throw new Error(JSON.stringify(result.error))
    return result.result
  }
  evaluate = async (fn, value) => {
    const result = await request('Runtime.evaluate', {
      expression: `(${fn.toString()})(${JSON.stringify(value)})`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await request('Page.bringToFront')
  await until(() => evaluate(() => !!document.querySelector('.research-composer')))
  await evaluate(() => {
    localStorage.setItem('questbranch-theme', 'light')
    location.reload()
  })
  await until(() =>
    evaluate(
      () =>
        !!document.querySelector('.research-composer') &&
        document.documentElement.dataset.theme === 'light',
    ),
  )
  if (option('restore') || evidence.restoreInput) {
    const backupPath = resolve(option('restore') || evidence.restoreInput)
    const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
    const imported = previous
      ? { id: evidence.importedId }
      : await command({ type: 'import-workspace', data: backup })
    const restored = await snapshot()
    assert(restored.workspaces.some((item) => item.id === imported.id))
    for (const node of backup.nodes) {
      const actual = restored.nodes.find((item) => item.id === node.id)
      assert(actual)
      assert.equal(actual.parentId, node.parentId)
      assert.equal(actual.originReportId, node.originReportId)
      assert.deepEqual(actual.referenceReportIds, node.referenceReportIds)
    }
    for (const report of backup.reports) {
      const actual = restored.reports.find((item) => item.id === report.id)
      assert(actual)
      assert.equal(actual.markdown, report.markdown)
      assert.equal(actual.nodeId, report.nodeId)
    }
    const exported = await evaluate((id) => window.questbranch.exportWorkspace(id), imported.id)
    for (const field of ['reports', 'messages', 'runs'])
      assert.equal(exported[field].length, backup[field].length)
    assert(!restored.runs.some((run) => run.status === 'running'))
    assert(!restored.settings.hasApiKey)
    evidence.restoreInput = backupPath
    evidence.importedId = imported.id
    evidence.restored = {
      nodes: backup.nodes.length,
      reports: backup.reports.length,
      messages: backup.messages.length,
      runs: backup.runs.length,
      sourcesAndVersions: true,
      noCredentials: true,
    }
    evidence.cases = [
      'final executable import into a separate profile and database',
      'reports, conversations, origins and run records preserved',
      'no automatic execution or model credentials imported',
    ]
  } else if (previous) {
    const current = await snapshot()
    if (process.argv.includes('--saved-location')) {
      assert.equal(current.storage.source, 'project')
      assert.equal(resolve(current.storage.directory), resolve(research))
      assert.equal(resolve(current.storage.database), join(resolve(research), 'research.sqlite'))
      assert.equal(current.storage.legacy, true)
      evidence.savedStorageLocationPreserved = true
    }
    assert.equal(
      current.nodes.find((node) => node.id === evidence.manualChild).originReportId,
      evidence.r1,
    )
    assert.equal(
      current.nodes.find((node) => node.id === evidence.synthesis).parentId,
      evidence.manualChild,
    )
    const comparison = current.runs.find((run) => run.id === evidence.comparisonRun)
    assert(comparison.context.items.some((item) => item.reportId === evidence.r1 && item.included))
    for (const id of evidence.mcpNodeIds)
      assert.equal(current.nodes.find((node) => node.id === id).originReportId, evidence.r1)
    const before = current.nodes.length
    await configure('mcp-stdio')
    await run({
      type: 'send-message',
      nodeId: evidence.parentId,
      selectedReportId: evidence.r1,
      message: '重开后重试相同创建请求',
    })
    const mcp = JSON.parse(
      readFileSync(join(research, 'agent-workspace', 'fixture-mcp.json'), 'utf8'),
    )
    assert.deepEqual(mcp.nodeIds, evidence.mcpNodeIds)
    assert.equal((await snapshot()).nodes.length, before)
    evidence.reopenedAndRetried = true
    await capture('08-reopened')
  } else {
    const beforeCreation = await snapshot()
    assert(beforeCreation.activeProjectId, 'A desktop project must own the new research')
    await click(
      `[data-project-id="${beforeCreation.activeProjectId}"] [aria-label="在项目内新建研究"]`,
    )
    await until(() => evaluate(() => !!document.querySelector('.modal textarea')))
    await fill('.modal textarea', '隔离验收：怎样让研究分支承接确切的报告版本？')
    await clickText('创建研究', '.modal button')
    await until(() =>
      evaluate(() =>
        document.querySelector('.project-study-button.active')?.textContent.includes('隔离验收'),
      ),
    )
    let current = await snapshot()
    assert.equal(current.activeProjectId, beforeCreation.activeProjectId)
    assert.equal(current.workspaces.length, beforeCreation.workspaces.length + 1)
    const workspace = current.workspaces.find((item) => item.id === current.activeWorkspaceId),
      parentId = workspace.rootId
    assert(!beforeCreation.workspaces.some((item) => item.id === workspace.id))
    evidence.workspaceId = workspace.id
    evidence.parentId = parentId
    for (const selector of [
      '[aria-label="添加研究方向"]',
      '[aria-label="为当前研究添加方向"]',
      '[aria-label="添加同级方向"]',
    ])
      assert(await evaluate((selector) => document.querySelector(selector).disabled, selector))
    await capture('01-no-report-disabled')
    await configure('normal')
    await run({ type: 'send-message', nodeId: parentId, message: '先讨论问题，不整理报告' })
    assert.equal(
      (await snapshot()).reports.filter((report) => report.nodeId === parentId).length,
      0,
    )
    await until(() =>
      evaluate(() => document.querySelector('[aria-label="添加研究方向"]').disabled),
    )
    const first = await run({
      type: 'start-research',
      nodeId: parentId,
      instruction: '保存第一份阶段报告',
    })
    const second = await run({
      type: 'start-research',
      nodeId: parentId,
      instruction: '保存第二份阶段报告',
    })
    evidence.r1 = first.reportId
    evidence.r2 = second.reportId
    assert.notEqual(evidence.r1, evidence.r2)
    await until(() =>
      evaluate(() => !document.querySelector('[aria-label="添加研究方向"]').disabled),
    )
    await click('[aria-label="添加研究方向"]')
    await until(() => evaluate(() => !!document.querySelector('[aria-label="来源报告"]')))
    await fill('[aria-label="来源报告"]', evidence.r1)
    await fill('.modal textarea', '人工子方向 B：如何保留来源版本？')
    await capture('02-source-version-picker')
    await clickText('添加研究方向', '.modal button')
    await until(() => evaluate(() => !!document.querySelector('.report-origin')))
    current = await snapshot()
    evidence.manualChild = current.nodes.find((node) => node.parentId === parentId).id
    assert.equal(
      current.nodes.find((node) => node.id === evidence.manualChild).originReportId,
      evidence.r1,
    )
    assert(
      await evaluate(() => document.querySelector('[aria-label="为当前研究添加方向"]').disabled),
    )
    assert.equal(
      await evaluate(() => document.querySelector('[aria-label="为当前研究添加方向"]').title),
      '在当前节点对话中保存报告后，再添加方向。',
    )
    await evaluate(() => {
      const node = document.querySelector('.react-flow__node.selected')
      node.focus()
      node.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      )
    })
    assert(!(await evaluate(() => !!document.querySelector('.modal'))))
    await capture('03-child-origin-and-prerequisite')
    await click('.report-origin')
    await until(() =>
      evaluate(() =>
        document
          .querySelector('[aria-label="选择报告历史版本"]')
          ?.textContent.includes('历史版本 1'),
      ),
    )
    // Persist the latest version first, prepare a chat draft, then switch to v1
    // and send within one frame, before the 280 ms view persistence debounce.
    await click('[aria-label="选择报告历史版本"]')
    await evaluate(() => document.querySelector('.history-popover button').click())
    await click('.detail-tabs [role="tab"]')
    await fill('.research-composer textarea', '基于这份报告创建两个后续方向')
    await click('.detail-tabs [role="tab"]:nth-child(2)')
    await pause(500)
    await configure('mcp-http')
    await pause(500)
    await click('[aria-label="选择报告历史版本"]')
    const beforeRunIds = (await snapshot()).runs.map((run) => run.id)
    const race = await evaluate(
      async ({ workspaceId }) => {
        const start = performance.now()
        const choices = [...document.querySelectorAll('.history-popover button')]
        choices.find((button) => button.textContent.includes('历史报告 1')).click()
        document.querySelector('.detail-tabs [role="tab"]').click()
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const persisted = await window.questbranch.snapshot()
        const reportId =
          persisted.views[workspaceId].readers[persisted.views[workspaceId].selectedId]?.reportId
        const send = document.querySelector('[aria-label="发送消息"]')
        if (!send || send.disabled) throw new Error('Chat send did not become available')
        send.click()
        return { elapsedMs: performance.now() - start, persistedReportBeforeSend: reportId }
      },
      { workspaceId: workspace.id },
    )
    assert(race.elapsedMs < 280, `Immediate send exceeded debounce: ${race.elapsedMs}`)
    assert.equal(race.persistedReportBeforeSend, evidence.r2)
    const mcpRun = await until(async () =>
      (await snapshot()).runs.find((run) => !beforeRunIds.includes(run.id)),
    )
    const finished = await finish(mcpRun.id)
    assert.equal(finished.selectedReportId, evidence.r1)
    evidence.immediateSend = race
    const httpResult = JSON.parse(
      readFileSync(join(research, 'agent-workspace', 'fixture-mcp.json'), 'utf8'),
    )
    assert.equal(httpResult.selectedReportId, evidence.r1)
    assert.equal(httpResult.transport, 'http')
    evidence.mcpNodeIds = httpResult.nodeIds
    await until(() =>
      evaluate(
        (ids) => ids.every((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)),
        evidence.mcpNodeIds,
      ),
    )
    await until(() =>
      evaluate(() => document.querySelector('.details-panel').textContent.includes('创建研究方向')),
    )
    await capture('04-mcp-tools-and-live-graph')
    const count = (await snapshot()).nodes.length
    await configure('mcp-stdio')
    await run({
      type: 'send-message',
      nodeId: parentId,
      selectedReportId: evidence.r1,
      message: '重试相同方向创建',
    })
    const stdioResult = JSON.parse(
      readFileSync(join(research, 'agent-workspace', 'fixture-mcp.json'), 'utf8'),
    )
    assert.equal(stdioResult.transport, 'stdio')
    assert.deepEqual(stdioResult.nodeIds, evidence.mcpNodeIds)
    assert.equal((await snapshot()).nodes.length, count)
    await configure('mcp-wait')
    const waiting = await command({
      type: 'send-message',
      nodeId: parentId,
      selectedReportId: evidence.r1,
      message: '创建后等待确认',
    })
    await until(async () =>
      (await snapshot()).runs
        .find((run) => run.id === waiting.id)
        ?.agent?.requests.some((request) => request.status === 'pending'),
    )
    await command({ type: 'cancel-research', runId: waiting.id })
    assert.equal((await snapshot()).runs.find((run) => run.id === waiting.id).status, 'cancelled')
    await configure('normal')
    const childReport = await run({
      type: 'start-research',
      nodeId: evidence.manualChild,
      instruction: '研究子方向，保存自己的报告',
    })
    await click('[aria-label="分支比较"]')
    await until(() => evaluate(() => !!document.querySelector('[aria-label="研究方向 A"]')))
    await fill('[aria-label="研究方向 A"]', childReport.reportId)
    await fill('[aria-label="研究方向 B"]', evidence.r1)
    assert(
      await evaluate(() =>
        document
          .querySelector('.comparison-config > .compare-version')
          .textContent.includes('人工子方向 B'),
      ),
    )
    await capture('05-comparison-ownership')
    const beforeIds = (await snapshot()).nodes.map((node) => node.id)
    await clickText('开展综合研究', '.modal button')
    const synthesis = await until(async () =>
      (await snapshot()).nodes.find((node) => !beforeIds.includes(node.id)),
    )
    evidence.synthesis = synthesis.id
    assert.equal(synthesis.parentId, evidence.manualChild)
    assert.equal(synthesis.originReportId, childReport.reportId)
    assert.deepEqual(
      new Set(synthesis.referenceReportIds),
      new Set([childReport.reportId, evidence.r1]),
    )
    const comparisonRun = await until(async () =>
      (await snapshot()).runs.find((run) => run.nodeId === synthesis.id),
    )
    const compared = await finish(comparisonRun.id)
    evidence.comparisonRun = compared.id
    assert(compared.context.items.some((item) => item.reportId === evidence.r1 && item.included))
    assert(!compared.context.items.some((item) => item.reportId === evidence.r2))
    await capture('06-comparison-result')
    const exported = await evaluate((id) => window.questbranch.exportWorkspace(id), workspace.id)
    assert(exported.branchRequests.length >= 3)
    assert(!JSON.stringify(exported).includes('QUESTBRANCH_MCP_TOKEN'))
    writeFileSync(join(folder, 'research.questbranch.json'), JSON.stringify(exported, null, 2))
    await evaluate(() => {
      localStorage.setItem('questbranch-theme', 'dark')
      location.reload()
    })
    await until(() =>
      evaluate(
        () =>
          document.documentElement?.dataset.theme === 'dark' &&
          !!document.querySelector('.report-origin'),
      ),
    )
    await pause(300)
    await capture('07-dark-source')
    evidence.windowMetrics = await evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      bodyWidth: document.body.scrollWidth,
      composer: !!document.querySelector('.research-composer textarea'),
    }))
    assert(evidence.windowMetrics.bodyWidth <= evidence.windowMetrics.width + 1)
    evidence.cases = [
      'no-report prerequisite',
      'chat is not a report',
      'historical source version picker',
      'source navigation',
      'keyboard prerequisite',
      'immediate version switch and send',
      'real HTTP MCP via ACP',
      'real stdio MCP via ACP',
      'live graph refresh',
      'idempotent retry',
      'cancel',
      'own report before next level',
      'ACP comparison ownership and materials',
      'isolated export',
      'dark source navigation',
    ]
  }
  await quitOwnedApp()
  const code = await Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('App did not exit normally')), 8000).unref(),
    ),
  ])
  assert.equal(code, 0)
  Object.assign(evidence, {
    executable,
    fixtureExecutable: packaged.executable,
    actualPackagedExecutable: true,
    isolatedDatabase: true,
    isolatedNativeHome: true,
    noRealModelOrLogin: true,
    normalExit: true,
    verifiedAt: new Date().toISOString(),
  })
  writeFileSync(join(folder, 'result.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ folder, success: true, reopened: !!previous }))
} catch (error) {
  writeFileSync(join(folder, 'failed.txt'), error.stack + '\n' + logs)
  console.error(error.stack, folder)
  if (evaluate) {
    try {
      const current = await snapshot()
      for (const run of current.runs.filter((run) => run.status === 'running'))
        await command({ type: 'cancel-research', runId: run.id })
      await capture('failed')
      await quitOwnedApp()
    } catch {
      /* Preserve the diagnostic from the original failure. */
    }
  }
  process.exitCode = 1
} finally {
  socket?.close()
  if (!childStopped) {
    const stopped = await Promise.race([exited.then(() => true), pause(2000).then(() => false)])
    // Only the exact test child spawned above, with its isolated profile, may be
    // terminated after a failed graceful close. Never enumerate/kill user apps.
    if (!stopped) {
      child.kill()
      await Promise.race([exited, pause(2000)])
    }
  }
}
