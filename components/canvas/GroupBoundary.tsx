'use client'

import { memo } from 'react'
import type { NodeProps, Node } from '@xyflow/react'

export interface GroupBoundaryData {
  groupId: string
  width: number
  height: number
  [key: string]: unknown
}

function GroupBoundaryComponent({ data }: NodeProps<Node<GroupBoundaryData>>) {
  const d = data as GroupBoundaryData
  return (
    <div
      className="pointer-events-none"
      style={{
        width: d.width,
        height: d.height,
        border: '1px dashed rgba(99, 102, 241, 0.25)',
        background: 'rgba(99, 102, 241, 0.04)',
        position: 'relative',
      }}
    >
      <span className="absolute -top-5 left-2 font-mono text-[9px] uppercase tracking-[0.16em] text-indigo-400/50">
        {d.groupId}
      </span>
    </div>
  )
}

export const GroupBoundary = memo(GroupBoundaryComponent)
