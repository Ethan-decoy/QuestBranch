import { useState } from 'react'
import { Popover } from 'radix-ui'
import { ArrowUpRight, Link2 } from 'lucide-react'
import { useApp } from './state'
import { relatedResearch, visibleResearchRows } from './research-view'
import { ancestorPath } from '../research/context'
import { nodeStatus, StatusLabel } from './components'
import { useTranslation } from 'react-i18next'

export function RelatedResearch() {
  const { t } = useTranslation()
  const state = useApp(),
    snapshot = state.snapshot!,
    view = state.view!,
    nodes = snapshot.nodes.filter(
      (node) => node.workspaceId === state.workspaceId && !node.removedAt,
    ),
    related = relatedResearch(nodes, view.selectedId),
    visible = new Set(
      visibleResearchRows(nodes, view.collapsed, view.graph?.focusId).map((row) => row.node.id),
    ),
    [open, setOpen] = useState(false)
  if (!related.length) return null
  return (
    <div className="related-navigation">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          className="related-trigger"
          aria-label={t('查看相关研究')}
          title={t('相关研究')}
        >
          <Link2 size={15} />
          <span>{related.length}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="related-popover"
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={12}
            aria-label={t('相关研究')}
          >
            <h3>
              {t('相关研究')} <span>{related.length}</span>
            </h3>
            <div className="related-list">
              {related.map((node) => {
                const path = ancestorPath(nodes, node.id)
                  .map((item) => item.title)
                  .join(' / ')
                return (
                  <button
                    key={node.id}
                    data-related-id={node.id}
                    onClick={() => {
                      setOpen(false)
                      state.jumpToRelated(node.id)
                    }}
                  >
                    <StatusLabel status={nodeStatus(node, snapshot)} compact />
                    <span>
                      <strong>{node.title}</strong>
                      <small title={path}>{path}</small>
                      {!visible.has(node.id) && (
                        <small className="related-hidden">
                          {view.graph?.focusId &&
                          !ancestorPath(nodes, node.id).some(
                            (item) => item.id === view.graph!.focusId,
                          )
                            ? t('当前分支外')
                            : t('已折叠')}
                        </small>
                      )}
                    </span>
                    <ArrowUpRight size={14} />
                  </button>
                )
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
