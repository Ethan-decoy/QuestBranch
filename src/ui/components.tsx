import { Dialog as Primitive } from 'radix-ui'
import {
  X,
  GitBranch,
  ArrowUpRight,
  Circle,
  FileText,
  LoaderCircle,
  Check,
  CirclePause,
  MessageSquare,
} from 'lucide-react'
import { useId, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { clsx } from 'clsx'
import { useApp } from './state'
import type { ResearchStatus } from './research-status'
import { useTranslation } from 'react-i18next'
import { statusText } from './i18n-labels'
export { nodeStatus } from './research-status'

export function Logo({ small = false }: { small?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={clsx('brand', small && 'small')} role="img" aria-label={t('QuestBranch 问之')}>
      <span className="brand-mark" aria-hidden="true" />
      {/* i18next-instrument-ignore-next-line: brand name */}
      {!small && <strong aria-hidden="true">QuestBranch</strong>}
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
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  wide?: boolean
  locked?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const descriptionId = useId()
  return (
    <Primitive.Root
      open
      onOpenChange={(open) => {
        if (!open && !locked) useApp.getState().open(null)
      }}
    >
      <Primitive.Portal>
        <Primitive.Overlay className="modal-overlay" />
        <Primitive.Content
          className={clsx('modal', wide && 'wide', className)}
          aria-describedby={description ? descriptionId : undefined}
        >
          <div className="modal-heading">
            <div>
              <Primitive.Title>{title}</Primitive.Title>
              {description && (
                <Primitive.Description id={descriptionId}>{description}</Primitive.Description>
              )}
            </div>
            <Primitive.Close className="icon-button" aria-label={t('关闭对话框')} disabled={locked}>
              <X size={18} />
            </Primitive.Close>
          </div>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
export function StatusLabel({
  status,
  compact = false,
}: {
  status: ResearchStatus
  compact?: boolean
}) {
  useTranslation()
  const label = statusText(status)
  const Icon =
    status.key === 'failed'
      ? null
      : {
          pending: Circle,
          discussed: MessageSquare,
          running: LoaderCircle,
          ready: FileText,
          interrupted: CirclePause,
        }[status.key]
  return (
    <span
      className={clsx('status', status.key, compact && 'status-compact')}
      title={compact ? label : undefined}
    >
      {Icon ? (
        <Icon
          size={12}
          aria-hidden="true"
          className={status.key === 'running' ? 'spin' : undefined}
        />
      ) : (
        <SignalIcon tone="error" size={16} />
      )}
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </span>
  )
}
export function SignalIcon({
  tone,
  size = 18,
}: {
  tone: 'error' | 'warning' | 'success'
  size?: number
}) {
  if (tone === 'success')
    return <Check size={size} className="signal-icon success" aria-hidden="true" />
  return (
    <svg
      className={`signal-icon ${tone}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {tone === 'error' ? (
        <>
          <circle cx="12" cy="12" r="10" fill="var(--color-error-signal)" />
          <path
            d="m8 8 8 8m0-8-8 8"
            fill="none"
            stroke="var(--color-on-error-signal)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <path
            d="M12 2.5 22 21H2Z"
            fill="var(--color-warning-signal)"
            stroke="var(--color-warning-outline)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M12 8v6"
            stroke="var(--color-on-warning-signal)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="12" cy="17.5" r="1.3" fill="var(--color-on-warning-signal)" />
        </>
      )}
    </svg>
  )
}
export function Feedback({
  tone,
  children,
}: {
  tone: 'error' | 'warning' | 'success'
  children: ReactNode
}) {
  return (
    <div
      className={`feedback ${tone === 'warning' ? 'notice' : `inline-${tone}`}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <SignalIcon tone={tone} />
      <div className="feedback-content">{children}</div>
    </div>
  )
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
