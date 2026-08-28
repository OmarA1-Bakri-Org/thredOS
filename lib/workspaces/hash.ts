import { createHash } from 'crypto'

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue }

function unsupportedCanonicalJson(path: string, value: unknown): never {
  const detail = value === undefined ? 'undefined' : Object.prototype.toString.call(value)
  throw new Error(`Value at ${path} is not supported canonical JSON: ${detail}`)
}

function canonicalizeJson(value: unknown, path: string): CanonicalJsonValue {
  if (value == null) return null
  if (typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) unsupportedCanonicalJson(path, value)
    return value
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonicalizeJson(entry, `${path}[${index}]`))
  if (typeof value !== 'object') unsupportedCanonicalJson(path, value)

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) unsupportedCanonicalJson(path, value)

  const normalized = Object.create(null) as Record<string, CanonicalJsonValue>
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const entry = (value as Record<string, unknown>)[key]
    if (entry === undefined) unsupportedCanonicalJson(`${path}.${key}`, entry)
    normalized[key] = canonicalizeJson(entry, `${path}.${key}`)
  }
  return normalized
}

function toBuffer(value: ArrayBuffer | ArrayBufferView | string): Buffer {
  if (typeof value === 'string') return Buffer.from(value, 'utf-8')
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  return Buffer.from(value)
}

export function hashSha256Bytes(value: ArrayBuffer | ArrayBufferView | string): string {
  return `sha256:${createHash('sha256').update(toBuffer(value)).digest('hex')}`
}

export function stringifyCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value, '$'))
}

export function hashCanonicalJson(value: unknown): string {
  return hashSha256Bytes(stringifyCanonicalJson(value))
}
