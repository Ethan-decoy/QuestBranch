import type { Source } from './types'
import { randomUUID } from 'node:crypto'

function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }
}
class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}
async function checked(response: Response) {
  if (!response.ok) {
    let message = `模型服务返回 HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: { message?: string } | string }
      const detail = typeof body.error === 'string' ? body.error : body.error?.message
      if (detail) message += `：${detail.slice(0, 400)}`
    } catch {}
    throw new ServiceError(message, response.status)
  }
  return response
}
export async function webSearch(
  query: string,
  apiKey: string,
  signal: AbortSignal,
  request: typeof globalThis.fetch = globalThis.fetch,
): Promise<Source[]> {
  const response = await checked(
    await request('https://api.tavily.com/search', {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({
        query: query.slice(0, 1200),
        search_depth: 'advanced',
        max_results: 5,
        include_raw_content: false,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    }),
  )
  const body = (await response.json()) as {
    results?: { title: string; url: string; content?: string }[]
  }
  return (body.results ?? [])
    .filter((r) => r.url?.startsWith('https://') || r.url?.startsWith('http://'))
    .map((r) => ({
      id: randomUUID(),
      title: r.title,
      url: r.url,
      excerpt: (r.content ?? '').slice(0, 2400),
    }))
}
