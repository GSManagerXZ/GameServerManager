import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

const STEAMCMD_SCRIPT_MAX_LIFETIME_MS = 35 * 60 * 1000

function getSteamCMDTaskDirectory(): string {
  return path.join(os.tmpdir(), 'gsm3-steamcmd', 'tasks')
}

export interface SteamCMDRunScript {
  filePath: string
  logDirectory: string
  cleanup: () => Promise<void>
}

export function quoteSteamCMDConsoleArgument(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export async function cleanupSteamCMDRunScripts(): Promise<void> {
  const taskDirectory = getSteamCMDTaskDirectory()
  await fs.rm(taskDirectory, { recursive: true, force: true })
  await fs.mkdir(taskDirectory, { recursive: true, mode: 0o700 })
  await fs.chmod(taskDirectory, 0o700)
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
  options: { allowPasswordPrompt?: boolean; maxLifetimeMs?: number } = {}
): Promise<SteamCMDRunScript> {
  if (commands.length === 0 || commands.some(command => !command || /[\r\n]/.test(command))) {
    throw new Error('SteamCMD脚本命令格式无效')
  }

  const taskDirectory = getSteamCMDTaskDirectory()
  await fs.mkdir(taskDirectory, { recursive: true, mode: 0o700 })
  const taskPath = path.join(taskDirectory, randomUUID())
  const logDirectory = path.join(taskPath, 'logs')
  const filePath = path.join(taskPath, 'commands.txt')
  await fs.chmod(taskDirectory, 0o700)
  await fs.mkdir(taskPath, { mode: 0o700 })
  await fs.mkdir(logDirectory, { recursive: true, mode: 0o700 })
  const content = [
    '@ShutdownOnFailedCommand 1',
    `@NoPromptForPassword ${options.allowPasswordPrompt ? '0' : '1'}`,
    ...commands
  ].join('\n') + '\n'
  await fs.writeFile(filePath, content, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  })

  let cleaned = false
  let cleanupPromise: Promise<void> | null = null
  let cleanupTimer: NodeJS.Timeout | null = null
  const cleanup = async () => {
    if (cleaned) return
    if (cleanupPromise) return cleanupPromise

    cleanupPromise = fs.rm(taskPath, { recursive: true, force: true })
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

  return { filePath, logDirectory, cleanup }
}
