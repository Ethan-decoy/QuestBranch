import { createStore } from 'zustand/vanilla'
import type { ConnectionResult, ResearchClient, SettingsInput } from '../research/types'
import { modelConnectionKey } from '../research/api-services'
import i18next from '../i18n'

// Only connection identity is retained, never keys. Model/effort overrides do not
// change the account connection. Request revisions prevent stale replies winning.
export function connectionKey(settings: SettingsInput) {
  return modelConnectionKey(settings)
}
type ConnectionState = {
  key: string
  status: 'idle' | 'connecting' | 'connected' | 'error'
  result: ConnectionResult | null
  error: string
  connect(settings: SettingsInput): Promise<void>
  invalidate(): void
}
export function createConnectionStore(connect: ResearchClient['testConnection']) {
  let revision = 0
  let pending: Promise<void> | undefined
  return createStore<ConnectionState>((set, get) => ({
    key: '',
    status: 'idle',
    result: null,
    error: '',
    invalidate() {
      revision++
      pending = undefined
      set({ key: '', status: 'idle', result: null, error: '' })
    },
    connect(settings) {
      const key = connectionKey(settings)
      if (get().key === key && pending) return pending
      const requestRevision = ++revision
      set({ key, status: 'connecting', error: '', result: get().key === key ? get().result : null })
      pending = (async () => {
        try {
          const result = await Promise.resolve().then(() => connect({ ...settings }))
          if (revision === requestRevision) set({ status: 'connected', result })
        } catch (error) {
          if (revision === requestRevision)
            set({
              status: 'error',
              result: null,
              error:
                error instanceof Error
                  ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
                  : i18next.t('连接失败'),
            })
        } finally {
          if (revision === requestRevision) pending = undefined
        }
      })()
      return pending
    },
  }))
}
