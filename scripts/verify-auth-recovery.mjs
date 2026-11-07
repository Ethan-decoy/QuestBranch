import { app, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopPackage } from './desktop-package.mjs'

// Real UI, isolated storage, simulated OAuth only. Never opens a real authorization page.
mkdirSync(resolve('artifacts/auth-recovery'), { recursive: true })
const folder = mkdtempSync(resolve('artifacts/auth-recovery/check-'))
const profile = join(folder, 'profile')
mkdirSync(profile)
app.setPath('userData', profile)
app.disableHardwareAcceleration()
delete process.env.QUESTBRANCH_DATA_DIR
delete process.env.ELECTRON_RENDERER_URL
const packageRoot = process.argv
  .find((argument) => argument.startsWith('--package-root='))
  ?.slice(15)
const appRoot = packageRoot ? desktopPackage(packageRoot).archive : resolve('.')
const sessions = new Map()
const calls = {}
const cases = []
let connected = false
let holdStart = false
let releaseStart
let holdStatus = false
let releaseStatus
let failStatus = false
let nextPrompt
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    calls[channel] = (calls[channel] ?? 0) + 1
    if (channel === 'research:command') assert.equal(args[1].type, 'save-view')
    if (channel === 'research:test') {
      const result = await listener(...args)
      return { ...result, status: connected ? 'configured' : 'login-required' }
    }
    if (channel === 'models:auth-start') {
      assert(
        ![...sessions.values()].some((session) => session.status === 'pending'),
        'Old authorization must be cancelled before retry',
      )
      const id = 'fixture-login-' + calls[channel]
      const session = {
        id,
        provider: 'openai',
        status: 'pending',
        message: '请在浏览器中完成授权',
        url: 'https://example.invalid/authorize?session=' + id,
      }
      if (nextPrompt) {
        session.prompt = nextPrompt
        nextPrompt = undefined
      }
      sessions.set(id, session)
      if (holdStart) {
        holdStart = false
        await new Promise((resolve) => {
          releaseStart = resolve
        })
      }
      return structuredClone(session)
    }
    if (channel === 'models:auth-status') {
      if (failStatus) {
        failStatus = false
        throw Error('隔离测试：状态查询暂不可用')
      }
      const result = structuredClone(sessions.get(args[1]))
      if (holdStatus) {
        holdStatus = false
        await new Promise((resolve) => {
          releaseStatus = resolve
        })
      }
      return result
    }
    if (channel === 'models:auth-cancel') {
      const session = sessions.get(args[1])
      if (session?.status === 'pending') session.status = 'cancelled'
      return
    }
    if (channel === 'models:auth-respond') {
      const session = sessions.get(args[1])
      assert.equal(args[2], session.prompt.id)
      assert.equal(args[3], 'fixture-code-not-real')
      session.status = 'connected'
      delete session.prompt
      connected = true
      return
    }
    return listener(...args)
  })
const timeout = setTimeout(() => app.exit(1), 90000)
app.on('browser-window-created', (_, window) => {
  window.setContentSize(1440, 900)
  window.webContents.setBackgroundThrottling(false)
  window.webContents.once('did-finish-load', async () => {
    const evaluate = (fn, value) =>
      window.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value)})`)
    const pause = (ms = 100) => new Promise((done) => setTimeout(done, ms))
    const capture = async (name) => {
      window.focus()
      window.webContents.invalidate()
      // Wake the compositor before capturing an otherwise occluded test window.
      await window.webContents.capturePage()
      await pause(200)
      writeFileSync(join(folder, name), (await window.webContents.capturePage()).toPNG())
    }
    const wait = async (fn) => {
      for (let n = 0; n < 120; n++) {
        if (await fn()) return
        await pause(50)
      }
      throw Error('UI timeout: ' + fn)
    }
    const click = (selector) =>
      evaluate((selector) => {
        const button = document.querySelector(selector)
        assertButton(button)
        function assertButton(element) {
          if (!element || element.disabled) throw Error('Unavailable control: ' + selector)
        }
        button.scrollIntoView({ block: 'nearest' })
        button.click()
      }, selector)
    const key = async (keyCode) => {
      window.focus()
      window.webContents.focus()
      for (const type of ['keyDown', 'keyUp']) window.webContents.sendInputEvent({ type, keyCode })
      await pause()
    }
    const latest = () => [...sessions.values()].at(-1)
    const accountButton = '.model-connection-actions button:last-child'
    const open = async () => {
      await click('[aria-label="模型与连接"]')
      await wait(() =>
        evaluate(
          (selector) =>
            !!document.querySelector(selector) && !document.querySelector(selector).disabled,
          accountButton,
        ),
      )
    }
    const start = async () => {
      const count = calls['models:auth-start'] ?? 0
      await click(accountButton)
      await wait(() => (calls['models:auth-start'] ?? 0) > count)
      return latest()
    }
    const waiting = () =>
      wait(() => evaluate(() => !!document.querySelector('[aria-label="账号授权"]')))
    const close = async (escape = true) => {
      const current = latest()
      if (escape) await key('Escape')
      else await click('[aria-label="关闭对话框"]')
      await wait(() => evaluate(() => !document.querySelector('.models-modal')))
      if (current?.status === 'pending') await wait(() => current.status === 'cancelled')
    }
    try {
      await wait(() => evaluate(() => !!document.querySelector('[aria-label="模型与连接"]')))
      await open()
      const first = await start()
      await waiting()
      await evaluate(() => window.dispatchEvent(new Event('focus')))
      const state = await evaluate(() => ({
        closeDisabled: document.querySelector('[aria-label="关闭对话框"]').disabled,
        retryAvailable: [...document.querySelectorAll('.model-connection-actions button')].some(
          (button) => button.textContent.includes('重新连接') && !button.disabled,
        ),
        canContinue: document
          .querySelector('.auth-interaction a')
          ?.textContent.includes('继续授权'),
      }))
      assert(
        !state.closeDisabled && state.retryAvailable && state.canContinue,
        JSON.stringify(state),
      )
      cases.push('abandoned-browser-remains-recoverable')
      await evaluate(() => {
        document.documentElement.dataset.theme = 'light'
        document.documentElement.style.colorScheme = 'light'
      })
      await capture('waiting-light.png')
      await evaluate(() => {
        document.documentElement.dataset.theme = 'dark'
        document.documentElement.style.colorScheme = 'dark'
      })
      await capture('waiting-dark.png')
      const retried = await start()
      await waiting()
      assert.equal(first.status, 'cancelled')
      assert.notEqual(retried.id, first.id)
      cases.push('retry-cancels-old-before-new')
      await click('.auth-actions button:first-child')
      await wait(() => retried.status === 'cancelled')
      await wait(() =>
        evaluate(
          (selector) =>
            !document.querySelector('.auth-interaction') &&
            !document.querySelector(selector).disabled,
          accountButton,
        ),
      )
      cases.push('cancel-button-releases-waiting')
      await start()
      await waiting()
      await close()
      cases.push('escape-cancels-pending')
      await pause(150)
      const closedQueries = calls['models:auth-status']
      await pause(700)
      assert.equal(calls['models:auth-status'], closedQueries)
      cases.push('close-stops-status-polling')
      await open()
      holdStatus = true
      const stale = await start()
      await waiting()
      await wait(() => !!releaseStatus)
      const replacement = await start()
      await waiting()
      releaseStatus()
      releaseStatus = undefined
      await pause(150)
      assert.equal(stale.status, 'cancelled')
      assert.equal(
        await evaluate(() => document.querySelector('.auth-interaction a')?.href),
        replacement.url,
      )
      cases.push('late-status-cannot-restore-old-session')
      await close(false)
      await open()
      holdStart = true
      const delayed = await start()
      await wait(() => !!releaseStart)
      await click('[aria-label="关闭对话框"]')
      await wait(() => evaluate(() => !document.querySelector('.models-modal')))
      releaseStart()
      releaseStart = undefined
      await wait(() => delayed.status === 'cancelled')
      cases.push('late-start-after-close-is-cancelled')
      await open()
      failStatus = true
      const unreadable = await start()
      await wait(() => evaluate(() => !!document.querySelector('.models-content [role="alert"]')))
      await wait(() => unreadable.status === 'cancelled')
      await start()
      await waiting()
      cases.push('status-failure-can-retry')
      await close()
      await open()
      const expired = await start()
      await waiting()
      expired.status = 'failed'
      expired.message = '连接超时，请重试'
      await evaluate(() => window.dispatchEvent(new Event('focus')))
      await wait(() => evaluate(() => !!document.querySelector('.models-content [role="alert"]')))
      await start()
      await waiting()
      cases.push('timeout-can-retry')
      await close()
      await open()
      const returning = await start()
      await waiting()
      await evaluate(() => {
        window.__authVisibility = 'hidden'
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => window.__authVisibility,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await pause(150)
      const hiddenQueries = calls['models:auth-status']
      await pause(700)
      assert.equal(calls['models:auth-status'], hiddenQueries)
      returning.status = 'connected'
      connected = true
      await evaluate(() => {
        window.__authVisibility = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event('focus'))
      })
      await wait(() =>
        evaluate(() =>
          document.querySelector('.provider-status')?.textContent.includes('账号已连接'),
        ),
      )
      cases.push('returning-to-qb-refreshes-authoritative-state')
      await close()
      connected = false
      await open()
      nextPrompt = { id: 'fixture-prompt', type: 'manual_code', message: '输入隔离测试授权码' }
      await start()
      await waiting()
      await evaluate(() => {
        const input = document.querySelector('.auth-interaction input')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
          input,
          'fixture-code-not-real',
        )
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await wait(() =>
        evaluate(() =>
          [...document.querySelectorAll('.auth-actions button')].some(
            (button) => button.textContent.trim() === '继续' && !button.disabled,
          ),
        ),
      )
      await click('.auth-actions button:last-child')
      await wait(() =>
        evaluate(() =>
          document.querySelector('.provider-status')?.textContent.includes('账号已连接'),
        ),
      )
      cases.push('manual-code-remains-supported')
      await close()
      assert(![...sessions.values()].some((session) => session.status === 'pending'))
      writeFileSync(
        join(folder, 'verified.json'),
        JSON.stringify(
          {
            folder,
            appRoot,
            profile,
            cases,
            calls,
            authStubbed: true,
            noRealBrowserOpened: true,
            isolatedProfile: true,
            noResearchGeneration: true,
            visibilityEventsSimulated: true,
            themeStyleOverrideOnly: true,
            noPendingSessions: true,
          },
          null,
          2,
        ),
      )
      console.log(JSON.stringify({ folder, passed: true, cases: cases.length }))
      clearTimeout(timeout)
      app.quit()
    } catch (error) {
      writeFileSync(join(folder, 'failed.txt'), error.stack)
      writeFileSync(join(folder, 'failure.png'), (await window.webContents.capturePage()).toPNG())
      console.error(error.stack)
      console.error(folder)
      clearTimeout(timeout)
      app.exit(1)
    }
  })
})
await import(pathToFileURL(join(appRoot, 'out/main/index.js')).href)
