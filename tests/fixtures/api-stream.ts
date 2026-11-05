import type { ApiProtocol } from '../../src/research/types'

// Minimal complete vendor streams, including lifecycle metadata that a real
// SDK validates. Fake keys and model IDs never leave the test's fetch stub.
export function apiEvents(protocol: ApiProtocol, text: string, ending = 'success') {
  if (protocol === 'anthropic-messages')
    return [
      {
        type: 'message_start',
        message: {
          id: 'msg-fixture',
          model: 'fixture-model',
          role: 'assistant',
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: '不是报告内容' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } },
      ...(ending === 'disconnect'
        ? []
        : ending === 'error'
          ? [{ type: 'error', error: { type: 'overloaded_error', message: 'fixture overload' } }]
          : [
              { type: 'content_block_stop', index: 1 },
              {
                type: 'message_delta',
                delta: {
                  stop_reason:
                    ending === 'limit' ? 'max_tokens' : ending === 'tool' ? 'tool_use' : 'end_turn',
                },
                usage: { output_tokens: 20 },
              },
              { type: 'message_stop' },
            ]),
    ]
  if (protocol === 'openai-responses')
    return [
      {
        type: 'response.created',
        response: {
          id: 'resp-fixture',
          created_at: 1,
          model: 'fixture-model',
          status: 'in_progress',
        },
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg-fixture',
          role: 'assistant',
          content: [],
          status: 'in_progress',
        },
      },
      { type: 'response.output_text.delta', item_id: 'msg-fixture', output_index: 0, delta: text },
      ...(ending === 'disconnect'
        ? []
        : ending === 'error'
          ? [
              {
                type: 'error',
                code: 'server_error',
                message: 'fixture overload',
                param: null,
                sequence_number: 3,
              },
            ]
          : [
              {
                type: 'response.output_item.done',
                output_index: 0,
                item: {
                  type: 'message',
                  id: 'msg-fixture',
                  role: 'assistant',
                  content: [{ type: 'output_text', text, annotations: [] }],
                  status: 'completed',
                },
              },
              {
                type: ending === 'limit' ? 'response.incomplete' : 'response.completed',
                response: {
                  id: 'resp-fixture',
                  status: ending === 'limit' ? 'incomplete' : 'completed',
                  ...(ending === 'limit'
                    ? { incomplete_details: { reason: 'max_output_tokens' } }
                    : {}),
                },
              },
            ]),
    ]
  return [
    { choices: [{ delta: { reasoning_content: '不是报告内容' } }] },
    { choices: [{ delta: { content: text } }] },
    ...(ending === 'disconnect'
      ? []
      : ending === 'error'
        ? [{ error: { message: 'fixture overload', type: 'server_error', code: 'overloaded' } }]
        : [
            {
              choices: [
                {
                  delta: {},
                  finish_reason:
                    ending === 'limit' ? 'length' : ending === 'tool' ? 'tool_calls' : 'stop',
                },
              ],
            },
          ]),
  ]
}

export function apiStream(
  protocol: ApiProtocol,
  text: string,
  ending?: string,
  chunkSize = 11,
  newline = '\r\n',
) {
  const encoded = new TextEncoder().encode(
    apiEvents(protocol, text, ending)
      .map(
        (event) =>
          `event: ${'type' in event ? event.type : 'message'}${newline}data: ${JSON.stringify(event)}${newline}${newline}`,
      )
      .join(''),
  )
  return new Response(
    new ReadableStream({
      start(controller) {
        // Deliberately split UTF-8 code points and SSE field boundaries.
        for (let i = 0; i < encoded.length; i += chunkSize)
          controller.enqueue(encoded.slice(i, i + chunkSize))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
