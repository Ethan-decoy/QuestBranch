import { z } from 'zod'
import { SourceSchema, ReasoningEffortSchema } from '../research/types'
import { AgentRunSchema, AgentActivitySchema } from '../research/agent'
import { ModelCallSchema } from '../research/usage'

const text = z.string().max(100_000),
  id = z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
    .refine(
      (value) => !['constructor', 'prototype', 'toString', 'hasOwnProperty'].includes(value),
      '记录编号无效',
    ),
  time = z.iso.datetime()
export { id as recordIdSchema }
const workspaceSchema = z.object({
  id,
  name: text,
  question: text,
  objective: text,
  constraints: text,
  rootId: id,
  createdAt: time,
  updatedAt: time,
})
const nodeSchema = z.object({
  id,
  workspaceId: id,
  parentId: id.nullable(),
  removedAt: time.optional(),
  removalId: id.optional(),
  title: text,
  question: text,
  summary: text,
  openQuestions: z.array(text).max(100),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  relatedIds: z.array(id).max(100),
  createdAt: time,
  updatedAt: time,
  originReportId: id.optional(),
  referenceReportIds: z.array(id).max(20).optional(),
})
const reportSchema = z.object({
  id,
  workspaceId: id,
  nodeId: id,
  title: text,
  markdown: text,
  summary: text,
  findings: z.array(text).max(100),
  openQuestions: z.array(text).max(100),
  sources: z.array(SourceSchema).max(100),
  createdAt: time,
  origin: z.enum(['ai', 'import']),
  model: text,
  runId: id.optional(),
  saveRequest: z
    .object({ id: z.string().min(1).max(200), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
    .optional(),
})
const contextSchema = z.object({
  policy: z.literal('branch-v1'),
  createdAt: time,
  workspaceId: id,
  nodeId: id,
  path: z.array(id),
  items: z.array(
    z.object({
      reportId: id,
      nodeId: id,
      title: text,
      reason: text,
      included: z.boolean(),
      excerpted: z.boolean(),
    }),
  ),
  sources: z.array(SourceSchema),
  messages: z.array(
    z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(400000) }),
  ),
  conversation: z
    .object({ includedMessageIds: z.array(id), omittedMessageIds: z.array(id) })
    .optional(),
  estimatedTokens: z.number().nonnegative(),
  budget: z.number().positive(),
  limitations: z.array(text),
})
const runSchema = z.object({
  recovery: z.literal('agent-session').optional(),
  modelCalls: z.array(ModelCallSchema).max(500).optional(),
  session: z
    .object({
      sessionId: id,
      bootstrapMessageIds: z.array(z.string()),
      requests: z.array(
        z.object({
          revision: z.number().int().nonnegative(),
          strategy: z.enum(['portable', 'native']),
          checkpointId: z.string().nullable(),
          origin: z.string(),
          modelId: z.string(),
          contextWindow: z.number().positive(),
          inputTokens: z.number().nonnegative(),
          request: z.unknown(),
        }),
      ),
    })
    .optional(),
  activities: z.array(AgentActivitySchema).max(500).optional(),
  toolCalls: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: text,
        arguments: z.unknown(),
        result: z.unknown().optional(),
        error: text.optional(),
      }),
    )
    .max(100)
    .optional(),
  agent: AgentRunSchema.optional(),
  id,
  workspaceId: id,
  nodeId: id,
  instruction: text,
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  phase: text,
  output: z.string().max(180000),
  error: text,
  model: text,
  reasoningEffort: ReasoningEffortSchema.optional(),
  context: contextSchema,
  createdAt: time,
  finishedAt: time.optional(),
  reportId: id.optional(),
  mode: z.literal('chat').optional(),
  selectedReportId: id.optional(),
  provider: z.enum(['compatible', 'ollama', 'codex', 'account']).optional(),
  api: z.object({ protocol: z.string().max(100), baseUrl: z.url().max(1000) }).optional(),
  codex: z.object({ threadId: id, turnId: id.optional() }).optional(),
  pi: z
    .object({
      provider: z.string().max(200),
      api: z.string().max(100),
      responseId: text.optional(),
    })
    .optional(),
})
const messageSchema = z.object({
  id,
  workspaceId: id,
  nodeId: id,
  runId: id,
  role: z.enum(['user', 'assistant']),
  content: z.string().max(180000),
  createdAt: time,
})
const viewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().min(0.001).max(5),
})
const positionsSchema = z.record(id, z.object({ x: z.number().finite(), y: z.number().finite() }))
const graphFrameSchema = z.object({
  mode: z.enum(['horizontal', 'mindmap', 'outline']),
  detail: z.enum(['summary', 'compact']),
  focusId: id.optional(),
})
export const viewSchema = z.object({
  revision: z.number().nonnegative().optional(),
  selectedId: id,
  collapsed: z.array(id).max(5000),
  drafts: z.record(id, z.string().max(12000)),
  chatDrafts: z.record(id, z.string().max(12000)).optional(),
  readers: z
    .record(
      id,
      z.object({
        tab: z.enum(['chat', 'report', 'sources', 'records']),
        reportId: id.optional(),
        scroll: z.record(z.string().max(220), z.number().finite().nonnegative()).optional(),
        composerOpen: z.boolean().optional(),
        overviewOpen: z.boolean().optional(),
        questionOpen: z.boolean().optional(),
      }),
    )
    .optional(),
  viewport: viewportSchema.optional(),
  positions: positionsSchema.optional(),
  graph: z
    .object({
      mode: z.enum(['horizontal', 'mindmap', 'outline']).optional(),
      detail: z.enum(['summary', 'compact']).optional(),
      focusId: id.optional(),
      branchSides: z.record(id, z.enum(['left', 'right'])).optional(),
      noticedNodeIds: z.array(id).max(10000).optional(),
      history: z
        .array(
          graphFrameSchema.extend({
            selectedId: id,
            collapsed: z.array(id).max(5000).optional(),
            viewport: viewportSchema.optional(),
          }),
        )
        .max(20)
        .optional(),
      scenes: z
        .array(
          graphFrameSchema.extend({
            viewport: viewportSchema.optional(),
            positions: positionsSchema.optional(),
          }),
        )
        .max(64)
        .optional(),
    })
    // Accept retired outline views at the storage/import boundary only. Do not
    // map their scenes onto horizontal ones and overwrite existing camera memory.
    .transform((graph) => ({
      ...graph,
      mode: graph.mode === 'outline' ? ('horizontal' as const) : graph.mode,
      history: graph.history?.map((frame) => ({
        ...frame,
        mode: frame.mode === 'outline' ? ('horizontal' as const) : frame.mode,
      })),
      scenes: graph.scenes?.flatMap((scene) =>
        scene.mode === 'outline' ? [] : [{ ...scene, mode: scene.mode }],
      ),
    }))
    .optional(),
})
const editSchema = z.object({ nodeId: id, previous: nodeSchema, createdAt: time })
const branchReceiptSchema = z.object({
  requestId: z.string().min(1).max(200),
  workspaceId: id,
  parentId: id,
  sourceReportId: id,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  nodeIds: z.array(id).min(1).max(20),
})
export const exportSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  modelSessions: z.unknown().optional(),
  workspace: workspaceSchema,
  nodes: z.array(nodeSchema).min(1).max(10000),
  reports: z.array(reportSchema).max(20000),
  runs: z.array(runSchema).max(20000),
  messages: z.array(messageSchema).max(40000).default([]),
  edits: z.array(editSchema).max(50000).default([]),
  branchRequests: z.array(branchReceiptSchema).max(20000).default([]),
  view: viewSchema.optional(),
})
