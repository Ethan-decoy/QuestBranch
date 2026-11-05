import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  RevisionConflictError,
  type Mutation,
  type SessionState,
  type SessionStore,
} from 'sessionweave'

export type SessionOwner = {
  sessionId: string
  workspaceId: string
  nodeId: string
  connection: string
  bootstrap: string[]
}

/** SQLite owns atomic publication only. Validation and compaction remain in SW. */
export class SqliteSessionStore implements SessionStore {
  readonly supportsNativeState = true
  readonly supportsWorkingMemoryState = true
  readonly supportsWorkingMemoryProvenance = true
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS model_sessions (
      session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      node_id TEXT NOT NULL REFERENCES nodes(id), connection TEXT NOT NULL, owner TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0, state TEXT,
      UNIQUE(node_id, connection));
      CREATE TABLE IF NOT EXISTS model_tool_results (
      session_id TEXT NOT NULL REFERENCES model_sessions(session_id), call_id TEXT NOT NULL,
      payload TEXT NOT NULL, PRIMARY KEY(session_id,call_id));
      CREATE TABLE IF NOT EXISTS model_session_archives (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), payload TEXT NOT NULL);`)
  }
  owner(workspaceId: string, nodeId: string, connection: string): SessionOwner {
    const row = this.db
      .prepare('SELECT owner FROM model_sessions WHERE node_id=? AND connection=?')
      .get(nodeId, connection)
    if (row) return JSON.parse(String(row.owner))
    const owner: SessionOwner = {
      sessionId: randomUUID(),
      workspaceId,
      nodeId,
      connection,
      bootstrap: [],
    }
    this.db
      .prepare(
        'INSERT INTO model_sessions(session_id,workspace_id,node_id,connection,owner) VALUES (?,?,?,?,?)',
      )
      .run(owner.sessionId, workspaceId, nodeId, connection, JSON.stringify(owner))
    return owner
  }
  bootstrapped(owner: SessionOwner, ids: string[]) {
    owner.bootstrap = ids
    this.db
      .prepare('UPDATE model_sessions SET owner=? WHERE session_id=?')
      .run(JSON.stringify(owner), owner.sessionId)
  }
  async load(sessionId: string): Promise<SessionState | null> {
    const row = this.db
      .prepare('SELECT state FROM model_sessions WHERE session_id=?')
      .get(sessionId)
    if (!row) throw new Error('研究会话不存在')
    return row.state ? JSON.parse(String(row.state)) : null
  }
  async commit(
    sessionId: string,
    expectedRevision: number,
    mutation: Mutation,
    signal?: AbortSignal,
  ): Promise<SessionState> {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db
        .prepare('SELECT state,revision FROM model_sessions WHERE session_id=?')
        .get(sessionId)
      if (!row || row.revision !== expectedRevision) throw new RevisionConflictError()
      const old: SessionState = row.state
        ? JSON.parse(String(row.state))
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
          old.version === 3 || mutation.workingMemoryCheckpoint?.version === 2
            ? 3
            : mutation.workingMemoryCheckpoint
              ? 2
              : old.version,
        messages: [...old.messages, ...(mutation.messages ?? [])],
        checkpoints: [...old.checkpoints, ...(mutation.checkpoint ? [mutation.checkpoint] : [])],
        usage: [...old.usage, ...(mutation.usage ? [mutation.usage] : [])],
        nativeCheckpoints: [
          ...(old.nativeCheckpoints ?? []),
          ...(mutation.nativeCheckpoint ? [mutation.nativeCheckpoint] : []),
        ],
        workingMemoryCheckpoints: [
          ...(old.workingMemoryCheckpoints ?? []),
          ...(mutation.workingMemoryCheckpoint ? [mutation.workingMemoryCheckpoint] : []),
        ],
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
      signal?.throwIfAborted()
      this.db
        .prepare('UPDATE model_sessions SET state=?,revision=? WHERE session_id=? AND revision=?')
        .run(JSON.stringify(next), next.revision, sessionId, expectedRevision)
      this.db.exec('COMMIT')
      return structuredClone(next)
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  result(
    sessionId: string,
    callId: string,
  ): {
    value: Record<string, unknown>
    summary: string
    isError?: boolean
    undo?: { nodeId: string; removalId: string }
  } | null {
    const row = this.db
      .prepare('SELECT payload FROM model_tool_results WHERE session_id=? AND call_id=?')
      .get(sessionId, callId)
    return row ? JSON.parse(String(row.payload)) : null
  }
  saveResult(sessionId: string, callId: string, result: unknown) {
    this.db
      .prepare('INSERT INTO model_tool_results VALUES (?,?,?)')
      .run(sessionId, callId, JSON.stringify(result))
  }
  export(workspaceId: string) {
    return {
      version: 1,
      sessions: this.db
        .prepare('SELECT owner,state FROM model_sessions WHERE workspace_id=?')
        .all(workspaceId)
        .map((row) => ({
          owner: JSON.parse(String(row.owner)),
          state: row.state ? JSON.parse(String(row.state)) : null,
          results: this.db
            .prepare('SELECT call_id,payload FROM model_tool_results WHERE session_id=?')
            .all(JSON.parse(String(row.owner)).sessionId)
            .map((result) => ({
              callId: String(result.call_id),
              result: JSON.parse(String(result.payload)),
            })),
        })),
      archives: this.db
        .prepare('SELECT payload FROM model_session_archives WHERE workspace_id=?')
        .all(workspaceId)
        .map((row) => JSON.parse(String(row.payload))),
    }
  }
  /** Imported identities are read-only evidence. New writable sessions bootstrap public QB records. */
  archive(workspaceId: string, payload: unknown) {
    this.db
      .prepare('INSERT INTO model_session_archives VALUES (?,?,?)')
      .run(randomUUID(), workspaceId, JSON.stringify(payload))
  }
  importedRaw(workspaceId: string, nodeId: string, connection: string): SessionState | null {
    return this.importedSession(workspaceId, nodeId, connection)?.state ?? null
  }
  importedResult(
    workspaceId: string,
    nodeId: string,
    connection: string,
    callId: string,
  ): ReturnType<SqliteSessionStore['result']> {
    return (
      this.importedSession(workspaceId, nodeId, connection)?.results?.find(
        (result) => result.callId === callId,
      )?.result ?? null
    )
  }
  private importedSession(workspaceId: string, nodeId: string, connection: string) {
    type Archived = {
      owner: SessionOwner
      state: SessionState | null
      results?: { callId: string; result: NonNullable<ReturnType<SqliteSessionStore['result']>> }[]
    }
    const rows = this.db
      .prepare(
        'SELECT payload FROM model_session_archives WHERE workspace_id=? ORDER BY rowid DESC',
      )
      .all(workspaceId)
    const find = (value: unknown): Archived | null => {
      if (!value || typeof value !== 'object') return null
      const archive = value as {
        sessions?: Archived[]
        archives?: unknown[]
      }
      const source = archive.sessions?.find(
        (entry) => entry.owner?.nodeId === nodeId && entry.owner.connection === connection,
      )
      if (source?.state) return source
      for (const child of archive.archives ?? []) {
        const source = find(child)
        if (source) return source
      }
      return null
    }
    for (const row of rows) {
      const source = find(JSON.parse(String(row.payload)))
      if (source) return source
    }
    return null
  }
}
