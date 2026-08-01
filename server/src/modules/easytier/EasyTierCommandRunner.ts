import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { buildChildProcessEnvironment } from '../../utils/childProcessEnvironment.js'
import {
  EasyTierBinaryCapabilities,
  EasyTierBinarySelection
} from './easytierTypes.js'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024

export interface EasyTierCommandOptions {
  timeoutMs?: number
  maxOutputBytes?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface EasyTierCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export class EasyTierCommandError extends Error {
  readonly code: string
  readonly executable: string
  readonly args: string[]
  readonly exitCode?: number
  readonly stderr?: string

  constructor(options: {
    code: string
    message: string
    executable: string
    args: string[]
    exitCode?: number
    stderr?: string
  }) {
    super(options.message)
    this.name = 'EasyTierCommandError'
    this.code = options.code
    this.executable = options.executable
    this.args = [...options.args]
    this.exitCode = options.exitCode
    this.stderr = options.stderr
  }
}

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

const resolveExecutablePath = async (executable: string): Promise<string | undefined> => {
  const hasDirectory = path.isAbsolute(executable) || executable.includes('/') || executable.includes('\\')
  if (hasDirectory) {
    const resolved = path.resolve(executable)
    return await pathExists(resolved) ? resolved : undefined
  }

  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const extensions = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : ['']
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, process.platform === 'win32' ? `${executable}${extension}` : executable)
      if (await pathExists(candidate)) return candidate
    }
  }
  return undefined
}

const extractLongFlags = (helpText: string): string[] => Array.from(new Set(
  Array.from(helpText.matchAll(/--([a-z0-9][a-z0-9-]*)/gi)).map(match => match[1].toLowerCase())
)).sort((left, right) => left.localeCompare(right))

const extractVersion = (output: string): string | undefined => {
  const semver = output.match(/(?:^|\s|v)(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)
  return semver?.[1]
}

const detectCommands = (helpText: string): string[] => {
  const knownCommands = [
    'node',
    'peer',
    'route',
    'stats',
    'connector',
    'proxy',
    'port-forward',
    'whitelist',
    'logger',
    'credential',
    'acl',
    'config',
    'service'
  ]
  const normalized = helpText.toLowerCase()
  return knownCommands.filter(command => new RegExp(`(^|\\s)${command.replace('-', '\\-')}(\\s|$)`, 'm').test(normalized))
}

export class EasyTierCommandRunner {
  async run(
    executable: string,
    args: string[],
    options: EasyTierCommandOptions = {}
  ): Promise<EasyTierCommandResult> {
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
    const maxOutputBytes = options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES
    const resolvedExecutable = await resolveExecutablePath(executable)

    if (!executable || !resolvedExecutable) {
      throw new EasyTierCommandError({
        code: 'EASYTIER_BINARY_NOT_FOUND',
        message: `EasyTier 可执行文件不存在: ${executable}`,
        executable,
        args
      })
    }

    return new Promise((resolve, reject) => {
      const child = spawn(resolvedExecutable, args, {
        cwd: options.cwd,
        env: buildChildProcessEnvironment(options.env),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let outputBytes = 0
      let settled = false

      const finishWithError = (error: EasyTierCommandError): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.kill('SIGKILL')
        reject(error)
      }

      const capture = (chunks: Buffer[], chunk: Buffer): void => {
        outputBytes += chunk.length
        if (outputBytes > maxOutputBytes) {
          finishWithError(new EasyTierCommandError({
            code: 'EASYTIER_OUTPUT_LIMIT',
            message: `EasyTier 命令输出超过 ${maxOutputBytes} 字节限制`,
            executable,
            args
          }))
          return
        }
        chunks.push(Buffer.from(chunk))
      }

      child.stdout?.on('data', chunk => capture(stdoutChunks, chunk))
      child.stderr?.on('data', chunk => capture(stderrChunks, chunk))

      child.on('error', error => {
        finishWithError(new EasyTierCommandError({
          code: 'EASYTIER_SPAWN_FAILED',
          message: `启动 EasyTier 命令失败: ${error.message}`,
          executable,
          args
        }))
      })

      child.on('close', exitCode => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim()
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()
        const normalizedExitCode = exitCode ?? -1
        if (normalizedExitCode !== 0) {
          reject(new EasyTierCommandError({
            code: 'EASYTIER_COMMAND_FAILED',
            message: stderr || stdout || `EasyTier 命令退出码: ${normalizedExitCode}`,
            executable,
            args,
            exitCode: normalizedExitCode,
            stderr
          }))
          return
        }
        resolve({ stdout, stderr, exitCode: normalizedExitCode })
      })

      const timer = setTimeout(() => {
        finishWithError(new EasyTierCommandError({
          code: 'EASYTIER_COMMAND_TIMEOUT',
          message: `EasyTier 命令执行超时（${timeoutMs}ms）`,
          executable,
          args
        }))
      }, timeoutMs)
    })
  }

  async runJson<T>(
    executable: string,
    args: string[],
    options: EasyTierCommandOptions = {}
  ): Promise<T> {
    const result = await this.run(executable, args, options)
    try {
      return JSON.parse(result.stdout) as T
    } catch {
      throw new EasyTierCommandError({
        code: 'EASYTIER_INVALID_JSON',
        message: 'EasyTier CLI 未返回有效 JSON',
        executable,
        args,
        stderr: result.stderr
      })
    }
  }

  async discoverCompanionCli(corePath: string): Promise<string | undefined> {
    const resolvedCorePath = await resolveExecutablePath(corePath)
    if (!resolvedCorePath) return undefined
    const directory = path.dirname(resolvedCorePath)
    const candidates = process.platform === 'win32'
      ? ['easytier-cli.exe', 'easytier-cli']
      : ['easytier-cli', 'easytier-cli.exe']

    for (const candidate of candidates) {
      const candidatePath = path.join(directory, candidate)
      if (await pathExists(candidatePath)) return candidatePath
    }
    return resolveExecutablePath(process.platform === 'win32' ? 'easytier-cli.exe' : 'easytier-cli')
  }

  async detectCapabilities(selection: EasyTierBinarySelection): Promise<EasyTierBinaryCapabilities> {
    const corePath = await resolveExecutablePath(selection.corePath)
    if (!corePath) {
      throw new EasyTierCommandError({
        code: 'EASYTIER_BINARY_NOT_FOUND',
        message: `EasyTier 可执行文件不存在: ${selection.corePath}`,
        executable: selection.corePath,
        args: []
      })
    }
    const cliPath = selection.cliPath
      ? await resolveExecutablePath(selection.cliPath)
      : await this.discoverCompanionCli(corePath)
    const [coreVersionResult, coreHelpResult, cliVersionResult, cliHelpResult] = await Promise.all([
      this.runBestEffort(corePath, ['--version']),
      this.runBestEffort(corePath, ['--help']),
      cliPath ? this.runBestEffort(cliPath, ['--version']) : Promise.resolve(''),
      cliPath ? this.runBestEffort(cliPath, ['--help']) : Promise.resolve('')
    ])
    const coreFlags = extractLongFlags(coreHelpResult)
    const cliFlags = extractLongFlags(cliHelpResult)
    const flags = Array.from(new Set([...coreFlags, ...cliFlags])).sort((left, right) => left.localeCompare(right))
    const commands = detectCommands(cliHelpResult)
    const version = extractVersion(coreVersionResult) || extractVersion(cliVersionResult)
    const supportsConfigFile = coreFlags.includes('config-file')
    const supportsJsonOutput = Boolean(cliPath) && (
      cliFlags.includes('output') ||
      /(?:^|\s)-o(?:[ ,=]|\s).*json|json output|output format/mi.test(cliHelpResult)
    )
    const supportsSecureMode = coreFlags.includes('secure-mode') || /secure[_ -]mode/i.test(coreHelpResult)
    const supportsCredentials = commands.includes('credential')
    const supportsAcl = commands.includes('acl')
    const compatibilityWarnings = [
      ...(!supportsConfigFile ? ['当前 easytier-core 不支持 --config-file，无法由面板安全托管'] : []),
      ...(!cliPath ? ['未找到 easytier-cli，实时管理功能不可用'] : []),
      ...(cliPath && !supportsJsonOutput ? ['当前 easytier-cli 不支持 JSON 输出，实时管理功能不可用'] : [])
    ]

    return {
      version,
      corePath,
      cliPath,
      supportsConfigFile,
      supportsJsonOutput,
      supportsSecureMode,
      supportsCredentials,
      supportsAcl,
      flags,
      coreFlags,
      cliFlags,
      commands,
      detectedAt: new Date().toISOString(),
      compatibilityWarnings
    }
  }

  private async runBestEffort(executable: string, args: string[]): Promise<string> {
    try {
      const result = await this.run(executable, args, { timeoutMs: 5000, maxOutputBytes: 512 * 1024 })
      return [result.stdout, result.stderr].filter(Boolean).join('\n')
    } catch (error) {
      if (error instanceof EasyTierCommandError) {
        return error.stderr || error.message
      }
      throw error
    }
  }
}
