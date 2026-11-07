import { t } from '../../i18n'
import { useEffect, useState } from 'react'
import { Popover } from 'radix-ui'
import { Brain, ChevronDown, LoaderCircle } from 'lucide-react'
import { client } from '../client'
import { useApp } from '../state'
import { Modal } from '../components'
import type { NativeModelSelection, NativeModelState } from '../../research/agent'
import { useTranslation } from 'react-i18next'

function HostFields({
  state,
  busy,
  select,
}: {
  state: NativeModelState
  busy: boolean
  select(value: NativeModelSelection): void
}) {
  const { t } = useTranslation()
  const { catalog, selection } = state
  const model = catalog.groups
    .find((g) => g.id === selection.provider)
    ?.models.find((m) => m.id === selection.model)
  return (
    <div className="form-grid">
      <label className="field">
        {t('模型')}
        <select
          aria-label={t('DSH 模型')}
          disabled={busy}
          value={JSON.stringify([selection.provider, selection.model])}
          onChange={(e) => {
            const [provider, model] = JSON.parse(e.target.value) as string[]
            select({ provider, model })
          }}
        >
          {!catalog.groups.some(
            (g) => g.id === selection.provider && g.models.some((m) => m.id === selection.model),
          ) && (
            <option value={JSON.stringify([selection.provider, selection.model])}>
              {selection.model || t('请先在 DSH 配置模型')}
            </option>
          )}
          {catalog.groups.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {g.models.map((m) => (
                <option key={m.id} value={JSON.stringify([g.id, m.id])}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {model?.reasoning && (
        <label className="field">
          {t('思考强度')}
          <select
            aria-label={t('DSH 思考强度')}
            disabled={busy}
            value={selection.reasoningEffort ?? ''}
            onChange={(e) => select({ ...selection, reasoningEffort: e.target.value || undefined })}
          >
            <option value="">{t('默认')}</option>
            {model.reasoning.efforts.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {catalog.failures.map((f) => (
        <p key={f.id} className="field-hint">
          {f.name}：{f.message}
        </p>
      ))}
    </div>
  )
}
function useHostModels() {
  const nodeId = useApp((s) => s.view?.selectedId ?? '')
  const running = useApp(
    (s) => s.snapshot?.runs.some((r) => r.nodeId === nodeId && r.status === 'running') ?? false,
  )
  const [state, setState] = useState<NativeModelState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setState(null)
    setError('')
    if (nodeId)
      void client.host!.models(nodeId).then(
        (value) => {
          if (active) setState(value)
        },
        (error) => {
          if (active) setError(String(error.message ?? error))
        },
      )
    return () => {
      active = false
    }
  }, [nodeId])
  const select = async (selection: NativeModelSelection) => {
    setBusy(true)
    setError('')
    try {
      await client.host!.selectModel(nodeId, selection)
      setState(await client.host!.models(nodeId))
    } catch (error) {
      setError(error instanceof Error ? error.message : t('模型切换失败'))
    } finally {
      setBusy(false)
    }
  }
  return { state, busy: busy || running, error, select }
}
export function HostModelsDialog() {
  const { t } = useTranslation()
  const models = useHostModels()
  return (
    <Modal title={t('DSH 模型')}>
      <div className="modal-body">
        {models.state ? (
          <HostFields {...models} state={models.state} />
        ) : (
          !models.error && <LoaderCircle className="spin" size={18} />
        )}
        {models.error && <p role="alert">{models.error}</p>}
      </div>
    </Modal>
  )
}
export function HostModelPicker({ onBusyChange }: { onBusyChange(busy: boolean): void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const models = useHostModels()
  useEffect(() => {
    onBusyChange(models.busy)
    return () => onBusyChange(false)
  }, [models.busy, onBusyChange])
  const selection = models.state?.selection
  const model = models.state?.catalog.groups
    .find((g) => g.id === selection?.provider)
    ?.models.find((m) => m.id === selection?.model)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="composer-selection">
          <Popover.Trigger
            className="composer-model"
            aria-label={t('选择 DSH 模型')}
            disabled={models.busy}
          >
            <span>{model?.name || selection?.model || t('DSH 模型')}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </Popover.Trigger>
          {model?.reasoning && (
            <button
              type="button"
              className="composer-effort"
              aria-label={t('选择 DSH 思考强度')}
              aria-haspopup="dialog"
              aria-expanded={open}
              disabled={models.busy}
              onClick={() => setOpen(true)}
            >
              <Brain size={13} aria-hidden="true" />
              <span>
                {model.reasoning.efforts.find((e) => e.id === selection?.reasoningEffort)?.name ||
                  t('默认')}
              </span>
            </button>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="composer-picker"
          side="top"
          align="start"
          sideOffset={9}
          collisionPadding={12}
          aria-label={t('DSH 模型与思考强度')}
        >
          <div className="composer-picker-heading">
            {/* i18next-instrument-ignore: host brand name */}
            <strong>DeepSeek Harness</strong>
            {models.busy && (
              <LoaderCircle size={14} className="spin" aria-label={t('正在更新模型选项')} />
            )}
          </div>
          {models.state ? (
            <HostFields {...models} state={models.state} />
          ) : (
            !models.error && <LoaderCircle className="spin" size={18} />
          )}
          {models.error && <p role="alert">{models.error}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
