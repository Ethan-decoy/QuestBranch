import { effortText } from '../i18n-labels'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { Popover } from 'radix-ui'
import { Brain, ChevronDown, LoaderCircle, Settings2 } from 'lucide-react'
import { useApp } from '../state'
import { client, providerConnection } from '../client'
import { connectionKey } from '../provider-connection'
import { resolveModelSelection } from '../../research/model-catalog'
import type { ReasoningEffort, Settings } from '../../research/types'
import type { AgentConnection } from '../../research/agent'
import { Button, Feedback } from '../components'
import { restoreAgentSelection } from './agent-selection'
import { useTranslation } from 'react-i18next'

function pickerIdentity(settings: Settings) {
  return settings.backend === 'acp'
    ? JSON.stringify([
        'acp',
        settings.agent?.kind,
        settings.agent?.command,
        settings.agent?.args,
        settings.agent?.cwd,
      ])
    : connectionKey(settings)
}

export function ComposerModelPicker({ onBusyChange }: { onBusyChange(busy: boolean): void }) {
  const { t } = useTranslation()
  const settings = useApp((s) => s.snapshot!.settings)
  const researching = useApp((s) => s.snapshot!.runs.some((run) => run.status === 'running'))
  const dialog = useApp((s) => s.dialog)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [agent, setAgent] = useState<AgentConnection | null>(null)
  const focus = useRef<'model' | 'effort'>('model')
  const modelField = useRef<HTMLSelectElement>(null)
  const effortField = useRef<HTMLSelectElement>(null)
  const connection = useStore(providerConnection)
  const acp = settings.backend === 'acp'
  const identity = pickerIdentity(settings)
  const current = connection.key === identity ? connection : null
  const catalog = current?.result?.catalog
  const model = catalog?.models.find((entry) => entry.model === settings.model)
  const agentModel = agent?.options.find(
    (option) => option.category === 'model' || option.id === 'model',
  )
  const agentEffort = agent?.options.find(
    (option) => option.category === 'thought_level' || option.id === 'reasoning_effort',
  )
  const modelName = acp
    ? agentModel?.choices.find(
        (choice) => choice.value === (settings.agent?.options?.[agentModel.id] ?? agentModel.value),
      )?.name ||
      settings.agent?.options?.model ||
      settings.agent?.name ||
      t('选择智能体')
    : model?.displayName || settings.model || t('选择模型')
  const chosenEffort = acp
    ? agentEffort?.choices.find(
        (choice) =>
          choice.value === (settings.agent?.options?.[agentEffort.id] ?? agentEffort.value),
      )?.name || settings.agent?.options?.reasoning_effort
    : settings.reasoningEffort
      ? effortText(settings.reasoningEffort)
      : model
        ? t('默认 · {{val}}', { val: effortText(model.defaultReasoningEffort) })
        : t('默认')
  const openModels = () => {
    setExpanded(false)
    useApp.getState().open('models')
  }
  useEffect(() => {
    setAgent(null)
  }, [identity])
  useEffect(() => {
    if (dialog) setExpanded(false)
  }, [dialog])
  useEffect(() => {
    onBusyChange(saving)
    return () => onBusyChange(false)
  }, [saving, onBusyChange])
  useEffect(() => {
    if (!expanded) return
    let disposed = false
    let ownedConnection = ''
    setError('')
    setLoading(true)
    void (async () => {
      try {
        if (acp) {
          setAgent(null)
          if (!settings.agent || !client.agent) throw new Error(t('请先连接智能体'))
          let result = await client.agent.connect(settings.agent)
          ownedConnection = result.id
          if (disposed) {
            await client.agent.disconnect(result.id)
            return
          }
          result = await restoreAgentSelection(
            client.agent,
            result,
            settings.agent.options,
            (state) => {
              if (!disposed) setAgent(state)
            },
          )
          if (disposed) return
          setAgent(result)
          if (result.status !== 'connected') throw new Error(t('请先在模型与连接中完成智能体登录'))
        } else {
          const cached = providerConnection.getState()
          if (cached.key !== identity || !cached.result || cached.status === 'error')
            await cached.connect(settings)
          const result = providerConnection.getState()
          if (result.key === identity && result.error) throw new Error(result.error)
          if (result.result?.status === 'login-required') throw new Error(t('请先连接此模型账号'))
        }
      } catch (error) {
        if (!disposed) setError(error instanceof Error ? error.message : t('无法读取模型选项'))
      } finally {
        if (!disposed) {
          setLoading(false)
          requestAnimationFrame(() =>
            (focus.current === 'effort' ? effortField : modelField).current?.focus(),
          )
        }
      }
    })()
    return () => {
      disposed = true
      if (ownedConnection) void client.agent?.disconnect(ownedConnection).catch(() => {})
    }
  }, [expanded, identity])

  const select = async (kind: 'model' | 'effort', value: string) => {
    if (saving || researching) return
    setSaving(true)
    setError('')
    try {
      const latest = useApp.getState().snapshot!.settings
      if (pickerIdentity(latest) !== identity) throw new Error(t('连接已改变，请重新选择'))
      let next: Settings
      if (acp) {
        const option = kind === 'model' ? agentModel : agentEffort
        if (!agent || !option || !option.choices.some((choice) => choice.value === value))
          throw new Error(t('当前智能体未提供该选项'))
        const configured = await client.agent!.configure(agent.id, option.id, value)
        setAgent(configured)
        next = {
          ...latest,
          agent: {
            ...latest.agent!,
            options: Object.fromEntries(
              configured.options.map((option) => [option.id, option.value]),
            ),
          },
        }
      } else {
        if (!catalog) throw new Error(t('模型目录尚未就绪'))
        if (kind === 'model' && !catalog.models.some((entry) => entry.model === value))
          throw new Error(t('请选择当前目录中的模型'))
        const patch =
          kind === 'model'
            ? { model: value, reasoningEffort: '' as const }
            : { reasoningEffort: value as ReasoningEffort | '' }
        next = { ...latest, ...patch }
        resolveModelSelection(next, catalog)
      }
      await useApp.getState().command({ type: 'save-settings', settings: next })
    } catch (error) {
      setError(error instanceof Error ? error.message : t('模型选择未保存'))
    } finally {
      setSaving(false)
    }
  }
  const busy = loading || saving || researching
  const agentValue = (option: typeof agentModel) =>
    option ? (settings.agent?.options?.[option.id] ?? option.value) : ''
  return (
    <Popover.Root open={expanded} onOpenChange={setExpanded}>
      <Popover.Anchor asChild>
        <div className="composer-selection">
          <Popover.Trigger asChild>
            <button
              className="composer-model"
              aria-label={t('选择模型')}
              title={modelName}
              disabled={researching || saving}
              onClick={() => {
                focus.current = 'model'
              }}
            >
              <span>{modelName}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          </Popover.Trigger>
          <button
            className="composer-effort"
            aria-label={t('选择思考强度')}
            title={t('思考强度：{{val}}', { val: chosenEffort || t('由智能体提供') })}
            disabled={researching || saving}
            aria-haspopup="dialog"
            aria-expanded={expanded}
            onClick={() => {
              focus.current = 'effort'
              setExpanded(true)
            }}
          >
            <Brain size={13} aria-hidden="true" />
            <span>{chosenEffort || t('强度')}</span>
          </button>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="composer-picker"
          side="top"
          align="start"
          sideOffset={9}
          collisionPadding={12}
          aria-label={t('模型与思考强度')}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="composer-picker-heading">
            <strong>{acp ? settings.agent?.name || t('智能体') : t('模型')}</strong>
            {(loading || saving) && (
              <LoaderCircle size={14} className="spin" aria-label={t('正在更新模型选项')} />
            )}
          </div>
          <label className="field">
            {t('模型')}
            <select
              ref={modelField}
              aria-label={t('聊天模型')}
              disabled={busy || (acp ? !agentModel : !catalog)}
              value={acp ? agentValue(agentModel) : settings.model}
              onChange={(event) => void select('model', event.target.value)}
            >
              {acp && !agentModel && <option value="">{t('由智能体管理')}</option>}
              {acp &&
                agentModel &&
                !agentModel.choices.some((choice) => choice.value === agentValue(agentModel)) && (
                  <option value={agentValue(agentModel)} disabled>
                    {agentValue(agentModel)}
                    {t('（请重新选择）')}
                  </option>
                )}
              {!acp && !catalog?.models.some((entry) => entry.model === settings.model) && (
                <option value={settings.model}>{settings.model || t('选择模型')}</option>
              )}
              {acp
                ? agentModel?.choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.name}
                    </option>
                  ))
                : catalog?.models.map((entry) => (
                    <option key={entry.model} value={entry.model}>
                      {entry.displayName || entry.model}
                    </option>
                  ))}
            </select>
          </label>
          <label className="field">
            {t('思考强度')}
            <select
              ref={effortField}
              aria-label={t('聊天思考强度')}
              disabled={busy || (acp ? !agentEffort : !model)}
              value={acp ? agentValue(agentEffort) : (settings.reasoningEffort ?? '')}
              onChange={(event) => void select('effort', event.target.value)}
            >
              {acp && !agentEffort && <option value="">{t('此连接未提供强度选项')}</option>}
              {acp &&
                agentEffort &&
                !agentEffort.choices.some((choice) => choice.value === agentValue(agentEffort)) && (
                  <option value={agentValue(agentEffort)} disabled>
                    {agentValue(agentEffort)}
                    {t('（请重新选择）')}
                  </option>
                )}
              {acp ? (
                agentEffort?.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.name}
                  </option>
                ))
              ) : (
                <>
                  <option value="">
                    {t('默认')}
                    {model ? ` · ${effortText(model.defaultReasoningEffort)}` : ''}
                  </option>
                  {settings.reasoningEffort &&
                    !model?.supportedReasoningEfforts.some(
                      (entry) => entry.reasoningEffort === settings.reasoningEffort,
                    ) && (
                      <option value={settings.reasoningEffort}>
                        {effortText(settings.reasoningEffort)}
                        {t('（请重新选择）')}
                      </option>
                    )}
                  {model?.supportedReasoningEfforts.map((entry) => (
                    <option key={entry.reasoningEffort} value={entry.reasoningEffort}>
                      {effortText(entry.reasoningEffort)}
                    </option>
                  ))}
                </>
              )}
            </select>
          </label>
          {error && <Feedback tone="error">{error}</Feedback>}
          <Button variant="ghost" className="composer-connections" onClick={openModels}>
            <Settings2 size={14} />
            {t('模型与连接')}
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
