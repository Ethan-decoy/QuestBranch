import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolve, join, extname } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { ResearchStore } from '../desktop/store'
import { ResearchService } from '../desktop/service'
import type { AppCommand } from '../research/types'

const production = process.argv.includes('--production'),
  port = Number(process.env.PORT ?? 5173)
const store = new ResearchStore(process.env.QUESTBRANCH_DATA_DIR ?? resolve('.questbranch'))
const service = new ResearchService(store)
const vite = production
  ? null
  : await (
      await import('vite')
    ).createServer({
      configFile: resolve('vite.web.config.ts'),
      server: { middlewareMode: true, hmr: { port: port + 1 } },
      appType: 'spa',
    })
async function body(request: IncomingMessage) {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024 * 1024) throw new Error('文件超过 64 MB 导入限制')
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as AppCommand
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}
const server = createServer(async (request, response) => {
  const host = request.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    json(response, 403, { error: '仅接受本地研究工作台请求' })
    return
  }
  const url = new URL(request.url ?? '/', `http://${host}`)
  if (url.pathname.startsWith('/api/')) {
    const origin = request.headers.origin
    if (origin && origin !== `http://${host}`) {
      json(response, 403, { error: '请求来源不匹配' })
      return
    }
    if (
      request.method === 'POST' &&
      !request.headers['content-type']?.startsWith('application/json')
    ) {
      json(response, 415, { error: '请求应使用 JSON' })
      return
    }
    try {
      if (url.pathname === '/api/state' && request.method === 'GET')
        json(response, 200, await service.snapshot())
      else if (url.pathname === '/api/command' && request.method === 'POST')
        json(response, 200, await service.command(await body(request)))
      else if (url.pathname === '/api/test' && request.method === 'POST')
        json(response, 200, await service.testConnection())
      else if (url.pathname === '/api/export' && request.method === 'GET')
        json(response, 200, await service.exportWorkspace(url.searchParams.get('id') ?? ''))
      else json(response, 404, { error: '此接口不存在' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作未完成'
      json(response, 400, {
        error: message.startsWith('[') ? '输入数据格式无效，请检查导入文件或表单内容' : message,
      })
    }
    return
  }
  if (vite) {
    vite.middlewares(request, response)
    return
  }
  try {
    const root = resolve('dist-web'),
      path = resolve(root, `.${decodeURIComponent(url.pathname)}`)
    if (path !== root && !path.startsWith(root + '\\') && !path.startsWith(root + '/'))
      throw new Error('invalid path')
    const file = (await stat(path).catch(() => null))?.isFile() ? path : join(root, 'index.html')
    const data = await readFile(file),
      mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.png': 'image/png',
      }
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(data)
  } catch {
    response.writeHead(404)
    response.end('未找到构建文件，请先运行 pnpm build。')
  }
})
server.listen(port, '127.0.0.1', () =>
  console.log(
    `QuestBranch · http://127.0.0.1:${port}\n数据目录：${store.directory}\nSQLite 本地持久化已启用。`,
  ),
)
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.on(event, () => {
    service.shutdown()
    server.close()
    void vite?.close()
    setTimeout(() => process.exit(0), 200).unref()
  })
