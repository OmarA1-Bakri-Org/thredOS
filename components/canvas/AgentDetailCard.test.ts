import { describe, expect, test } from 'bun:test'
import { resolveFloatingCardLayout } from './AgentDetailCard'

describe('resolveFloatingCardLayout', () => {
  test('keeps an oversized card inside the canvas with a scrollable viewport height', () => {
    expect(resolveFloatingCardLayout({
      rawLeft: 400,
      rawBottom: 500,
      cardWidth: 320,
      cardHeight: 780,
      zoom: 1,
      containerWidth: 1280,
      containerHeight: 720,
      topInset: 96,
      bottomLimit: 360,
      margin: 12,
    })).toEqual({
      left: 400,
      top: 96,
      maxHeight: 264,
    })
  })
})
