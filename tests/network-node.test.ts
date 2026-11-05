import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodeNetwork } from '../src/desktop/network-node'
import { createNetworkLog } from '../src/desktop/network-log'
import type { NetworkEntry } from '../src/desktop/network'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No verification port')
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return address.port
}

it('Node 预览通过 HTTP_PROXY 转发远程请求，本机服务保持直连，流式响应保持可读', async () => {
  const origin = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: first\n\n')
    setTimeout(() => response.end('data: last\n\n'), 15)
  })
  const originPort = await listen(origin)
  const tunneled: string[] = []
  const upstream: Socket[] = []
  cleanup.push(() => {
    for (const socket of upstream) socket.destroy()
  })
  const proxy = createServer()
  proxy.on('connect', (request, client, head) => {
    tunneled.push(request.url ?? '')
    const socket = connect(originPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) socket.write(head)
      client.pipe(socket).pipe(client)
    })
    upstream.push(socket)
    socket.on('error', () => client.destroy())
    client.on('error', () => socket.destroy())
    client.on('close', () => socket.destroy())
  })
  const proxyPort = await listen(proxy)
  const entries: NetworkEntry[] = []
  const network = createNodeNetwork((entry) => entries.push(entry), {
    HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
  })
  cleanup.push(() => network.shutdown())
  const response = await network.fetch('http://api.example.invalid/stream')
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('first')
  let remainder = ''
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    remainder += new TextDecoder().decode(chunk.value)
  }
  expect(remainder).toContain('last')
  expect(tunneled).toEqual(['api.example.invalid:80'])
  expect(await (await network.fetch(`http://127.0.0.1:${originPort}/local`)).text()).toContain(
    'last',
  )
  expect(tunneled).toHaveLength(1)
  expect(entries.filter((entry) => entry.event === 'finished').map((entry) => entry.route)).toEqual(
    ['environment', 'local-direct'],
  )
})

it('代理不通时不会静默改为直连', async () => {
  const reservation = createServer()
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve))
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const entries: NetworkEntry[] = []
  const network = createNodeNetwork((entry) => entries.push(entry), {
    HTTPS_PROXY: `http://127.0.0.1:${address.port}`,
  })
  cleanup.push(() => network.shutdown())
  await expect(network.fetch('https://api.example.invalid')).rejects.toThrow('ECONNREFUSED')
  expect(entries.at(-1)).toMatchObject({
    route: 'environment',
    outcome: 'failed',
    errorCode: 'ECONNREFUSED',
  })
})

it('无效代理配置报错时不包含代理密码', () => {
  expect(() =>
    createNodeNetwork(() => {}, { ALL_PROXY: 'socks5://user:secret@localhost:9876' }),
  ).toThrow('HTTP / HTTPS')
  try {
    createNodeNetwork(() => {}, { ALL_PROXY: 'malformed-private-secret' })
  } catch (error) {
    expect(String(error)).not.toContain('private-secret')
  }
})

it('诊断日志按大小轮转，重新打开后可读取最后一次失败', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-network-log-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const log = createNetworkLog(directory)
  const entry: NetworkEntry = {
    time: new Date().toISOString(),
    id: 'fixture-id',
    event: 'finished',
    operation: 'auth-login',
    provider: 'openai',
    host: 'auth.example.invalid',
    transport: 'chromium',
    route: 'system-proxy',
    durationMs: 50,
    status: 403,
    outcome: 'failed',
    errorCode: 'HTTP_403',
    serverCode: 'unsupported_country_region_territory',
  }
  for (let index = 0; index < 4000; index++) log(entry)
  const files = readdirSync(directory).sort()
  expect(files).toEqual(['network.log', 'network.old.log'])
  for (const file of files)
    expect(statSync(join(directory, file)).size).toBeLessThan(1024 * 1024 + 1024)
  const reopened = createNetworkLog(directory)
  reopened({ ...entry, id: 'after-restart' })
  const last = readFileSync(join(directory, 'network.log'), 'utf8').trim().split('\n').at(-1)!
  expect(JSON.parse(last)).toMatchObject({
    id: 'after-restart',
    status: 403,
    serverCode: 'unsupported_country_region_territory',
  })
})
