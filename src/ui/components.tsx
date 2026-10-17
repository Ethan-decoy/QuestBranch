import { Dialog as Primitive } from 'radix-ui'
import { X, GitBranch, ArrowUpRight } from 'lucide-react'
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { clsx } from 'clsx'
import { useApp } from './state'
import type { ResearchNode, Snapshot } from '../research/types'

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={clsx('brand', small && 'small')}>
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path
          d="M9 25V9M9 17h6c5 0 8-3 8-8M9 23h9c3 0 5-2 5-5"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <circle cx="9" cy="7" r="3" fill="currentColor" />
        <circle cx="23" cy="7" r="3" fill="currentColor" />
        <circle cx="23" cy="16" r="3" fill="currentColor" />
      </svg>
      {!small && (
        <div>
          <strong>QuestBranch</strong>
          <span>问枝 · 让思考有迹可循</span>
        </div>
      )}
    </div>
  )
}
export function Button({
  children,
  className,
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' }) {
  return (
    <button className={clsx('button', variant, className)} {...props}>
      {children}
    </button>
  )
}
export function Modal({
  title,
  description,
  children,
  wide = false,
  locked = false,
}: {
  title: string
  description: string
  children: ReactNode
  wide?: boolean
  locked?: boolean
}) {
  return (
    <Primitive.Root
      open
      onOpenChange={(open) => {
        if (!open && !locked) useApp.getState().open(null)
      }}
    >
      <Primitive.Portal>
        <Primitive.Overlay className="modal-overlay" />
        <Primitive.Content className={clsx('modal', wide && 'wide')}>
          <div className="modal-heading">
            <div>
              <Primitive.Title>{title}</Primitive.Title>
              <Primitive.Description>{description}</Primitive.Description>
            </div>
            <Primitive.Close className="icon-button" aria-label="关闭对话框" disabled={locked}>
              <X size={18} />
            </Primitive.Close>
          </div>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
export function nodeStatus(node: ResearchNode, snapshot: Snapshot) {
  const run = [...snapshot.runs].reverse().find((r) => r.nodeId === node.id)
  const reports = snapshot.reports.filter((r) => r.nodeId === node.id)
  if (run?.status === 'running') return { key: 'running', label: '研究中' }
  if (run?.status === 'failed' || run?.status === 'interrupted')
    return { key: 'failed', label: run.status === 'failed' ? '需要重试' : '已中断' }
  if (reports.length) return { key: 'ready', label: '已有认识' }
  if (run?.mode === 'chat' && run.status === 'completed')
    return { key: 'pending', label: '已开展讨论' }
  return { key: 'pending', label: '待研究' }
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-symbol">
        <GitBranch size={25} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={13} />
    </a>
  )
}
