import { effortText } from '../i18n-labels'
import {
  Check,
  ExternalLink,
  LoaderCircle,
  LogOut,
  PlugZap,
  RotateCcw,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { Button, Feedback } from '../components'
import { providerConnection } from '../client'
import { apiProtocol, apiProtocols } from '../../research/api-services'
import type { ApiProtocol, ReasoningEffort } from '../../research/types'
import type { ModelSettingsController } from './use-model-settings'
import { useTranslation } from 'react-i18next'

export function ModelSettingsPanel({ controller }: { controller: ModelSettingsController }) {
  const { t } = useTranslation()
  const {
    form,
    chooseMode,
    busy,
    saving,
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
  } = controller
  return (
    <>
      <div className="provider-options">
        {(
          [
            ['account', Sparkles, t('账号登录'), t('ChatGPT、Claude、GitHub Copilot 等')],
            ['compatible', PlugZap, t('API 服务'), t('OpenAI、Claude、DeepSeek 与自定义服务')],
            ['ollama', Settings2, 'Ollama', t('在自己的设备上运行模型')],
          ] as const
        ).map(([mode, Icon, title, description]) => (
          <button
            type="button"
            key={mode}
            className={form.provider === mode ? 'selected' : ''}
            onClick={() => chooseMode(mode)}
            disabled={busy}
          >
            <Icon size={18} />
            <strong>{title}</strong>
            <span>{description}</span>
            {form.provider === mode && <Check size={14} />}
          </button>
        ))}
      </div>
      {form.provider !== 'ollama' && (
        <label className="field">
          {t('提供商')}
          <select
            value={form.modelProvider ?? 'custom'}
            onChange={(event) => chooseProvider(event.target.value)}
            disabled={busy || !providers.length}
          >
            {providers
              .filter((entry) => (account ? entry.oauth : entry.apiKey))
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {account ? (entry.oauthName ?? entry.name) : entry.name}
                </option>
              ))}
            {!account && <option value="custom">{t('自定义兼容服务')}</option>}
            {!!form.modelProvider &&
              !providers.some((entry) => entry.id === form.modelProvider) &&
              form.modelProvider !== 'custom' && (
                <option value={form.modelProvider}>{form.modelProvider}</option>
              )}
          </select>
        </label>
      )}
      {!account && custom && (
        <>
          {form.provider !== 'ollama' && (
            <label className="field">
              {t('接口协议')}
              <select
                value={apiProtocol(form)}
                onChange={(event) => {
                  update({
                    apiProtocol: event.target.value as ApiProtocol,
                    apiKey: '',
                    clearApiKey: false,
                    model: '',
                    reasoningEffort: '',
                  })
                  providerConnection.getState().invalidate()
                }}
                disabled={busy}
              >
                {apiProtocols.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            {t('服务地址')}
            <input
              type="url"
              required
              value={form.baseUrl}
              placeholder="https://your-service.example/v1"
              disabled={busy}
              onChange={(event) => {
                update({ baseUrl: event.target.value, apiKey: '', clearApiKey: false })
                providerConnection.getState().invalidate()
              }}
            />
          </label>
        </>
      )}
      {!account && (
        <label className="field">
          {t('API 密钥')} <span>{savedKeyAvailable ? t('已保存') : t('按服务要求填写')}</span>
          <input
            type="password"
            autoComplete="off"
            value={form.apiKey}
            disabled={busy}
            onChange={(event) => {
              update({ apiKey: event.target.value })
              providerConnection.getState().invalidate()
            }}
            placeholder={
              savedKeyAvailable
                ? t('留空保留已保存的密钥')
                : form.provider === 'ollama'
                  ? t('本地服务通常无需填写')
                  : t('填写此服务的密钥')
            }
          />
        </label>
      )}
      <div className="provider-account-row">
        <div className="provider-account">
          <span
            className={`provider-status ${connected ? 'connected' : connecting || authPending ? 'connecting' : connectionError ? 'error' : ''}`}
            role="status"
          >
            <span className="save-dot" />
            {authPending
              ? t('等待账号授权')
              : connecting
                ? t('正在读取…')
                : connected
                  ? account
                    ? t('账号已连接')
                    : t('已配置')
                  : account
                    ? t('未连接账号')
                    : t('未配置')}
          </span>
          <small>
            {account
              ? provider?.name
              : result?.modelDiscovery === 'unsupported'
                ? t('服务未提供模型目录，可手动填写模型')
                : result
                  ? t('已加载 {{length}} 个模型', { length: result.models.length })
                  : t('选择模型后保存设置')}
          </small>
        </div>
        <div className="model-connection-actions">
          {account && connected && (
            <Button type="button" onClick={() => void logout()} disabled={busy || researching}>
              <LogOut size={14} />
              {t('退出账号')}
            </Button>
          )}
          <Button
            type="button"
            onClick={() =>
              account ? void startLogin('oauth') : void providerConnection.getState().connect(form)
            }
            disabled={
              saving ||
              connecting ||
              authBusy ||
              (!account && authPending) ||
              (account && researching)
            }
          >
            {connecting || authBusy ? (
              <LoaderCircle size={14} className="spin" />
            ) : account && (connected || authPending || session?.status === 'failed') ? (
              <RotateCcw size={14} />
            ) : (
              <PlugZap size={14} />
            )}
            {account
              ? connected || authPending || session?.status === 'failed'
                ? t('重新连接')
                : t('连接账号')
              : t('连接服务')}
          </Button>
        </div>
      </div>
      {session &&
        session.status !== 'cancelled' &&
        (session.status === 'failed' ? (
          <Feedback tone="error">{session.message}</Feedback>
        ) : session.status === 'pending' ? (
          <div className="auth-interaction" aria-label={t('账号授权')} aria-live="polite">
            <p>{session.message}</p>
            {session.userCode && <code className="auth-device-code">{session.userCode}</code>}
            {session.url && (
              <a href={session.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} />
                {t('继续授权')}
              </a>
            )}
            {session.prompt && (
              <label className="field">
                {session.prompt.message}
                {session.prompt.type === 'select' ? (
                  <select
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    disabled={authBusy}
                  >
                    {session.prompt.options?.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={session.prompt.type === 'secret' ? 'password' : 'text'}
                    autoComplete="off"
                    value={answer}
                    placeholder={session.prompt.placeholder}
                    onChange={(event) => setAnswer(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        void submitAnswer()
                      }
                    }}
                    disabled={authBusy}
                  />
                )}
              </label>
            )}
            <div className="auth-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={authBusy}
                onClick={() => void cancelLogin()}
              >
                {t('取消连接')}
              </Button>
              {session.prompt && (
                <Button
                  type="button"
                  variant="primary"
                  disabled={authBusy || !answer.trim()}
                  onClick={() => void submitAnswer()}
                >
                  {t('继续')}
                </Button>
              )}
            </div>
          </div>
        ) : null)}
      {connectionError && <Feedback tone="error">{connectionError}</Feedback>}
      <div className="form-row model-selection-row">
        <label className="field">
          {t('模型')}
          {account ? (
            <select
              value={form.model}
              disabled={busy || !catalog?.models.length}
              onChange={(event) => update({ model: event.target.value, reasoningEffort: '' })}
            >
              <option value="">{t('请选择模型')}</option>
              {!!form.model && !model && (
                <option value={form.model}>
                  {t('{{model}}（请重新选择）', { model: form.model })}
                </option>
              )}
              {catalog?.models.map((entry) => (
                <option key={entry.model} value={entry.model}>
                  {entry.displayName}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={form.model}
              disabled={busy}
              list="available-models"
              placeholder={t('选择或填写模型标识')}
              onChange={(event) => update({ model: event.target.value, reasoningEffort: '' })}
            />
          )}
        </label>
        <datalist id="available-models">
          {result?.models.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <label className="field">
          {t('思考强度')}
          <select
            value={form.reasoningEffort ?? ''}
            disabled={busy || !model}
            onChange={(event) =>
              update({ reasoningEffort: event.target.value as ReasoningEffort | '' })
            }
          >
            <option value="">
              {t('模型默认')}
              {model ? ` · ${effortText(model.defaultReasoningEffort)}` : ''}
            </option>
            {form.reasoningEffort &&
              !model?.supportedReasoningEfforts.some(
                (entry) => entry.reasoningEffort === form.reasoningEffort,
              ) && (
                <option value={form.reasoningEffort}>
                  {effortText(form.reasoningEffort)}
                  {t('（请重新选择）')}
                </option>
              )}
            {model?.supportedReasoningEfforts.map((entry) => (
              <option key={entry.reasoningEffort} value={entry.reasoningEffort}>
                {effortText(entry.reasoningEffort)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selectionError && <Feedback tone="error">{selectionError}</Feedback>}
      <details className="advanced-settings">
        <summary>{t('更多设置')}</summary>
        <label className="field">
          {t('持续会话')}
          <select
            value={form.sessionStrategy ?? 'auto'}
            disabled={busy}
            onChange={(event) =>
              update({ sessionStrategy: event.target.value as 'auto' | 'native' | 'portable' })
            }
          >
            {!account && <option value="auto">{t('原生优先 · 核实能力')}</option>}
            {(!account || form.sessionStrategy === 'native') && (
              <option value="native" disabled={account}>
                {account ? t('原生会话（此账号连接不可用）') : t('仅使用原生会话')}
              </option>
            )}
            <option value="portable">{t('OM 工作记忆')}</option>
          </select>
        </label>
        <div className="form-row">
          <label className="field">
            {t('会话窗口上限')}
            <span>{t('可选')}</span>
            <input
              type="number"
              min={4000}
              max={2000000}
              disabled={busy}
              value={form.sessionInputBudget ?? ''}
              placeholder={t('使用模型容量')}
              onChange={(event) =>
                update({
                  sessionInputBudget: event.target.value ? Number(event.target.value) : undefined,
                })
              }
            />
          </label>
          <label className="field">
            {t('模型上下文容量')}
            <span>{t('手动覆盖')}</span>
            <input
              type="number"
              min={4000}
              max={2000000}
              disabled={busy}
              value={form.modelContextWindow ?? ''}
              placeholder={t('使用模型目录')}
              onChange={(event) =>
                update({
                  modelContextWindow: event.target.value ? Number(event.target.value) : undefined,
                })
              }
            />
          </label>
        </div>
        {!account && !custom && (
          <>
            <label className="field">
              {t('服务地址')}
              <span>{t('可选')}</span>
              <input
                type="url"
                value={form.baseUrl}
                placeholder={provider?.baseUrl ?? t('使用提供商默认地址')}
                disabled={busy}
                onChange={(event) => {
                  update({ baseUrl: event.target.value, apiKey: '', clearApiKey: false })
                  providerConnection.getState().invalidate()
                }}
              />
            </label>
            {provider?.apiKeyLogin && (
              <Button
                type="button"
                onClick={() => void startLogin('api_key')}
                disabled={busy || researching}
              >
                <Settings2 size={14} />
                {t('配置认证参数')}
              </Button>
            )}
          </>
        )}
        <div className="form-row">
          <label className="field">
            {t('研究材料预算')}
            <input
              type="number"
              min={4000}
              max={128000}
              value={form.contextBudget}
              disabled={busy}
              onChange={(event) => update({ contextBudget: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            {t('输出 Token 上限')}
            <input
              type="number"
              min={1}
              max={128000}
              value={form.maxOutputTokens ?? ''}
              placeholder={t('使用模型默认值')}
              disabled={busy}
              onChange={(event) =>
                update({
                  maxOutputTokens: event.target.value ? Number(event.target.value) : undefined,
                })
              }
            />
          </label>
        </div>
        {!account && custom && apiProtocol(form) === 'anthropic-messages' && (
          <label className="field">
            {t('Anthropic 工作空间 ID')} <span>{t('可选')}</span>
            <input
              value={form.anthropicWorkspaceId ?? ''}
              disabled={busy}
              onChange={(event) => {
                update({
                  anthropicWorkspaceId: event.target.value,
                  apiKey: '',
                  clearApiKey: false,
                })
                providerConnection.getState().invalidate()
              }}
            />
          </label>
        )}
        <label className="field">
          {t('Tavily API 密钥')} <span>{t('外部资料检索 · 可选')}</span>
          <input
            type="password"
            autoComplete="off"
            value={form.searchKey}
            disabled={busy}
            onChange={(event) => update({ searchKey: event.target.value })}
            placeholder={
              settings.hasSearchKey ? t('留空保留已保存的密钥') : t('未配置时使用已有研究资料')
            }
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.jsonMode}
            disabled={busy}
            onChange={(event) => update({ jsonMode: event.target.checked })}
          />
          {t('优先使用结构化报告输出')}
        </label>
        {!account && savedKeyAvailable && (
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={!!form.clearApiKey}
              disabled={busy}
              onChange={(event) => {
                update({ clearApiKey: event.target.checked })
                providerConnection.getState().invalidate()
              }}
            />
            {t('清除此服务保存的模型凭据')}
          </label>
        )}
        {settings.hasSearchKey && (
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={!!form.clearSearchKey}
              disabled={busy}
              onChange={(event) => update({ clearSearchKey: event.target.checked })}
            />
            {t('清除已保存的检索密钥')}
          </label>
        )}
      </details>
    </>
  )
}
