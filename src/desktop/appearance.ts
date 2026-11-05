import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import appIcon from '../../build/icon.png?asset'
import appIconDark from '../../build/icon-dark.png?asset'

function windowIcon() {
  // Windows shell colors are independent of the app preference and OS app mode.
  const dark =
    process.platform === 'win32'
      ? nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
      : nativeTheme.shouldUseDarkColors
  return dark ? appIconDark : appIcon
}

function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? '#101213' : '#f6f7f7'
}

export function windowAppearance() {
  return { icon: windowIcon(), backgroundColor: windowBackground() }
}

export function installNativeAppearance() {
  let currentIcon = windowIcon()
  const backgrounds = new WeakMap<BrowserWindow, string>()
  const syncBackground = (window: BrowserWindow) => {
    const color = windowBackground()
    if (backgrounds.get(window) === color) return
    window.setBackgroundColor(color)
    backgrounds.set(window, color)
  }
  const update = () => {
    const icon = windowIcon()
    const iconChanged = icon !== currentIcon
    for (const window of BrowserWindow.getAllWindows()) {
      syncBackground(window)
      if (iconChanged && process.platform !== 'darwin') window.setIcon(icon)
    }
    if (iconChanged && process.platform === 'darwin') app.dock?.setIcon(icon)
    currentIcon = icon
  }
  if (process.platform === 'darwin') app.dock?.setIcon(currentIcon)
  ipcMain.handle('appearance:theme', (event, theme: unknown) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') throw new Error('未知主题')
    nativeTheme.themeSource = theme
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) syncBackground(window)
  })
  nativeTheme.on('updated', update)
  return () => {
    nativeTheme.removeListener('updated', update)
    ipcMain.removeHandler('appearance:theme')
  }
}
