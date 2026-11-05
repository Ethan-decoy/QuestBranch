// Uses the actual renderer and normal IPC in verify-workbench's isolated profile.
export async function selectResearchNode({ evaluate, click, pause }, id) {
  const target = await evaluate(async (id) => {
    const snapshot = await window.questbranch.snapshot()
    const node = snapshot.nodes.find((node) => node.id === id)
    const titles = []
    for (
      let current = node;
      current;
      current = snapshot.nodes.find((item) => item.id === current.parentId)
    )
      titles.unshift(current.title)
    return { title: node.title, path: titles.join(' / ') }
  }, id)
  await click('[aria-label="搜索研究"]')
  await evaluate((title) => {
    const input = document.querySelector('[aria-label="搜索研究与材料"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, title)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, target.title)
  await pause(250)
  await evaluate(({ title, path }) => {
    const result = [...document.querySelectorAll('[data-search-kind="node"]')].find(
      (button) =>
        button.querySelector('strong').textContent === title &&
        button.querySelector('.search-path').title === path,
    )
    if (!result) throw Error('Research search did not find: ' + title)
    result.click()
  }, target)
  await pause(450)
}

export async function verifyResearchViews({
  window,
  evaluate,
  pause,
  click,
  capture,
  check,
  source,
  rootId,
  older,
}) {
  const snapshot = () => evaluate(() => window.questbranch.snapshot()),
    before = await snapshot(),
    branchId = source.nodes.find((node) => node.parentId === rootId).id
  const currentView = async () => {
    // Panning and selection each restart the persisted-view debounce.
    await pause(650)
    return (await snapshot()).views[source.workspace.id]
  }
  async function choose(id) {
    await selectResearchNode({ evaluate, click, pause }, id)
  }
  async function key(keyCode, modifiers = []) {
    window.focus()
    window.webContents.focus()
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await pause(230)
  }
  const focusTopic = (id) =>
    evaluate(
      (id) => document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`).focus(),
      id,
    )
  async function fillQuestion(text) {
    await evaluate((text) => {
      const input = document.querySelector('[role="dialog"] textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, text)
    await pause(60)
    await click('[role="dialog"] button[type="submit"]')
    await pause(400)
    check(
      await evaluate(() => !document.querySelector('[role="dialog"]')),
      'Views: creation finishes without model setup',
    )
  }
  await choose(branchId)
  await click('[aria-label="定位当前研究"]')
  await pause(350)
  await capture('10-horizontal-summary')
  await click('[aria-label="显示阶段摘要"]')
  await pause(300)
  await click('[aria-label="定位当前研究"]')
  await pause(350)
  await capture('11-horizontal-compact')
  check(
    await evaluate(() =>
      [...document.querySelectorAll('.research-card')].every(
        (element) => element.classList.contains('is-concise') && element.clientHeight <= 100,
      ),
    ),
    'Views: compact topics retain title/status/counts at 100px',
  )
  await focusTopic(branchId)
  await evaluate(
    (id) =>
      document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`).dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
        }),
      ),
    branchId,
  )
  check(
    await evaluate(() => !document.querySelector('[role="dialog"]')),
    'Views: IME composition does not create a direction',
  )
  await key('Enter', ['control'])
  check(
    await evaluate(() => !!document.querySelector('[role="dialog"] .parent-preview strong')),
    'Views: Ctrl+Enter shows child parent',
  )
  const childQuestion = '隔离验收：从当前研究快速增加子方向'
  await fillQuestion(childQuestion)
  let data = await snapshot()
  const child = data.nodes.find((node) => node.question === childQuestion)
  check(child?.parentId === branchId, 'Views: correct child ownership')
  await focusTopic(child.id)
  await key('Enter', ['shift'])
  await fillQuestion('隔离验收：在相同父研究下增加同级方向')
  data = await snapshot()
  const sibling = data.nodes.find(
    (node) => node.question === '隔离验收：在相同父研究下增加同级方向',
  )
  check(sibling?.parentId === child.parentId, 'Views: correct sibling ownership')
  await focusTopic(sibling.id)
  await key('F2')
  await fillQuestion('隔离验收：修改后立即显示的新研究标题')
  check(
    await evaluate(
      (id) =>
        document
          .querySelector(`[data-testid="node-${id}"] h3`)
          .textContent.includes('修改后立即显示'),
      sibling.id,
    ),
    'Views: edited titles update without stale layout data',
  )
  await choose(branchId)
  await click('[aria-label="中心导图"]')
  await pause(350)
  await click('[aria-label="查看全图"]')
  await pause(450)
  await capture('12-mindmap-compact-overview')
  await choose(rootId)
  await focusTopic(rootId)
  await key('Left')
  check(
    (await currentView()).selectedId ===
      source.nodes.filter((node) => node.parentId === rootId)[1].id,
    'Views: mind-map left arrow follows the left visual branch',
  )
  await key('Right')
  check(
    (await currentView()).selectedId === rootId,
    'Views: left-branch right arrow returns toward the root',
  )
  await choose(branchId)
  await click('[aria-label="定位当前研究"]')
  await pause(350)
  await click('[aria-label="收起当前分支"]')
  const global = await currentView(),
    scene = (view) =>
      view.graph.scenes.find(
        (item) => item.mode === 'mindmap' && item.detail === 'compact' && !item.focusId,
      )
  await click('[aria-label="聚焦当前分支"]')
  await pause(350)
  check(
    await evaluate(
      (ids) =>
        JSON.stringify(
          [...document.querySelectorAll('.research-card')]
            .map((element) => element.dataset.testid.slice(5))
            .sort(),
        ) === JSON.stringify(ids.sort()),
      [
        branchId,
        ...before.nodes.filter((node) => node.parentId === branchId).map((node) => node.id),
        child.id,
        sibling.id,
      ],
    ),
    'Views: focused branch retains its existing and newly created topics only',
  )
  check((await currentView()).graph.focusId === branchId, 'Views: focus is presentation state')
  await capture('13-focused-branch')
  await focusTopic(branchId)
  await key('Escape')
  const restored = await currentView()
  check(
    !restored.graph.focusId &&
      Math.abs(scene(restored).viewport.x - scene(global).viewport.x) < 2 &&
      Math.abs(scene(restored).viewport.zoom - scene(global).viewport.zoom) < 0.005,
    'Views: Esc restores the original scene',
  )
  check(
    restored.collapsed.includes(branchId),
    'Views: returning also restores the original collapsed branch',
  )
  await click('[aria-label="展开当前分支"]')
  check(
    await evaluate(() => !document.querySelector('[aria-label="研究大纲"], .outline-scroll')),
    'Views: retired outline has no remaining entry or renderer',
  )
  const camera = scene(await currentView()).viewport
  await click('[aria-label="横向图"]')
  await capture('14-horizontal-compact')
  await click('[aria-label="中心导图"]')
  const returnedCamera = scene(await currentView()).viewport
  check(
    Math.abs(returnedCamera.x - camera.x) < 2 &&
      Math.abs(returnedCamera.zoom - camera.zoom) < 0.005,
    'Views: layout round trip restores the independent camera',
  )
  await click('[aria-label="展开阅读"]')
  await click('[aria-label="恢复侧栏"]')
  await choose(branchId)
  await click('[aria-label="定位当前研究"]')
  await pause(350)
  await click('[aria-label="聚焦当前分支"]')
  await pause(300)
  async function find(query, kind) {
    await click('[aria-label="搜索研究"]')
    await evaluate((query) => {
      const input = document.querySelector('[aria-label="搜索研究与材料"]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, query)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, query)
    await pause(300)
    await click(`[data-search-kind="${kind}"]`)
    await pause(350)
  }
  await find('QBX21 历史材料定位验收', 'report')
  let view = await currentView()
  check(
    view.selectedId === rootId && view.readers[rootId].reportId === older.id && !view.graph.focusId,
    'Views: search reveals the exact historical report outside the branch',
  )
  check(
    await evaluate(() => !!document.querySelector('.report-markdown .material-search-match')),
    'Views: matching paragraph is located',
  )
  await capture('15-historical-material-located')
  await click('[aria-label="在图谱中定位当前研究"]')
  await pause(400)
  check(
    await evaluate(() => !!document.querySelector('.research-card.is-selected')),
    'Views: report returns to its topic',
  )
  await click('[aria-label="返回上一视图"]')
  await pause(350)
  check(
    (await currentView()).graph.focusId === branchId,
    'Views: search retains the branch return route',
  )
  await find('QBX21 来源摘录定位验收', 'source')
  view = await currentView()
  check(
    view.readers[rootId].tab === 'sources' && view.readers[rootId].reportId === older.id,
    'Views: source retains report version',
  )
  check(
    await evaluate(() =>
      document
        .querySelector('.source-card.material-search-match')
        ?.textContent.includes('QBX21 来源摘录定位验收'),
    ),
    'Views: source excerpt is located',
  )
  await capture('16-source-located')
  for (const [theme, width, height] of [
    ['light', 1280, 800],
    ['dark', 1050, 700],
  ]) {
    await click(`[aria-label="${theme === 'light' ? '亮色' : '深色'}主题"]`)
    window.setContentSize(width, height)
    await pause(300)
    if (width <= 1100) await click('[aria-label="研究图谱"]')
    await capture(`17-${theme}-${width}-views`)
    check(
      await evaluate(() => {
        const bounds = document.querySelector('.research-canvas').getBoundingClientRect()
        return (
          document.documentElement.scrollWidth <= innerWidth &&
          [...document.querySelectorAll('.graph-tools button')].every((element) => {
            const rect = element.getBoundingClientRect()
            return (
              rect.width >= 31 &&
              rect.height >= 31 &&
              rect.left >= bounds.left &&
              rect.right <= bounds.right &&
              rect.bottom <= bounds.bottom
            )
          })
        )
      }),
      'Views: tools fit narrow canvases with usable named targets',
    )
    await click('[aria-label="横向图"]')
    await capture(`17b-${theme}-${width}-horizontal`)
    check(
      await evaluate(
        () =>
          document.querySelector('.flow-surface').clientHeight > 150 &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
      'Views: narrow horizontal layout leaves useful space for research',
    )
    await click('[aria-label="中心导图"]')
  }
  window.setContentSize(1440, 900)
  await click('[aria-label="亮色主题"]')
  await click('.detail-tabs [id$="-tab-report"]')
  await evaluate(() => {
    document.querySelector('.detail-body').scrollTop = 450
  })
  await pause(450)
  const after = await snapshot()
  for (const field of ['reports', 'runs', 'messages'])
    check(
      JSON.stringify(after[field]) === JSON.stringify(before[field]),
      `Views: ${field} unchanged; no model calls`,
    )
  for (const original of before.nodes) {
    const node = after.nodes.find((node) => node.id === original.id)
    check(
      node.parentId === original.parentId &&
        JSON.stringify(node.relatedIds) === JSON.stringify(original.relatedIds),
      'Views: original ancestry and context links preserved',
    )
  }
  await capture('18-views-ready-for-restart')
  return {
    compactHeight: 100,
    summaryHeight: 144,
    historicalReportId: older.id,
    sourcesLocated: true,
    rawRecordsPreserved: true,
    modelRequests: 0,
    mode: after.views[source.workspace.id].graph.mode,
    detail: after.views[source.workspace.id].graph.detail,
    history: after.views[source.workspace.id].graph.history,
  }
}
