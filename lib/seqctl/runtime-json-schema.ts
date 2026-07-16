import { z } from 'zod'

export const RuntimeJsonSuccessSchema = z.object({
  schemaVersion: z.literal(1),
  success: z.literal(true),
  data: z.unknown(),
})

export const RuntimeJsonFailureSchema = z.object({
  schemaVersion: z.literal(1),
  success: z.literal(false),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
})

export const RuntimeJsonEnvelopeSchema = z.discriminatedUnion('success', [
  RuntimeJsonSuccessSchema,
  RuntimeJsonFailureSchema,
])

export type RuntimeJsonEnvelope = z.infer<typeof RuntimeJsonEnvelopeSchema>

export function runtimeSuccess(data: unknown): RuntimeJsonEnvelope {
  return RuntimeJsonSuccessSchema.parse({ schemaVersion: 1, success: true, data })
}

export function runtimeFailure(code: string, message: string): RuntimeJsonEnvelope {
  return RuntimeJsonFailureSchema.parse({
    schemaVersion: 1,
    success: false,
    error: { code, message },
  })
}
