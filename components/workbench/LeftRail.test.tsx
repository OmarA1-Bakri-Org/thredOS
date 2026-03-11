import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { useUIStore } from '@/lib/ui/store'

mock.module('@/lib/ui/api', () => ({
  useThreadSurfaces: () => ({
    data: [
      {
        id: 'thread-master',
        surfaceLabel: 'Master Thread',
        depth: 0,
        role: 'orchestrator',
        childSurfaceIds: ['thread-research', 'thread-synthesis'],
      },
      {
        id: 'thread-synthesis',
        surfaceLabel: 'Synthesis Thread',
        depth: 1,
        role: 'synth',
        childSurfaceIds: [],
      },
    ],
  }),
}))

const { LeftRail } = await import('./LeftRail')

describe('LeftRail', () => {
  beforeEach(() => {
    useUIStore.setState({
      selectedThreadSurfaceId: 'thread-synthesis',
    })
  })

  test('renders navigator surfaces with the selected thread highlighted', () => {
    const markup = renderToStaticMarkup(<LeftRail />)

    expect(markup).toContain('Thread Navigator')
    expect(markup).toContain('Master Thread')
    expect(markup).toContain('Synthesis Thread')
    expect(markup).toContain('shadow-[0_0_0_1px_rgba(96,165,250,0.15)]')
  })

  test('does not render Thread Runner locked section in footer', () => {
    const markup = renderToStaticMarkup(<LeftRail />)

    expect(markup).not.toContain('data-testid="left-rail-thread-runner"')
    expect(markup).not.toContain('Locked')
  })
})
