import type { ApiProtocol, Settings } from './types'

export const apiProtocols: { id: ApiProtocol; label: string }[] = [
  { id: 'openai-responses', label: 'OpenAI Responses' },
  { id: 'openai-chat', label: 'OpenAI Chat Completions' },
  { id: 'anthropic-messages', label: 'Anthropic Messages' },
]

export function apiProtocol(settings: Pick<Settings, 'provider' | 'apiProtocol'>): ApiProtocol {
  return settings.provider === 'ollama' ? 'openai-chat' : (settings.apiProtocol ?? 'openai-chat')
}

// Pi account transports expose model calls, not QB's raw native-compaction route.
// Normalize their legacy auto default before preparation; never fall back on errors
// or override an explicit native-only choice. API capability evidence stays separate.
export function sessionStrategy(
  settings: Pick<Settings, 'provider' | 'sessionStrategy'>,
): NonNullable<Settings['sessionStrategy']> {
  if (settings.provider === 'account' && settings.sessionStrategy !== 'native') return 'portable'
  return settings.sessionStrategy ?? 'auto'
}

// Keep stored Ollama server roots intact while using its SDK-compatible API.
export function apiBaseUrl(settings: Pick<Settings, 'provider' | 'baseUrl'>) {
  const baseUrl = settings.baseUrl.replace(/\/+$/, '')
  return baseUrl && settings.provider === 'ollama' && !baseUrl.endsWith('/v1')
    ? `${baseUrl}/v1`
    : baseUrl
}

// Native Pi providers own their protocol routing. Custom connections retain
// their protocol + exact endpoint identity, including legacy stored keys.
export function httpConnectionKey(
  settings: Pick<
    Settings,
    'provider' | 'baseUrl' | 'apiProtocol' | 'anthropicWorkspaceId' | 'modelProvider'
  >,
) {
  if (
    settings.modelProvider &&
    settings.modelProvider !== 'custom' &&
    settings.provider === 'compatible'
  )
    return JSON.stringify([
      'compatible',
      'pi',
      settings.modelProvider,
      settings.baseUrl.replace(/\/+$/, ''),
    ])
  const protocol = settings.provider === 'ollama' ? 'ollama' : apiProtocol(settings)
  return JSON.stringify([
    settings.provider,
    protocol,
    settings.baseUrl.replace(/\/+$/, ''),
    protocol === 'anthropic-messages' ? (settings.anthropicWorkspaceId?.trim() ?? '') : '',
  ])
}

export function modelProviderId(settings: Pick<Settings, 'provider' | 'modelProvider'>) {
  if (settings.provider === 'ollama') return 'custom'
  return settings.modelProvider || (settings.provider === 'account' ? 'openai' : 'custom')
}

export function modelConnectionKey(
  settings: Pick<
    Settings,
    'provider' | 'baseUrl' | 'apiProtocol' | 'anthropicWorkspaceId' | 'modelProvider'
  >,
) {
  return settings.provider === 'account'
    ? JSON.stringify(['account', modelProviderId(settings)])
    : httpConnectionKey(settings)
}
