import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { ConfirmDialog } from './confirm-dialog'

type ElementWithChildren = ReactElement<{ children?: ReactNode; [key: string]: unknown }>

function collectByTestId(node: ReactNode, target: string, acc: ElementWithChildren[] = []): ElementWithChildren[] {
  if (Array.isArray(node)) {
    for (const child of node) collectByTestId(child, target, acc)
    return acc
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return acc
  }

  const element = node as ElementWithChildren
  if (element.props['data-testid'] === target) {
    acc.push(element)
  }

  collectByTestId(element.props.children, target, acc)
  return acc
}

describe('ConfirmDialog', () => {
  test('does not render when closed', () => {
    const dialog = ConfirmDialog({
      open: false,
      title: 'Stop step?',
      description: 'This will stop execution.',
      confirmLabel: 'Stop',
      onCancel: () => {},
      onConfirm: () => {},
    })

    expect(dialog).toBeNull()
  })

  test('renders modal shell, body, and action row when open', () => {
    const dialog = ConfirmDialog({
      open: true,
      title: 'Block gate?',
      description: 'This will block the gate.',
      confirmLabel: 'Block gate',
      onCancel: () => {},
      onConfirm: () => {},
    })

    expect(collectByTestId(dialog, 'confirm-dialog')).toHaveLength(1)
    expect(collectByTestId(dialog, 'confirm-dialog-actions')).toHaveLength(1)
  })
})
