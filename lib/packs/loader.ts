import { readFile } from 'fs/promises'
import { join } from 'path'
import YAML from 'yaml'
import { PackManifestSchema, type PackManifest } from './pack-schema'

const PACKS_PATH = '.threados/packs'

export async function loadPack(basePath: string, packId: string, version: string): Promise<PackManifest> {
  const filePath = join(basePath, PACKS_PATH, packId, version, 'pack.yaml')
  const content = await readFile(filePath, 'utf-8')
  const raw = YAML.parse(content)
  return PackManifestSchema.parse(raw)
}
