import { app } from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Deterministic software compositing for screenshot checks on CI and occluded desktops.
app.disableHardwareAcceleration()

// Inspect only a fresh instance of this application; never reuse a person's research database.
const artifacts = resolve('artifacts')
mkdirSync(artifacts, { recursive: true })
process.env.QUESTBRANCH_DATA_DIR = mkdtempSync(resolve(artifacts, 'desktop-verification-'))
const width = Number(process.argv.find((arg) => arg.startsWith('--width='))?.split('=')[1] ?? 1440)
const height = Number(process.argv.find((arg) => arg.startsWith('--height='))?.split('=')[1] ?? 900)
let completed = false
const timeout = setTimeout(() => {
  console.error('桌面验收超时')
  app.exit(1)
}, 20000)
app.on('browser-window-created', (_, window) => {
  window.setContentSize(width, height)
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        if (!window.questbranch) throw new Error('沙箱预加载接口未建立');
        const snapshot = await window.questbranch.snapshot();
        await new Promise((resolve, reject) => {
          const start = Date.now();
          const poll = () => {
            if (document.querySelector('.research-card') && document.querySelector('.markdown')) resolve();
            else if (Date.now() - start > 10000) reject(new Error('研究画布或报告未呈现'));
            else setTimeout(poll, 50);
          }; poll();
        });
        return { preload: true, workspaces: snapshot.workspaces.length, nodes: snapshot.nodes.length, reports: snapshot.reports.length, visibleCards: document.querySelectorAll('.research-card').length, title: document.title };
      })()`)
      console.log('Desktop IPC and SQLite verified:', JSON.stringify(result))
      await new Promise((resolve) => setTimeout(resolve, 450))
      const capture = await window.webContents.capturePage()
      writeFileSync(resolve(artifacts, `desktop-${width}.png`), capture.toPNG())
      writeFileSync(
        resolve(artifacts, `desktop-verification-${width}.json`),
        JSON.stringify({ ...result, width, height }, null, 2),
      )
      console.log(JSON.stringify(result, null, 2))
      completed = true
      clearTimeout(timeout)
      app.quit()
    } catch (error) {
      console.error(error instanceof Error ? error.stack : '桌面验收失败')
      clearTimeout(timeout)
      app.exit(1)
    }
  })
})
process.on('exit', () => {
  if (!completed) process.exitCode = 1
})
await import('../out/main/index.js')
