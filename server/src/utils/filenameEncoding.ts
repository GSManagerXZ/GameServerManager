import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'

const REPLACEMENT_CHARACTER = '\uFFFD'
const UTF8_LOCALE = 'zh_CN.UTF-8'
const FALLBACK_UTF8_LOCALE = 'C.UTF-8'
const UTF8_LOCALE_CANDIDATES = [
  UTF8_LOCALE,
  'zh_CN.utf8',
  FALLBACK_UTF8_LOCALE,
  'C.utf8',
  'en_US.UTF-8',
  'en_US.utf8',
]

let cachedUtf8Locale: string | null = null

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
  const locale = getPreferredUtf8Locale(baseEnv)
  const nextEnv: NodeJS.ProcessEnv = { ...baseEnv }

  for (const key of Object.keys(nextEnv)) {
    if (key.startsWith('LC_')) {
      delete nextEnv[key]
    }
  }

  nextEnv.LANG = locale
  nextEnv.LC_ALL = locale
  nextEnv.LC_CTYPE = locale
  nextEnv.LC_MESSAGES = locale

  if (locale.toLowerCase().startsWith('zh_cn')) {
    nextEnv.LANGUAGE = 'zh_CN:zh'
  } else {
    delete nextEnv.LANGUAGE
  }

  return nextEnv
}

export function getPreferredUtf8Locale(baseEnv: NodeJS.ProcessEnv = process.env): string {
  if (os.platform() === 'win32') {
    return UTF8_LOCALE
  }

  const configuredLocale = baseEnv.GSM3_TERMINAL_LOCALE?.trim()
  if (configuredLocale) {
    return configuredLocale
  }

  if (cachedUtf8Locale) {
    return cachedUtf8Locale
  }

  cachedUtf8Locale = detectAvailableUtf8Locale()
  return cachedUtf8Locale
}

function detectAvailableUtf8Locale(): string {
  try {
    const output = execFileSync('locale', ['-a'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    })

    const availableLocales = output
      .split(/\r?\n/)
      .map(locale => locale.trim())
      .filter(Boolean)

    for (const candidate of UTF8_LOCALE_CANDIDATES) {
      const matched = availableLocales.find(locale => locale.toLowerCase() === candidate.toLowerCase())
      if (matched) {
        return matched
      }
    }
  } catch {
    // Minimal containers and cloud images can lack locale(1). C.UTF-8 is available on Debian/Ubuntu glibc images.
  }

  return FALLBACK_UTF8_LOCALE
}
