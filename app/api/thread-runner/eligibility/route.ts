import { checkEligibility } from '@/lib/thread-runner/repository'

export async function GET() {
  const status = checkEligibility()
  return Response.json(status)
}
