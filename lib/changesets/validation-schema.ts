import { z } from 'zod'
export const ValidationPolicyIntentSchema = z.object({
  schema_version: z.literal(1), workflow_run_id: z.string().min(1),
  required_commands: z.number().int().nonnegative(), commands_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict()
