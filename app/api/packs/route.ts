import { PackRepository } from '@/lib/packs/repository'

const repo = new PackRepository()

export async function GET() {
  const packs = repo.listPacks()
  return Response.json({ packs })
}
