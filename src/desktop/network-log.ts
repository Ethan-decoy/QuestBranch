import log from 'electron-log/node'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { NetworkEntry } from './network'

export function createNetworkLog(directory: string) {
  const logger = log.create({ logId: `network-${randomUUID()}` })
  logger.transports.console.level = false
  logger.transports.file.resolvePathFn = () => join(directory, 'network.log')
  logger.transports.file.format = '{text}'
  logger.transports.file.maxSize = 1024 * 1024
  // Two small structured entries per HTTP request. Synchronous appends also
  // preserve the last failure when a user quits immediately after login fails.
  logger.transports.file.sync = true
  return (entry: NetworkEntry) => logger.info(JSON.stringify(entry))
}
