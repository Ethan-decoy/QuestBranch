import { useId, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Modal, Button, Feedback } from '../components'
import { useApp } from '../state'
import { ModelSettingsPanel } from './model-panel'
import { useModelSettings } from './use-model-settings'
import { AgentPanel } from './agent-panel'
import { useTranslation } from 'react-i18next'

export function ModelsDialog() {
  const { t } = useTranslation()
  const backend = useApp((s) => s.snapshot!.settings.backend)
  const [tab, setTab] = useState(backend === 'acp' ? 'acp' : 'model')
  const id = useId()
  return (
    <Modal
      title={t('模型与连接')}
      description={
        tab === 'acp'
          ? t('使用智能体的工具与技能；可用能力取决于后端配置。')
          : t('连接账号、API 或 Ollama；普通模型对话不自动检索网页。')
      }
      wide
      className="models-modal"
    >
      <div
        className="connection-tabs"
        role="tablist"
        aria-label={t('连接方式')}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next =
            event.key === 'Home'
              ? 'model'
              : event.key === 'End'
                ? 'acp'
                : tab === 'model'
                  ? 'acp'
                  : 'model'
          setTab(next)
          document.getElementById(`${id}-${next}`)?.focus()
        }}
      >
        {(['model', 'acp'] as const).map((value) => (
          <button
            key={value}
            id={`${id}-${value}`}
            role="tab"
            aria-controls={`${id}-panel`}
            tabIndex={tab === value ? 0 : -1}
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {value === 'model' ? t('模型') : t('智能体')}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        className="connection-panel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
      >
        {tab === 'acp' ? <AgentPanel /> : <DirectModelForm />}
      </div>
    </Modal>
  )
}
function DirectModelForm() {
  const { t } = useTranslation()
  const open = useApp((s) => s.open)
  const [error, setError] = useState('')
  const model = useModelSettings({ setError })
  const { formRef, dirty, saving, authPending, authBusy, connecting, finish } = model
  return (
    <form
      ref={formRef}
      className="models-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (!authPending && !authBusy) finish()
      }}
    >
      <div className="models-content">
        <ModelSettingsPanel controller={model} />
      </div>
      {error && (
        <div className="models-feedback">
          <Feedback tone="error">{error}</Feedback>
        </div>
      )}
      <div className="modal-footer split models-footer">
        <span className="settings-save-status" role="status">
          <span className="save-dot" />
          {dirty ? t('模型设置未保存') : t('已保存')}
        </span>
        <div className="settings-footer-actions">
          {dirty && (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => open(null)}>
              {t('取消')}
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={saving || authBusy || authPending || (dirty && connecting)}
          >
            {saving && <LoaderCircle size={14} className="spin" />}
            {dirty ? t('保存更改') : t('完成')}
          </Button>
        </div>
      </div>
    </form>
  )
}
