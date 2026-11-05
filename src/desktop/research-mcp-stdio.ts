import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// Transport adapter only. Never opens a database or reads model credentials.
const client = new Client({ name: 'questbranch-stdio-bridge', version: '1.0.0' })
const server = new Server(
  { name: 'questbranch-research', version: '1.0.0' },
  { capabilities: { tools: {} } },
)
let closed = false
async function close() {
  if (closed) return
  closed = true
  await Promise.allSettled([server.close(), client.close()])
}
process.stdin.once('end', () => {
  void close()
})
process.once('SIGTERM', () => {
  void close()
})
server.onclose = () => {
  void close()
}
try {
  const url = new URL(process.env.QUESTBRANCH_MCP_URL ?? '')
  const token = process.env.QUESTBRANCH_MCP_TOKEN ?? ''
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/mcp' ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    throw new Error('Invalid local research endpoint')
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  server.setRequestHandler(ListToolsRequestSchema, () => client.listTools())
  server.setRequestHandler(CallToolRequestSchema, (request) => client.callTool(request.params))
  if (closed) await client.close()
  else await server.connect(new StdioServerTransport())
} catch {
  // stdout is exclusively MCP transport; never echo the scoped authorization.
  console.error('QuestBranch research tools are unavailable or the research has ended.')
  await close()
  process.exitCode = 1
}
