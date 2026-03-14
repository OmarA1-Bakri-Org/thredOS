'use client'

import { memo } from 'react'
import { getSmoothStepPath, type EdgeProps } from '@xyflow/react'

function DependencyEdgeComponent(props: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    borderRadius: 8,
  })

  const color = (props.style?.stroke as string) || '#94a3b8'
  const isAnimated = props.animated

  return (
    <g>
      {/* Glow layer — soft halo under the edge */}
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeOpacity={0.07}
        strokeLinecap="round"
      />
      {/* Main edge */}
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeOpacity={isAnimated ? 0.8 : 0.45}
        strokeLinecap="round"
        strokeDasharray={isAnimated ? '6 4' : undefined}
        className={isAnimated ? 'threados-edge-flow' : undefined}
      />
      {/* Target endpoint dot */}
      <circle
        cx={props.targetX}
        cy={props.targetY}
        r={2.5}
        fill={color}
        fillOpacity={0.4}
      />
    </g>
  )
}

export const DependencyEdge = memo(DependencyEdgeComponent)
