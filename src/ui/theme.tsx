import { create } from 'zustand'
import { Check } from 'lucide-react'
import { useId } from 'react'
import { client } from './client'
import { SignalIcon } from './components'
import type { Theme } from './theme-colors'
import { useTranslation } from 'react-i18next'

type ThemeMode = Theme | 'system'
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const resolveTheme = (mode: ThemeMode): Theme =>
  mode === 'system' ? (systemTheme.matches ? 'dark' : 'light') : mode

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.documentElement.style.backgroundColor = theme === 'dark' ? '#101213' : '#f6f7f7'
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#101213' : '#f6f7f7')
}
const savedMode = document.documentElement.dataset.themeMode
const initial: ThemeMode =
  savedMode === 'system' || savedMode === 'dark' || savedMode === 'light'
    ? savedMode
    : document.documentElement.dataset.theme === 'dark'
      ? 'dark'
      : 'light'
function applyMode(mode: ThemeMode) {
  document.documentElement.dataset.themeMode = mode
  apply(resolveTheme(mode))
  void client.appearance?.setTheme(mode).catch(() => {})
}
applyMode(initial)
export const useTheme = create<{
  theme: Theme
  mode: ThemeMode
  persistent: boolean
  choose(mode: ThemeMode): void
}>((set) => ({
  theme: resolveTheme(initial),
  mode: initial,
  persistent: true,
  choose(mode) {
    let persistent = true
    try {
      localStorage.setItem('questbranch-theme', mode)
    } catch {
      persistent = false
    }
    // Set the preference before the native update can emit a media-query change.
    set({ mode, theme: resolveTheme(mode), persistent })
    applyMode(mode)
  },
}))

systemTheme.addEventListener('change', () => {
  if (useTheme.getState().mode !== 'system') return
  const theme = resolveTheme('system')
  apply(theme)
  useTheme.setState({ theme })
})

function ThemeMiniature({ theme }: { theme: Theme }) {
  return (
    <svg className="theme-miniature" data-preview-theme={theme} viewBox="0 0 112 68">
      <rect className="miniature-surface" x="0.5" y="0.5" width="111" height="67" rx="5" />
      <path
        className="miniature-canvas"
        d="M5 1h15v66H5a4 4 0 0 1-4-4V5a4 4 0 0 1 4-4ZM21 1h55v66H21Z"
      />
      <path className="miniature-divider" d="M20.5 1v66M76.5 1v66" />
      <rect className="miniature-accent" x="6" y="7" width="7" height="4" rx="1" />
      <path className="miniature-lines" d="M6 19h9M6 25h7M9 34h6M9 40h5" />
      <path
        className="miniature-edges"
        d="M43 34h4q3 0 3-3V20q0-3 3-3h3M43 34h4q3 0 3 3v11q0 3 3 3h3"
      />
      <rect className="miniature-selected" x="26" y="28" width="17" height="12" rx="2" />
      <rect className="miniature-node" x="56" y="12" width="15" height="10" rx="2" />
      <rect className="miniature-node" x="56" y="46" width="15" height="10" rx="2" />
      <path
        className="miniature-lines"
        d="M30 32h9M30 36h6M59 16h8M59 50h8M82 17h23M82 23h19M82 29h23M82 35h16M82 44h23M82 50h20M82 56h14"
      />
      <path className="miniature-heading" d="M82 9h18" />
    </svg>
  )
}

export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { theme, mode, choose, persistent } = useTheme()
  const name = useId()
  return (
    <div className="theme-preference">
      <fieldset className="theme-switch">
        <legend className="sr-only">{t('界面主题')}</legend>
        {(
          [
            ['system', t('跟随系统')],
            ['light', t('亮色')],
            ['dark', t('深色')],
          ] as const
        ).map(([value, label]) => (
          <label className="theme-option" key={value}>
            <input
              type="radio"
              name={name}
              value={value}
              aria-label={t('{{label}}主题', { label })}
              checked={mode === value}
              onChange={() => choose(value)}
              title={
                value === 'system'
                  ? t('跟随系统（当前{{val}}）', { val: theme === 'dark' ? t('深色') : t('亮色') })
                  : label
              }
            />
            <span className="theme-mode-preview" aria-hidden="true">
              <ThemeMiniature theme={value === 'system' ? 'light' : value} />
              {value === 'system' && <ThemeMiniature theme="dark" />}
            </span>
            <span className="theme-mode-caption">
              {label}
              <Check className="theme-option-check" size={12} aria-hidden="true" />
            </span>
          </label>
        ))}
      </fieldset>
      {!persistent && (
        <small role="status">
          <SignalIcon tone="warning" size={14} />
          {t('当前环境无法记住主题，本次切换仍然生效。')}
        </small>
      )}
    </div>
  )
}
