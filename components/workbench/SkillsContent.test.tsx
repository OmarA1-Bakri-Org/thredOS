import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@/lib/ui/store', () => ({
  useUIStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ selectedThreadSurfaceId: 'ts-1' }),
}))

mock.module('@/lib/ui/api', () => ({
  useThreadSurfaceSkills: () => ({
    data: [
      { id: 'search', label: 'Search', inherited: false },
      { id: 'files', label: 'Files', inherited: false },
      { id: 'model', label: 'Model', inherited: true },
    ],
  }),
  useAgentPerformance: () => ({ data: null, isLoading: false }),
  useGateMetrics: () => ({ data: null, isLoading: false }),
  useListPacks: () => ({ data: [], isLoading: false }),
  useCreatePack: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  usePromotePack: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useBuilderProfile: () => ({ data: null, isLoading: false }),
  useThreadRunnerEligibility: () => ({ data: { eligible: false, requirements: [] }, isLoading: false }),
  useOptimizeWorkflow: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
  useListRaces: () => ({ data: [], isLoading: false }),
  useRaceResults: () => ({ data: null, isLoading: false }),
  useEnrollRace: () => ({ mutate: () => {}, isPending: false }),
  useRecordRun: () => ({ mutate: () => {}, isPending: false }),
  useTraces: () => ({ data: [], isLoading: false }),
  useApprovals: () => ({ data: [], isLoading: false }),
  useRequestApproval: () => ({ mutate: () => {}, mutateAsync: async () => ({}) }),
  useResolveApproval: () => ({ mutate: () => {}, mutateAsync: async () => ({}) }),
  useRevealSurface: () => ({ mutate: () => {}, mutateAsync: async () => ({}) }),
  useExportBundle: () => ({ mutate: () => {}, mutateAsync: async () => ({}) }),
  useSurfaceAccess: () => ({ data: null, isLoading: false }),
}))

const { SkillsContent } = await import('./SkillsContent')

describe('SkillsContent', () => {
  test('renders skills from thread surface query', () => {
    const markup = renderToStaticMarkup(<SkillsContent />)
    expect(markup).toContain('skill-inventory-panel')
    expect(markup).toContain('Search')
    expect(markup).toContain('Files')
    expect(markup).toContain('Model')
  })
})
