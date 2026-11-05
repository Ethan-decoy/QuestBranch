import { useEffect, useRef, useState } from 'react'
import { Popover } from 'radix-ui'
import { Button } from './components'
import { useTranslation } from 'react-i18next'

export function PanelResizer({
  label,
  width,
  min,
  max,
  reversed = false,
  hidden,
  onResize,
}: {
  label: string
  width: number
  min: number
  max: number
  reversed?: boolean
  hidden?: boolean
  onResize: (width: number) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; width: number; pointer: number } | null>(null)
  const moved = useRef(false)
  const editWidth = () =>
    String(Math.min(Math.floor(max), Math.max(Math.ceil(min), Math.round(width))))
  useEffect(() => {
    if (hidden) setOpen(false)
  }, [hidden])
  return (
    <Popover.Root
      open={open && !hidden}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setDraft(editWidth())
      }}
    >
      <Popover.Trigger asChild>
        <div
          className="panel-resizer"
          hidden={hidden}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('调整{{label}}', { label })}
          aria-valuemin={Math.ceil(min)}
          aria-valuemax={Math.floor(max)}
          aria-valuenow={Math.round(width)}
          aria-valuetext={t('{{val}} 像素', { val: Math.round(width) })}
          title={label}
          tabIndex={0}
          data-dragging={dragging || undefined}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 4 : 24
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              if (event.key === 'Home') onResize(min)
              else if (event.key === 'End') onResize(max)
              else
                onResize(width + (event.key === 'ArrowRight' ? 1 : -1) * (reversed ? -1 : 1) * step)
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setDraft(editWidth())
              setOpen(!open)
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            setOpen(false)
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            start.current = { x: event.clientX, width, pointer: event.pointerId }
            moved.current = false
            setDragging(true)
          }}
          onPointerMove={(event) => {
            if (!start.current || start.current.pointer !== event.pointerId) return
            const delta = event.clientX - start.current.x
            if (Math.abs(delta) > 2) moved.current = true
            if (moved.current) onResize(start.current.width + delta * (reversed ? -1 : 1))
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
            start.current = null
            setDragging(false)
          }}
          onLostPointerCapture={() => {
            start.current = null
            setDragging(false)
          }}
          onClick={(event) => {
            if (moved.current) event.preventDefault()
          }}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="resize-popover"
          aria-label={label}
          side={reversed ? 'left' : 'right'}
          sideOffset={6}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onResize(Number(draft))
              setOpen(false)
            }}
          >
            <label>
              {t('{{label}}（px）', { label })}
              <input
                type="number"
                min={Math.ceil(min)}
                max={Math.floor(max)}
                required
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <Button type="submit">{t('应用')}</Button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
