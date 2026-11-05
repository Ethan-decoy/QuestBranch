import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export type NetworkOperation =
  'auth-login' | 'token-refresh' | 'model-discovery' | 'model-stream' | 'web-search'
export type NetworkContext = { operation: NetworkOperation; provider: string }
export type NetworkRoute =
  'system-proxy' | 'system-direct' | 'environment' | 'direct' | 'local-direct' | 'unknown'
export type NetworkEntry = {
  time: string
  id: string
  event: 'headers' | 'finished'
  operation: NetworkOperation | 'http'
  provider?: string
  host: string
  transport: 'chromium' | 'node'
  route: NetworkRoute
  durationMs: number
  status?: number
  requestId?: string
  outcome?: 'completed' | 'released' | 'failed' | 'cancelled' | 'timeout'
  errorCode?: string
  serverCode?: string
}
export interface Network {
  fetch: typeof globalThis.fetch
  run<T>(context: NetworkContext, work: () => T): T
}

// Tests and embedders can supply a transport without installing a process-wide
// default. The application entry points install their host implementation once.
export const defaultNetwork: Network = {
  fetch: (input, init) => globalThis.fetch(input, init),
  run: (_context, work) => work(),
}

export function isLoopback(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^::ffff:7f[0-9a-f]{2}:/.test(host)
  )
}

const serverCodes = new Set([
  'unsupported_country_region_territory',
  'invalid_grant',
  'invalid_client',
  'invalid_token',
  'access_denied',
  'authorization_pending',
  'slow_down',
  'expired_token',
  'rate_limit_exceeded',
  'rate_limit_error',
  'insufficient_quota',
  'server_error',
  'overloaded_error',
  'authentication_error',
  'permission_error',
])
const networkCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EACCES',
  'EPERM',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_NETWORK_CHANGED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_DATE_INVALID',
  'ERR_SSL_PROTOCOL_ERROR',
])
function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'NETWORK_ERROR'
  const code = 'code' in error ? error.code : undefined
  if (typeof code === 'string' && networkCodes.has(code)) return code
  for (const known of networkCodes) if (error.message.includes(known)) return known
  return error.cause && error.cause !== error ? errorCode(error.cause) : 'NETWORK_ERROR'
}
function safeId(value: string | null) {
  return value && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : undefined
}
function diagnosticServerCode(text: string) {
  try {
    const body = JSON.parse(text)
    const code =
      typeof body.error === 'string' ? body.error : (body.error?.code ?? body.error?.type)
    return serverCodes.has(code) ? (code as string) : undefined
  } catch {
    return undefined
  }
}

export function createNetwork(options: {
  fetch: typeof globalThis.fetch
  localFetch?: typeof globalThis.fetch
  route: (url: URL) => Promise<NetworkRoute>
  transport: NetworkEntry['transport']
  log: (entry: NetworkEntry) => void
  timeoutMs?: number
}) {
  const scope = new AsyncLocalStorage<NetworkContext>()
  const active = new Set<AbortController>()
  let closed = false
  const network: Network = {
    run: (context, work) => scope.run(context, work),
    fetch: async (input, init) => {
      if (closed) throw new Error('网络连接已关闭')
      const request = new Request(input, init)
      const url = new URL(request.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('网络请求应使用不含登录凭据的 HTTP / HTTPS 地址')
      const context = scope.getStore()
      const start = performance.now()
      const controller = new AbortController()
      active.add(controller)
      const timeoutMs =
        options.timeoutMs ?? (context?.operation === 'model-stream' ? 240000 : 30000)
      const timer = setTimeout(
        () => controller.abort(new DOMException('网络请求超时，请重试', 'TimeoutError')),
        timeoutMs,
      )
      timer.unref()
      const signal = AbortSignal.any([request.signal, controller.signal])
      const base = {
        id: randomUUID(),
        operation: context?.operation ?? 'http',
        ...(context?.provider && /^[a-zA-Z0-9_-]{1,80}$/.test(context.provider)
          ? { provider: context.provider }
          : {}),
        host: url.hostname,
        transport: options.transport,
      } satisfies Partial<NetworkEntry>
      let route: NetworkRoute = isLoopback(url) ? 'local-direct' : 'unknown'
      let finished = false
      let status: number | undefined
      let requestId: string | undefined
      let errorBody = ''
      const record = (entry: Partial<NetworkEntry> & Pick<NetworkEntry, 'event'>) => {
        try {
          options.log({
            ...base,
            time: new Date().toISOString(),
            route,
            status,
            requestId,
            durationMs: Math.round(performance.now() - start),
            ...entry,
          })
        } catch {
          /* Diagnostics must not break a request. */
        }
      }
      const finish = (outcome: NetworkEntry['outcome'], code?: string) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        active.delete(controller)
        record({
          event: 'finished',
          outcome,
          errorCode: code,
          ...(errorBody ? { serverCode: diagnosticServerCode(errorBody) } : {}),
        })
      }
      const onAbort = () =>
        finish(
          signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled',
          signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED',
        )
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        signal.throwIfAborted()
        if (route !== 'local-direct') {
          // Proxy resolution is diagnostic, not a second routing implementation.
          // It is raced against cancellation so a slow PAC lookup cannot hang login.
          route = await new Promise<NetworkRoute>((resolve, reject) => {
            const abort = () => reject(signal.reason)
            signal.addEventListener('abort', abort, { once: true })
            options
              .route(url)
              .then(resolve, () => resolve('unknown'))
              .finally(() => signal.removeEventListener('abort', abort))
            if (signal.aborted) abort()
          })
        }
        signal.throwIfAborted()
        const response = await (
          route === 'local-direct' ? (options.localFetch ?? options.fetch) : options.fetch
        )(request, {
          signal,
          credentials: 'omit',
          // SDK credentials must not be forwarded by a redirected API endpoint.
          redirect: request.redirect === 'follow' ? 'error' : request.redirect,
        })
        status = response.status
        requestId = safeId(
          response.headers.get('x-request-id') ?? response.headers.get('request-id'),
        )
        record({ event: 'headers' })
        if (!response.body) {
          finish(response.ok ? 'completed' : 'failed', response.ok ? undefined : `HTTP_${status}`)
          return response
        }
        const reader = response.body.getReader()
        const inspectError = !response.ok && response.headers.get('content-type')?.includes('json')
        const decoder = new TextDecoder()
        const body = new ReadableStream<Uint8Array>(
          {
            async pull(output) {
              try {
                const chunk = await reader.read()
                if (chunk.done) {
                  if (inspectError) errorBody += decoder.decode()
                  finish(
                    response.ok ? 'completed' : 'failed',
                    response.ok ? undefined : `HTTP_${status}`,
                  )
                  output.close()
                } else {
                  // Only bounded error JSON is inspected; only allowlisted codes
                  // reach logs. Prompts, tokens, headers and body text never do.
                  if (inspectError && errorBody.length < 4096)
                    errorBody += decoder.decode(chunk.value.subarray(0, 4096 - errorBody.length), {
                      stream: true,
                    })
                  output.enqueue(chunk.value)
                }
              } catch (error) {
                finish(
                  signal.aborted
                    ? signal.reason?.name === 'TimeoutError'
                      ? 'timeout'
                      : 'cancelled'
                    : 'failed',
                  signal.aborted ? 'ABORTED' : errorCode(error),
                )
                output.error(signal.aborted ? signal.reason : error)
              }
            },
            cancel: async (reason) => {
              // SDKs may stop reading after an SSE terminal event, before HTTP
              // EOF. That releases a response; it is not a user cancellation.
              finish(
                signal.aborted ? 'cancelled' : 'released',
                signal.aborted ? 'ABORTED' : undefined,
              )
              await reader.cancel(reason)
            },
          },
          { highWaterMark: 0 },
        )
        const wrapped = new Response(body, {
          status,
          statusText: response.statusText,
          headers: response.headers,
        })
        Object.defineProperties(wrapped, {
          url: { value: response.url || request.url },
          redirected: { value: response.redirected },
          type: { value: response.type },
        })
        return wrapped
      } catch (error) {
        if (signal.aborted) {
          onAbort()
          throw signal.reason
        }
        const code = errorCode(error)
        finish('failed', code)
        throw new Error(`网络连接失败（${code}），请检查网络与系统代理`, { cause: error })
      }
    },
  }
  return {
    ...network,
    shutdown() {
      closed = true
      for (const controller of active) controller.abort()
    },
  }
}

// Pi 1.3 OAuth and Google SDK calls do not expose a fetch injection seam. Bind
// the owning host's fetch once, before creating any SDK clients. Never swap it
// around an individual login/request: concurrent turns must share one policy.
export function installHostFetch(network: Network) {
  const previous = globalThis.fetch
  globalThis.fetch = network.fetch
  return () => {
    if (globalThis.fetch === network.fetch) globalThis.fetch = previous
  }
}
