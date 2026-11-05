import { describe, expect, it } from 'vitest'
import {
  defaultWorkbenchWidths,
  readWorkbenchWidths,
  resizeWorkbenchPane,
  saveWorkbenchWidths,
  workbenchLayout,
} from '../src/ui/workbench-layout'

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

describe('三栏布局偏好', () => {
  it('首次打开按扣除分隔条的净宽分配16/50/34，默认布局随窗口变化', () => {
    for (const width of [1280, 1440, 1560, 1920]) {
      const layout = workbenchLayout(width, defaultWorkbenchWidths)
      const available = width - 24
      expect(layout.navigation).toBeCloseTo(available * 0.16)
      expect(layout.graph).toBeCloseTo(available * 0.5)
      expect(layout.detail).toBeCloseTo(available * 0.34)
    }
  })
  it('一次调整只改变相邻两栏，不使另一侧随默认百分比跳动', () => {
    const initial = workbenchLayout(1560, defaultWorkbenchWidths)
    const navigation = workbenchLayout(
      1560,
      resizeWorkbenchPane(initial, defaultWorkbenchWidths, 'navigation', initial.navigation + 48),
    )
    expect(navigation.detail).toBe(initial.detail)
    expect(navigation.graph).toBeCloseTo(initial.graph - 48)
    const detail = workbenchLayout(
      1560,
      resizeWorkbenchPane(initial, defaultWorkbenchWidths, 'detail', initial.detail + 80),
    )
    expect(detail.navigation).toBe(initial.navigation)
    expect(detail.graph).toBeCloseTo(initial.graph - 80)
  })
  it('拖动到极端位置仍保留图谱和阅读区域的最小可用空间', () => {
    const initial = workbenchLayout(1280, defaultWorkbenchWidths)
    for (const pane of ['navigation', 'detail'] as const)
      for (const value of [-10000, 10000]) {
        const layout = workbenchLayout(
          1280,
          resizeWorkbenchPane(initial, defaultWorkbenchWidths, pane, value),
        )
        expect(layout.navigation).toBeGreaterThanOrEqual(200)
        expect(layout.navigation).toBeLessThanOrEqual(360)
        expect(layout.graph).toBeGreaterThanOrEqual(400)
        expect(layout.detail).toBeGreaterThanOrEqual(360)
        expect(layout.navigation + layout.graph + layout.detail).toBeCloseTo(1256)
      }
  })
  it('窗口收窄时临时约束宽度，重新放大后恢复原有偏好', () => {
    const preferred = { navigation: 300, detail: 800 }
    const narrow = workbenchLayout(1150, preferred)
    expect(narrow.detail).toBeLessThan(800)
    expect(narrow.graph).toBe(400)
    const restored = workbenchLayout(1840, preferred)
    expect(restored.navigation).toBe(300)
    expect(restored.detail).toBe(800)
    expect(preferred).toEqual({ navigation: 300, detail: 800 })
  })
  it('导航隐藏时调整报告宽度，保留导航原有偏好', () => {
    const preferred = { navigation: 280, detail: 500 }
    const hidden = workbenchLayout(1560, preferred, false)
    const resized = resizeWorkbenchPane(hidden, preferred, 'detail', 560)
    expect(resized.navigation).toBe(280)
    expect(workbenchLayout(1560, resized).navigation).toBe(280)
  })
  it('保留旧版手动报告宽度，恢复默认后重启不再读回旧值', () => {
    const local = storage({ 'questbranch-panel-width': '600' })
    expect(readWorkbenchWidths(local)).toEqual({ navigation: null, detail: 600 })
    saveWorkbenchWidths(local, { navigation: 260, detail: 580 })
    expect(readWorkbenchWidths(local)).toEqual({ navigation: 260, detail: 580 })
    saveWorkbenchWidths(local, defaultWorkbenchWidths)
    expect(readWorkbenchWidths(local)).toEqual(defaultWorkbenchWidths)
    expect(local.getItem('questbranch-panel-width')).toBeNull()
  })
  it('损坏或被禁用的本机存储不会向布局注入无效尺寸', () => {
    for (const value of ['broken', 'null', '42', '{"navigation":-1,"detail":"Infinity"}'])
      expect(readWorkbenchWidths(storage({ 'questbranch-workbench-layout': value }))).toEqual(
        defaultWorkbenchWidths,
      )
    expect(
      readWorkbenchWidths({
        getItem() {
          throw Error('blocked')
        },
      }),
    ).toEqual(defaultWorkbenchWidths)
  })
})
