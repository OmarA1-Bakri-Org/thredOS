import { describe, expect, test } from 'bun:test'
import { buttonVariants } from './button'

describe('buttonVariants', () => {
  test('default workbench buttons use hard-corner geometry', () => {
    const classes = buttonVariants({ variant: 'default', size: 'default' })

    expect(classes).toContain('rounded-none')
    expect(classes).toContain('border')
    expect(classes).toContain('uppercase')
  })

  test('success and warning variants expose explicit semantic tones', () => {
    expect(buttonVariants({ variant: 'success' })).toContain('emerald')
    expect(buttonVariants({ variant: 'warning' })).toContain('amber')
  })
})
