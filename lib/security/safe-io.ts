import { constants } from 'fs'
import { open } from 'fs/promises'

function withNoFollow(flags: number, fallback: string): number | string {
  return typeof constants.O_NOFOLLOW === 'number'
    ? flags | constants.O_NOFOLLOW
    : fallback
}

export async function appendFileNoFollow(filePath: string, content: string): Promise<void> {
  const handle = await open(
    filePath,
    withNoFollow(constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND, 'a'),
    0o600,
  )
  try {
    await handle.writeFile(content, 'utf-8')
  } finally {
    await handle.close()
  }
}

export async function readTextFileNoFollow(filePath: string): Promise<string> {
  const handle = await open(filePath, withNoFollow(constants.O_RDONLY, 'r'))
  try {
    return await handle.readFile('utf-8')
  } finally {
    await handle.close()
  }
}

export async function writeFileNoFollow(filePath: string, content: string): Promise<void> {
  const handle = await open(
    filePath,
    withNoFollow(constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 'w'),
    0o600,
  )
  try {
    await handle.writeFile(content, 'utf-8')
  } finally {
    await handle.close()
  }
}

export async function copyFileNoFollow(sourcePath: string, destinationPath: string): Promise<void> {
  const source = await open(sourcePath, withNoFollow(constants.O_RDONLY, 'r'))
  try {
    const destination = await open(
      destinationPath,
      withNoFollow(constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 'w'),
      0o600,
    )
    try {
      await destination.writeFile(await source.readFile())
    } finally {
      await destination.close()
    }
  } finally {
    await source.close()
  }
}
