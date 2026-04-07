import fs from 'fs/promises'
import path from 'path'

const REPLACEMENT_CHARACTER = '\uFFFD'
const UTF8_LOCALE = 'zh_CN.UTF-8'

export function filenameContainsReplacementCharacters(filename: string): boolean {
  return filename.includes(REPLACEMENT_CHARACTER)
}

export async function directoryContainsCorruptedNames(rootPath: string): Promise<boolean> {
  const pendingDirs = [rootPath]

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop()!
    const entries = await fs.readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      if (filenameContainsReplacementCharacters(entry.name)) {
        return true
      }

      if (entry.isDirectory()) {
        pendingDirs.push(path.join(currentDir, entry.name))
      }
    }
  }

  return false
}

export function buildUtf8LocaleEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    LANG: UTF8_LOCALE,
    LANGUAGE: 'zh_CN:zh',
    LC_ALL: UTF8_LOCALE,
    LC_CTYPE: UTF8_LOCALE,
  }
}
