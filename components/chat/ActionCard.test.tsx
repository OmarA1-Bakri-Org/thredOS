import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { ActionCard } from './ActionCard'
import type { ProposedAction } from '@/lib/chat/validator'

type ButtonElement = ReactElement<{
  children?: ReactNode
  onClick?: () => void
}>

function collectButtons(node: ReactNode, acc: ButtonElement[] = []): ButtonElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ReactElement<{ children?: ReactNode; [key: string]: unknown }>
  if (typeof element.type === 'function') {
    const render = element.type as (props: typeof element.props) => ReactNode
    collectButtons(render(element.props), acc)
    return acc
  }

  if (typeof element.type === 'object' && element.type && 'type' in element.type) {
    const memoType = (element.type as { type?: unknown }).type
    if (typeof memoType === 'function') {
      collectButtons(memoType(element.props), acc)
      return acc
    }
  }

  if (element.type === 'button') {
    acc.push(element as ButtonElement)
  }

  collectButtons(element.props.children, acc)
  return acc
}

describe('ActionCard', () => {
  const actions: ProposedAction[] = [{ command: 'step.add', args: { id: 'draft-step' } }]

  test('apply forwards the proposed actions', () => {
    const applied: ProposedAction[][] = []
    const card = <ActionCard actions={actions} onApply={value => applied.push(value)} onDiscard={() => {}} />

    const applyButton = collectButtons(card)[0]
    ;(applyButton?.props.onClick as (() => void) | undefined)?.()

    expect(applied).toEqual([actions])
  })

  test('discard invokes the discard handler', () => {
    let discarded = false
    const card = (
      <ActionCard
        actions={actions}
        onApply={() => {}}
        onDiscard={() => {
          discarded = true
        }}
      />
    )

    const discardButton = collectButtons(card)[1]
    ;(discardButton?.props.onClick as (() => void) | undefined)?.()

    expect(discarded).toBeTrue()
  })
})
