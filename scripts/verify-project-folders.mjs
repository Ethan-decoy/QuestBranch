import { app, dialog } from 'electron'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { desktopPackage, option } from './desktop-package.mjs'

const packageRoot = option('package-root'),
  appRoot = packageRoot ? desktopPackage(packageRoot).archive : resolve('.')

const parent = resolve('artifacts/project-navigation')
mkdirSync(parent, { recursive: true })
const folder = mkdtempSync(join(parent, 'check-')),
  paths = {}
for (const name of ['profile', 'legacy', 'A', 'B', 'moved']) {
  paths[name] = join(folder, name)
  mkdirSync(paths[name])
}
app.setPath('userData', paths.profile)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
process.env.QUESTBRANCH_DATA_DIR = paths.legacy
for (const name of [
  'ELECTRON_RENDERER_URL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'TAVILY_API_KEY',
])
  delete process.env[name]
const selections = [],
  cases = []
dialog.showOpenDialog = async () => {
  assert(selections.length, 'Unexpected picker')
  const path = selections.shift()
  return { canceled: !path, filePaths: path ? [path] : [] }
}
let completed = false,
  stage = 'startup'
const timeout = setTimeout(() => {
  console.error('Project navigation verification timed out:', stage)
  app.exit(1)
}, 120000)
app.on('browser-window-created', (_, window) => {
  window.setContentSize(1440, 900)
  window.webContents.once('did-finish-load', async () => {
    const debuggerClient = window.webContents.debugger
    debuggerClient.attach('1.3')
    const evaluate = async (fn, value) => {
      const result = await window.webContents.executeJavaScript(
        `(async()=>{try{return {value:await (${fn.toString()})(${JSON.stringify(value) ?? ''})}}catch(error){return {error:String(error),stack:error.stack}}})()`,
      )
      if (result.error) throw new Error(`${stage}: ${result.error}\n${result.stack}`)
      return result.value
    }
    const snapshot = () => evaluate(() => window.questbranch.snapshot())
    const until = async (read) => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const result = await read()
        if (result) return result
        await new Promise((done) => setTimeout(done, 40))
      }
      throw new Error('UI timeout: ' + stage)
    }
    const click = (text, selector = 'button') =>
      evaluate(
        ({ text, selector }) => {
          const item = [...document.querySelectorAll(selector)].find(
            (item) => item.textContent.trim() === text || item.getAttribute('aria-label') === text,
          )
          if (!item || item.disabled) throw new Error('Unavailable control: ' + text)
          item.click()
        },
        { text, selector },
      )
    const fill = (selector, text) =>
      evaluate(
        ({ selector, text }) => {
          const input = document.querySelector(selector)
          if (!input) throw new Error('Missing field: ' + selector)
          input.focus()
          const prototype =
            input instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, text)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        },
        { selector, text },
      )
    const select = (label, value) =>
      evaluate(
        ({ label, value }) => {
          const item = document.querySelector(`select[aria-label="${label}"]`)
          item.value = value
          item.dispatchEvent(new Event('change', { bubbles: true }))
        },
        { label, value },
      )
    const menu = async (kind, id, action) => {
      await evaluate(
        ({ kind, id }) => {
          const item = document.querySelector(
            kind === 'project'
              ? `[data-project-id="${id}"] > .project-entry`
              : `[data-workspace-id="${id}"] > .project-entry`,
          )
          if (!item) throw new Error('Object missing')
          item.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 160, clientY: 220 }),
          )
        },
        { kind, id },
      )
      await until(() => evaluate(() => !!document.querySelector('[role="menu"]')))
      if (action) await click(action, '[role="menuitem"]')
    }
    const capture = async (name) => {
      await evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        )
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
      })
      await new Promise((done) => setTimeout(done, 120))
      writeFileSync(join(folder, name + '.png'), (await window.webContents.capturePage()).toPNG())
    }
    // Chromium's own drag start creates the data; CDP only delivers the target/drop.
    const dragItem = async (kind, sourceId, targetId, placement, cancel = false, screenshot) => {
      const points = await evaluate(
        ({ kind, sourceId, targetId, placement }) => {
          const attribute = kind === 'project' ? 'data-project-id' : 'data-workspace-id'
          const row = (id) =>
            [...document.querySelectorAll(`[${attribute}]`)].find(
              (item) => item.getAttribute(attribute) === id,
            )
          const source = row(sourceId)
              .querySelector(kind === 'project' ? '.project-name' : '.project-study-button')
              .getBoundingClientRect(),
            target = (
              kind === 'project' ? row(targetId).querySelector('.project-entry') : row(targetId)
            ).getBoundingClientRect()
          const child =
              kind === 'project'
                ? row(sourceId).querySelector('.project-study-button')?.getBoundingClientRect()
                : null,
            other =
              kind === 'research'
                ? [...document.querySelectorAll('[data-project-id]')]
                    .find((item) => item !== row(sourceId).closest('[data-project-id]'))
                    ?.querySelector('.project-name')
                    .getBoundingClientRect()
                : null
          return {
            source: { x: source.left + 40, y: source.top + source.height / 2 },
            child: child?.height ? { x: child.left + 40, y: child.top + child.height / 2 } : null,
            blocked: other ? { x: other.left + 40, y: other.top + other.height / 2 } : null,
            target: {
              x: target.left + 60,
              y: placement === 'before' ? target.top + 4 : target.bottom - 4,
            },
          }
        },
        { kind, sourceId, targetId, placement },
      )
      const hover = async (point, accepted = true) => {
        for (const type of ['dragEnter', 'dragOver']) {
          await evaluate((type) => {
            document.getElementById('root').addEventListener(
              type.toLowerCase(),
              (event) => {
                window.__qbDropFeedback = {
                  accepted: event.defaultPrevented,
                  effect: event.dataTransfer.dropEffect,
                }
              },
              { once: true },
            )
          }, type)
          await debuggerClient.sendCommand('Input.dispatchDragEvent', { type, ...point, data })
          const feedback = await evaluate(() => {
            const feedback = window.__qbDropFeedback
            delete window.__qbDropFeedback
            return feedback
          })
          assert.equal(feedback.accepted, accepted, `${kind} ${type} acceptance`)
          if (accepted) assert.equal(feedback.effect, 'move', `${kind} ${type} feedback`)
        }
      }
      let data
      const intercepted = (_event, method, params) => {
        if (method === 'Input.dragIntercepted') data = params.data
      }
      debuggerClient.on('message', intercepted)
      await debuggerClient.sendCommand('Input.setInterceptDrags', { enabled: true })
      try {
        await debuggerClient.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          ...points.source,
        })
        await debuggerClient.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          ...points.source,
          button: 'left',
          buttons: 1,
          clickCount: 1,
        })
        await debuggerClient.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: points.source.x + 12,
          y: points.source.y + 12,
          button: 'left',
          buttons: 1,
        })
        await debuggerClient.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          ...points.target,
          button: 'left',
          buttons: 1,
        })
        await until(() => data)
        assert(
          data.items.some(
            (item) =>
              item.mimeType === `application/x-questbranch-${kind}` && item.data === sourceId,
          ),
        )
        await hover(points.source)
        if (points.child) await hover(points.child)
        if (points.blocked) await hover(points.blocked, false)
        await hover(points.target)
        await until(() =>
          evaluate(
            ({ kind, sourceId, targetId, placement }) => {
              const attribute = kind === 'project' ? 'data-project-id' : 'data-workspace-id'
              return (
                [...document.querySelectorAll(`[${attribute}]`)].find(
                  (row) => row.getAttribute(attribute) === targetId,
                )?.dataset.dropPosition === (sourceId === targetId ? undefined : placement)
              )
            },
            { kind, sourceId, targetId, placement },
          ),
        )
        if (screenshot) await capture(screenshot)
        await debuggerClient.sendCommand('Input.dispatchDragEvent', {
          type: cancel ? 'dragCancel' : 'drop',
          ...points.target,
          data,
        })
        await debuggerClient.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          ...points.target,
          button: 'left',
          buttons: 0,
          clickCount: 1,
        })
        await until(() =>
          evaluate(() => !document.querySelector('.is-dragging, [data-drop-position]')),
        )
      } finally {
        debuggerClient.removeListener('message', intercepted)
        await debuggerClient.sendCommand('Input.setInterceptDrags', { enabled: false })
      }
    }
    const dragResearch = (...args) => dragItem('research', ...args)
    const collapseProjects = async (ids, collapsed) => {
      for (const id of ids) {
        await evaluate(
          ({ id, collapsed }) => {
            const button = document.querySelector(`[data-project-id="${id}"] .project-chevron`)
            if (button.getAttribute('aria-expanded') !== String(!collapsed)) button.click()
          },
          { id, collapsed },
        )
        await until(() =>
          evaluate(
            ({ id, collapsed }) =>
              document
                .querySelector(`[data-project-id="${id}"] .project-chevron`)
                ?.getAttribute('aria-expanded') === String(!collapsed),
            { id, collapsed },
          ),
        )
      }
    }
    const projectOrder = () =>
      evaluate(() =>
        [...document.querySelectorAll('[data-project-id]')].map((row) => row.dataset.projectId),
      )
    const expectProjectOrder = (expected) =>
      until(async () => JSON.stringify(await projectOrder()) === JSON.stringify(expected))
    const checkProjectGap = () =>
      evaluate(() => {
        const rows = [...document.querySelectorAll('[data-project-id]')].map((row) =>
          row.getBoundingClientRect(),
        )
        return rows.every(
          (row, index) =>
            row.height >= 32 && (!index || Math.abs(row.top - rows[index - 1].bottom) <= 1),
        )
      })
    const createProject = async (name, directory) => {
      await click('新建项目')
      await until(() => evaluate(() => !!document.querySelector('.modal input')))
      await fill('.modal input', name)
      selections.push(directory)
      await click('选择文件夹')
      await until(() =>
        evaluate(
          (path) => document.querySelector('.project-folder-row code')?.textContent === path,
          directory,
        ),
      )
      await click('创建项目')
      const project = await until(async () => {
        const state = await snapshot()
        return state.projects.find((project) => project.directory === directory)
      })
      await until(() => evaluate(() => !document.querySelector('[role="dialog"]')))
      return project
    }
    const createResearch = async (projectId, name, question) => {
      await evaluate(
        (id) => document.querySelector(`[data-project-id="${id}"] .project-add`).click(),
        projectId,
      )
      await until(() => evaluate(() => !!document.querySelector('.modal textarea')))
      await fill('.modal input', name)
      await fill('.modal textarea', question)
      await click('创建研究')
      const workspace = await until(async () =>
        (await snapshot()).workspaces.find((workspace) => workspace.name === name),
      )
      await until(() => evaluate(() => !document.querySelector('[role="dialog"]')))
      return workspace
    }
    try {
      await until(() => evaluate(() => !!document.querySelector('.research-composer textarea')))
      window.show()
      window.focus()
      window.webContents.focus()
      assert(
        await evaluate(() => {
          const header = document.querySelector('.projects-navigation .sidebar-label')
          return (
            !header.querySelector('select') &&
            header.querySelectorAll('button').length === 1 &&
            header.querySelector('button').getAttribute('aria-label') === '新建项目'
          )
        }),
      )
      cases.push('project header keeps one add action without a view selector or folder button')
      await click('设置')
      await click('外观', '[role="tab"]')
      await click('亮色', 'label')
      await click('完成')
      stage = 'empty project'
      const a = await createProject('项目 A', paths.A)
      await until(() => evaluate(() => !!document.querySelector('.project-landing')))
      assert.equal((await snapshot()).activeWorkspaceId, '')
      assert.equal(await evaluate(() => document.querySelectorAll('.research-card').length), 0)
      await capture('empty-project-light')
      cases.push('empty projects have stable identities and never display another study')

      stage = 'project drag ordering and gaps'
      const legacy = (await snapshot()).projects.find((project) => project.legacy),
        ids = [legacy.id, a.id]
      await collapseProjects(ids, true)
      assert(await checkProjectGap(), 'Collapsed project rows have unnecessary vertical gaps')
      await capture('project-spacing-light')
      cases.push('collapsed projects form adjacent rows while retaining usable hit targets')
      const collapsedBefore = (await snapshot()).navigation.collapsed
      await dragItem('project', a.id, a.id, 'before')
      assert.deepEqual(await projectOrder(), ids)
      assert.equal((await snapshot()).activeProjectId, a.id)
      assert.deepEqual((await snapshot()).navigation.collapsed, collapsedBefore)
      cases.push('dropping a project on itself is accepted without changing order or selection')
      await dragItem('project', a.id, legacy.id, 'before', false, 'project-drag-light')
      await expectProjectOrder([a.id, legacy.id])
      assert.equal((await snapshot()).activeProjectId, a.id)
      assert.equal((await snapshot()).activeWorkspaceId, '')
      assert.deepEqual((await snapshot()).navigation.collapsed, collapsedBefore)
      await dragItem('project', a.id, legacy.id, 'after', true)
      assert.deepEqual(await projectOrder(), [a.id, legacy.id])
      await dragItem('project', a.id, legacy.id, 'after')
      await expectProjectOrder(ids)
      cases.push(
        'native project drag inserts above/below and cancellation retains selection and collapse state',
      )
      await evaluate(
        (id) => document.querySelector(`[data-project-id="${id}"] .project-name`).focus(),
        a.id,
      )
      for (const [key, code, expected] of [
        ['ArrowUp', 38, [a.id, legacy.id]],
        ['ArrowDown', 40, ids],
      ]) {
        await debuggerClient.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key,
          code: key,
          modifiers: 1,
          windowsVirtualKeyCode: code,
        })
        await debuggerClient.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key,
          code: key,
          modifiers: 0,
          windowsVirtualKeyCode: code,
        })
        await expectProjectOrder(expected)
        await until(() =>
          evaluate(() => document.querySelector('.project-name:focus')?.draggable === true),
        )
      }
      await menu('project', a.id)
      assert(
        await evaluate(
          () =>
            ![...document.querySelectorAll('[role="menuitem"]')].some((item) =>
              ['上移', '下移'].includes(item.textContent.trim()),
            ),
        ),
      )
      await debuggerClient.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      })
      await debuggerClient.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      })
      await until(() => evaluate(() => !document.querySelector('[role="menu"]')))
      cases.push('project menus omit movement commands and keyboard sorting preserves focus')
      await collapseProjects(ids, false)

      stage = 'two studies and drafts'
      const one = await createResearch(a.id, '研究一', '问题一：如何保持研究连续？')
      await fill('.research-composer textarea', '研究一的未发送草稿')
      const two = await createResearch(a.id, '研究二', '问题二：如何清晰组织研究？')
      await fill('.research-composer textarea', '研究二的未发送草稿')
      await dragItem('project', a.id, a.id, 'after')
      assert.deepEqual(await projectOrder(), ids)
      assert.equal((await snapshot()).activeWorkspaceId, two.id)
      cases.push('expanded project drag accepts its child area while preserving study selection')
      await new Promise((done) => setTimeout(done, 300))
      await click('研究一', '.project-study-button')
      await until(() =>
        evaluate(
          () =>
            document.querySelector('.research-composer textarea')?.value === '研究一的未发送草稿',
        ),
      )
      await click('研究二', '.project-study-button')
      await until(() =>
        evaluate(
          () =>
            document.querySelector('.research-composer textarea')?.value === '研究二的未发送草稿',
        ),
      )
      cases.push('two studies in one project restore their own draft and selected node')

      stage = 'research drag ordering'
      const order = () =>
        evaluate(
          (id) =>
            [...document.querySelectorAll(`[data-project-id="${id}"] [data-workspace-id]`)].map(
              (row) => row.dataset.workspaceId,
            ),
          a.id,
        )
      const expectOrder = async (expected) =>
        until(async () => JSON.stringify(await order()) === JSON.stringify(expected))
      await dragResearch(one.id, two.id, 'after', false, 'research-drag-light')
      await expectOrder([two.id, one.id])
      assert.equal((await snapshot()).activeWorkspaceId, two.id)
      assert.equal(
        await evaluate(() => document.querySelector('.research-composer textarea').value),
        '研究二的未发送草稿',
      )
      await dragResearch(one.id, two.id, 'before')
      await expectOrder([one.id, two.id])
      await dragResearch(one.id, two.id, 'after', true)
      assert.deepEqual(await order(), [one.id, two.id])
      cases.push(
        'native Chromium drag reorders above/below, and cancellation preserves order, selection and draft',
      )

      await evaluate(
        (id) =>
          [...document.querySelectorAll('[data-workspace-id]')]
            .find((row) => row.dataset.workspaceId === id)
            .querySelector('button')
            .focus(),
        one.id,
      )
      for (const [key, code, expected] of [
        ['ArrowDown', 40, [two.id, one.id]],
        ['ArrowUp', 38, [one.id, two.id]],
      ]) {
        await debuggerClient.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key,
          code: key,
          modifiers: 1,
          windowsVirtualKeyCode: code,
        })
        await debuggerClient.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key,
          code: key,
          modifiers: 0,
          windowsVirtualKeyCode: code,
        })
        await expectOrder(expected)
        await until(() =>
          evaluate(() => document.querySelector('.project-study-button:focus')?.draggable === true),
        )
      }
      cases.push('keyboard sorting retains focus without selecting the moved research')

      await menu('research', one.id)
      assert(
        await evaluate(
          () =>
            ![...document.querySelectorAll('[role="menuitem"]')].some((item) =>
              ['上移', '下移'].includes(item.textContent.trim()),
            ),
        ),
      )
      await debuggerClient.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      })
      await debuggerClient.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      })
      await until(() => evaluate(() => !document.querySelector('[role="menu"]')))
      cases.push('research object menus omit movement commands')

      await click('设置')
      await click('外观', '[role="tab"]')
      await click('深色', 'label')
      await click('完成')
      await collapseProjects(ids, true)
      assert(await checkProjectGap(), 'Dark theme collapsed project rows have gaps')
      await capture('project-spacing-dark')
      await collapseProjects(ids, false)
      await dragResearch(one.id, two.id, 'after', false, 'research-drag-dark')
      await expectOrder([two.id, one.id])
      await dragResearch(one.id, two.id, 'before')
      await expectOrder([one.id, two.id])
      await click('设置')
      await click('外观', '[role="tab"]')
      await click('亮色', 'label')
      await click('完成')

      stage = 'rename and keyboard'
      await menu('project', a.id, '重命名')
      await fill('.project-inline-edit input', '项目 A · 改名')
      await evaluate(() =>
        document
          .querySelector('.project-inline-edit input')
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
      )
      await until(
        async () =>
          (await snapshot()).projects.find((project) => project.id === a.id)?.name ===
          '项目 A · 改名',
      )
      await menu('research', one.id, '重命名')
      await fill('.project-inline-edit input', '研究一 · 新标题')
      await evaluate(() =>
        document
          .querySelector('.project-inline-edit input')
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
      )
      await until(
        async () =>
          (await snapshot()).workspaces.find((workspace) => workspace.id === one.id)?.name ===
          '研究一 · 新标题',
      )
      assert.equal(
        (await snapshot()).workspaces.find((workspace) => workspace.id === one.id).question,
        one.question,
      )
      assert.equal((await snapshot()).storage.directory, paths.A)
      await until(() =>
        evaluate(() => document.activeElement?.classList.contains('project-study-button')),
      )
      cases.push('context-menu rename preserves disk location, root question and identities')

      stage = 'research pin'
      await menu('research', one.id, '固定')
      await until(async () => (await snapshot()).researchNavigation[one.id]?.pinned)
      assert.equal((await snapshot()).activeWorkspaceId, two.id)
      assert.equal(
        await evaluate(
          (id) => document.querySelectorAll(`[data-workspace-id="${id}"]`).length,
          one.id,
        ),
        1,
      )
      await capture('projects-light')
      cases.push('pinning marks one study without changing its identity or the active study')

      stage = 'move between projects'
      const b = await createProject('项目 B', paths.B)
      await menu('research', one.id, '移动到项目')
      await select('目标项目', b.id)
      await click('移动')
      await until(
        async () =>
          (await snapshot()).workspaces.find((workspace) => workspace.id === one.id)?.projectId ===
          b.id,
      )
      assert.equal((await snapshot()).activeWorkspaceId, one.id)
      await until(() =>
        evaluate(
          () =>
            document.querySelector('.research-composer textarea')?.value === '研究一的未发送草稿',
        ),
      )
      assert.equal(
        (await snapshot()).workspaces.filter((workspace) => workspace.id === one.id).length,
        1,
      )
      cases.push('moving a study changes one ownership while retaining draft and research identity')

      stage = 'archive and restore'
      await click('研究二', '.project-study-button')
      await until(async () => (await snapshot()).activeWorkspaceId === two.id)
      await menu('research', two.id, '归档研究')
      await until(() =>
        evaluate((id) => !document.querySelector(`[data-workspace-id="${id}"]`), two.id),
      )
      assert.equal((await snapshot()).activeWorkspaceId, '')
      const archivedAt = (await snapshot()).researchNavigation[two.id].archivedAt
      const selectResearch = async (id) => {
        await evaluate(
          (id) =>
            document.querySelector(`[data-workspace-id="${id}"] .project-study-button`).click(),
          id,
        )
        await until(async () => (await snapshot()).activeWorkspaceId === id)
      }
      const archivedAction = async (action) => {
        await menu('project', a.id)
        for (const [text, count] of [
          ['已归档研究', 2],
          ['研究二', 3],
        ]) {
          await evaluate((text) => {
            const item = [...document.querySelectorAll('[role="menuitem"]')].find(
              (item) => item.textContent.trim() === text,
            )
            if (!item) throw new Error('Missing archived menu: ' + text)
            item.focus()
          }, text)
          for (const type of ['keyDown', 'keyUp'])
            await debuggerClient.sendCommand('Input.dispatchKeyEvent', {
              type,
              key: 'ArrowRight',
              code: 'ArrowRight',
              windowsVirtualKeyCode: 39,
            })
          await until(() =>
            evaluate((count) => document.querySelectorAll('[role="menu"]').length === count, count),
          )
        }
        await click(action, '[role="menuitem"]')
      }
      await collapseProjects([b.id], false)
      await selectResearch(one.id)
      await archivedAction('打开（只读）')
      await until(async () => (await snapshot()).activeWorkspaceId === two.id)
      await until(() =>
        evaluate(() => document.querySelector('.research-composer textarea')?.readOnly),
      )
      assert(await evaluate(() => document.querySelector('.composer-send').disabled))
      const archivedNode = (await snapshot()).workspaces.find(
        (workspace) => workspace.id === two.id,
      ).rootId
      assert(
        await evaluate(async (nodeId) => {
          try {
            await window.questbranch.command({ type: 'edit-node', nodeId, question: '不应写入' })
            return false
          } catch (error) {
            return String(error).includes('已归档')
          }
        }, archivedNode),
      )
      await click('研究报告', '[role="tab"]')
      await until(
        async () => (await snapshot()).views[two.id].readers?.[archivedNode]?.tab === 'report',
      )
      assert.equal((await snapshot()).researchNavigation[two.id].archivedAt, archivedAt)
      await capture('archived-readonly-light')
      await click('设置')
      await click('外观', '[role="tab"]')
      await click('深色', 'label')
      await click('完成')
      await capture('archived-readonly-dark')
      cases.push(
        'archived research opens read-only from the project menu and preserves archive state and reader position',
      )
      await selectResearch(one.id)
      const exportedPath = join(folder, 'archived-study.questbranch.json')
      let downloadState
      window.webContents.session.once('will-download', (_event, item) => {
        item.setSavePath(exportedPath)
        item.once('done', (_event, state) => {
          downloadState = state
        })
      })
      await archivedAction('导出研究')
      await until(() => downloadState === 'completed')
      assert.equal(JSON.parse(readFileSync(exportedPath, 'utf8')).workspace.id, two.id)
      assert.equal((await snapshot()).researchNavigation[two.id].archivedAt, archivedAt)
      assert.equal((await snapshot()).activeWorkspaceId, one.id)
      cases.push(
        'archived research exports through a real download without restoring or selecting it',
      )
      await archivedAction('恢复研究')
      await until(() =>
        evaluate((id) => !!document.querySelector(`[data-workspace-id="${id}"]`), two.id),
      )
      assert(!(await snapshot()).researchNavigation[two.id]?.archivedAt)
      assert.equal((await snapshot()).activeWorkspaceId, one.id)
      cases.push('project context menu restores archived research without changing selection')

      stage = 'close and reopen'
      await menu('project', b.id, '关闭项目')
      await until(async () => !(await snapshot()).projects.some((project) => project.id === b.id))
      assert(existsSync(join(paths.B, '.questbranch', 'research.sqlite')))
      await click('新建项目')
      await until(() => evaluate(() => !!document.querySelector('.modal input')))
      selections.push(paths.B)
      await click('选择文件夹')
      await until(() =>
        evaluate(() =>
          [...document.querySelectorAll('.modal button')].some(
            (button) => button.textContent.trim() === '打开项目',
          ),
        ),
      )
      await click('打开项目')
      await until(async () => (await snapshot()).activeProjectId === b.id)
      await until(() => evaluate(() => !document.querySelector('[role="dialog"]')))
      assert.equal((await snapshot()).activeWorkspaceId, one.id)
      cases.push('the add flow reopens an existing folder without creating a duplicate project')

      stage = 'whole-project relocation'
      const recovery = join(paths.A, '.questbranch', 'backups', 'before-sessionweave-materials-v4')
      mkdirSync(recovery, { recursive: true })
      const recoverySource = new DatabaseSync(join(paths.A, '.questbranch', 'research.sqlite'), {
        readOnly: true,
      })
      try {
        await backup(recoverySource, join(recovery, 'research.sqlite'))
      } finally {
        recoverySource.close()
      }
      writeFileSync(join(recovery, '.credential-key'), 'historical-fixture-key')
      writeFileSync(join(recovery, 'backup.json'), '{"feature":"sessionweave-materials-v4"}\n')
      const recoveryFiles = ['research.sqlite', '.credential-key', 'backup.json'],
        recoveryBytes = recoveryFiles.map((file) => readFileSync(join(recovery, file)))
      await click('项目 A · 改名', '.project-name')
      await until(async () => (await snapshot()).activeProjectId === a.id)
      await click('设置')
      await click('本地存储', '[role="tab"]')
      const archiveRoot = join(paths.A, '.questbranch', 'backups'),
        overlapChild = join(archiveRoot, 'ordinary-destination')
      mkdirSync(overlapChild)
      for (const directory of [archiveRoot, overlapChild]) {
        const entries = readdirSync(directory).sort()
        selections.push(directory)
        await click('迁移此项目')
        await until(() =>
          evaluate(() =>
            document.querySelector('[role="alert"]')?.textContent.includes('备份目录'),
          ),
        )
        assert(await evaluate(() => !document.querySelector('.storage-destination')))
        assert.equal((await snapshot()).storage.directory, paths.A)
        assert.deepEqual(readdirSync(directory).sort(), entries)
      }
      cases.push(
        'relocation picker rejects the recovery root and its child before offering confirmation or creating staging files',
      )
      selections.push(paths.moved)
      await click('迁移此项目')
      await until(() => evaluate(() => !!document.querySelector('.storage-destination')))
      await click('迁移项目')
      await until(async () => (await snapshot()).storage.directory === paths.moved)
      assert(existsSync(join(paths.A, '.questbranch', 'research.sqlite')))
      for (const [index, file] of recoveryFiles.entries()) {
        assert(
          readFileSync(
            join(paths.moved, '.questbranch', 'backups', 'before-sessionweave-materials-v4', file),
          ).equals(recoveryBytes[index]),
        )
        assert(readFileSync(join(recovery, file)).equals(recoveryBytes[index]))
      }
      await click('完成')
      cases.push('whole-project relocation retains the source and needs no restart')

      stage = 'dark and narrow layouts'
      await click('设置')
      await click('外观', '[role="tab"]')
      await click('深色', 'label')
      await click('完成')
      await capture('projects-dark')
      window.setContentSize(1100, 760)
      await capture('projects-narrow')
      assert(await evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      window.setContentSize(1440, 900)
      cases.push('light, dark and narrow layouts keep the research content usable')
      const db = new DatabaseSync(join(paths.moved, '.questbranch', 'research.sqlite'), {
        readOnly: true,
      })
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM settings').get().n, 0)
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
      db.close()
      stage = 'quit immediately after typing'
      const state = await snapshot(),
        selected = state.views[state.activeWorkspaceId].selectedId
      await fill('.research-composer textarea', '退出前最后输入的研究草稿')
      app.once('quit', () => {
        try {
          const db = new DatabaseSync(join(paths.moved, '.questbranch', 'research.sqlite'), {
            readOnly: true,
          })
          const view = JSON.parse(
            db.prepare('SELECT payload FROM views WHERE workspace_id=?').get(two.id).payload,
          )
          db.close()
          assert.equal(view.chatDrafts[selected], '退出前最后输入的研究草稿')
          cases.push('immediate quit flushes the final draft into the owning project')
          completed = true
          writeFileSync(
            join(folder, 'result.json'),
            JSON.stringify(
              {
                status: 'passed',
                cases,
                folder,
                packageRoot: packageRoot ?? null,
                noRemoteModelCalls: true,
              },
              null,
              2,
            ),
          )
          console.log(JSON.stringify({ status: 'passed', cases, folder }))
        } catch (error) {
          console.error(error.stack)
          writeFileSync(
            join(folder, 'result.json'),
            JSON.stringify(
              { status: 'failed', stage, error: String(error), cases, folder },
              null,
              2,
            ),
          )
        }
        clearTimeout(timeout)
      })
      app.quit()
    } catch (error) {
      await capture('failure').catch(() => {})
      console.error(error.stack)
      writeFileSync(
        join(folder, 'result.json'),
        JSON.stringify({ status: 'failed', stage, error: String(error), cases, folder }, null, 2),
      )
      clearTimeout(timeout)
      app.exit(1)
    }
  })
})
process.on('exit', () => {
  if (!completed) process.exitCode = 1
})
await import(pathToFileURL(join(appRoot, 'out/main/index.js')).href)
