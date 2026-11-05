import { app, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const option = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
mkdirSync(resolve('artifacts/research-polish'), { recursive: true })
const reopen = option('reopen')
const folder = reopen ? resolve(reopen) : mkdtempSync(resolve('artifacts/research-polish/check-'))
assert(folder.startsWith(resolve('artifacts/research-polish') + sep))
const profile = join(folder, 'profile')
if (!reopen) mkdirSync(profile)
app.setPath('userData', profile)
process.env.QUESTBRANCH_DATA_DIR = join(folder, 'research')
for (const key of ['TAVILY_API_KEY', 'OPENAI_API_KEY', 'ELECTRON_RENDERER_URL'])
  delete process.env[key]
app.disableHardwareAcceleration()
const packageRoot = option('package-root')
const appRoot = packageRoot ? resolve(packageRoot, 'resources/app.asar') : resolve('.')
const requests = [],
  commands = []
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    assert(!channel.startsWith('models:auth-'), 'No account connection in isolated QA')
    if (channel === 'research:command') commands.push(args[1])
    return listener(...args)
  })
const output = {
  title: '隔离固定响应：按共同维度比较',
  summary: '验证所选报告版本与比较表保存。',
  findings: ['本内容为本机固定响应，不是模型研究结论。'],
  openQuestions: ['真实研究内容质量仍需实际使用验证。'],
  followups: [],
  report:
    '## 比较\n\n本机固定响应，仅验证报告渲染与版本引用。\n\n| 共同维度 | 方案 A | 方案 B | 一致、冲突与互补 |\n| --- | --- | --- | --- |\n| 隐私边界 | 来自所选旧版；条件：个人使用；未知：外部泄露；依据：polish-a-old | 来自所选 B；条件：本地运行；未知：远程检索；依据：polish-b | 存在待核查的差异 |\n| 维护成本 | 结论与条件待核查 | 结论与条件待核查 | 不打分 |',
}
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.headers.host, `127.0.0.1:${server.address().port}`)
    assert.equal(request.url, '/v1/chat/completions')
    const buffers = []
    for await (const chunk of request) buffers.push(chunk)
    const body = JSON.parse(Buffer.concat(buffers).toString())
    requests.push(body)
    assert.equal(body.model, 'fixture-model')
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(
      `data: ${JSON.stringify({ id: 'fixture-comparison', model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: null }] })}\n\n`,
    )
    response.write(
      `data: ${JSON.stringify({ id: 'fixture-comparison', model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    )
    response.end('data: [DONE]\n\n')
  } catch (error) {
    response.writeHead(500).end(String(error))
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const now = '2026-10-22T00:00:00Z',
  wid = 'polish-workspace',
  rootId = 'polish-root'
const base = {
  workspaceId: wid,
  title: '研究方向',
  question: '研究问题',
  summary: '阶段认识与条件尚待验证，完整内容保留在报告中。',
  openQuestions: ['哪些条件尚未覆盖？'],
  relatedIds: [],
  color: '#568e78',
  createdAt: now,
  updatedAt: now,
}
const nodes = [
  { ...base, id: rootId, parentId: null, title: '如何让长期研究保留清晰的问题结构与上下文？' },
]
for (let branch = 0; branch < 6; branch++) {
  const id = `branch-${branch}`
  nodes.push({
    ...base,
    id,
    parentId: rootId,
    title:
      branch % 2
        ? `研究方向 ${branch}`
        : `方向${branch}：如何在跨平台研究工作空间中保留长期探索的问题背景并合理降低维护成本？`,
    relatedIds: branch === 0 ? ['leaf-2-0'] : [],
  })
  for (let leaf = 0; leaf < (branch === 0 ? 14 : branch === 2 ? 12 : 1); leaf++)
    nodes.push({
      ...base,
      id: `leaf-${branch}-${leaf}`,
      parentId: id,
      title:
        leaf % 3
          ? `分支 ${branch} 的问题 ${leaf}`
          : `分支${branch}：研究资料出现不一致时，如何保留各自的来源、条件与未知事项？`,
    })
}
for (let depth = 0; depth < 6; depth++)
  nodes.push({
    ...base,
    id: `deep-${depth}`,
    parentId: depth ? `deep-${depth - 1}` : 'leaf-0-0',
    title: `深入问题 ${depth}：对长期维护与阅读位置进行连续验证`,
  })
function report(id, nodeId, createdAt, marker) {
  return {
    id,
    nodeId,
    workspaceId: wid,
    title: `${nodeId} 的阶段报告`,
    markdown: `## 认识\n\n${marker}`,
    summary: '供比较的阶段认识，条件与未知项继续保留。',
    findings: ['这是固定资料中的主张，仍有适用条件。'],
    openQuestions: ['缺失资料需要后续核查。'],
    sources: [
      {
        id: `${id}-source`,
        title: '合成来源',
        url: 'https://example.com/research-fixture',
        excerpt: '仅为隔离验收资料。',
      },
    ],
    origin: 'import',
    model: 'fixture',
    createdAt,
  }
}
const reports = [
  report('polish-a-old', 'branch-0', now, 'OLD_VERSION_SELECTED'),
  report('polish-a-new', 'branch-0', '2026-10-22T01:00:00Z', 'NEW_VERSION_MUST_NOT_LEAK'),
  report('polish-b', 'branch-2', now, 'SELECTED_B_MATERIAL'),
]
const fixture = {
  schemaVersion: 2,
  workspace: {
    id: wid,
    name: '图谱与比较 · 隔离验收',
    rootId,
    question: nodes[0].title,
    objective: '检查图谱与比较',
    constraints: '仅合成资料和固定本地响应',
    createdAt: now,
    updatedAt: now,
  },
  nodes,
  reports,
  messages: [],
  runs: [],
  edits: [],
  view: {
    selectedId: 'branch-0',
    collapsed: ['branch-2'],
    drafts: {},
    readers: { 'branch-0': { tab: 'report', reportId: 'polish-a-old' } },
  },
}
const timeout = setTimeout(() => app.exit(1), 180000)
app.on('browser-window-created', (_, window) => {
  window.setContentSize(1440, 900)
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    const evaluate = (fn, value) =>
      window.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value)})`)
    const pause = (ms = 200) => new Promise((done) => setTimeout(done, ms))
    const wait = async (fn) => {
      for (let n = 0; n < 160; n++) {
        if (await fn()) return
        await pause(80)
      }
      throw Error('UI timeout')
    }
    const snapshot = () => evaluate(() => window.questbranch.snapshot())
    const view = async () => {
      await pause(650)
      return (await snapshot()).views[wid]
    }
    const click = async (selector) => {
      await evaluate((selector) => {
        const element = document.querySelector(selector)
        if (!element || element.disabled) throw Error('Unavailable: ' + selector)
        element.click()
      }, selector)
      await pause()
    }
    const fill = async (selector, value) => {
      await evaluate(
        ({ selector, value }) => {
          const element = document.querySelector(selector)
          const prototype =
            element.tagName === 'SELECT'
              ? HTMLSelectElement.prototype
              : HTMLTextAreaElement.prototype
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
          element.dispatchEvent(
            new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
          )
        },
        { selector, value },
      )
      await pause(100)
    }
    const setTheme = async (theme) => {
      await click('[aria-label="设置"]')
      await click(`[aria-label="${theme === 'dark' ? '深色' : '亮色'}主题"]`)
      await click('.settings-modal [aria-label="关闭对话框"]')
    }
    const cases = []
    const capture = async (name) => {
      await pause(300)
      writeFileSync(join(folder, `${name}.png`), (await window.webContents.capturePage()).toPNG())
      cases.push(name)
    }
    const camera = (view) =>
      view.graph?.scenes?.find(
        (scene) =>
          scene.mode === (view.graph.mode ?? 'horizontal') &&
          scene.detail === (view.graph.detail ?? 'summary') &&
          scene.focusId === view.graph.focusId,
      )?.viewport ?? view.viewport
    const sameCamera = (a, b) =>
      assert(
        Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.zoom - b.zoom) < 0.005,
        'Camera restoration',
      )
    try {
      await wait(() => evaluate(() => !!document.querySelector('.graph-tools')))
      if (reopen) {
        const expected = JSON.parse(readFileSync(join(folder, 'verified.json'), 'utf8')),
          data = await snapshot(),
          current = await view()
        assert.deepEqual(current.graph.branchSides, expected.finalView.graph.branchSides)
        assert.equal(current.selectedId, expected.finalView.selectedId)
        assert.equal(data.runs.find((run) => run.id === expected.runId).status, 'completed')
        assert.equal(current.readers['branch-0'].reportId, 'polish-a-old')
        assert.equal(requests.length, 0)
        writeFileSync(
          join(folder, 'reopened.json'),
          JSON.stringify(
            {
              appRoot,
              passed: true,
              branchSides: true,
              selectedReportVersion: true,
              completedComparison: true,
              noModelRequest: true,
            },
            null,
            2,
          ),
        )
      } else {
        await evaluate(async (fixture) => {
          await window.questbranch.command({ type: 'import-workspace', data: fixture })
          localStorage.setItem('questbranch-workspace', fixture.workspace.id)
        }, fixture)
        window.webContents.reload()
        await pause(400)
        await wait(() => evaluate(() => !!document.querySelector('[data-testid="node-branch-0"]')))
        await evaluate(() => {
          window.__dock = document.querySelector('.graph-tools')
        })
        const before = await snapshot()
        assert(
          await evaluate(() =>
            document.querySelector('.history-menu > button').textContent.includes('历史版本 1'),
          ),
          'Report reader version agrees with comparison picker',
        )
        for (const theme of ['light', 'dark']) {
          await setTheme(theme)
          for (const mode of ['中心导图', '横向图']) {
            await click(`[aria-label="${mode}"]`)
            for (const detail of ['summary', 'compact']) {
              const current = await view()
              if ((current.graph?.detail ?? 'summary') !== detail)
                await click('[aria-label="显示阶段摘要"]')
              await click('[aria-label="定位当前研究"]')
              await pause(350)
              assert(await evaluate(() => window.__dock === document.querySelector('.graph-tools')))
              const titles = await evaluate(() =>
                [...document.querySelectorAll('.research-card')].map((card) => ({
                  title: card.querySelector('h3').getBoundingClientRect().height,
                  height: card.getBoundingClientRect().height,
                  overflow: card.scrollHeight > card.clientHeight + 2,
                })),
              )
              assert(
                titles.some((item) => item.title >= 38),
                'Long Chinese titles wrap',
              )
              assert(
                titles.every((item) => !item.overflow),
                'Cards do not clip their own contents',
              )
              await capture(`${theme}-${mode}-${detail}`)
            }
          }
        }
        const savedSides = (await view()).graph.branchSides
        assert.notEqual(
          savedSides['branch-0'],
          savedSides['branch-2'],
          'Heavy branches balance both sides',
        )
        await click('[data-testid="node-branch-2"] .branch-toggle')
        await click('[aria-label="中心导图"]')
        await click('[aria-label="查看全图"]')
        await pause(450)
        await capture('balanced-mindmap-overview')
        const ports = await evaluate(() => {
          const issues = []
          for (const [parent, child] of [
            ['branch-0', 'leaf-0-1'],
            ['branch-2', 'leaf-2-1'],
            ['leaf-0-0', 'deep-0'],
          ]) {
            const edge = document.querySelector(
              `[data-testid="rf__edge-${parent}-${child}"] .react-flow__edge-path`,
            )
            if (!edge) {
              issues.push('missing ' + child)
              continue
            }
            const start = edge.getPointAtLength(0),
              end = edge.getPointAtLength(edge.getTotalLength()),
              transform = edge.getScreenCTM(),
              a = new DOMPoint(start.x, start.y).matrixTransform(transform),
              b = new DOMPoint(end.x, end.y).matrixTransform(transform),
              source = document
                .querySelector(`.react-flow__node[data-id="${parent}"]`)
                .getBoundingClientRect(),
              target = document
                .querySelector(`.react-flow__node[data-id="${child}"]`)
                .getBoundingClientRect(),
              right = target.x >= source.x
            if (
              Math.abs(a.x - (right ? source.right : source.left)) > 4 ||
              Math.abs(b.x - (right ? target.left : target.right)) > 4 ||
              Math.abs(a.y - (source.top + source.height / 2)) > 4 ||
              Math.abs(b.y - (target.top + target.height / 2)) > 4
            )
              issues.push('misaligned ' + child)
          }
          return issues
        })
        assert.deepEqual(ports, [], 'Tree connectors meet the facing card edges')
        await click('[aria-label="恢复自动布局"]')
        for (const field of ['nodes', 'reports', 'runs', 'messages'])
          assert.deepEqual((await snapshot())[field], before[field])
        await click('[aria-label="显示阶段摘要"]')
        // Save a manual card position using the normal storage boundary, then reopen it.
        await evaluate(async (wid) => {
          const data = await window.questbranch.snapshot(),
            view = data.views[wid]
          const mode = view.graph.mode,
            detail = view.graph.detail,
            focusId = view.graph.focusId
          const scene = view.graph.scenes.find(
            (scene) => scene.mode === mode && scene.detail === detail && scene.focusId === focusId,
          )
          scene.positions = { ...scene.positions, 'leaf-0-0': { x: 1200, y: -600 } }
          view.collapsed = ['branch-2']
          view.revision = Date.now() + 10
          await window.questbranch.command({ type: 'save-view', workspaceId: wid, view })
        }, wid)
        window.webContents.reload()
        await pause(400)
        await wait(() => evaluate(() => !!document.querySelector('[data-testid="node-branch-0"]')))
        const original = await view()
        await setTheme('light')
        await click('[aria-label="查看相关研究"]')
        assert(
          await evaluate(() =>
            document.querySelector('.related-popover').textContent.includes('已折叠'),
          ),
        )
        await capture('related-folded-target')
        await click('[data-related-id="leaf-2-0"]')
        let current = await view()
        assert.equal(current.selectedId, 'leaf-2-0')
        assert(!current.collapsed.includes('branch-2'))
        await click('[aria-label="查看相关研究"]')
        assert(
          await evaluate(() => !!document.querySelector('[data-related-id="branch-0"]')),
          'Incoming relation is discoverable',
        )
        await evaluate(() => document.querySelector('.related-trigger').click())
        await click('[aria-label="返回上一视图"]')
        current = await view()
        assert.equal(current.selectedId, 'branch-0')
        assert.deepEqual(current.collapsed, original.collapsed)
        sameCamera(camera(current), camera(original))
        await click('[aria-label="聚焦当前分支"]')
        const focused = await view()
        await setTheme('dark')
        await click('[aria-label="查看相关研究"]')
        assert(
          await evaluate(() =>
            document.querySelector('.related-popover').textContent.includes('当前分支外'),
          ),
        )
        await capture('related-outside-focus')
        await click('[data-related-id="leaf-2-0"]')
        assert.equal((await view()).graph.focusId, undefined)
        await click('[aria-label="返回上一视图"]')
        current = await view()
        assert.equal(current.graph.focusId, 'branch-0')
        sameCamera(camera(current), camera(focused))
        assert.equal(current.readers['branch-0'].reportId, 'polish-a-old')
        for (const [id, side] of Object.entries(savedSides))
          assert.equal(current.graph.branchSides[id], side)
        for (const field of ['nodes', 'reports', 'runs', 'messages'])
          assert.deepEqual((await snapshot())[field], before[field])
        for (const [width, zoom] of [
          [1050, 1],
          [1440, 2],
        ]) {
          window.setContentSize(width, 1000)
          window.webContents.setZoomFactor(zoom)
          assert.equal(window.webContents.getZoomFactor(), zoom)
          await pause(300)
          const map = await evaluate(() => {
            const button = document.querySelector('[aria-label="研究图谱"]')
            if (button?.getBoundingClientRect().width) button.click()
            return true
          })
          assert(map)
          await capture(`narrow-${width}-zoom-${zoom}`)
          assert(await evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        }
        window.setContentSize(1440, 900)
        window.webContents.setZoomFactor(1)
        await pause(250)
        await evaluate(
          async (baseUrl) =>
            window.questbranch.command({
              type: 'save-settings',
              settings: {
                provider: 'compatible',
                modelProvider: 'custom',
                apiProtocol: 'openai-chat',
                baseUrl,
                model: 'fixture-model',
                modelContextWindow: 128000,
                sessionStrategy: 'portable',
                apiKey: 'fixture-key',
                jsonMode: false,
                contextBudget: 12000,
              },
            }),
          `http://127.0.0.1:${server.address().port}/v1`,
        )
        await pause(900)
        await setTheme('light')
        await click('[aria-label="分支比较"]')
        await fill('[aria-label="研究方向 A"]', 'polish-a-old')
        await fill('[aria-label="研究方向 B"]', 'polish-b')
        await fill('[aria-label="共同比较维度"]', '隐私边界\n维护成本')
        await capture('comparison-versions-and-dimensions')
        await click('[role="dialog"] [aria-label="关闭对话框"]')
        await setTheme('dark')
        await click('[aria-label="分支比较"]')
        await fill('[aria-label="研究方向 A"]', 'polish-a-old')
        await fill('[aria-label="研究方向 B"]', 'polish-b')
        await fill('[aria-label="共同比较维度"]', '隐私边界\n维护成本')
        await capture('comparison-dark')
        window.setContentSize(1050, 800)
        await pause(250)
        await capture('comparison-narrow')
        window.setContentSize(1440, 1000)
        window.webContents.setZoomFactor(2)
        await pause(300)
        await evaluate(() =>
          document.querySelector('[role="dialog"] .modal-footer').scrollIntoView({ block: 'end' }),
        )
        assert(await evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        await capture('comparison-200-percent')
        window.setContentSize(1440, 900)
        window.webContents.setZoomFactor(1)
        await pause(250)
        await evaluate(() =>
          [...document.querySelectorAll('[role="dialog"] button')]
            .find((button) => button.textContent.includes('开展综合研究'))
            .click(),
        )
        await wait(async () => {
          const runs = (await snapshot()).runs
          const failed = runs.find((run) => run.status === 'failed')
          assert(!failed, failed?.error)
          return runs.some((run) => run.status === 'completed')
        })
        const data = await snapshot(),
          run = data.runs.find((run) => run.status === 'completed')
        assert.equal(requests.length, 1)
        const serialized = JSON.stringify(requests[0])
        assert(serialized.includes('OLD_VERSION_SELECTED'))
        assert(!serialized.includes('NEW_VERSION_MUST_NOT_LEAK'))
        assert(serialized.includes('隐私边界'))
        assert.deepEqual(
          run.context.items
            .filter((item) => item.reason.includes('用户明确指定'))
            .map((item) => item.reportId),
          ['polish-a-old', 'polish-b'],
        )
        assert(
          run.context.items
            .filter((item) => item.reason.includes('用户明确指定'))
            .every((item) => item.included),
        )
        assert.equal(data.views[wid].readers['branch-0'].reportId, 'polish-a-old')
        for (const report of reports)
          assert.deepEqual(
            data.reports.find((item) => item.id === report.id),
            report,
          )
        await click('.detail-tabs [id$="-tab-report"]')
        await wait(() => evaluate(() => !!document.querySelector('.markdown table')))
        await capture('comparison-report-table')
        const finalView = await view()
        writeFileSync(
          join(folder, 'verified.json'),
          JSON.stringify(
            {
              appRoot,
              cases,
              nodes: nodes.length,
              runId: run.id,
              finalView,
              commands: commands.map((command) => command.type),
              fixedLocalRequests: requests.length,
              realModelRequests: 0,
              isolatedProfile: true,
              researchInputVerified: true,
              reportVersionsPreserved: true,
              relationRoundTrips: 2,
              manualPositionsPreserved: Object.values(finalView.graph.scenes).some(
                (scene) => scene.positions?.['leaf-0-0']?.x === 1200,
              ),
              longChineseCards: true,
              heavyBranchesBalanced: true,
              noUserDatabase: true,
            },
            null,
            2,
          ),
        )
      }
      console.log(
        JSON.stringify({
          folder,
          reopened: !!reopen,
          cases: cases.length,
          requests: requests.length,
        }),
      )
      clearTimeout(timeout)
      server.close()
      app.quit()
    } catch (error) {
      writeFileSync(join(folder, 'failed.txt'), error.stack)
      writeFileSync(join(folder, 'failure.png'), (await window.webContents.capturePage()).toPNG())
      console.error(error.stack)
      console.error(folder)
      clearTimeout(timeout)
      server.close()
      app.exit(1)
    }
  })
})
await import(pathToFileURL(join(appRoot, 'out/main/index.js')).href)
