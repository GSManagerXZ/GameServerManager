import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

const STEAMCMD_SCRIPT_MAX_LIFETIME_MS = 35 * 60 * 1000

function getSteamCMDTaskDirectoryCandidates(): string[] {
  return [
    path.join(os.tmpdir(), 'gsm3-steamcmd', 'tasks'),
    path.join(process.cwd(), 'data', 'tmp', 'gsm3-steamcmd', 'tasks')
  ]
}

async function prepareSteamCMDTaskDirectory(clean = false): Promise<string> {
  let lastError: unknown

  for (const taskDirectory of getSteamCMDTaskDirectoryCandidates()) {
    try {
      if (clean) {
        await fs.rm(taskDirectory, { recursive: true, force: true })
      }

      await fs.mkdir(taskDirectory, { recursive: true, mode: 0o700 })
      await fs.chmod(taskDirectory, 0o700)
      return taskDirectory
    } catch (error: any) {
      lastError = error
      if (error?.code !== 'EACCES' && error?.code !== 'EPERM') {
        throw error
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('无法创建SteamCMD临时脚本目录')
}

async function createPrivateSteamCMDTaskDirectory(): Promise<string> {
  const candidates = [os.tmpdir(), path.join(process.cwd(), 'data', 'tmp')]
  for (let index = 0; index < candidates.length; index++) {
    const directory = path.resolve(candidates[index])
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      return await fs.mkdtemp(path.join(directory, 'gsm3-steamcmd-'))
    } catch (error: any) {
      if (index === candidates.length - 1 || !['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) {
        throw error
      }
    }
  }
  throw new Error('无法创建SteamCMD临时脚本目录')
}

export interface SteamCMDRunScript {
  filePath: string
  logDirectory: string
  // Passed after stdin/stdout/stderr, so the script is descriptor 3 in the child.
  inheritedFileDescriptors: number[]
  cleanup: () => Promise<void>
}

export function getSteamCMDRunScriptArguments(script: SteamCMDRunScript): string[] {
  // The script's own failure policy and quit command cannot run if it cannot be read.
  return [
    '-logdir', script.logDirectory,
    '+@ShutdownOnFailedCommand', '1',
    '+runscript', script.inheritedFileDescriptors.length > 0 ? '/proc/self/fd/3' : script.filePath,
    '+quit'
  ]
}

export function quoteSteamCMDConsoleArgument(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export async function cleanupSteamCMDRunScripts(): Promise<void> {
  await prepareSteamCMDTaskDirectory(true)
}

export async function prepareSteamCMDLaunch(executablePath: string): Promise<void> {
  if (process.platform !== 'win32') return

  const bootstrapLogPath = path.join(path.dirname(executablePath), 'logs', 'bootstrap_log.txt')
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(bootstrapLogPath, 'r+')
    const stats = await handle.stat()
    const length = Math.min(stats.size, 64 * 1024)
    const buffer = Buffer.alloc(length)
    if (length > 0) {
      await handle.read(buffer, 0, length, stats.size - length)
    }

    // Windows SteamCMD 可能在重新打开旧格式bootstrap日志时栈溢出。
    if (!buffer.toString('utf8').includes(' -logdir ')) {
      await handle.truncate(0)
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  } finally {
    await handle?.close()
  }
}

export async function createSteamCMDRunScript(
  commands: string[],
  options: { allowPasswordPrompt?: boolean; maxLifetimeMs?: number; inheritFileDescriptor?: boolean } = {}
): Promise<SteamCMDRunScript> {
  if (commands.length === 0 || commands.some(command => !command || /[\0\r\n]/.test(command))) {
    throw new Error('SteamCMD脚本命令格式无效')
  }

  const inheritFileDescriptor = options.inheritFileDescriptor && process.platform === 'linux'
  const taskPath = inheritFileDescriptor
    ? await createPrivateSteamCMDTaskDirectory()
    : path.join(await prepareSteamCMDTaskDirectory(), randomUUID())
  const logDirectory = path.join(taskPath, 'logs')
  const filePath = path.join(taskPath, 'commands.txt')
  let scriptHandle: Awaited<ReturnType<typeof fs.open>> | null = null
  const content = [
    '@ShutdownOnFailedCommand 1',
    `@NoPromptForPassword ${options.allowPasswordPrompt ? '0' : '1'}`,
    ...commands
  ].join('\n') + '\n'
  try {
    if (!inheritFileDescriptor) await fs.mkdir(taskPath, { mode: 0o700 })
    await fs.mkdir(logDirectory, { mode: 0o700 })
    await fs.writeFile(filePath, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    if (inheritFileDescriptor) {
      scriptHandle = await fs.open(filePath, 'r')
      // SteamCMD reopens this inherited descriptor through /proc/self/fd/3.
      // Unlink now: other panel processes and tmp cleaners cannot remove its contents.
      await fs.unlink(filePath)
    }
  } catch (error) {
    await scriptHandle?.close()
    await fs.rm(taskPath, { recursive: true, force: true })
    throw error
  }

  let cleaned = false
  let cleanupPromise: Promise<void> | null = null
  let cleanupTimer: NodeJS.Timeout | null = null
  const cleanup = async () => {
    if (cleaned) return
    if (cleanupPromise) return cleanupPromise

    cleanupPromise = (async () => {
      await scriptHandle?.close()
      scriptHandle = null
      await fs.rm(taskPath, { recursive: true, force: true })
    })()
      .then(() => {
        cleaned = true
        if (cleanupTimer) clearTimeout(cleanupTimer)
      })
      .finally(() => {
        cleanupPromise = null
      })
    return cleanupPromise
  }

  const maxLifetimeMs = options.maxLifetimeMs ?? STEAMCMD_SCRIPT_MAX_LIFETIME_MS
  cleanupTimer = setTimeout(() => {
    void cleanup().catch(() => {
      // 正在使用的Windows脚本可能暂时无法删除，进程退出时会再次清理。
    })
  }, maxLifetimeMs)
  cleanupTimer.unref?.()

  return { filePath, logDirectory, inheritedFileDescriptors: scriptHandle ? [scriptHandle.fd] : [], cleanup }
}
