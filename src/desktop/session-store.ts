import {
  RevisionConflictError,
  type Mutation,
  type SessionState,
  type SessionStore,
} from 'sessionweave'
import { SessionRevisionConflictError, type SqliteSessionArchive } from './session-archive'

/** Standalone SessionWeave adapter; DSH only needs the opaque archive. */
export class SqliteSessionStore implements SessionStore {
  readonly supportsNativeState = true
  readonly supportsWorkingMemoryState = true
  readonly supportsWorkingMemoryProvenance = true
  readonly supportsMaterialRevisions = true
  constructor(private readonly archive: SqliteSessionArchive) {}

  async load(sessionId: string): Promise<SessionState | null> {
    return (await this.archive.load(sessionId)) as SessionState | null
  }
  importedRaw(workspaceId: string, nodeId: string, connection: string): SessionState | null {
    return this.archive.importedRaw(workspaceId, nodeId, connection) as SessionState | null
  }
  async commit(
    sessionId: string,
    expectedRevision: number,
    mutation: Mutation,
    signal?: AbortSignal,
  ): Promise<SessionState> {
    try {
      return await this.archive.update(
        sessionId,
        expectedRevision,
        (state) => {
          const old: SessionState = state
            ? (state as SessionState)
            : {
                version: 1,
                sessionId,
                revision: 0,
                messages: [],
                checkpoints: [],
                usage: [],
              }
          const next: SessionState = {
            ...old,
            revision: old.revision + 1,
            version:
              old.version === 4 || mutation.materialRevisions
                ? 4
                : old.version === 3 || mutation.workingMemoryCheckpoint?.version === 2
                  ? 3
                  : mutation.workingMemoryCheckpoint
                    ? 2
                    : old.version,
            messages: [...old.messages, ...(mutation.messages ?? [])],
            checkpoints: [
              ...old.checkpoints,
              ...(mutation.checkpoint ? [mutation.checkpoint] : []),
            ],
            usage: [...old.usage, ...(mutation.usage ? [mutation.usage] : [])],
            nativeCheckpoints: [
              ...(old.nativeCheckpoints ?? []),
              ...(mutation.nativeCheckpoint ? [mutation.nativeCheckpoint] : []),
            ],
            workingMemoryCheckpoints: [
              ...(old.workingMemoryCheckpoints ?? []),
              ...(mutation.workingMemoryCheckpoint ? [mutation.workingMemoryCheckpoint] : []),
            ],
            ...(old.materialRevisions || mutation.materialRevisions
              ? {
                  materialRevisions: [
                    ...(old.materialRevisions ?? []),
                    ...(mutation.materialRevisions ?? []),
                  ],
                }
              : {}),
            appendLog: [
              ...(old.appendLog ?? []),
              ...(mutation.messages?.length &&
              Object.keys(mutation).every((key) => ['messages', 'usage'].includes(key))
                ? [
                    {
                      revision: old.revision + 1,
                      startSequence: old.messages.length + 1,
                      endSequence: old.messages.length + mutation.messages.length,
                    },
                  ]
                : []),
            ],
          }
          return next
        },
        signal,
      )
    } catch (error) {
      if (error instanceof SessionRevisionConflictError) throw new RevisionConflictError()
      throw error
    }
  }
}
