import type { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { defaultSettings, type Settings, type SettingsInput } from '../research/types'
import { AgentConfigSchema } from '../research/agent'
import {
  apiProtocol,
  httpConnectionKey,
  modelConnectionKey,
  modelProviderId,
  sessionStrategy,
} from '../research/api-services'

export interface CredentialCodec {
  encrypt(value: string): string
  decrypt(value: string): string
}

/** Owns settings compatibility and encrypted scopes on the store's existing connection. */
export class SettingsStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly codec: CredentialCodec,
    private readonly transaction: <T>(operation: () => T) => T,
  ) {}
  private putSetting(key: string, payload: string) {
    this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, payload)
  }
  private readSetting(key: string) {
    return (
      this.db.prepare('SELECT payload FROM settings WHERE key=?').get(key) as
        { payload: string } | undefined
    )?.payload
  }
  private apiKeyConnection(settings: Settings) {
    return (
      this.readSetting('apiKeyConnection') ??
      httpConnectionKey({
        ...settings,
        baseUrl: this.readSetting('apiKeyOrigin') ?? '',
        apiProtocol: 'openai-chat',
        anthropicWorkspaceId: '',
      })
    )
  }
  settings(): Settings {
    const saved = this.readSetting('preferences')
    const previous = saved
      ? (JSON.parse(saved) as Omit<Settings, 'provider'> & {
          provider: Settings['provider'] | 'codex'
        })
      : undefined
    const provider =
      previous?.provider === 'codex' ? 'account' : (previous?.provider ?? defaultSettings.provider)
    const settings: Settings = {
      ...defaultSettings,
      backend: previous?.backend ?? 'model',
      agent: previous?.agent ? AgentConfigSchema.parse(previous.agent) : undefined,
      provider,
      modelProvider:
        previous?.modelProvider ||
        (previous?.provider === 'codex' || previous?.provider === 'account' || !previous
          ? 'openai'
          : 'custom'),
      baseUrl: previous?.provider === 'codex' ? '' : (previous?.baseUrl ?? defaultSettings.baseUrl),
      model: previous?.model ?? defaultSettings.model,
      reasoningEffort: previous?.reasoningEffort ?? '',
      apiProtocol: previous?.apiProtocol,
      anthropicWorkspaceId: previous?.anthropicWorkspaceId,
      maxOutputTokens: previous?.maxOutputTokens,
      sessionStrategy: sessionStrategy({ provider, sessionStrategy: previous?.sessionStrategy }),
      sessionInputBudget: previous?.sessionInputBudget,
      modelContextWindow: previous?.modelContextWindow,
      jsonMode: previous?.jsonMode ?? defaultSettings.jsonMode,
      contextBudget: previous?.contextBudget ?? defaultSettings.contextBudget,
    }
    // OAuth and API connections use separate encrypted scopes. Legacy API keys
    // are read only for their original exact endpoint until explicitly saved.
    const credential = this.readModelCredential(modelConnectionKey(settings)) as
      { type?: string } | undefined
    return {
      ...settings,
      hasApiKey: !!(
        credential?.type === 'api_key' ||
        (settings.provider !== 'account' &&
          modelProviderId(settings) === 'custom' &&
          this.readSetting('apiKey') &&
          this.apiKeyConnection(settings) === httpConnectionKey(settings))
      ),
      hasSearchKey: !!(this.readSetting('searchKey') || process.env.TAVILY_API_KEY),
    }
  }
  credentials(): { apiKey: string; searchKey: string } {
    const read = (name: string, fallback?: string) => {
      const encrypted = this.readSetting(name)
      return encrypted ? this.codec.decrypt(encrypted) : (fallback ?? '')
    }
    const settings = this.settings()
    const credential = this.readModelCredential(modelConnectionKey(settings)) as
      { type?: string; key?: string } | undefined
    return {
      apiKey: settings.hasApiKey
        ? credential?.type === 'api_key'
          ? (credential.key ?? '')
          : read('apiKey')
        : '',
      searchKey: read('searchKey', process.env.TAVILY_API_KEY),
    }
  }
  saveSettings(input: SettingsInput) {
    const previous = this.settings()
    if (input.baseUrl) {
      const url = new URL(input.baseUrl)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error('服务地址应为不含密钥、查询参数或片段的 HTTP / HTTPS 地址')
    }
    if (
      input.backend !== 'acp' &&
      input.provider !== 'account' &&
      modelProviderId(input) === 'custom' &&
      !input.baseUrl
    )
      throw new Error('请填写自定义服务地址')
    const preferences = {
      backend: input.backend ?? 'model',
      agent: input.agent ? AgentConfigSchema.parse(input.agent) : previous.agent,
      provider: input.provider,
      modelProvider: modelProviderId(input),
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      apiProtocol: apiProtocol(input),
      ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
      anthropicWorkspaceId: input.anthropicWorkspaceId?.trim() ?? '',
      model: input.model.trim(),
      jsonMode: input.jsonMode,
      contextBudget: input.contextBudget,
      sessionStrategy: sessionStrategy(input),
      sessionInputBudget: input.sessionInputBudget,
      modelContextWindow: input.modelContextWindow,
      reasoningEffort: input.reasoningEffort ?? '',
    }
    this.transaction(() => {
      // Freeze a legacy key's original identity before changing preferences.
      if (this.readSetting('apiKey') && !this.readSetting('apiKeyConnection'))
        this.putSetting('apiKeyConnection', this.apiKeyConnection(previous))
      this.putSetting('preferences', JSON.stringify(preferences))
      if (input.backend !== 'acp' && input.provider !== 'account') {
        const scope = modelConnectionKey(preferences)
        if (input.clearApiKey) this.putModelCredential(scope, undefined)
        else {
          const current = this.readModelCredential(scope) as
            { type?: string; env?: Record<string, string> } | undefined
          const key = input.apiKey?.trim() || this.credentials().apiKey
          if (key && (input.apiKey?.trim() || !current))
            this.putModelCredential(scope, {
              type: 'api_key',
              key,
              ...(current?.type === 'api_key' && current.env ? { env: current.env } : {}),
            })
        }
        if (input.clearApiKey && this.apiKeyConnection(previous) === httpConnectionKey(preferences))
          this.db.prepare('DELETE FROM settings WHERE key=?').run('apiKey')
      }
      if (input.clearSearchKey) this.db.prepare('DELETE FROM settings WHERE key=?').run('searchKey')
      else if (input.searchKey?.trim())
        this.putSetting('searchKey', this.codec.encrypt(input.searchKey.trim()))
    })
  }
  private modelCredentialKey(scope: string) {
    return `piCredential:${createHash('sha256').update(scope).digest('hex')}`
  }
  readModelCredential(scope: string): unknown | undefined {
    const value = this.readSetting(this.modelCredentialKey(scope))
    return value ? JSON.parse(this.codec.decrypt(value)) : undefined
  }
  private putModelCredential(scope: string, value: unknown | undefined) {
    const key = this.modelCredentialKey(scope)
    if (value === undefined) this.db.prepare('DELETE FROM settings WHERE key=?').run(key)
    else this.putSetting(key, this.codec.encrypt(JSON.stringify(value)))
  }
  saveModelCredential(scope: string, value: unknown | undefined) {
    this.transaction(() => this.putModelCredential(scope, value))
  }
  installationId() {
    const existing = this.readSetting('piInstallationId')
    if (existing) return existing
    const value = randomUUID()
    this.transaction(() => this.putSetting('piInstallationId', value))
    return value
  }
}

export function createLocalCredentialCodec(directory: string): CredentialCodec {
  const path = join(directory, '.credential-key')
  if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode: 0o600 })
  const key = readFileSync(path)
  return {
    encrypt(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv),
        body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
    },
    decrypt(value) {
      const buffer = Buffer.from(value, 'base64'),
        decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12))
      decipher.setAuthTag(buffer.subarray(12, 28))
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString(
        'utf8',
      )
    },
  }
}
