import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import lockfile from 'proper-lockfile'
import { z } from 'zod'
import type { AuthOperationOptions, Credential, CredentialStore } from '@earendil-works/pi-ai'
import { ResearchStore } from './store'

const credentialSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('api_key'),
    key: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z
    .object({
      type: z.literal('oauth'),
      access: z.string(),
      refresh: z.string(),
      expires: z.number(),
    })
    .loose(),
])

// A collection belongs to one QB connection. The original Pi provider ID stays
// intact, while OAuth and each API endpoint have independent encrypted storage.
export class PiCredentialStore implements CredentialStore {
  private static chains = new Map<string, Promise<unknown>>()
  constructor(
    private readonly store: ResearchStore,
    private readonly scope: string,
    private readonly providerId: string,
  ) {}
  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted()
    if (providerId !== this.providerId) return undefined
    const value = this.store.readModelCredential(this.scope)
    return value === undefined ? undefined : credentialSchema.parse(value)
  }
  async list(options?: AuthOperationOptions) {
    const credential = await this.read(this.providerId, options)
    return credential ? [{ providerId: this.providerId, type: credential.type }] : []
  }
  private async exclusive<T>(
    fn: (assertLock: () => void) => Promise<T>,
    options?: AuthOperationOptions,
  ): Promise<T> {
    const key = join(
      this.store.directory,
      `pi-${createHash('sha256').update(this.scope).digest('hex')}.lock`,
    )
    const previous = PiCredentialStore.chains.get(key) ?? Promise.resolve()
    const task = previous
      .catch(() => {})
      .then(async () => {
        const signal = options?.signal
        const deadline = Date.now() + 45000
        let compromised: Error | undefined
        let release: (() => Promise<void>) | undefined
        while (!release) {
          signal?.throwIfAborted()
          try {
            release = await lockfile.lock(join(this.store.directory, 'research.sqlite'), {
              lockfilePath: key,
              stale: 30000,
              update: 10000,
              onCompromised: (error) => {
                compromised = error
              },
            })
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ELOCKED' || Date.now() >= deadline)
              throw error
            await setTimeout(100, undefined, { signal })
          }
        }
        try {
          signal?.throwIfAborted()
          const assertLock = () => {
            signal?.throwIfAborted()
            if (compromised) throw compromised
          }
          const result = await fn(assertLock)
          assertLock()
          return result
        } finally {
          await release()
        }
      })
    PiCredentialStore.chains.set(key, task)
    try {
      return await task
    } finally {
      if (PiCredentialStore.chains.get(key) === task) PiCredentialStore.chains.delete(key)
    }
  }
  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ) {
    if (providerId !== this.providerId) throw new Error('凭据与当前模型连接不匹配')
    return this.exclusive(async (assertLock) => {
      const current = await this.read(providerId, options)
      const next = await fn(current)
      assertLock()
      if (next !== undefined)
        this.store.saveModelCredential(this.scope, credentialSchema.parse(next))
      return next ?? current
    }, options)
  }
  async delete(providerId: string, options?: AuthOperationOptions) {
    if (providerId !== this.providerId) throw new Error('凭据与当前模型连接不匹配')
    await this.exclusive(async (assertLock) => {
      assertLock()
      this.store.saveModelCredential(this.scope, undefined)
    }, options)
  }
}
