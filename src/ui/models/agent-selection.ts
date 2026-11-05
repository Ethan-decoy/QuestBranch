import { t } from '../../i18n'
import type { AgentClient, AgentConnection } from '../../research/agent'

/** A new ACP configuration session must restore the model before dependent options. */
export async function restoreAgentSelection(
  client: Pick<AgentClient, 'configure'>,
  connection: AgentConnection,
  saved: Record<string, string> = {},
  onState?: (connection: AgentConnection) => void,
): Promise<AgentConnection> {
  onState?.(connection)
  if (connection.status !== 'connected') return connection
  const isModel = (id: string) =>
    connection.options.some(
      (option) => option.id === id && (option.category === 'model' || option.id === 'model'),
    )
  const entries = Object.entries(saved).sort(([a], [b]) => Number(isModel(b)) - Number(isModel(a)))
  let current = connection
  for (const [id, value] of entries) {
    const option = current.options.find((option) => option.id === id)
    if (!option?.choices.some((choice) => choice.value === value))
      throw new Error(t('智能体已不支持保存的模型或配置，请重新选择'))
    if (option.value !== value) {
      current = await client.configure(current.id, id, value)
      onState?.(current)
    }
  }
  return current
}
