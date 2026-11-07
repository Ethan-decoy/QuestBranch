import { app, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopPackage } from './desktop-package.mjs'

mkdirSync(resolve('artifacts/graph-toolbar'), { recursive: true })
const folder = mkdtempSync(resolve('artifacts/graph-toolbar/check-'))
const profile = join(folder, 'profile')
mkdirSync(profile)
app.setPath('userData', profile)
app.disableHardwareAcceleration()
delete process.env.QUESTBRANCH_DATA_DIR
delete process.env.ELECTRON_RENDERER_URL
const option = (name, fallback) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=') ?? fallback
const packageRoot = option('package-root', '')
const appRoot = packageRoot ? desktopPackage(packageRoot).archive : resolve('.')
const width = Number(option('width', '1440'))
const height = Number(option('height', '900'))
const zoom = Number(option('zoom', '1'))
const theme = option('theme', 'light')
const narrow = process.argv.includes('--narrow')
const calls = {}
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    calls[channel] = (calls[channel] ?? 0) + 1
    assert(!channel.startsWith('models:auth-'))
    if (channel === 'research:command') assert.equal(args[1].type, 'save-view')
    return listener(...args)
  })
const timeout = setTimeout(() => app.exit(1), 45000)
app.on('browser-window-created', (_, window) => {
  window.setContentSize(width, height)
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    const evaluate = (fn, value) =>
      window.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value)})`)
    const pause = (ms = 100) => new Promise((done) => setTimeout(done, ms))
    const wait = async (fn) => {
      for (let n = 0; n < 120; n++) {
        if (await fn()) return
        await pause(50)
      }
      throw Error('UI timeout')
    }
    const read = () =>
      evaluate(() => {
        const tools = document.querySelector('.graph-tools')
        const rect = tools.getBoundingClientRect()
        const canvas = document.querySelector('.research-canvas').getBoundingClientRect()
        const content = document.querySelector('.flow-surface').getBoundingClientRect()
        return {
          directory: !!tools.querySelector('[aria-label="研究节点目录"]'),
          readingButton: !!tools.querySelector('[aria-label="阅读当前研究"]'),
          branchToggle: !!tools.querySelector(
            '[aria-label="收起当前分支"], [aria-label="展开当前分支"]',
          ),
          outlineAbsent: !document.querySelector('[aria-label="研究大纲"], .outline-scroll'),
          groups: [...tools.querySelectorAll('.graph-tool-group, .canvas-controls')].map(
            (group) => ({
              label: group.getAttribute('aria-label'),
              buttons: [...group.querySelectorAll('button')].map((button) =>
                button.getAttribute('aria-label'),
              ),
            }),
          ),
          presentation: {
            layout: tools
              .querySelector('.graph-layouts [aria-pressed="true"]')
              .getAttribute('aria-label'),
            summary: tools
              .querySelector('[aria-label="显示阶段摘要"]')
              .getAttribute('aria-pressed'),
          },
          sameDock: window.__originalDock === tools,
          activeLabel: document.activeElement?.getAttribute('aria-label'),
          contentClear: content.bottom <= rect.top + 1,
          controlsFit: [...tools.querySelectorAll('button')].every((button) => {
            const box = button.getBoundingClientRect()
            return (
              !box.width ||
              (box.width >= 31 &&
                box.height >= 31 &&
                box.left >= canvas.left - 1 &&
                box.right <= canvas.right + 1 &&
                box.top >= canvas.top &&
                box.bottom <= canvas.bottom + 1)
            )
          }),
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          buttons: [...tools.querySelectorAll('button')].map((button) => {
            const box = button.getBoundingClientRect()
            return {
              label: button.getAttribute('aria-label'),
              disabled: button.disabled,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            }
          }),
        }
      })
    try {
      await wait(() =>
        evaluate(() => !!document.querySelector('.graph-tools [aria-label="横向图"]')),
      )
      window.webContents.setZoomFactor(zoom)
      await pause(200)
      window.focus()
      window.webContents.focus()
      await evaluate((theme) => {
        document.documentElement.dataset.theme = theme
        document.documentElement.style.colorScheme = theme
        const map = document.querySelector('[aria-label="研究图谱"]')
        if (map?.getBoundingClientRect().width) map.click()
        window.__originalDock = document.querySelector('.graph-tools')
      }, theme)
      if (narrow) {
        await evaluate(() => document.querySelector('[aria-label="调整报告区域宽度"]').focus())
        for (const type of ['keyDown', 'keyUp'])
          window.webContents.sendInputEvent({ type, keyCode: 'End' })
        await pause(300)
      }
      const before = await evaluate(() => window.questbranch.snapshot())
      const cases = []
      let previousPresentation = (await read()).presentation
      for (const label of [
        '横向图',
        '中心导图',
        '显示阶段摘要',
        '横向图',
        '显示阶段摘要',
        '中心导图',
        '定位当前研究',
        '查看全图',
        '返回上次视角',
        '缩小画布',
        '缩小画布',
        '定位当前研究',
      ]) {
        await evaluate((label) => {
          const button = document.querySelector(`.graph-tools button[aria-label="${label}"]`)
          if (!button || button.disabled) throw Error('Unavailable control: ' + label)
          button.focus()
          button.click()
        }, label)
        await pause(650)
        const state = await read()
        if (['横向图', '中心导图'].includes(label)) {
          assert.equal(state.presentation.layout, label)
          assert.equal(state.presentation.summary, previousPresentation.summary)
        } else if (label === '显示阶段摘要') {
          assert.equal(state.presentation.layout, previousPresentation.layout)
          assert.notEqual(state.presentation.summary, previousPresentation.summary)
        }
        previousPresentation = state.presentation
        cases.push({ mode: label, ...state })
        if (cases.length <= 6) {
          window.webContents.invalidate()
          await window.webContents.capturePage()
          await pause(100)
          writeFileSync(
            join(folder, `${cases.length}-${label}.png`),
            (await window.webContents.capturePage()).toPNG(),
          )
        }
      }
      const issues = []
      if (cases.some((item) => item.directory)) issues.push('Redundant node-path select remains')
      if (cases.some((item) => item.readingButton)) issues.push('Redundant reading button remains')
      if (cases.some((item) => item.branchToggle)) issues.push('Redundant branch toggle remains')
      if (cases.some((item) => !item.outlineAbsent)) issues.push('Retired outline view remains')
      assert.deepEqual(cases[0].groups.slice(0, 5), [
        { label: '结构展示', buttons: ['横向图', '中心导图'] },
        { label: '节点显示', buttons: ['显示阶段摘要'] },
        { label: '分支编辑', buttons: ['为当前研究添加方向', '添加同级方向'] },
        { label: '节点详情', buttons: ['编辑当前研究'] },
        { label: '分支浏览', buttons: ['聚焦当前分支'] },
      ])
      assert.equal(cases[0].groups[5].label, '画布操作')
      if (cases.some((item) => !item.sameDock)) issues.push('View switch remounts the toolbar')
      if (cases.some((item) => item.activeLabel !== item.mode))
        issues.push('View switch steals button focus')
      if (cases.some((item) => !item.contentClear || !item.controlsFit || item.pageOverflow))
        issues.push('Tools overlap content or overflow the canvas')
      for (const label of [
        '横向图',
        '中心导图',
        '显示阶段摘要',
        '为当前研究添加方向',
        '添加同级方向',
        '编辑当前研究',
        '聚焦当前分支',
      ]) {
        const boxes = cases.map((item) => item.buttons.find((button) => button.label === label))
        if (
          boxes.some(
            (box) => !box || Math.abs(box.x - boxes[0].x) > 1 || Math.abs(box.y - boxes[0].y) > 1,
          )
        )
          issues.push('View button moved: ' + label)
      }
      await evaluate(() => document.querySelector('.graph-layouts button').focus())
      for (const type of ['keyDown', 'keyUp'])
        window.webContents.sendInputEvent({ type, keyCode: 'Tab' })
      await pause(100)
      assert.equal(
        await evaluate(() => document.activeElement?.getAttribute('aria-label')),
        '中心导图',
      )
      const nodeToggle = await evaluate(() => {
        const card = document.querySelector('.research-card.is-selected')
        const button = card.querySelector('.branch-toggle')
        const box = button.getBoundingClientRect()
        const cardBox = card.getBoundingClientRect()
        const style = getComputedStyle(button)
        return {
          expanded: button.getAttribute('aria-expanded'),
          background: style.backgroundColor,
          width: box.width,
          height: box.height,
          insideCard:
            box.left >= cardBox.left && box.right <= cardBox.right && box.bottom <= cardBox.bottom,
          nodes: document.querySelectorAll('.research-card').length,
          count: button.textContent,
        }
      })
      assert.equal(nodeToggle.expanded, 'true')
      assert.equal(nodeToggle.background, 'rgba(0, 0, 0, 0)')
      assert(nodeToggle.insideCard && nodeToggle.width >= 31 && nodeToggle.height >= 31)
      await evaluate(() =>
        document.querySelector('.research-card.is-selected .branch-toggle').click(),
      )
      await wait(() =>
        evaluate(
          (expandedCount) =>
            document
              .querySelector('.research-card.is-selected .branch-toggle')
              ?.getAttribute('aria-expanded') === 'false' &&
            document.querySelectorAll('.research-card').length < expandedCount,
          nodeToggle.nodes,
        ),
      )
      assert(
        await evaluate(
          (expandedCount) =>
            document
              .querySelector('.research-card.is-selected .branch-toggle')
              .getAttribute('aria-expanded') === 'false' &&
            document.querySelectorAll('.research-card').length < expandedCount,
          nodeToggle.nodes,
        ),
        'Collapsing a card hides its descendants',
      )
      window.focus()
      window.webContents.focus()
      await evaluate(() =>
        document.querySelector('.research-card.is-selected .branch-toggle').focus(),
      )
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
      window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
      await pause(300)
      assert.equal(
        await evaluate(() => document.querySelectorAll('.research-card').length),
        nodeToggle.nodes,
      )
      assert.equal(
        await evaluate(() =>
          document
            .querySelector('.research-card.is-selected .branch-toggle')
            .getAttribute('aria-expanded'),
        ),
        'true',
      )
      const after = await evaluate(() => window.questbranch.snapshot())
      const actualZoom = window.webContents.getZoomFactor()
      assert.equal(actualZoom, zoom)
      for (const field of ['nodes', 'messages', 'runs', 'reports'])
        assert.deepEqual(after[field], before[field])
      writeFileSync(
        join(folder, 'result.json'),
        JSON.stringify(
          {
            folder,
            appRoot,
            cases,
            issues,
            calls,
            width,
            height,
            zoom,
            actualZoom,
            theme,
            narrow,
            keyboardTabVerified: true,
            nodeToggle: { ...nodeToggle, pointerCollapse: true, keyboardExpand: true },
            researchUnchanged: true,
            themeStyleOverrideOnly: true,
            isolatedProfile: true,
            noExternalModelRequest: true,
          },
          null,
          2,
        ),
      )
      console.log(JSON.stringify({ folder, issues, cases: cases.length }))
      assert.equal(issues.length, 0, issues.join('; '))
      clearTimeout(timeout)
      app.quit()
    } catch (error) {
      writeFileSync(join(folder, 'failed.txt'), error.stack)
      console.error(error.stack)
      console.error(folder)
      clearTimeout(timeout)
      app.exit(1)
    }
  })
})
await import(pathToFileURL(join(appRoot, 'out/main/index.js')).href)
