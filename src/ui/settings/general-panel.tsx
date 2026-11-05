import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { chooseLanguage, type UiLanguage } from '../../i18n'
import { Feedback } from '../components'

export function GeneralPanel() {
  const { t, i18n } = useTranslation()
  const [changing, setChanging] = useState(false)
  const [persistent, setPersistent] = useState(true)
  return (
    <>
      <h3 className="settings-section-title">{t('语言')}</h3>
      <div className="settings-preference-group">
        <div className="settings-preference-row">
          <strong>{t('界面语言')}</strong>
          <select
            aria-label={t('界面语言')}
            value={i18n.resolvedLanguage}
            disabled={changing}
            onChange={async (event) => {
              setChanging(true)
              try {
                setPersistent(await chooseLanguage(event.target.value as UiLanguage))
              } finally {
                setChanging(false)
              }
            }}
          >
            {/* i18next-instrument-ignore: language autonym */}
            <option value="zh-CN" lang="zh-CN">
              简体中文
            </option>
            {/* i18next-instrument-ignore: language autonym */}
            <option value="en" lang="en">
              English
            </option>
          </select>
        </div>
      </div>
      {!persistent && (
        <Feedback tone="error">{t('语言仅在当前窗口生效，无法保存到本机。')}</Feedback>
      )}
    </>
  )
}
