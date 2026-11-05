export type Theme = 'light' | 'dark'

// Stored values identify a branch. Only its displayed value changes with theme.
export const branchDisplayPalette: Record<string, Record<Theme, string>> = {
  '#4e806d': { light: '#376f60', dark: '#73ac9b' },
  '#7186aa': { light: '#466796', dark: '#87a7d4' },
  '#b38a5b': { light: '#7e6536', dark: '#bea475' },
  '#a88092': { light: '#83576b', dark: '#c291a6' },
  '#7d8d61': { light: '#6c5d89', dark: '#a898c7' },
}

function luminance(rgb: number[]) {
  return rgb
    .map((value) => value / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
}
const channels = (color: string) =>
  [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16))
const surfaces = {
  light: ['#f6f7f7', '#ffffff', '#f5f5f6', '#def2e8'].map((color) => luminance(channels(color))),
  dark: ['#101213', '#24272a', '#363b41', '#234234'].map((color) => luminance(channels(color))),
}
const imported = new Map<string, string>()

export function displayBranchColor(color: string, theme: Theme): string {
  const identity = color.toLowerCase()
  if (!/^#[a-f0-9]{6}$/i.test(identity)) return branchDisplayPalette['#4e806d'][theme]
  const known = branchDisplayPalette[identity]
  if (known) return known[theme]
  const key = theme + identity
  const cached = imported.get(key)
  if (cached) return cached
  let rgb = channels(identity)
  // Imported markers retain their hue when visible; only otherwise mix toward
  // a neutral until they clear supported surfaces. Storage remains untouched.
  for (let step = 0; step < 40; step++) {
    const foreground = luminance(rgb)
    if (
      surfaces[theme].every(
        (background) =>
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) >=
          3.1,
      )
    )
      break
    rgb = rgb.map((value) => Math.round(value * 0.9 + (theme === 'dark' ? 255 : 0) * 0.1))
  }
  const result = '#' + rgb.map((value) => value.toString(16).padStart(2, '0')).join('')
  if (imported.size >= 512) imported.clear()
  imported.set(key, result)
  return result
}
