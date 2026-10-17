import type { ResearchClient } from '../research/types'
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
          signal: AbortSignal.timeout(path === 'test' ? 90000 : 20000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '本地服务暂时无法连接')
  return data as T
}
export const client: ResearchClient = window.questbranch ?? {
  snapshot: () => request('state'),
  command: (command) => request('command', command),
  testConnection: () => request('test', {}),
  exportWorkspace: (id) => request(`export?id=${encodeURIComponent(id)}`),
}
