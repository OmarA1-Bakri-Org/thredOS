import { readFile } from 'fs/promises'
import YAML from 'yaml'
import { PackManifestSchema, type PackManifest } from './pack-schema'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '@/lib/security/safe-path'

export async function loadPack(basePath: string, packId: string, version: string): Promise<PackManifest> {
  assertSafePathSegment(packId, 'pack id')
  assertSafePathSegment(version, 'pack version')
  const threadosRoot = await resolveExistingPathWithinRoot(basePath, '.threados')
  const packsRoot = await resolveExistingPathWithinRoot(threadosRoot, 'packs')
  const filePath = await resolveExistingPathWithinRoot(packsRoot, packId, version, 'pack.yaml')
  const content = await readFile(filePath, 'utf-8')
  const raw = YAML.parse(content)
  return PackManifestSchema.parse(raw)
}
