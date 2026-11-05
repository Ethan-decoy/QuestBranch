import { t } from '../i18n'
import type { ResearchClient, Snapshot } from '../research/types'
import { createConnectionStore } from './provider-connection'
declare global {
  interface Window {
    questbranch?: ResearchClient
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api/${path}`,
    body === undefined
      ? { signal: AbortSignal.timeout(20000) }
      : {
          method: 'POST',
          signal: AbortSignal.timeout(
            path === 'test' ? 90000 : path === 'agents/connect' ? 70000 : 20000,
          ),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? t('本地服务暂时无法连接'))
  return data as T
}
function snapshot(): Promise<Snapshot>
function snapshot(sinceVersion: number): Promise<Snapshot | null>
function snapshot(sinceVersion?: number): Promise<Snapshot | null> {
  return request(sinceVersion === undefined ? 'state' : `state?sinceVersion=${sinceVersion}`)
}
export const client: ResearchClient = window.questbranch ?? {
  snapshot,
  command: (command) => request('command', command),
  testConnection: (settings) => request('test', { settings }),
  modelProviders: () => request('providers'),
  agent: {
    connect: (config) => request('agents/connect', { config }),
    state: (id) => request(`agents/state?id=${encodeURIComponent(id)}`),
    authenticate: (id, methodId) => request('agents/authenticate', { id, methodId }),
    configure: (id, configId, value) => request('agents/configure', { id, configId, value }),
    respond: (id, requestId, response) => request('agents/respond', { id, requestId, response }),
    disconnect: (id) => request('agents/disconnect', { id }),
  },
  auth: {
    start: (settings, type) => request('auth/start', { settings, type }),
    status: (id) => request(`auth/status?id=${encodeURIComponent(id)}`),
    respond: (id, promptId, value) => request('auth/respond', { id, promptId, value }),
    cancel: (id) => request('auth/cancel', { id }),
    logout: (settings) => request('auth/logout', { settings }),
  },
  exportWorkspace: (id) => request(`export?id=${encodeURIComponent(id)}`),
}
export const providerConnection = createConnectionStore((settings) =>
  client.testConnection(settings),
)
