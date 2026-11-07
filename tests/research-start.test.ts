import { expect, it } from 'vitest'
import type { ViewState } from '../src/research/types'
import { suggestChatDraft } from '../src/ui/research-start'

const fresh = (): ViewState => ({ selectedId: 'new-node', collapsed: [], drafts: {} })

it('示例只填入当前节点，保留其他节点草稿，不产生研究操作', () => {
  const view = { ...fresh(), chatDrafts: { another: '已有问题' } }
  expect(suggestChatDraft(view, 'new-node', '研究计划')).toEqual({
    chatDrafts: { another: '已有问题', 'new-node': '研究计划' },
  })
  expect(view.chatDrafts).toEqual({ another: '已有问题' })
})

it('不能覆盖当前草稿或从旧版恢复的草稿', () => {
  expect(
    suggestChatDraft(
      { ...fresh(), chatDrafts: { 'new-node': '我自己的问题' } },
      'new-node',
      '示例',
    ),
  ).toBeNull()
  expect(
    suggestChatDraft({ ...fresh(), drafts: { 'new-node': '旧版草稿' } }, 'new-node', '示例'),
  ).toBeNull()
})

it('切换节点或没有当前视图时，不把过时点击写入其他研究', () => {
  expect(suggestChatDraft({ ...fresh(), selectedId: 'another' }, 'new-node', '示例')).toBeNull()
  expect(suggestChatDraft(null, 'new-node', '示例')).toBeNull()
})

it('空白草稿可以使用示例；空的示例不会改变草稿', () => {
  expect(
    suggestChatDraft({ ...fresh(), chatDrafts: { 'new-node': '  ' } }, 'new-node', '示例'),
  ).toEqual({
    chatDrafts: { 'new-node': '示例' },
  })
  expect(suggestChatDraft(fresh(), 'new-node', '  ')).toBeNull()
})
