import { describe, expect, it } from 'vitest'
import { readSendShortcut, shouldSendMessage } from '../src/ui/shortcuts'

const enter = {
  key: 'Enter',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  keyCode: 13,
}
describe('聊天发送快捷键', () => {
  it('默认 Enter 发送，Shift+Enter 换行，保留 Ctrl/Cmd+Enter 发送', () => {
    expect(shouldSendMessage(enter, 'enter')).toBe(true)
    expect(shouldSendMessage({ ...enter, shiftKey: true }, 'enter')).toBe(false)
    expect(shouldSendMessage({ ...enter, ctrlKey: true }, 'enter')).toBe(true)
    expect(shouldSendMessage({ ...enter, metaKey: true }, 'enter')).toBe(true)
  })
  it('切换到组合键模式后，Enter 换行且 Ctrl/Cmd+Enter 发送', () => {
    expect(shouldSendMessage(enter, 'mod-enter')).toBe(false)
    expect(shouldSendMessage({ ...enter, ctrlKey: true }, 'mod-enter')).toBe(true)
    expect(shouldSendMessage({ ...enter, metaKey: true }, 'mod-enter')).toBe(true)
  })
  it.each(['enter', 'mod-enter'] as const)(
    '%s 模式不误发中文输入法确认、按键长按或其他 Enter 组合',
    (shortcut) => {
      const key = { ...enter, ctrlKey: true }
      expect(shouldSendMessage(key, shortcut, true)).toBe(false)
      for (const patch of [
        { isComposing: true },
        { keyCode: 229 },
        { repeat: true },
        { shiftKey: true },
        { altKey: true },
        { key: 'a' },
      ])
        expect(shouldSendMessage({ ...key, ...patch }, shortcut)).toBe(false)
    },
  )
  it('无设置、损坏或无法访问本机设置时使用 Enter，读取已保存的组合键模式', () => {
    expect(readSendShortcut()).toBe('enter')
    expect(readSendShortcut({ getItem: () => 'invalid json' })).toBe('enter')
    expect(
      readSendShortcut({
        getItem: () => {
          throw new Error('storage unavailable')
        },
      }),
    ).toBe('enter')
    expect(readSendShortcut({ getItem: () => '{"sendMessage":"mod-enter"}' })).toBe('mod-enter')
  })
})
