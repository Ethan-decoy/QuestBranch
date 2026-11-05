import { t } from '../../i18n'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useApp } from '../state'
import { client, providerConnection } from '../client'
import { connectionKey } from '../provider-connection'
import { resolveModelSelection } from '../../research/model-catalog'
import { apiProtocol, modelProviderId, sessionStrategy } from '../../research/api-services'
import type { AuthSession, ModelProvider, SettingsInput } from '../../research/types'
import i18next from '../../i18n'

function preferences(settings: SettingsInput) {
  return JSON.stringify([
    settings.backend ?? 'model',
    settings.provider,
    modelProviderId(settings),
    settings.baseUrl.replace(/\/+$/, ''),
    apiProtocol(settings),
    settings.maxOutputTokens,
    settings.anthropicWorkspaceId?.trim() ?? '',
    settings.model.trim(),
    settings.reasoningEffort ?? '',
    settings.jsonMode,
    settings.contextBudget,
    sessionStrategy(settings),
    settings.sessionInputBudget,
    settings.modelContextWindow,
  ])
}

export function useModelSettings({ setError }: { setError(message: string): void }) {
  const formRef = useRef<HTMLFormElement>(null)
  const settings = useApp((s) => s.snapshot!.settings)
  const researching = useApp((s) => s.snapshot!.runs.some((run) => run.status === 'running'))
  const command = useApp((s) => s.command)
  const refresh = useApp((s) => s.refresh)
  const open = useApp((s) => s.open)
  const [form, setForm] = useState<SettingsInput>({
    ...settings,
    sessionStrategy: sessionStrategy(settings),
    backend: 'model',
    apiKey: '',
    searchKey: '',
  })
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [saving, setSaving] = useState(false)
  const [session, setSessionState] = useState<AuthSession | null>(null)
  const [answer, setAnswer] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const sessionRef = useRef<AuthSession | null>(null)
  const authMounted = useRef(true)
  const authRevision = useRef(0)
  const authInFlight = useRef(false)
  const setSession = (value: AuthSession | null) => {
    sessionRef.current = value
    setSessionState(value)
  }
  const isCurrentAuth = (revision: number) =>
    authMounted.current && authRevision.current === revision
  const beginAuth = () => {
    if (!authMounted.current || authInFlight.current) return
    authInFlight.current = true
    const revision = ++authRevision.current
    setAuthBusy(true)
    setError('')
    return revision
  }
  const finishAuth = (revision: number) => {
    if (!isCurrentAuth(revision)) return
    authInFlight.current = false
    setAuthBusy(false)
  }
  const applyAuthState = async (state: AuthSession, revision: number) => {
    if (!isCurrentAuth(revision)) return
    setSession(state)
    if (state.status === 'connected') {
      providerConnection.getState().invalidate()
      await providerConnection.getState().connect(form)
      if (isCurrentAuth(revision)) await refresh()
    }
  }
  const connection = useStore(providerConnection)
  const currentConnection = connection.key === connectionKey(form)
  const result = currentConnection ? connection.result : null
  const connectionError = currentConnection ? connection.error : ''
  const connecting = currentConnection && connection.status === 'connecting'
  const connected = result?.status === 'configured'
  const authPending = session?.status === 'pending'
  const busy = saving || connecting || authBusy || authPending
  const account = form.provider === 'account'
  const custom = modelProviderId(form) === 'custom'
  const provider = providers.find((entry) => entry.id === form.modelProvider)
  const catalog = result?.catalog
  const model = catalog?.models.find((entry) => entry.model === form.model)
  const savedKeyAvailable = settings.hasApiKey && connectionKey(settings) === connectionKey(form)
  const dirty =
    preferences(form) !== preferences(settings) ||
    !!(form.apiKey || form.searchKey || form.clearApiKey || form.clearSearchKey)
  let selectionError = ''
  if (catalog && form.model && (account || model)) {
    try {
      resolveModelSelection(form, catalog)
    } catch (error) {
      selectionError =
        error instanceof Error ? error.message : i18next.t('请选择有效的模型与思考强度')
    }
  }
  const update = (patch: Partial<SettingsInput>) => {
    setForm((current) => ({ ...current, ...patch }))
    setError('')
  }
  useEffect(() => {
    let disposed = false
    void client
      .modelProviders()
      .then((result) => {
        if (!disposed) setProviders(result)
      })
      .catch((error) => {
        if (!disposed) setError(error.message)
      })
    return () => {
      disposed = true
    }
  }, [])
  const identity = connectionKey(form)
  useEffect(() => {
    providerConnection.getState().invalidate()
    // Loading a native catalog does not issue a model-generation request.
    if (!custom) void providerConnection.getState().connect(form)
  }, [identity])
  useEffect(() => {
    authMounted.current = true
    return () => {
      authMounted.current = false
      authRevision.current++
      authInFlight.current = false
      const current = sessionRef.current
      if (current && current.status !== 'connected')
        void client.auth.cancel(current.id).catch(() => {})
    }
  }, [])
  useEffect(() => {
    setAnswer(session?.prompt?.type === 'select' ? (session.prompt.options?.[0]?.id ?? '') : '')
  }, [session?.prompt?.id])
  useEffect(() => {
    if (!session || session.status !== 'pending') return
    let disposed = false
    let checking = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const isPending = () =>
      !disposed &&
      authMounted.current &&
      sessionRef.current?.id === session.id &&
      sessionRef.current.status === 'pending'
    const schedule = () => {
      clearTimeout(timer)
      if (isPending() && document.visibilityState !== 'hidden')
        timer = setTimeout(() => void poll(), 600)
    }
    const poll = async () => {
      clearTimeout(timer)
      if (!isPending() || document.visibilityState === 'hidden') return
      if (checking || authInFlight.current) {
        schedule()
        return
      }
      checking = true
      const revision = authRevision.current
      try {
        const state = await client.auth.status(session.id)
        if (!isPending() || !isCurrentAuth(revision)) return
        await applyAuthState(state, revision)
      } catch (error) {
        if (isPending() && isCurrentAuth(revision)) {
          setSession({
            ...sessionRef.current!,
            status: 'failed',
            message: error instanceof Error ? error.message : i18next.t('无法读取连接状态'),
          })
          void client.auth.cancel(session.id).catch(() => {})
        }
      } finally {
        checking = false
        schedule()
      }
    }
    const resume = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'hidden') void poll()
    }
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [session?.id, session?.status])

  function chooseMode(mode: SettingsInput['provider']) {
    update({
      provider: mode,
      modelProvider: mode === 'ollama' ? 'custom' : 'openai',
      baseUrl: mode === 'ollama' ? 'http://127.0.0.1:11434' : '',
      model: '',
      reasoningEffort: '',
      apiProtocol: 'openai-chat',
      anthropicWorkspaceId: '',
      maxOutputTokens: undefined,
      modelContextWindow: undefined,
      sessionInputBudget: undefined,
      sessionStrategy: sessionStrategy({ provider: mode }),
      apiKey: '',
      clearApiKey: false,
    })
    setSession(null)
  }
  function chooseProvider(id: string) {
    update({
      modelProvider: id,
      baseUrl: '',
      model: '',
      reasoningEffort: '',
      apiKey: '',
      clearApiKey: false,
      anthropicWorkspaceId: '',
      maxOutputTokens: undefined,
      modelContextWindow: undefined,
      sessionInputBudget: undefined,
      sessionStrategy: sessionStrategy({ provider: form.provider }),
    })
    setSession(null)
  }
  async function startLogin(type: 'oauth' | 'api_key') {
    const revision = beginAuth()
    if (revision === undefined) return
    const previous = sessionRef.current
    try {
      // A retry replaces the old authorization before starting another callback listener.
      if (previous) {
        await client.auth.cancel(previous.id)
        if (!isCurrentAuth(revision)) return
      }
      setSession(null)
      const started = await client.auth.start(form, type)
      if (!isCurrentAuth(revision)) {
        if (started.status === 'pending') void client.auth.cancel(started.id).catch(() => {})
        return
      }
      await applyAuthState(started, revision)
    } catch (error) {
      if (isCurrentAuth(revision)) {
        const message = error instanceof Error ? error.message : i18next.t('连接未完成')
        if (previous) setSession({ ...previous, status: 'failed', message })
        else setError(message)
      }
    } finally {
      finishAuth(revision)
    }
  }
  async function submitAnswer() {
    const current = sessionRef.current
    if (!current?.prompt) return
    const revision = beginAuth()
    if (revision === undefined) return
    try {
      await client.auth.respond(current.id, current.prompt.id, answer)
      if (!isCurrentAuth(revision)) return
      setAnswer('')
      const state = await client.auth.status(current.id)
      await applyAuthState(state, revision)
    } catch (error) {
      if (isCurrentAuth(revision))
        setError(error instanceof Error ? error.message : t('登录信息未提交'))
    } finally {
      finishAuth(revision)
    }
  }
  async function cancelLogin() {
    const current = sessionRef.current
    if (current?.status !== 'pending') return
    const revision = beginAuth()
    if (revision === undefined) return
    try {
      await client.auth.cancel(current.id)
      if (isCurrentAuth(revision))
        setSession({
          id: current.id,
          provider: current.provider,
          status: 'cancelled',
          message: i18next.t('已取消连接'),
        })
    } catch (error) {
      if (isCurrentAuth(revision))
        setSession({
          ...current,
          status: 'failed',
          message: error instanceof Error ? error.message : i18next.t('取消连接失败'),
        })
    } finally {
      finishAuth(revision)
    }
  }
  async function logout() {
    const revision = beginAuth()
    if (revision === undefined) return
    try {
      await client.auth.logout(form)
      if (!isCurrentAuth(revision)) return
      setSession(null)
      providerConnection.getState().invalidate()
      await providerConnection.getState().connect(form)
      await refresh()
    } catch (error) {
      if (isCurrentAuth(revision)) setError(error instanceof Error ? error.message : t('退出失败'))
    } finally {
      finishAuth(revision)
    }
  }
  async function save() {
    if (selectionError) {
      setError(selectionError)
      return false
    }
    setSaving(true)
    setError('')
    try {
      await command({ type: 'save-settings', settings: form })
      setForm((current) => ({
        ...current,
        apiKey: '',
        searchKey: '',
        clearApiKey: false,
        clearSearchKey: false,
      }))
      open(null)
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : t('保存失败'))
      return false
    } finally {
      setSaving(false)
    }
  }
  function finish() {
    if (!dirty) {
      open(null)
      return
    }
    if (formRef.current?.reportValidity()) void save()
  }

  return {
    form,
    chooseMode,
    busy,
    providers,
    account,
    chooseProvider,
    custom,
    update,
    savedKeyAvailable,
    connected,
    connecting,
    authPending,
    connectionError,
    provider,
    result,
    logout,
    researching,
    startLogin,
    session,
    answer,
    setAnswer,
    authBusy,
    submitAnswer,
    cancelLogin,
    catalog,
    model,
    selectionError,
    settings,
    formRef,
    dirty,
    saving,
    finish,
  }
}
export type ModelSettingsController = ReturnType<typeof useModelSettings>
