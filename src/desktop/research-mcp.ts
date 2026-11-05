import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { version } from '../../package.json'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpCapabilities, McpServer as AcpMcpServer } from '@agentclientprotocol/sdk'
import type { ResearchStore } from './store'
import { researchTools } from './research-tools'

const result = (value: object) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  structuredContent: { ...value },
})

/** One run, one capability. No database path, model credential or general RPC is exposed. */
export async function openResearchMcp(store: ResearchStore, runId: string, signal: AbortSignal) {
  const tools = researchTools(store, runId, signal).filter(
    (tool) => tool.name !== 'qb_save_research' || store.run(runId).mode === 'chat',
  )
  const token = randomBytes(32).toString('hex')
  let expired = false
  const assertActive = () => {
    if (expired || signal.aborted || store.run(runId).status !== 'running')
      throw new Error('本次研究工具连接已结束')
  }
  const sessions = new Set<McpServer>()
  const makeServer = () => {
    const server = new McpServer({ name: 'questbranch-research', version })
    for (const tool of tools)
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.parameters.shape,
          annotations: {
            readOnlyHint: tool.readOnly,
            destructiveHint: tool.name === 'qb_remove_branch',
            idempotentHint: !tool.readOnly,
            openWorldHint: false,
          },
        },
        async (input) => {
          if (expired) throw new Error('本次研究工具连接已结束')
          const outcome = tool.execute(input)
          if (outcome.undo) {
            const current = store.run(runId)
            if (
              !current.activities?.some(
                (activity) => activity.undo?.removalId === outcome.undo?.removalId,
              )
            )
              store.saveRun({
                ...current,
                activities: [
                  ...(current.activities ?? []),
                  {
                    id: outcome.undo.removalId,
                    title: tool.title,
                    kind: 'edit',
                    status: 'completed',
                    content: outcome.summary,
                    undo: outcome.undo,
                  },
                ],
              })
          }
          return result(outcome.value)
        },
      )
    return server
  }
  const http = createServer(async (request, response) => {
    const authorization = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from(`Bearer ${token}`)
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      response.writeHead(401).end()
      return
    }
    if (
      request.url !== '/mcp' ||
      request.headers.host !== new URL(url).host ||
      request.headers.origin
    ) {
      response.writeHead(403).end()
      return
    }
    try {
      assertActive()
    } catch {
      response.writeHead(410).end()
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' }).end()
      return
    }
    const server = makeServer()
    sessions.add(server)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    response.once('close', () => {
      sessions.delete(server)
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(request, response)
    } catch {
      if (!response.headersSent) response.writeHead(500).end('Research tool request failed')
      else response.end()
    }
  })
  http.requestTimeout = 15_000
  http.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', () => {
      http.off('error', reject)
      resolve()
    })
  })
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('研究工具服务未启动')
  const url = `http://127.0.0.1:${address.port}/mcp`
  let closing: Promise<void> | undefined
  const close = () => {
    if (closing) return closing
    expired = true
    signal.removeEventListener('abort', abort)
    closing = (async () => {
      await Promise.allSettled([...sessions].map((server) => server.close()))
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    })()
    return closing
  }
  const abort = () => {
    void close()
  }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) {
    await close()
    throw new Error('已取消研究')
  }
  return {
    servers(capabilities?: McpCapabilities): AcpMcpServer[] {
      assertActive()
      if (capabilities?.http)
        return [
          {
            name: 'questbranch',
            type: 'http',
            url,
            headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
          },
        ]
      // ACP v1 requires stdio support; HTTP is optional. Only the bridge is a child
      // process: the store, scope and write transaction remain owned by QB.
      const compiled = fileURLToPath(new URL('./research-mcp-stdio.js', import.meta.url))
      const source = fileURLToPath(new URL('./research-mcp-stdio.ts', import.meta.url))
      const args = existsSync(compiled)
        ? [compiled]
        : [
            '--import',
            pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href,
            source,
          ]
      return [
        {
          name: 'questbranch',
          command: process.execPath,
          args,
          env: [
            { name: 'QUESTBRANCH_MCP_URL', value: url },
            { name: 'QUESTBRANCH_MCP_TOKEN', value: token },
            ...(process.versions.electron ? [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }] : []),
          ],
        },
      ]
    },
    close,
  }
}
