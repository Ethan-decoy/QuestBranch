// An explicit protocol fixture. Production never substitutes this process for Codex.
const readline = require('node:readline')
const scenario = process.argv[2] || 'normal'
const output = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const event = (method, params) =>
  output({ method, params: { threadId: 'fixture-thread', ...params } })
readline
  .createInterface({ input: process.stdin })
  .on('line', (line) => {
    const request = JSON.parse(line)
    if (!request.method || request.id === undefined) return
    const reply = (result) => output({ id: request.id, result })
    switch (request.method) {
      case 'initialize':
        return reply({ userAgent: 'QB protocol fixture' })
      case 'account/read':
        return reply({
          account:
            scenario === 'api-key'
              ? { type: 'apiKey' }
              : { type: 'chatgpt', planType: 'fixture', email: null },
        })
      case 'model/list':
        return reply({ data: [{ model: 'fixture-codex' }] })
      case 'account/rateLimits/read':
        return reply({
          rateLimits: { primary: { usedPercent: 27, windowDurationMins: 300, resetsAt: null } },
        })
      case 'config/read':
        return reply({ config: { mcp_servers: { fixture_server: {} } } })
      case 'thread/start': {
        const parameters = request.params
        if (
          !parameters.ephemeral ||
          parameters.approvalPolicy !== 'never' ||
          parameters.sandbox !== 'read-only' ||
          parameters.config.mcp_servers.fixture_server.enabled !== false ||
          parameters.config.features.shell_tool !== false
        ) {
          return output({ id: request.id, error: { message: 'Research restrictions missing' } })
        }
        return reply({
          thread: { id: 'fixture-thread' },
          model: 'fixture-codex',
          modelProvider: 'openai',
        })
      }
      case 'turn/interrupt':
        return reply({})
      case 'turn/start': {
        reply({ turn: { id: 'fixture-turn' } })
        if (scenario === 'exit') return process.exit(2)
        if (scenario === 'slow') return
        if (scenario === 'tool')
          return event('item/started', { item: { id: 'tool', type: 'commandExecution' } })
        event('item/started', {
          item: { id: 'comment', type: 'agentMessage', phase: 'commentary', text: '' },
        })
        event('item/agentMessage/delta', {
          itemId: 'comment',
          delta: 'Visible progress, not the final reply',
        })
        const item = {
          id: 'answer',
          type: 'agentMessage',
          phase: 'final_answer',
          text: '这是一段分块到达的节点对话。',
        }
        event('item/started', { item: { ...item, text: '' } })
        const encoded = Buffer.from(
          JSON.stringify({
            method: 'item/agentMessage/delta',
            params: {
              threadId: 'fixture-thread',
              turnId: 'fixture-turn',
              itemId: 'answer',
              delta: item.text,
            },
          }) + '\r\n',
        )
        const split = encoded.indexOf(Buffer.from('这')) + 1
        process.stdout.write(encoded.subarray(0, split))
        setTimeout(() => {
          process.stdout.write(encoded.subarray(split))
          event('item/completed', { item })
          event('turn/completed', {
            turn: { id: 'fixture-turn', status: 'completed', items: [item] },
          })
        }, 10)
        return
      }
      default:
        output({ id: request.id, error: { message: 'Unknown fixture method' } })
    }
  })
  .on('close', () => process.exit(0))
