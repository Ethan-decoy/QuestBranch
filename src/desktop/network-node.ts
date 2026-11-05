import { Agent, EnvHttpProxyAgent } from 'undici'
import { createNetwork, type NetworkEntry } from './network'

export function createNodeNetwork(log: (entry: NetworkEntry) => void, env = process.env) {
  // Browser preview is a Node server. Its proxy contract is environment
  // variables; it does not pretend to inherit an Electron/OS proxy session.
  const http = env.http_proxy ?? env.HTTP_PROXY ?? env.all_proxy ?? env.ALL_PROXY ?? ''
  const https = env.https_proxy ?? env.HTTPS_PROXY ?? http
  for (const value of [http, https]) {
    if (!value) continue
    try {
      if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error()
    } catch {
      throw new Error('浏览器预览的代理应为 HTTP / HTTPS 地址，请检查代理环境变量')
    }
  }
  const proxy = new EnvHttpProxyAgent({
    httpProxy: http,
    httpsProxy: https,
    noProxy: env.no_proxy ?? env.NO_PROXY ?? '',
  })
  const direct = new Agent()
  const nativeFetch = globalThis.fetch
  const network = createNetwork({
    fetch: (input, init) => {
      const request = { ...init, dispatcher: proxy }
      return nativeFetch(input, request)
    },
    localFetch: (input, init) => {
      const request = { ...init, dispatcher: direct }
      return nativeFetch(input, request)
    },
    route: async () => (http || https ? 'environment' : 'direct'),
    transport: 'node',
    log,
  })
  return {
    ...network,
    shutdown() {
      network.shutdown()
      void Promise.allSettled([proxy.destroy(), direct.destroy()])
    },
  }
}
