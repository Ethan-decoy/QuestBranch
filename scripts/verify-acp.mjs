import { app, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

mkdirSync(resolve('artifacts/acp-integration'), { recursive: true })
const folder = mkdtempSync(resolve('artifacts/acp-integration/check-'))
const profile = join(folder, 'profile')
mkdirSync(profile)
app.setPath('userData', profile)
app.disableHardwareAcceleration()
delete process.env.QUESTBRANCH_DATA_DIR
delete process.env.ELECTRON_RENDERER_URL
// Native handshake must not read the developer's account or issue model requests.
process.env.CODEX_HOME = join(folder, 'codex-home')
mkdirSync(process.env.CODEX_HOME)
for (const name of [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'TAVILY_API_KEY',
  'CODEX_CONFIG',
  'CODEX_PATH',
])
  delete process.env[name]
const option = (name, fallback) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const packageRoot = option('package-root', '')
const appRoot = packageRoot ? resolve(packageRoot, 'resources/app.asar') : resolve('.')
const theme = option('theme', 'light')
const width = Number(option('width', '1440')),
  zoom = Number(option('zoom', '1'))
const builtin = process.argv.includes('--builtin-only')
const calls = {}
const liveConnections = new Set()
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    calls[channel] = (calls[channel] ?? 0) + 1
    assert(!channel.startsWith('models:auth-'))
    const result = await listener(...args)
    if (channel === 'agents:connect') liveConnections.add(result.id)
    if (channel === 'agents:disconnect') liveConnections.delete(args[1])
    return result
  })
const timeout = setTimeout(() => {
  console.error('ACP verification timed out', folder)
  app.exit(1)
}, 90_000)
app.on('browser-window-created', (_, window) => {
  window.setContentSize(width, 900)
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    const evaluate = async (fn, value) => {
      const result = await window.webContents.executeJavaScript(
        `(async () => { try { return { ok: true, value: await (${fn.toString()})(${JSON.stringify(value)}) } } catch(error) { return { ok: false, error: error.stack } } })()`,
      )
      if (!result.ok) throw new Error(result.error)
      return result.value
    }
    const pause = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))
    const wait = async (fn) => {
      for (let n = 0; n < 240; n++) {
        if (await fn()) return
        await pause()
      }
      throw new Error('UI timeout')
    }
    const click = (text, selector = 'button') =>
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
    const capture = async (name) => {
      await evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      await pause(100)
      writeFileSync(join(folder, name + '.png'), (await window.webContents.capturePage()).toPNG())
    }
    const revealRequest = async () => {
      await evaluate(() =>
        document.querySelector('.agent-request').scrollIntoView({ block: 'center' }),
      )
      await pause(100)
      assert(
        await evaluate(() => {
          const request = document.querySelector('.agent-request')
          const body = request.closest('.detail-body').getBoundingClientRect()
          return [...request.querySelectorAll('button')].every((button) => {
            const rect = button.getBoundingClientRect()
            return (
              rect.top >= body.top &&
              rect.bottom <= body.bottom &&
              rect.left >= 0 &&
              rect.right <= innerWidth
            )
          })
        }),
        'Native request actions must be reachable within the scroll area',
      )
    }
    try {
      await wait(() => evaluate(() => !!document.querySelector('.research-composer')))
      window.webContents.setZoomFactor(zoom)
      await evaluate((theme) => {
        document.documentElement.dataset.theme = theme
        document.documentElement.style.colorScheme = theme
      }, theme)
      if (builtin) {
        const result = await evaluate(() => window.questbranch.agent.connect({ kind: 'codex' }))
        assert.equal(result.status, 'login-required')
        assert(result.authMethods.some((method) => method.id === 'chat-gpt-device-code'))
        await evaluate((id) => window.questbranch.agent.disconnect(id), result.id)
        writeFileSync(
          join(folder, 'result.json'),
          JSON.stringify(
            {
              appRoot,
              builtinHandshake: result,
              isolatedCodexHome: true,
              noAuthenticationOrModelRequest: true,
              calls,
            },
            null,
            2,
          ),
        )
      } else {
        const config = {
          kind: 'custom',
          command: process.execPath,
          args: [resolve('tests/fixtures/acp-agent.mjs'), 'permission'],
          name: 'Fixture ACP',
        }
        await evaluate(async (config) => {
          const snapshot = await window.questbranch.snapshot()
          await window.questbranch.command({
            type: 'save-settings',
            settings: { ...snapshot.settings, backend: 'acp', agent: config },
          })
        }, config)
        await wait(() =>
          evaluate(() =>
            document
              .querySelector('.research-composer [aria-label="模型与连接"]')
              ?.textContent.includes('Fixture ACP'),
          ),
        )
        await evaluate(() =>
          document.querySelector('.research-composer [aria-label="模型与连接"]').click(),
        )
        await wait(() =>
          evaluate(() => !!document.querySelector('.connection-tabs [aria-selected="true"]')),
        )
        assert.equal(
          await evaluate(
            () => document.querySelector('.connection-tabs [aria-selected="true"]').textContent,
          ),
          '智能体',
        )
        await click('连接')
        await wait(() =>
          evaluate(() =>
            document.querySelector('.provider-status')?.textContent.includes('已连接'),
          ),
        )
        assert(
          await evaluate(() =>
            [...document.querySelectorAll('.models-modal .field')].some((field) =>
              field.textContent.includes('Fixture Deep'),
            ),
          ),
        )
        await evaluate(() => {
          const field = [...document.querySelectorAll('.models-content .field')].find((field) =>
            field.textContent.trim().startsWith('模型'),
          )
          const select = field.querySelector('select')
          select.scrollIntoView({ block: 'center' })
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(
            select,
            'fixture-deep',
          )
          select.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await wait(() =>
          evaluate(() =>
            [...document.querySelectorAll('.models-content select')].some(
              (select) => select.value === 'fixture-deep' && !select.disabled,
            ),
          ),
        )
        await capture('connection')
        await click('使用此智能体')
        await wait(() => evaluate(() => !document.querySelector('[role="dialog"]')))
        const nodeId = await evaluate(
          () =>
            document.querySelector('.research-card.is-selected').dataset.id ||
            document.querySelector('.react-flow__node.selected')?.dataset.id,
        )
        await evaluate(() => document.querySelector('.details-panel [role="tab"]').click())
        await wait(() =>
          evaluate(() =>
            document
              .querySelector('.details-panel [role="tab"][aria-selected="true"]')
              ?.textContent.includes('对话'),
          ),
        )
        // Native DOM input event exercises React, IME remains governed by the existing composer.
        await evaluate(() => {
          const input = document.querySelector('.research-composer textarea')
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
            input,
            '继续研究并查阅新资料',
          )
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await wait(() =>
          evaluate(() =>
            [...document.querySelectorAll('.research-composer button')].some(
              (button) => button.getAttribute('aria-label') === '发送消息' && !button.disabled,
            ),
          ),
        )
        await evaluate(() => document.querySelector('[aria-label="发送消息"]').click())
        await wait(() => evaluate(() => !!document.querySelector('.agent-request')))
        assert(await evaluate(() => !!document.querySelector('.agent-tool summary')))
        await revealRequest()
        await capture('permission')
        await click('允许一次')
        await wait(() =>
          evaluate(
            () =>
              !document.querySelector('.chat-progress') &&
              document
                .querySelector('.chat-message.assistant .chat-message-content')
                ?.textContent.includes('原生工具'),
          ),
        )
        await capture('chat')
        const state = await evaluate(() => window.questbranch.snapshot())
        const run = state.runs.at(-1)
        assert.equal(run.status, 'completed')
        assert.equal(run.model, 'fixture-deep')
        assert.equal(run.agent.activities[0].status, 'completed')
        assert(!JSON.stringify(run.agent).includes('RAW_DEBUG_ONLY'))
        assert.equal(await evaluate(() => !!document.querySelector('.raw-details')), false)
        // Retain coverage of the legacy report API; ordinary UI saving now uses the chat tool.
        await click('研究报告', '[role="tab"]')
        await evaluate(async () => {
          const current = await window.questbranch.snapshot()
          return window.questbranch.command({
            type: 'start-research',
            nodeId: current.views[current.workspaces[0].id].selectedId,
            instruction: '研究并保存报告',
          })
        })
        await wait(() => evaluate(() => !!document.querySelector('.agent-request')))
        await revealRequest()
        await click('允许一次')
        await wait(() =>
          evaluate(
            () =>
              document.querySelector('.report-body')?.textContent.includes('ACP 研究报告') ||
              document.querySelector('.markdown')?.textContent.includes('ACP 研究报告'),
          ),
        )
        await capture('report')
        const after = await evaluate(() => window.questbranch.snapshot())
        assert(after.reports.some((report) => report.title === 'ACP 阶段报告'))
        if (process.argv.includes('--branching-ui')) {
          await evaluate(() => document.querySelector('[aria-label="添加研究方向"]').click())
          await wait(() => evaluate(() => !!document.querySelector('[aria-label="来源报告"]')))
          await evaluate(() => {
            const select = document.querySelector('[aria-label="来源报告"]')
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(
              select,
              'report-visual',
            )
            select.dispatchEvent(new Event('change', { bubbles: true }))
            const input = document.querySelector('.modal textarea')
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
              input,
              '缩放验收：按历史来源继续研究',
            )
            input.dispatchEvent(new Event('input', { bubbles: true }))
          })
          await capture('branch-source-picker')
          await evaluate(() =>
            document.querySelector('.modal .primary').scrollIntoView({ block: 'center' }),
          )
          assert(
            await evaluate(() => {
              const rect = document.querySelector('.modal .primary').getBoundingClientRect()
              return rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth
            }),
          )
          await click('添加研究方向', '.modal button')
          await wait(() => evaluate(() => !!document.querySelector('.report-origin')))
          assert(
            await evaluate(() => {
              const rect = document.querySelector('.report-origin').getBoundingClientRect()
              return (
                rect.height >= 32 &&
                rect.top >= 0 &&
                rect.bottom <= innerHeight &&
                rect.right <= innerWidth
              )
            }),
          )
          assert(
            await evaluate(() => document.querySelector('[aria-label="添加研究方向"]').disabled),
          )
          await capture('branch-source-detail')
          await evaluate(() => document.querySelector('.report-origin').click())
          await wait(() =>
            evaluate(() =>
              document
                .querySelector('[aria-label="选择报告历史版本"]')
                ?.textContent.includes('历史版本 1'),
            ),
          )
          await evaluate(() => document.querySelector('[aria-label="分支比较"]').click())
          await wait(() =>
            evaluate(() => !!document.querySelector('.comparison-config > .compare-version')),
          )
          await capture('branch-comparison-narrow')
          await evaluate(() =>
            document.querySelector('.modal .primary').scrollIntoView({ block: 'center' }),
          )
          assert(
            await evaluate(() => {
              const rect = document.querySelector('.modal .primary').getBoundingClientRect()
              return rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth
            }),
          )
          await capture('branch-comparison-footer')
          await click('关闭', '.modal button')
        }
        const exported = await evaluate(
          (id) => window.questbranch.exportWorkspace(id),
          after.runs.at(-1).workspaceId,
        )
        assert(exported.runs.at(-1).agent.sessionId)
        const overflow = await evaluate(() => document.documentElement.scrollWidth > innerWidth)
        assert(!overflow)
        const beforeReload = after.runs.at(-1).id
        await window.webContents.reload()
        await wait(() => evaluate(() => !!document.querySelector('.research-composer')))
        assert(
          (await evaluate(() => window.questbranch.snapshot())).runs.some(
            (run) => run.id === beforeReload && run.agent.activities.length,
          ),
        )
        writeFileSync(
          join(folder, 'result.json'),
          JSON.stringify(
            {
              appRoot,
              theme,
              width,
              zoom,
              nodeId,
              calls,
              chatAndReport: true,
              nativePermissionUI: true,
              nativeConfigurationUI: true,
              toolActivityPersisted: true,
              reload: true,
              export: true,
              noPageOverflow: true,
              noRawDiagnostics: true,
              isolatedProfile: true,
              fixtureNotRealModel: true,
              branchingUI: process.argv.includes('--branching-ui'),
            },
            null,
            2,
          ),
        )
      }
      console.log(JSON.stringify({ folder, builtin, success: true }))
      clearTimeout(timeout)
      app.quit()
    } catch (error) {
      await capture('failed')
      writeFileSync(join(folder, 'failed.txt'), error.stack)
      console.error(error.stack, folder)
      clearTimeout(timeout)
      await evaluate(
        async (ids) => {
          for (const run of (await window.questbranch.snapshot()).runs.filter(
            (run) => run.status === 'running',
          ))
            await window.questbranch.command({ type: 'cancel-research', runId: run.id })
          for (const id of ids) await window.questbranch.agent.disconnect(id).catch(() => {})
        },
        [...liveConnections],
      ).catch(() => {})
      app.exit(1)
    }
  })
})
await import(pathToFileURL(join(appRoot, 'out/main/index.js')).href)
