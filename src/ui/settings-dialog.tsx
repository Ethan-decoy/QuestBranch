import { useId, useRef, useState } from 'react'
import { FolderOpen, Keyboard, Languages, Sun } from 'lucide-react'
import { Modal, Button, Feedback } from './components'
import { useApp } from './state'
import { AppearancePanel } from './settings/appearance-panel'
import { ShortcutsPanel } from './settings/shortcuts-panel'
import { StorageSettingsPanel, useStorageSettings } from './settings/storage-panel'
import { useTranslation } from 'react-i18next'
import { GeneralPanel } from './settings/general-panel'

export function SettingsDialog() {
  const { t } = useTranslation()
  const section = useApp((s) => s.settingsSection)
  const setSection = useApp((s) => s.setSettingsSection)
  const open = useApp((s) => s.open)
  const tabsId = useId()
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const storage = useStorageSettings({ setError, setMessage })
  const { relocating, choosingDirectory } = storage
  return (
    <Modal title={t('设置')} wide className="settings-modal" locked={relocating}>
      <div className="settings-layout">
        <div
          className="settings-tabs"
          role="tablist"
          aria-label={t('设置分类')}
          aria-orientation="vertical"
        >
          {(
            [
              ['general', Languages, t('通用')],
              ['appearance', Sun, t('外观')],
              ['shortcuts', Keyboard, t('快捷键')],
              ['storage', FolderOpen, t('本地存储')],
            ] as const
          ).map(([key, Icon, label], index, tabs) => (
            <button
              type="button"
              key={key}
              ref={(element) => {
                tabButtons.current[index] = element
              }}
              id={`${tabsId}-settings-tab-${key}`}
              role="tab"
              aria-controls={`${tabsId}-settings-panel-${key}`}
              aria-selected={section === key}
              tabIndex={section === key ? 0 : -1}
              disabled={relocating}
              onClick={() => setSection(key)}
              onKeyDown={(event) => {
                const target =
                  event.key === 'ArrowDown'
                    ? (index + 1) % tabs.length
                    : event.key === 'ArrowUp'
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : -1
                if (target < 0) return
                event.preventDefault()
                setSection(tabs[target][0])
                tabButtons.current[target]?.focus()
              }}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <fieldset className="settings-fields" disabled={relocating}>
          <div className="settings-content">
            <section
              role="tabpanel"
              id={`${tabsId}-settings-panel-general`}
              aria-labelledby={`${tabsId}-settings-tab-general`}
              hidden={section !== 'general'}
              tabIndex={0}
            >
              <GeneralPanel />
            </section>
            <section
              role="tabpanel"
              id={`${tabsId}-settings-panel-shortcuts`}
              aria-labelledby={`${tabsId}-settings-tab-shortcuts`}
              hidden={section !== 'shortcuts'}
              tabIndex={0}
            >
              <ShortcutsPanel />
            </section>
            <section
              role="tabpanel"
              id={`${tabsId}-settings-panel-appearance`}
              aria-labelledby={`${tabsId}-settings-tab-appearance`}
              hidden={section !== 'appearance'}
              tabIndex={0}
            >
              <AppearancePanel />
            </section>
            <section
              role="tabpanel"
              id={`${tabsId}-settings-panel-storage`}
              aria-labelledby={`${tabsId}-settings-tab-storage`}
              hidden={section !== 'storage'}
              tabIndex={0}
            >
              <StorageSettingsPanel controller={storage} />
            </section>
          </div>
          {(message || error) && (
            <div className="settings-feedback">
              {message && <Feedback tone="success">{message}</Feedback>}
              {error && <Feedback tone="error">{error}</Feedback>}
            </div>
          )}
          <div className="modal-footer split settings-footer">
            <span className="settings-save-status" role="status">
              <span className="save-dot" />
              {section === 'general'
                ? t('设置即时保存')
                : section === 'appearance'
                  ? t('外观即时保存')
                  : section === 'shortcuts'
                    ? t('快捷键即时保存')
                    : t('已保存')}
            </span>
            <Button
              type="button"
              variant="primary"
              disabled={relocating || choosingDirectory}
              onClick={() => open(null)}
            >
              {t('完成')}
            </Button>
          </div>
        </fieldset>
      </div>
    </Modal>
  )
}
