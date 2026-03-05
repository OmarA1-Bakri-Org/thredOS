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
      className="rounded-lg pointer-events-none"
      style={{
        width: d.width,
        height: d.height,
        border: '2px dashed rgba(99, 102, 241, 0.4)',
        background: 'rgba(99, 102, 241, 0.05)',
        position: 'relative',
      }}
    >
      <span
        className="absolute -top-5 left-2 text-[10px] font-mono text-indigo-400 opacity-70"
      >
        group: {d.groupId}
      </span>
    </div>
  )
}

export const GroupBoundary = memo(GroupBoundaryComponent)
