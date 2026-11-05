import { Feedback } from '../components'
import { modifierKey, useShortcuts, type SendShortcut } from '../shortcuts'
import { useTranslation } from 'react-i18next'

export function ShortcutsPanel() {
  const { t } = useTranslation()
  const { sendMessage, persistent, chooseSend } = useShortcuts()
  return (
    <>
      <h3 className="settings-section-title">{t('对话')}</h3>
      <div className="settings-preference-group">
        <div className="settings-preference-row">
          <strong>{t('发送消息')}</strong>
          <select
            aria-label={t('发送消息快捷键')}
            value={sendMessage}
            onChange={(event) => chooseSend(event.target.value as SendShortcut)}
          >
            {/* i18next-instrument-ignore: physical key names */}
            <option value="enter">Enter</option>
            {/* i18next-instrument-ignore: physical key names */}
            <option value="mod-enter">{modifierKey} + Enter</option>
          </select>
        </div>
        <div className="settings-preference-row">
          <strong>{t('换行')}</strong>
          <kbd>{sendMessage === 'enter' ? 'Shift + Enter' : 'Enter'}</kbd>
        </div>
      </div>
      <h3 className="settings-section-title shortcuts-heading">{t('工作台')}</h3>
      <div className="settings-preference-group">
        {(
          [
            [t('搜索研究'), `${modifierKey} + K`],
            [t('打开设置'), `${modifierKey} + ,`],
            [t('关闭面板'), 'Esc'],
          ] as const
        ).map(([label, keys]) => (
          <div className="settings-preference-row" key={label}>
            <strong>{label}</strong>
            <kbd>{keys}</kbd>
          </div>
        ))}
      </div>
      {!persistent && (
        <Feedback tone="error">{t('快捷键仅在当前窗口生效，无法保存到本机。')}</Feedback>
      )}
    </>
  )
}
