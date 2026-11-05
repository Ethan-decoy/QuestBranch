import { session } from 'electron'
import { createNetwork, type NetworkEntry } from './network'

export async function createElectronNetwork(log: (entry: NetworkEntry) => void) {
  // API requests never share renderer/browser cookies or a persistent cache.
  const system = session.fromPartition('questbranch-network', { cache: false })
  const local = session.fromPartition('questbranch-network-local', { cache: false })
  await system.setProxy({ mode: 'system' })
  await local.setProxy({ mode: 'direct' })
  return createNetwork({
    fetch: (input, init) => system.fetch(input instanceof URL ? input.toString() : input, init),
    localFetch: (input, init) => local.fetch(input instanceof URL ? input.toString() : input, init),
    route: async (url) => {
      const proxy = await system.resolveProxy(url.toString())
      const first = proxy.split(';')[0].trim()
      return first === 'DIRECT' ? 'system-direct' : first ? 'system-proxy' : 'unknown'
    },
    transport: 'chromium',
    log,
  })
}
