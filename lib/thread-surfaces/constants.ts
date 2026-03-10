export const ROOT_THREAD_SURFACE_ID = 'thread-root'

export function deriveStepThreadSurfaceId(stepId: string): string {
  return `thread-${stepId}`
}
