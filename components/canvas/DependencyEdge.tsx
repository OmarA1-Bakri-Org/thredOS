'use client'

import { memo } from 'react'
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

function DependencyEdgeComponent(props: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    borderRadius: 0,
  })

  return <BaseEdge path={edgePath} style={props.style} />
}

export const DependencyEdge = memo(DependencyEdgeComponent)
