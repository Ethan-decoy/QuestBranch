import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '../components'
import { useApp } from '../state'
import { ThemeSwitcher, useTheme } from '../theme'
import { useTranslation } from 'react-i18next'

function ResetLayoutButton() {
  const { t } = useTranslation()
  const resetLayout = useApp((s) => s.resetLayout)
  const theme = useTheme((s) => s.theme)
  const animations = useRef<Animation[]>([])
  const [completed, setCompleted] = useState(0)
  useEffect(() => () => animations.current.forEach((animation) => animation.cancel()), [theme])
  return (
    <>
      <Button
        type="button"
        onClick={(event) => {
          animations.current.forEach((animation) => animation.cancel())
          animations.current = []
          if (!resetLayout()) {
            setCompleted(0)
            return
          }
          const button = event.currentTarget
          const style = getComputedStyle(button)
          const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
          const normal = {
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            color: style.color,
            boxShadow: style.boxShadow,
          }
          const accent = style.getPropertyValue('--color-action').trim()
          const highlight = {
            backgroundColor: style.getPropertyValue('--color-success-surface').trim(),
            borderColor: accent,
            color: style.getPropertyValue('--color-action-text').trim(),
            boxShadow: reduced
              ? normal.boxShadow
              : `0 0 0 4px color-mix(in srgb, ${accent} 20%, transparent)`,
          }
          animations.current.push(
            button.animate(
              reduced
                ? [highlight, highlight]
                : [
                    { ...normal, offset: 0 },
                    { ...highlight, offset: 0.35 },
                    { ...normal, offset: 1 },
                  ],
              { duration: reduced ? 700 : 1050, easing: 'ease-in-out' },
            ),
          )
          const icon = button.querySelector('svg')
          if (icon && !reduced)
            animations.current.push(
              icon.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-360deg)' }], {
                duration: 420,
                easing: 'cubic-bezier(.2,.7,.2,1)',
              }),
            )
          setCompleted((count) => count + 1)
        }}
      >
        <RotateCcw size={14} aria-hidden="true" />
        {t('恢复默认布局')}
      </Button>
      <span className="sr-only" role="status">
        {completed > 0 && <span key={completed}>{t('已恢复默认布局')}</span>}
      </span>
    </>
  )
}

export function AppearancePanel() {
  const { t } = useTranslation()
  return (
    <>
      {' '}
      <h3 className="settings-section-title">{t('视觉风格')}</h3>
      <div className="settings-preference-group">
        <div className="settings-preference-row">
          <strong>{t('模式')}</strong>
          <ThemeSwitcher />
        </div>
      </div>
      <div className="settings-preference-group">
        <div className="settings-preference-row">
          <strong>{t('主题')}</strong>
          <span className="appearance-current-theme">
            <span className="appearance-palette" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            {t('问之')}
          </span>
        </div>
        <div className="settings-preference-row">
          <strong>{t('分栏布局')}</strong>
          <ResetLayoutButton />
        </div>
      </div>
    </>
  )
}
