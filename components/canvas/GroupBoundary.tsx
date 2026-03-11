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
  const bracketColor = 'rgba(99, 102, 241, 0.28)'
  const sz = 14

  return (
    <div
      className="pointer-events-none relative"
      style={{
        width: d.width,
        height: d.height,
        background: 'rgba(99, 102, 241, 0.025)',
      }}
    >
      {/* Corner brackets — schematic alignment marks */}
      <div className="absolute top-0 left-0" style={{ width: sz, height: sz, borderTop: `1px solid ${bracketColor}`, borderLeft: `1px solid ${bracketColor}` }} />
      <div className="absolute top-0 right-0" style={{ width: sz, height: sz, borderTop: `1px solid ${bracketColor}`, borderRight: `1px solid ${bracketColor}` }} />
      <div className="absolute bottom-0 left-0" style={{ width: sz, height: sz, borderBottom: `1px solid ${bracketColor}`, borderLeft: `1px solid ${bracketColor}` }} />
      <div className="absolute bottom-0 right-0" style={{ width: sz, height: sz, borderBottom: `1px solid ${bracketColor}`, borderRight: `1px solid ${bracketColor}` }} />

      <span className="absolute -top-5 left-2 font-mono text-[9px] uppercase tracking-[0.16em] text-indigo-400/35">
        {d.groupId}
      </span>
    </div>
  )
}

export const GroupBoundary = memo(GroupBoundaryComponent)
