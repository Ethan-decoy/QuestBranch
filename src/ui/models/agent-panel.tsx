import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, PlugZap, Square } from 'lucide-react'
import type { AgentConfig, AgentConnection } from '../../research/agent'
import { useApp } from '../state'
import { client } from '../client'
import { AgentRequests } from '../agent-activity'
import { Button, Feedback } from '../components'
import { restoreAgentSelection } from './agent-selection'
import { useTranslation } from 'react-i18next'

export function AgentPanel() {
  const { t } = useTranslation()
  const settings = useApp((state) => state.snapshot!.settings)
  const command = useApp((state) => state.command),
    open = useApp((state) => state.open)
  const [config, setConfig] = useState<AgentConfig>(settings.agent ?? { kind: 'codex' })
  const [args, setArgs] = useState(JSON.stringify(config.args ?? []))
  const [connection, setConnection] = useState<AgentConnection | null>(null)
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('')
  const mounted = useRef(true),
    revision = useRef(0),
    connectedId = useRef('')
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      revision.current++
      if (connectedId.current) void client.agent?.disconnect(connectedId.current).catch(() => {})
    }
  }, [])
  useEffect(() => {
    if (!connection || connection.status === 'failed') return
    let disposed = false,
      timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await client.agent!.state(connection.id)
        if (!disposed) setConnection(result)
      } catch (error) {
        if (!disposed) {
          setConnection(null)
          setError(error instanceof Error ? error.message : t('连接已关闭'))
        }
        return
      }
      if (!disposed) timer = setTimeout(() => void poll(), 650)
    }
    timer = setTimeout(() => void poll(), 650)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [connection?.id, connection?.status])
  const disconnect = async () => {
    revision.current++
    const id = connectedId.current
    connectedId.current = ''
    setConnection(null)
    setBusy(false)
    if (id) await client.agent?.disconnect(id)
  }
  const update = (patch: Partial<AgentConfig>) => {
    void disconnect().catch(() => {})
    setConfig((current) => ({ ...current, ...patch, options: undefined, name: undefined }))
    setError('')
  }
  const connect = async () => {
    if (!client.agent) {
      setError(t('当前客户端尚不支持 ACP'))
      return
    }
    await disconnect()
    const version = ++revision.current
    setBusy(true)
    setError('')
    try {
      const parsed: unknown = config.kind === 'custom' ? JSON.parse(args) : undefined
      if (
        config.kind === 'custom' &&
        (!Array.isArray(parsed) || parsed.some((arg) => typeof arg !== 'string'))
      )
        throw new Error(t('启动参数应为 JSON 字符串数组'))
      let result = await client.agent.connect({ ...config, args: parsed as string[] | undefined })
      if (!mounted.current || revision.current !== version) {
        await client.agent.disconnect(result.id)
        return
      }
      connectedId.current = result.id
      result = await restoreAgentSelection(client.agent, result, config.options, (state) => {
        if (mounted.current && revision.current === version) setConnection(state)
      })
      if (!mounted.current || revision.current !== version) return
      setConnection(result)
      setConfig((current) => ({
        ...current,
        args: parsed as string[] | undefined,
        name: result.name,
      }))
    } catch (error) {
      if (mounted.current && revision.current === version)
        setError(error instanceof Error ? error.message : t('连接失败'))
    } finally {
      if (mounted.current && revision.current === version) setBusy(false)
    }
  }
  const authenticate = async (methodId: string) => {
    if (!connection) return
    const version = revision.current
    setBusy(true)
    setError('')
    try {
      await client.agent!.authenticate(connection.id, methodId)
      const result = await restoreAgentSelection(
        client.agent!,
        await client.agent!.state(connection.id),
        config.options,
        (state) => {
          if (mounted.current && revision.current === version) setConnection(state)
        },
      )
      if (mounted.current && revision.current === version) setConnection(result)
    } catch (error) {
      if (mounted.current && revision.current === version)
        setError(error instanceof Error ? error.message : t('登录失败'))
    } finally {
      if (mounted.current && revision.current === version) setBusy(false)
    }
  }
  const configure = async (configId: string, value: string) => {
    if (!connection) return
    const version = revision.current
    setBusy(true)
    setError('')
    try {
      const result = await client.agent!.configure(connection.id, configId, value)
      if (mounted.current && revision.current === version) {
        setConnection(result)
        setConfig((current) => ({
          ...current,
          options: Object.fromEntries(result.options.map((option) => [option.id, option.value])),
        }))
      }
    } catch (error) {
      if (mounted.current && revision.current === version)
        setError(error instanceof Error ? error.message : t('配置未能应用'))
    } finally {
      if (mounted.current && revision.current === version) setBusy(false)
    }
  }
  const selected = connection
    ? {
        ...config,
        name: connection.name,
        options: Object.fromEntries(
          connection.options.map((option) => [
            option.id,
            config.options?.[option.id] ?? option.value,
          ]),
        ),
      }
    : config
  const configured =
    settings.backend === 'acp' && JSON.stringify(selected) === JSON.stringify(settings.agent)
  const save = async () => {
    if (configured) {
      open(null)
      return
    }
    if (connection?.status !== 'connected') {
      setError(t('请先连接智能体'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await command({
        type: 'save-settings',
        settings: {
          ...settings,
          backend: 'acp',
          agent: selected,
        },
      })
      open(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : t('设置未保存'))
    } finally {
      if (mounted.current) setSaving(false)
    }
  }
  return (
    <form
      className="models-form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="models-content">
        <label className="field">
          {t('智能体')}
          <select
            value={config.kind}
            disabled={saving}
            onChange={(event) => update({ kind: event.target.value as AgentConfig['kind'] })}
          >
            {/* i18next-instrument-ignore: provider brand name */}
            <option value="codex">Codex</option>
            <option value="custom">{t('自定义 ACP')}</option>
          </select>
        </label>
        {config.kind === 'custom' && (
          <>
            <label className="field">
              {t('ACP 程序')}
              <input
                required
                value={config.command ?? ''}
                placeholder={t('可执行程序的绝对路径')}
                onChange={(event) => update({ command: event.target.value })}
              />
            </label>
            <label className="field">
              {t('启动参数')}
              <input
                value={args}
                placeholder='["--acp"]'
                onChange={(event) => {
                  setArgs(event.target.value)
                  update({ args: undefined })
                }}
              />
            </label>
          </>
        )}
        <div className="provider-account-row">
          <span
            className={`provider-status ${connection?.status === 'connected' ? 'connected' : ''}`}
            role="status"
          >
            {busy || connection?.status === 'authenticating' ? (
              <LoaderCircle size={13} className="spin" />
            ) : connection?.status === 'connected' ? (
              <Check size={13} />
            ) : (
              <span className="save-dot" />
            )}
            {busy
              ? t('正在连接')
              : connection?.status === 'connected'
                ? t('{{name}} 已连接', { name: connection.name })
                : connection?.status === 'authenticating'
                  ? t('等待登录')
                  : connection?.status === 'login-required'
                    ? t('需要登录')
                    : t('未连接')}
          </span>
          {connection || busy ? (
            <Button type="button" onClick={() => void disconnect()}>
              <Square size={13} />
              {t('断开')}
            </Button>
          ) : (
            <Button type="button" onClick={() => void connect()} disabled={saving}>
              <PlugZap size={14} />
              {t('连接')}
            </Button>
          )}
        </div>
        {connection?.status === 'login-required' && (
          <div className="agent-request-actions">
            {connection.authMethods.map((method) => (
              <Button
                type="button"
                key={method.id}
                disabled={busy}
                onClick={() => void authenticate(method.id)}
              >
                {method.name}
              </Button>
            ))}
          </div>
        )}
        {connection && <AgentRequests requests={connection.requests} />}
        {connection?.error && <Feedback tone="error">{connection.error}</Feedback>}
        {connection?.options.map((option) => (
          <label className="field" key={option.id}>
            {option.name}
            <select
              disabled={busy || saving}
              value={config.options?.[option.id] ?? option.value}
              onChange={(event) => void configure(option.id, event.target.value)}
            >
              {config.options?.[option.id] &&
                !option.choices.some((choice) => choice.value === config.options?.[option.id]) && (
                  <option value={config.options[option.id]} disabled>
                    {config.options[option.id]}
                    {t('（请重新选择）')}
                  </option>
                )}
              {option.choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        {!!connection?.commands.length && (
          <div className="agent-commands" aria-label={t('智能体命令')}>
            {connection.commands.map((command) => (
              <code key={command.name} title={command.description}>
                /{command.name}
              </code>
            ))}
          </div>
        )}
        <details className="advanced-settings">
          <summary>{t('工作目录')}</summary>
          <label className="field">
            {t('目录')}
            <input
              value={config.cwd ?? ''}
              placeholder={t('默认使用项目文件夹，旧研究库使用 agent-workspace')}
              onChange={(event) => update({ cwd: event.target.value })}
            />
          </label>
        </details>
        {error && <Feedback tone="error">{error}</Feedback>}
      </div>
      <div className="modal-footer split models-footer">
        <span className="settings-save-status">
          <span className="save-dot" />
          {/* i18next-instrument-ignore-next-line: protocol identifier */}
          {'ACP'}
        </span>
        <Button
          type="submit"
          variant="primary"
          disabled={saving || busy || connection?.status === 'authenticating'}
        >
          {saving && <LoaderCircle className="spin" size={13} />}
          {configured ? t('完成') : t('使用此智能体')}
        </Button>
      </div>
    </form>
  )
}
