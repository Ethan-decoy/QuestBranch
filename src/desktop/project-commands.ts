import { z } from 'zod'
import { id, question } from './command-schemas'
const name = z.string().trim().min(1, '请输入名称').max(100)
export const projectCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create-project'),
    name,
    requestId: id,
    directoryToken: id.optional(),
  }),
  z.object({
    type: z.literal('create-research'),
    projectId: id,
    question,
    name: z.string().trim().max(100).optional(),
    constraints: z.string().max(6000).optional(),
    requestId: id,
  }),
  z.object({ type: z.literal('select-project'), projectId: id }),
  z.object({ type: z.literal('select-research'), workspaceId: id }),
  z.object({ type: z.literal('rename-project'), projectId: id, name }),
  z.object({ type: z.literal('rename-research'), workspaceId: id, name }),
  z.object({ type: z.literal('pin-project'), projectId: id, pinned: z.boolean() }),
  z.object({ type: z.literal('pin-research'), workspaceId: id, pinned: z.boolean() }),
  z.object({
    type: z.literal('reorder-project'),
    projectId: id,
    targetProjectId: id,
    placement: z.enum(['before', 'after']),
  }),
  z.object({
    type: z.literal('reorder-research'),
    workspaceId: id,
    targetWorkspaceId: id,
    placement: z.enum(['before', 'after']),
  }),
  z.object({ type: z.literal('archive-research'), workspaceId: id, archived: z.boolean() }),
  z.object({ type: z.literal('close-project'), projectId: id }),
  z.object({ type: z.literal('move-research'), workspaceId: id, projectId: id, requestId: id }),
  z.object({ type: z.literal('import-research'), projectId: id, data: z.unknown() }),
  z.object({
    type: z.literal('save-navigation'),
    navigation: z.object({
      collapsed: z.array(id).max(10000),
      recent: z.array(id).max(100),
    }),
  }),
])
