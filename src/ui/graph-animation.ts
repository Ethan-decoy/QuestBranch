import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ResearchNode } from '../research/types'
import type { DrawnResearch, GraphLayout } from './graph-visuals'

export function useReducedGraphMotion() {
  const [reduced, setReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'),
      change = () => setReduced(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return reduced
}

export function interpolateGraphItem(
  from: DrawnResearch,
  to: DrawnResearch,
  progress: number,
): DrawnResearch {
  const p = 1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), 3)
  return {
    ...to,
    position: {
      x: from.position.x + (to.position.x - from.position.x) * p,
      y: from.position.y + (to.position.y - from.position.y) * p,
    },
    height: from.height + (to.height - from.height) * p,
    opacity: from.opacity + (to.opacity - from.opacity) * p,
  }
}

/** Only actual layout changes schedule frames; reading and AI signals use CSS. */
export function useAnimatedGraph(target: GraphLayout, all: ResearchNode[], reduced: boolean) {
  const [drawn, setDrawn] = useState<DrawnResearch[]>(() =>
    target.map((item) => ({ ...item, opacity: 1 })),
  )
  const [animating, setAnimating] = useState(false),
    current = useRef(drawn)
  useLayoutEffect(() => {
    const after: DrawnResearch[] = target.map((item) => ({ ...item, opacity: 1 }))
    if (reduced || !current.current.length) {
      current.current = after
      setDrawn(after)
      setAnimating(false)
      return
    }
    const before = new Map(current.current.map((item) => [item.node.id, item])),
      destination = new Map(after.map((item) => [item.node.id, item]))
    const parents = new Map(all.map((n) => [n.id, n.parentId]))
    const start: DrawnResearch[] = [],
      end = [...after]
    for (const old of current.current)
      if (!destination.has(old.node.id)) {
        let parent = parents.get(old.node.id),
          visited = new Set<string>()
        while (parent && !destination.has(parent) && !visited.has(parent)) {
          visited.add(parent)
          parent = parents.get(parent)
        }
        const anchor = parent ? destination.get(parent) : undefined
        end.push({ ...old, position: anchor?.position ?? old.position, opacity: 0, leaving: true })
      }
    for (const next of end) {
      const parent = next.node.parentId
        ? (before.get(next.node.parentId) ?? destination.get(next.node.parentId))
        : undefined
      start.push(
        before.get(next.node.id) ?? {
          ...next,
          position: parent?.position ?? next.position,
          opacity: 0,
        },
      )
    }
    if (
      end.length === current.current.length &&
      end.every((item, i) => {
        const old = start[i]
        return (
          old.node.id === item.node.id &&
          old.position.x === item.position.x &&
          old.position.y === item.position.y &&
          old.height === item.height &&
          old.opacity === item.opacity
        )
      })
    ) {
      current.current = after
      setDrawn(after)
      setAnimating(false)
      return
    }
    let frame = 0,
      cancelled = false
    const began = performance.now()
    setAnimating(true)
    // Mount entering cards before the next paint so returning from a creation
    // dialog can focus the real node while its entrance is still in progress.
    current.current = start
    setDrawn(start)
    const tick = (time: number) => {
      if (cancelled) return
      const p = Math.min(1, (time - began) / 400)
      current.current =
        p === 1 ? after : end.map((item, i) => interpolateGraphItem(start[i], item, p))
      setDrawn(current.current)
      if (p < 1) frame = requestAnimationFrame(tick)
      else setAnimating(false)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [target, reduced])
  const settleDraggedNode = (id: string, position: { x: number; y: number }) => {
    current.current = current.current.map((item) =>
      item.node.id === id ? { ...item, position } : item,
    )
    setDrawn(current.current)
  }
  return { drawn, animating, settleDraggedNode }
}
