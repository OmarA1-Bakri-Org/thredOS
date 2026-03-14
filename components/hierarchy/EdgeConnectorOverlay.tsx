'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface EdgeDef {
  source: string
  target: string
}

interface EdgePath {
  key: string
  d: string
}

interface EdgeConnectorOverlayProps {
  edges: EdgeDef[]
}

/**
 * Renders SVG bezier-curve connectors between nodes identified by
 * `data-thread-surface-id` attributes within the nearest parent
 * `[data-testid="thread-flow-plane"]` container.
 *
 * This is a separate client component so that the parent ThreadFlowPlane
 * can remain hook-free (important for the existing test harness that calls
 * function components directly outside of React's render pipeline).
 */
export function EdgeConnectorOverlay({ edges }: EdgeConnectorOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [edgePaths, setEdgePaths] = useState<EdgePath[]>([])
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 })

  const computeEdges = useCallback(() => {
    const svg = svgRef.current
    if (!svg || edges.length === 0) {
      setEdgePaths([])
      return
    }

    // Walk up to the flow-plane container
    const container = svg.closest('[data-testid="thread-flow-plane"]') as HTMLElement | null
    if (!container) {
      setEdgePaths([])
      return
    }

    const containerRect = container.getBoundingClientRect()
    setSvgSize({ width: containerRect.width, height: containerRect.height })

    const paths: EdgePath[] = []
    for (const edge of edges) {
      const sourceEl = container.querySelector<HTMLElement>(
        `[data-thread-surface-id="${CSS.escape(edge.source)}"]`,
      )
      const targetEl = container.querySelector<HTMLElement>(
        `[data-thread-surface-id="${CSS.escape(edge.target)}"]`,
      )
      if (!sourceEl || !targetEl) continue

      const sourceRect = sourceEl.getBoundingClientRect()
      const targetRect = targetEl.getBoundingClientRect()

      // Source: right-edge center; Target: left-edge center (horizontal flow)
      const x1 = sourceRect.right - containerRect.left
      const y1 = sourceRect.top + sourceRect.height / 2 - containerRect.top
      const x2 = targetRect.left - containerRect.left
      const y2 = targetRect.top + targetRect.height / 2 - containerRect.top

      // Cubic bezier with horizontal control points for a smooth curve
      const dx = (x2 - x1) * 0.5
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`

      paths.push({ key: `${edge.source}->${edge.target}`, d })
    }
    setEdgePaths(paths)
  }, [edges])

  useEffect(() => {
    // Defer first computation so sibling nodes have mounted
    const frame = requestAnimationFrame(() => computeEdges())

    const svg = svgRef.current
    const container = svg?.closest('[data-testid="thread-flow-plane"]') as HTMLElement | null
    if (!container) return () => cancelAnimationFrame(frame)

    const observer = new ResizeObserver(() => {
      computeEdges()
    })
    observer.observe(container)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [computeEdges])

  if (edges.length === 0) return null

  return (
    <svg
      ref={svgRef}
      data-testid="edge-connector-svg"
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
      width={svgSize.width || '100%'}
      height={svgSize.height || '100%'}
    >
      {edgePaths.map(ep => (
        <path
          key={ep.key}
          data-testid="edge-connector"
          d={ep.d}
          fill="none"
          stroke="rgba(100,116,139,0.3)"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  )
}
