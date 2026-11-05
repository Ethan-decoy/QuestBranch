export type WorkbenchWidths = { navigation: number | null; detail: number | null }
export type WorkbenchPane = keyof WorkbenchWidths

const storageKey = 'questbranch-workbench-layout'
const legacyKey = 'questbranch-panel-width'
export const splitterWidth = 12
export const defaultWorkbenchWidths: WorkbenchWidths = { navigation: null, detail: null }
const validWidth = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function readWorkbenchWidths(storage: Pick<Storage, 'getItem'>): WorkbenchWidths {
  try {
    const saved = storage.getItem(storageKey)
    if (saved) {
      const value: unknown = JSON.parse(saved)
      if (value && typeof value === 'object')
        return {
          navigation:
            'navigation' in value && validWidth(value.navigation) ? value.navigation : null,
          detail: 'detail' in value && validWidth(value.detail) ? value.detail : null,
        }
    } else {
      const legacy = Number(storage.getItem(legacyKey))
      if (legacy >= 340 && legacy <= 680) return { navigation: null, detail: legacy }
    }
  } catch {
    // A damaged preference must not prevent the research workspace from opening.
  }
  return { ...defaultWorkbenchWidths }
}

export function saveWorkbenchWidths(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  widths: WorkbenchWidths,
): boolean {
  try {
    storage.setItem(storageKey, JSON.stringify(widths))
    storage.removeItem(legacyKey)
    return true
  } catch {
    return false
  }
}

export function workbenchLayout(
  width: number,
  preferred: WorkbenchWidths,
  navigationVisible = true,
) {
  const available = Math.max(0, width - splitterWidth * (navigationVisible ? 2 : 1))
  // Compact presentation uses one pane; scaling keeps its hidden tracks well defined too.
  const scale = Math.min(1, available / (navigationVisible ? 960 : 760))
  const navigationMin = navigationVisible ? 200 * scale : 0
  const detailMin = 360 * scale
  const graphMin = 400 * scale
  const navigation = navigationVisible
    ? clamp(
        preferred.navigation ?? available * 0.16,
        navigationMin,
        Math.min(360, available - detailMin - graphMin),
      )
    : 0
  const detail = clamp(
    preferred.detail ?? available * 0.34,
    detailMin,
    available - navigation - graphMin,
  )
  return {
    navigation,
    detail,
    graph: Math.max(0, available - navigation - detail),
    limits: {
      navigation: { min: navigationMin, max: Math.min(360, available - detail - graphMin) },
      detail: { min: detailMin, max: available - navigation - graphMin },
    },
  }
}

export function resizeWorkbenchPane(
  layout: ReturnType<typeof workbenchLayout>,
  preferred: WorkbenchWidths,
  pane: WorkbenchPane,
  value: number,
): WorkbenchWidths {
  if (!Number.isFinite(value)) return preferred
  return {
    navigation: layout.navigation > 0 ? layout.navigation : preferred.navigation,
    detail: layout.detail,
    [pane]: clamp(value, layout.limits[pane].min, layout.limits[pane].max),
  }
}
