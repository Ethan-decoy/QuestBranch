import type { Settings, Source } from './types'
import { randomUUID } from 'node:crypto'

function endpoint(settings: Settings, path: string) {
  return settings.baseUrl.replace(/\/+$/, '') + path
}
function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
    throw new Error(message)
  }
  return response
}
export async function listModels(settings: Settings, apiKey: string): Promise<string[]> {
  if (settings.provider === 'codex') throw new Error('Codex 通过本地账号连接访问')
  const path = settings.provider === 'ollama' ? '/api/tags' : '/models'
  const response = await checked(
    await fetch(endpoint(settings, path), {
      headers: headers(apiKey),
      signal: AbortSignal.timeout(15000),
    }),
  )
  const body = (await response.json()) as { models?: { name: string }[]; data?: { id: string }[] }
  return settings.provider === 'ollama'
    ? (body.models ?? []).map((m) => m.name)
    : (body.data ?? []).map((m) => m.id)
}
export async function generate(
  settings: Settings,
  apiKey: string,
  messages: { role: string; content: string }[],
  signal: AbortSignal,
  onChunk: (output: string) => void,
): Promise<string> {
  if (settings.provider === 'codex') throw new Error('Codex 通过本地账号连接访问')
  const ollama = settings.provider === 'ollama'
  const body = {
    model: settings.model,
    messages,
    stream: true,
    ...(settings.jsonMode
      ? ollama
        ? { format: 'json' }
        : { response_format: { type: 'json_object' } }
      : {}),
  }
  const response = await checked(
    await fetch(endpoint(settings, ollama ? '/api/chat' : '/chat/completions'), {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(240000)]),
    }),
  )
  if (!response.body) throw new Error('模型没有返回内容流')
  const reader = response.body.getReader(),
    decoder = new TextDecoder()
  let pending = '',
    output = ''
  const accept = (data: string) => {
    if (!data.trim() || data.trim() === '[DONE]') return
    const event = JSON.parse(data) as {
      message?: { content?: string }
      choices?: { delta?: { content?: string } }[]
      error?: string | { message?: string }
    }
    if (event.error)
      throw new Error(
        typeof event.error === 'string' ? event.error : (event.error.message ?? '模型流返回错误'),
      )
    const chunk = ollama ? event.message?.content : event.choices?.[0]?.delta?.content
    if (typeof chunk === 'string') {
      output += chunk
      if (output.length > 180000) throw new Error('模型输出超出单次研究限制，已有原文已保存')
      onChunk(output)
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      let split: number
      while ((split = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, split).replace(/\r$/, '')
        pending = pending.slice(split + 1)
        if (ollama) accept(line)
        else if (line.startsWith('data:')) accept(line.slice(5).trim())
      }
    }
    pending += decoder.decode()
    if (pending.trim()) {
      if (ollama) accept(pending)
      else if (pending.startsWith('data:')) accept(pending.slice(5).trim())
    }
  } finally {
    reader.releaseLock()
  }
  if (!output.trim()) throw new Error('模型没有返回研究内容')
  return output
}
export async function webSearch(
  query: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<Source[]> {
  const response = await checked(
    await fetch('https://api.tavily.com/search', {
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
