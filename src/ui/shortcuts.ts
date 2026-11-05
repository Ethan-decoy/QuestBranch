import { create } from 'zustand'

export type SendShortcut = 'enter' | 'mod-enter'
const storageKey = 'questbranch-shortcuts'
type KeyEvent = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  repeat: boolean
  isComposing: boolean
  keyCode: number
}

export function shouldSendMessage(event: KeyEvent, shortcut: SendShortcut, composing = false) {
  if (
    event.key !== 'Enter' ||
    composing ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    event.shiftKey ||
    event.altKey
  )
    return false
  return shortcut === 'enter' || event.ctrlKey || event.metaKey
}

export function readSendShortcut(storage?: Pick<Storage, 'getItem'>): SendShortcut {
  try {
    const saved = JSON.parse(storage?.getItem(storageKey) ?? 'null')
    return saved?.sendMessage === 'mod-enter' ? 'mod-enter' : 'enter'
  } catch {
    return 'enter'
  }
}

export const useShortcuts = create<{
  sendMessage: SendShortcut
  persistent: boolean
  chooseSend(shortcut: SendShortcut): void
}>((set) => ({
  sendMessage: (() => {
    try {
      return readSendShortcut(globalThis.localStorage)
    } catch {
      return 'enter'
    }
  })(),
  persistent: true,
  chooseSend(sendMessage) {
    let persistent = true
    try {
      localStorage.setItem(storageKey, JSON.stringify({ sendMessage }))
    } catch {
      persistent = false
    }
    set({ sendMessage, persistent })
  },
}))

export const modifierKey =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
export const sendShortcutLabel = (shortcut: SendShortcut) =>
  shortcut === 'enter' ? 'Enter' : `${modifierKey} + Enter`
