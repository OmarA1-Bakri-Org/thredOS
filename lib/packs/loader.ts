import { readFile } from 'fs/promises'
import YAML from 'yaml'
import { PackManifestSchema, type PackManifest } from './pack-schema'
import { assertSafePathSegment, resolveExistingPathWithinRoot } from '@/lib/security/safe-path'

const PACKS_PATH = '.threados/packs'

export async function loadPack(basePath: string, packId: string, version: string): Promise<PackManifest> {
  assertSafePathSegment(packId, 'pack id')
  assertSafePathSegment(version, 'pack version')
  const filePath = await resolveExistingPathWithinRoot(basePath, PACKS_PATH, packId, version, 'pack.yaml')
  const content = await readFile(filePath, 'utf-8')
  const raw = YAML.parse(content)
  return PackManifestSchema.parse(raw)
}
