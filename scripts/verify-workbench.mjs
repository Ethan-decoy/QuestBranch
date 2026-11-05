import { app } from 'electron'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { selectResearchNode, verifyResearchViews } from './verify-research-views.mjs'

// Run against supplied research prose in a new profile. Never open a daily database
// or request model output. Extra versions and branches are labelled acceptance samples.
const reopen = process.argv.find((value) => value.startsWith('--reopen='))?.slice(9)
const previous = reopen
  ? JSON.parse(readFileSync(join(resolve(reopen), 'verified.json'), 'utf8'))
  : null
if (reopen)
  assert(
    resolve(reopen).startsWith(resolve('artifacts') + sep) &&
      basename(resolve(reopen)).startsWith('workbench-verification-'),
    'Only reopen a completed isolated verification profile',
  )
const input =
  process.argv.find((value) => value.startsWith('--workspace='))?.slice(12) ?? previous?.sample
if (!input) throw new Error('Supply --workspace=<exported .questbranch.json>')
const source = JSON.parse(readFileSync(resolve(input), 'utf8'))
assert.equal(source.nodes.length, 6, 'Use the original six-node audit sample')
const rootId = source.workspace.rootId
const longId =
  source.nodes.find((node) => node.id !== rootId && node.question.length > 180)?.id ??
  source.nodes[2].id
const original = source.reports.find((report) => report.nodeId === rootId)
assert(original?.markdown.includes('|'), 'Use the original report with its table')
const older = {
  ...original,
  id: `${original.id}-acceptance-older`,
  title: '阅读状态验收副本 · 历史版本',
  createdAt: '2026-01-01T00:00:00.000Z',
  model: '验收副本（不调用模型）',
}
source.reports.push(older)
// Fixture reports give the audit's original directions a real saved basis for
// the later dense-tree interaction. They are labelled samples, never model output.
for (const node of source.nodes.filter((node) => node.parentId === rootId))
  if (!source.reports.some((report) => report.nodeId === node.id))
    source.reports.push({
      ...original,
      id: `${node.id}-acceptance-report`,
      nodeId: node.id,
      title: '隔离验收样本报告',
      model: '验收副本（不调用模型）',
      origin: 'import',
      runId: undefined,
    })
if (process.argv.includes('--views') || previous?.interactions?.researchViews) {
  older.markdown +=
    '\n\n## 隔离验收材料\n\nQBX21 历史材料定位验收：此段仅用于检验从搜索返回指定报告版本。'
  older.sources = [
    {
      id: 'qbx21-reference',
      title: '隔离验收来源',
      url: 'https://example.org/qbx21',
      excerpt: 'QBX21 来源摘录定位验收：仅作为本地定位样本，不请求外部资料。',
    },
  ]
}
source.workspace.name = '工作台验收 · 隔离副本'
source.view = { selectedId: rootId, collapsed: [], drafts: {}, chatDrafts: {} }
mkdirSync(resolve('artifacts'), { recursive: true })
const folder = reopen ? resolve(reopen) : mkdtempSync(resolve('artifacts/workbench-verification-'))
const profile = join(folder, 'profile')
if (!reopen) mkdirSync(profile)
app.setPath('userData', profile)
app.disableHardwareAcceleration()
delete process.env.QUESTBRANCH_DATA_DIR
const results = {
  version: JSON.parse(readFileSync(resolve('package.json'))).version,
  folder,
  profile,
  sample: resolve(input),
  packaged: process.argv.includes('--packaged'),
  noModelRequests: true,
  cases: [],
  interactions: {},
}
const timeout = setTimeout(() => {
  console.error('Workbench verification timed out')
  app.exit(1)
}, 240000)

function measure() {
  const rect = (selector) => {
    const e = document.querySelector(selector)
    if (!e) return null
    const r = e.getBoundingClientRect()
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      scrollTop: e.scrollTop,
      scrollWidth: e.scrollWidth,
      clientWidth: e.clientWidth,
      clientHeight: e.clientHeight,
      scrollHeight: e.scrollHeight,
    }
  }
  const canvas = document.querySelector('.flow-surface').getBoundingClientRect()
  const cards = [...document.querySelectorAll('.research-card')].map((card) => {
    const r = card.getBoundingClientRect()
    return {
      id: card.dataset.testid,
      fullyVisible:
        r.left >= canvas.left - 1 &&
        r.right <= canvas.right + 1 &&
        r.top >= canvas.top - 1 &&
        r.bottom <= canvas.bottom + 1,
    }
  })
  const active = document.querySelector('.detail-tabs [aria-selected="true"]')
  return {
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    theme: document.documentElement.dataset.theme,
    tab: active?.textContent.trim(),
    reader: rect('.detail-body'),
    canvas: rect('.flow-surface'),
    navigation: rect('.sidebar-navigation'),
    report: rect('.report-markdown'),
    topbar: rect('.topbar'),
    secondaryToolbar: rect('.workspace-toolbar'),
    title: rect('.detail-title'),
    composer: rect('.research-composer'),
    input: rect('.research-composer textarea'),
    details: rect('.details-panel'),
    inputVisible: !!document.querySelector('.research-composer textarea')?.getBoundingClientRect()
      .height,
    inputCollapseControl: !!document.querySelector(
      '.composer-bar, .research-composer [aria-expanded]',
    ),
    table: rect('.table-scroll'),
    tableHeaders: [...document.querySelectorAll('.report-markdown th')].map((e) => ({
      text: e.textContent,
      width: e.getBoundingClientRect().width,
    })),
    documentOverflow: {
      x: document.documentElement.scrollWidth > innerWidth,
      y: document.documentElement.scrollHeight > innerHeight,
    },
    graphHidden: document.querySelector('.graph-slot').hidden,
    cards,
    transform: document.querySelector('.react-flow__viewport')?.style.transform,
    separator: rect('[aria-label="调整报告区域宽度"]'),
    tabStops: [...document.querySelectorAll('.detail-tabs [role="tab"]')].filter(
      (e) => e.tabIndex === 0,
    ).length,
    tabPanelLinked:
      !!active &&
      document
        .getElementById(active.getAttribute('aria-controls'))
        ?.getAttribute('aria-labelledby') === active.id,
  }
}

app.on('browser-window-created', (_, window) => {
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    const evaluate = (fn, value) =>
      window.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value)})`)
    const pause = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms))
    const ready = () =>
      evaluate(async () => {
        const deadline = Date.now() + 10000
        while (!document.querySelector('.research-card')) {
          if (Date.now() > deadline) throw Error('Renderer not ready')
          await new Promise((r) => setTimeout(r, 30))
        }
      })
    const click = async (selector) => {
      const themeChoice = /^\[aria-label="(亮色|深色)主题"\]$/.test(selector)
      if (themeChoice) {
        await evaluate(() => document.querySelector('[aria-label="设置"]').click())
        await pause()
      }
      await evaluate((selector) => {
        const e = document.querySelector(selector)
        if (!e) throw Error(`Missing ${selector}`)
        e.click()
      }, selector)
      await pause()
      if (themeChoice) {
        await evaluate(() =>
          document.querySelector('.settings-modal [aria-label="关闭对话框"]').click(),
        )
        await pause()
      }
    }
    const tab = async (name) => click(`.detail-tabs [id$="-tab-${name}"]`)
    const key = async (name) => {
      window.focus()
      window.webContents.focus()
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: name })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: name })
      await pause(80)
    }
    const select = async (id) => {
      await evaluate((id) => document.querySelector(`[data-testid="node-${id}"]`).click(), id)
      await pause()
    }
    const capture = async (name) => {
      await pause(250)
      const metrics = await evaluate(measure)
      assert(!metrics.inputCollapseControl, 'Input has no collapse/expand control')
      if (metrics.details.width && metrics.details.height) {
        assert(metrics.inputVisible && metrics.input.height >= 48, 'Fixed input remains usable')
        const expected = Math.max(132, Math.min(220, metrics.details.height * 0.22))
        assert(
          Math.abs(metrics.composer.height - expected) < 2,
          'Input retains its bounded 22% proportion',
        )
        assert(
          metrics.reader.y + metrics.reader.height <= metrics.composer.y + 1,
          'Reader and input do not overlap',
        )
      }
      results.cases.push({ name, ...metrics })
      writeFileSync(join(folder, `${name}.png`), (await window.webContents.capturePage()).toPNG())
      return metrics
    }
    const check = (condition, message) => {
      assert(condition, message)
    }
    try {
      await ready()
      if (reopen) {
        await pause(350)
        const m = await evaluate(measure),
          view = await evaluate(async () => {
            const s = await window.questbranch.snapshot()
            return s.views[localStorage.getItem('questbranch-workspace')]
          })
        check(
          m.tab === '研究报告' && Math.abs(m.reader.scrollTop - 450) < 3,
          'A02: actual process restart restores the report position',
        )
        check(
          view.chatDrafts[longId]?.includes('验收草稿') &&
            view.readers[rootId].reportId === older.id,
          'A02: process restart preserves draft and selected report version',
        )
        if (previous.interactions.researchViews) {
          check(
            view.graph?.mode === previous.interactions.researchViews.mode &&
              view.graph?.detail === previous.interactions.researchViews.detail &&
              JSON.stringify(view.graph?.history) ===
                JSON.stringify(previous.interactions.researchViews.history),
            'Views: actual process restart restores the layout, detail and return history',
          )
        }
        await capture('09-process-reopened')
        writeFileSync(
          join(folder, 'reopened.json'),
          JSON.stringify(
            {
              version: results.version,
              packaged: results.packaged,
              tab: m.tab,
              scrollTop: m.reader.scrollTop,
              draftPreserved: true,
              reportVersionPreserved: true,
            },
            null,
            2,
          ),
        )
        clearTimeout(timeout)
        console.log(JSON.stringify({ folder, processRestartPassed: true }))
        app.quit()
        return
      }
      await evaluate(async (data) => {
        data.view = { selectedId: data.workspace.rootId, collapsed: [], drafts: {}, ...data.view }
        data.view.readers = {
          ...data.view.readers,
          [data.workspace.rootId]: {
            ...data.view.readers?.[data.workspace.rootId],
            tab: 'report',
            composerOpen: false,
          },
        }
        await window.questbranch.command({ type: 'import-workspace', data })
        await window.questbranch.command({
          type: 'save-settings',
          settings: {
            provider: 'account',
            modelProvider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            model: '',
            jsonMode: false,
            contextBudget: 16000,
          },
        })
        localStorage.setItem('questbranch-workspace', data.workspace.id)
      }, source)
      window.webContents.reload()
      await new Promise((resolve) => window.webContents.once('did-finish-load', resolve))
      await ready()
      window.setContentSize(1440, 900)
      await pause(300)
      check(
        (await evaluate(measure)).tab === '研究报告',
        'A02: initial report must open when a report exists, even with an account connection',
      )
      const initialWorkbench = await capture('01-light-report-six-nodes')
      if (process.argv.includes('--density')) {
        const selectedBefore = await evaluate(
          () => document.querySelector('.research-card.is-selected').dataset.testid,
        )
        await click('[aria-label="收起工作空间导航"]')
        const hiddenNavigation = await capture('01b-light-navigation-collapsed')
        check(
          await evaluate(() => document.querySelector('.sidebar').hidden),
          'Density: desktop navigation collapses',
        )
        check(
          hiddenNavigation.canvas.width > initialWorkbench.canvas.width + 150,
          'Density: collapsing navigation returns width to the graph',
        )
        await click('[aria-label="展开工作空间导航"]')
        check(
          await evaluate(
            (id) => document.querySelector('.research-card.is-selected').dataset.testid === id,
            selectedBefore,
          ),
          'Density: navigation collapse preserves the selected research',
        )
        check(
          await evaluate(() =>
            [
              ...document.querySelectorAll(
                '.topbar button, .sidebar-bottom button, .graph-tools button',
              ),
            ]
              .filter((e) => e.getBoundingClientRect().width > 0)
              .every((e) => {
                const r = e.getBoundingClientRect()
                return (
                  r.width >= 31 &&
                  r.height >= 31 &&
                  !!(e.getAttribute('aria-label') || e.textContent.trim())
                )
              }),
          ),
          'Density: compact controls retain usable targets and accessible names',
        )
        check(
          await evaluate(() =>
            [...document.querySelectorAll('.research-card p')].every(
              (e) => e.clientHeight >= parseFloat(getComputedStyle(e).lineHeight) * 2 - 0.5,
            ),
          ),
          'Density: card summaries keep two complete lines at the normal reading scale',
        )
        for (const selector of ['.question-context', '.report-overview', '.report-toc']) {
          await click(`${selector} > summary`)
          check(
            await evaluate((selector) => document.querySelector(selector).open, selector),
            'Density: report disclosures remain available',
          )
          await click(`${selector} > summary`)
        }
        results.interactions.navigationCollapse = {
          focusPreserved: true,
          graphWidthBefore: initialWorkbench.canvas.width,
          graphWidthAfter: hiddenNavigation.canvas.width,
        }
        await click('[aria-label="添加研究方向"]')
        check(
          await evaluate(() => {
            const modal = document.querySelector('[role="dialog"]')
            return (
              !!document.getElementById(modal.getAttribute('aria-labelledby')) &&
              !!modal.querySelector('.parent-preview strong') &&
              !!modal.querySelector('textarea[required]')
            )
          }),
          'Density: the concise branch dialog retains its title, parent context and required question',
        )
        await capture('01c-new-direction-dialog')
        await click('[aria-label="关闭对话框"]')
        const originalPanelWidth = await evaluate(() =>
          document.querySelector('.app-shell').style.getPropertyValue('--panel-width'),
        )
        window.setContentSize(1120, 800)
        await evaluate(() =>
          document.querySelector('.app-shell').style.setProperty('--panel-width', '680px'),
        )
        await pause(300)
        await capture('01d-narrow-graph-controls')
        check(
          await evaluate(() => {
            const bounds = document.querySelector('.research-canvas').getBoundingClientRect()
            return [...document.querySelectorAll('.graph-tools button')].every((e) => {
              const r = e.getBoundingClientRect()
              return (
                r.width >= 31 &&
                r.height >= 31 &&
                r.left >= bounds.left &&
                r.right <= bounds.right &&
                r.bottom <= bounds.bottom
              )
            })
          }),
          'Density: all graph controls remain reachable when the report takes most of the width',
        )
        await evaluate(
          (width) => document.querySelector('.app-shell').style.setProperty('--panel-width', width),
          originalPanelWidth,
        )
        window.setContentSize(1440, 900)
        await pause(300)
      }

      // Independent scroll positions and an explicit older report selection.
      await click('[aria-label="选择报告历史版本"]')
      await click('.history-popover button:last-child')
      await evaluate(() => {
        document.querySelector('.detail-body').scrollTop = 650
      })
      await pause(400)
      const before = await evaluate(measure)
      await select(longId)
      check((await evaluate(measure)).tab === '对话', 'A02: a new node starts in conversation')
      await evaluate(() => {
        const e = document.querySelector('.research-composer textarea')
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        set.call(e, '验收草稿：切换节点、阅读和重启后仍保留。')
        e.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await pause()
      await select(rootId)
      const after = await evaluate(measure)
      check(
        after.tab === '研究报告' && Math.abs(after.reader.scrollTop - before.reader.scrollTop) < 3,
        'A02: report tab and reading position must survive node round trip',
      )
      check(
        await evaluate(() =>
          document.querySelector('.history-menu > button').textContent.includes('历史版本'),
        ),
        'A02: selected historical report survives node round trip',
      )
      results.interactions.nodeRoundTrip = {
        before: before.reader.scrollTop,
        after: after.reader.scrollTop,
      }
      await evaluate(() => {
        const e = document.querySelector('.research-composer textarea')
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
          e,
          '验收研究草稿：输入与阅读切换后保留。',
        )
        e.dispatchEvent(new Event('input', { bubbles: true }))
      })
      check(
        Math.abs((await evaluate(measure)).reader.scrollTop - after.reader.scrollTop) < 3,
        'A01: input editing preserves reading location',
      )
      const inputHeight = (await evaluate(measure)).composer.height
      await evaluate(() => {
        const input = document.querySelector('.research-composer textarea')
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
          input,
          '验收研究草稿：长输入在框内滚动。\n'.repeat(100),
        )
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await pause(200)
      const longInput = await capture('01e-fixed-long-input')
      check(
        Math.abs(longInput.composer.height - inputHeight) < 2 &&
          longInput.input.scrollHeight > longInput.input.clientHeight,
        'Long input scrolls without growing the panel',
      )
      for (const name of ['chat', 'sources', 'records', 'report']) {
        await tab(name)
        const fixed = await evaluate(measure)
        check(
          fixed.inputVisible && Math.abs(fixed.composer.height - inputHeight) < 2,
          'Input stays fixed across detail tabs',
        )
      }
      await tab('chat')
      check(
        await evaluate(() => !!document.querySelector('.conversation-empty .button')),
        'A02: empty conversation must link to the existing report',
      )
      await tab('report')
      await evaluate(() =>
        document.querySelector('.table-scroll').scrollIntoView({ block: 'start' }),
      )
      const table = await capture('02-light-table-local-scroll')
      check(table.table.scrollWidth > table.table.clientWidth, 'A04: narrow table scrolls locally')
      check(
        table.tableHeaders.every((cell) => cell.width >= 99),
        'A04: readable table columns',
      )

      // Reading uses the workspace; hidden map controls leave the tab order.
      const transform = (await evaluate(measure)).transform
      await click('[aria-label="展开阅读"]')
      const full = await capture('03-light-expanded-reading')
      check(full.graphHidden, 'A03: graph must be hidden, not covered by a reader')
      check(
        full.inputVisible && !full.inputCollapseControl,
        'A01: fixed input stays available during reading',
      )
      check(
        full.composer.height >= 131 && full.composer.height <= 221,
        'A01: fixed input uses bounded space',
      )
      window.focus()
      const focus = []
      for (let i = 0; i < 18; i++) {
        await key('Tab')
        const f = await evaluate(() => {
          const e = document.activeElement
          const r = e.getBoundingClientRect()
          return {
            label: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 50),
            tag: e.tagName,
            hidden: !!e.closest('[hidden]'),
            visible:
              r.width > 0 &&
              r.height > 0 &&
              r.right > 0 &&
              r.left < innerWidth &&
              r.bottom > 0 &&
              r.top < innerHeight,
          }
        })
        check(!f.hidden && f.visible, 'A03: keyboard focus must remain visible')
        focus.push(f)
      }
      results.interactions.readingFocus = focus
      await key('Escape')
      check(
        !(await evaluate(() =>
          document.querySelector('.details-panel').classList.contains('expanded'),
        )),
        'A03: Esc exits reading',
      )
      check(
        await evaluate(() => document.activeElement.getAttribute('aria-label') === '展开阅读'),
        'A03: focus returns to the reading toggle',
      )
      check(
        (await evaluate(measure)).transform === transform,
        'A05: leaving reading restores the map viewport',
      )

      // Automatic activation, one Tab stop, and real Chromium arrow key events.
      await evaluate(() => document.querySelector('.detail-tabs [aria-selected="true"]').focus())
      await key('Right')
      check(
        (await evaluate(measure)).tab.startsWith('来源'),
        'A08: Right moves and activates the next tab',
      )
      await key('Left')
      const tabs = await evaluate(measure)
      check(
        tabs.tab === '研究报告' && tabs.tabStops === 1 && tabs.tabPanelLinked,
        'A08: roving tab stop and panel association',
      )
      await key('Home')
      check((await evaluate(measure)).tab === '对话', 'A08: Home activates first tab')
      await key('End')
      check((await evaluate(measure)).tab.startsWith('记录'), 'A08: End activates last tab')
      await tab('report')
      const initialWidth = await evaluate(
        () => document.querySelector('.details-panel').getBoundingClientRect().width,
      )
      await evaluate(() => document.querySelector('[aria-label="调整报告区域宽度"]').focus())
      await key('Left')
      check((await evaluate(measure)).separator.width >= 12, 'A07: enlarged resize hit area')
      check(
        (await evaluate(
          () => document.querySelector('.details-panel').getBoundingClientRect().width,
        )) ===
          initialWidth + 24,
        'A07: keyboard resize remains available',
      )

      // Repeat the real sample at each audited size and in both accepted themes.
      for (const theme of ['light', 'dark']) {
        if (theme === 'dark') await click('[aria-label="深色主题"]')
        await select(longId)
        for (const [w, h] of [
          [1440, 900],
          [1280, 800],
        ]) {
          window.setContentSize(w, h)
          await pause(220)
          const m = await capture(`04-${theme}-long-${w}x${h}`)
          check(m.reader.height >= 200, 'A01: long question must leave useful reading space')
          check(!m.documentOverflow.x && !m.documentOverflow.y, 'A06: no whole-page overflow')
        }
        window.setSize(1050, 700)
        await pause(300)
        const min = await capture(`05-${theme}-native-minimum`)
        check(min.reader.height >= 200, 'A01: native minimum leaves at least 200px reading space')
        check(!min.documentOverflow.x && !min.documentOverflow.y, 'A06: native minimum reflows')
        results.interactions[`${theme}NativeMinimum`] = {
          outer: window.getBounds(),
          content: window.getContentBounds(),
          bodyHeight: min.reader.height,
        }
        await select(rootId)
        await tab('report')
        await capture(`05b-${theme}-native-report`)
        window.setContentSize(1280, 800)
        window.webContents.setZoomFactor(2)
        await pause(400)
        const zoomed = await capture(`06-${theme}-200-percent`)
        check(
          !zoomed.documentOverflow.x && !zoomed.documentOverflow.y,
          'A06: 200% text stays within the viewport',
        )
        check(zoomed.reader.height >= 100, 'A06: 200% keeps a readable scroll area')
        check(
          await evaluate(() => {
            const e = document.querySelector('.research-composer textarea')
            const r = e.getBoundingClientRect()
            return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
          }),
          'A06: composing remains reachable at 200%',
        )
        await click('[aria-label="打开工作空间导航"]')
        check(
          await evaluate(() => document.activeElement.getAttribute('aria-label') === '返回工作台'),
          'A06: compact navigation receives visible focus',
        )
        await click('[aria-label="返回工作台"]')
        window.webContents.setZoomFactor(1)
        window.setContentSize(1440, 900)
        await pause(300)
        if (theme === 'dark') {
          await click('[aria-label="展开阅读"]')
          await capture('06b-dark-expanded-reading')
          await key('Escape')
        }
      }

      // Dense tree: fit includes every node; research search restores readable scale.
      await evaluate(
        async (ids) => {
          for (const parentId of ids)
            for (const title of ['阅读定位', '节点往返', '资料来源', '缩放焦点', '输入草稿'])
              await window.questbranch.command({
                type: 'create-node',
                parentId,
                sourceReportId: (await window.questbranch.snapshot()).reports
                  .filter((report) => report.nodeId === parentId)
                  .at(-1).id,
                question: `隔离验收样本：${title}如何影响研究任务？`,
              })
        },
        source.nodes.filter((node) => node.parentId === rootId).map((node) => node.id),
      )
      await pause(1400)
      for (const theme of ['dark', 'light']) {
        await click(`[aria-label="${theme === 'dark' ? '深色' : '亮色'}主题"]`)
        await click('[aria-label="查看全图"]')
        await pause(450)
        const dense = await capture(`07-${theme}-dense-31-overview`)
        check(
          dense.cards.length === 31 && dense.cards.every((card) => card.fullyVisible),
          'A05: View all must fit all 31 nodes',
        )
        check(
          await evaluate(() => !document.querySelector('.research-card .branch-toggle')),
          'A07: low zoom uses unscaled controls',
        )
        const chosen = await evaluate(async () => {
          const snapshot = await window.questbranch.snapshot()
          const workspaceId = localStorage.getItem('questbranch-workspace')
          return snapshot.nodes.filter((node) => node.workspaceId === workspaceId).at(-1).id
        })
        await selectResearchNode({ evaluate, click, pause }, chosen)
        check(
          await evaluate(
            () =>
              document.querySelector('.research-card.is-selected').getBoundingClientRect().width >=
              200,
          ),
          'A05: research search restores a readable node scale',
        )
        check(
          await evaluate(() =>
            [...document.querySelectorAll('.research-card .branch-toggle')].every((e) => {
              const r = e.getBoundingClientRect()
              return r.width >= 28 && r.height >= 28
            }),
          ),
          'A07: normal node action targets remain usable',
        )
        await capture(`08-${theme}-dense-node-reading`)
      }
      // Pending directions cannot derive grandchildren before saving their own
      // report. Imported deep histories are covered by verify-research-polish.
      const blocked = await evaluate(async () => {
        const before = await window.questbranch.snapshot()
        const parent = before.nodes.at(-1)
        let rejected = false
        try {
          await window.questbranch.command({
            type: 'create-node',
            parentId: parent.id,
            sourceReportId: parent.originReportId,
            question: '隔离验收：不允许越过自己的报告',
          })
        } catch (error) {
          rejected = error.message.includes('必须属于父节点')
        }
        return (
          rejected && (await window.questbranch.snapshot()).nodes.length === before.nodes.length
        )
      })
      check(blocked, 'New pending direction requires its own saved report before deeper branching')
      // Persist the original report, reading position and unsent draft through renderer reload.
      await select(rootId)
      await tab('report')
      await evaluate(() => (document.querySelector('.detail-body').scrollTop = 450))
      await pause(650)
      const saved = await evaluate(async () => {
        const s = await window.questbranch.snapshot()
        return s.views[localStorage.getItem('questbranch-workspace')]
      })
      check(saved.chatDrafts[longId]?.includes('验收草稿'), 'A02: unsent draft is persisted')
      window.webContents.reload()
      await new Promise((resolve) => window.webContents.once('did-finish-load', resolve))
      await ready()
      await pause(300)
      const reopened = await evaluate(measure)
      check(
        reopened.tab === '研究报告' && Math.abs(reopened.reader.scrollTop - 450) < 3,
        'A02: reload restores tab and reading location',
      )
      check(
        saved.readers[rootId].reportId === older.id,
        'A02: report version is saved independently of the current provider',
      )
      results.interactions.reload = {
        tab: reopened.tab,
        scrollTop: reopened.reader.scrollTop,
        draftPreserved: true,
      }
      if (process.argv.includes('--views'))
        results.interactions.researchViews = await verifyResearchViews({
          window,
          evaluate,
          pause,
          click,
          capture,
          check,
          source,
          rootId,
          older,
        })
      writeFileSync(join(folder, 'verified.json'), JSON.stringify(results, null, 2))
      clearTimeout(timeout)
      console.log(
        JSON.stringify({
          folder,
          version: results.version,
          cases: results.cases.length,
          passed: 'A01–A08',
        }),
      )
      app.quit()
    } catch (error) {
      writeFileSync(
        join(folder, 'failed.json'),
        JSON.stringify({ ...results, error: error.stack }, null, 2),
      )
      writeFileSync(join(folder, 'failure.png'), (await window.webContents.capturePage()).toPNG())
      clearTimeout(timeout)
      console.error(error.stack)
      console.error(folder)
      app.exit(1)
    }
  })
})
const packageRoot = process.argv
  .find((argument) => argument.startsWith('--package-root='))
  ?.slice('--package-root='.length)
const appRoot = process.argv.includes('--packaged')
  ? resolve(packageRoot || 'release/win-unpacked', 'resources/app.asar')
  : resolve('.')
results.appRoot = appRoot
try {
  await import(pathToFileURL(join(appRoot, 'out/main/index.js')).href)
} catch (error) {
  clearTimeout(timeout)
  console.error(error)
  app.exit(1)
}
