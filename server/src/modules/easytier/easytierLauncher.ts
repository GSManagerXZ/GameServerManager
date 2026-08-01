import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import type { Readable, Writable } from 'stream'
import { buildChildProcessEnvironment } from '../../utils/childProcessEnvironment.js'
import { buildEasyTierToml } from './easytierConfig.js'
import { EasyTierProfileStore } from './EasyTierProfileStore.js'

const CONFIG_DUMP_START_PATTERN = /Starting easytier from config file .* with config:\s*$/i
const CONFIG_DUMP_END_PATTERN = /^-{10,}\s*$/
const SENSITIVE_ASSIGNMENT_PATTERN = /^(\s*(?:network_secret|local_private_key|group_secret)\s*=\s*).*$/i

const sanitizeOutputLine = (line: string): string => {
  const lineEnding = line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : ''
  const content = lineEnding ? line.slice(0, -lineEnding.length) : line
  return `${content.replace(SENSITIVE_ASSIGNMENT_PATTERN, '$1"[redacted]"')}${lineEnding}`
}

const forwardSanitizedOutput = (input: Readable | null, output: Writable): void => {
  if (!input) return

  input.setEncoding('utf-8')
  let pending = ''
  let isRedactingConfigDump = false

  const forwardLine = (line: string): void => {
    const lineEnding = line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : ''
    const content = lineEnding ? line.slice(0, -lineEnding.length) : line

    if (CONFIG_DUMP_START_PATTERN.test(content)) {
      isRedactingConfigDump = true
      output.write(`${content.replace(/with config:\s*$/i, 'with config: [redacted]')}${lineEnding}`)
      return
    }

    if (isRedactingConfigDump) {
      if (CONFIG_DUMP_END_PATTERN.test(content.trim())) isRedactingConfigDump = false
      return
    }

    output.write(sanitizeOutputLine(line))
  }

  input.on('data', (chunk: string | Buffer) => {
    pending += chunk.toString()
    let newlineIndex = pending.indexOf('\n')
    while (newlineIndex >= 0) {
      forwardLine(pending.slice(0, newlineIndex + 1))
      pending = pending.slice(newlineIndex + 1)
      newlineIndex = pending.indexOf('\n')
    }
  })

  input.on('end', () => {
    if (pending && !isRedactingConfigDump) output.write(sanitizeOutputLine(pending))
    pending = ''
  })
}

const run = async (): Promise<void> => {
  const [profileId, dataRoot, runtimeDirectory] = process.argv.slice(2)

  if (!profileId || !dataRoot) {
    process.stderr.write('EasyTier launcher 缺少 profileId 或 dataRoot\n')
    process.exitCode = 2
    return
  }

  const store = new EasyTierProfileStore({ dataRoot })
  const { profile, secrets, paths } = await store.getRuntimeBundle(profileId, runtimeDirectory)

  if (!profile.settings.rpcPortal) {
    process.stderr.write('EasyTier profile 缺少 RPC portal\n')
    process.exitCode = 2
    return
  }

  await fs.writeFile(
    paths.configPath,
    buildEasyTierToml(profile, secrets, paths.credentialPath),
    { encoding: 'utf-8', mode: 0o600 }
  )
  if (process.platform !== 'win32') await fs.chmod(paths.configPath, 0o600)

  await fs.rm(paths.credentialPath, { force: true })
  if (secrets.credentialFileContent) {
    await fs.writeFile(paths.credentialPath, `${secrets.credentialFileContent.trim()}\n`, {
      encoding: 'utf-8',
      mode: 0o600
    })
    if (process.platform !== 'win32') await fs.chmod(paths.credentialPath, 0o600)
  }

  const child = spawn(profile.binary.corePath, [
    '--config-file',
    paths.configPath,
    '--rpc-portal',
    profile.settings.rpcPortal,
    '--rpc-portal-whitelist',
    profile.settings.rpcPortalWhitelist.join(',')
  ], {
    cwd: paths.directory,
    env: buildChildProcessEnvironment({
      ...(secrets.networkSecret ? { ET_NETWORK_SECRET: secrets.networkSecret } : {}),
      ...(secrets.localPrivateKey ? { ET_LOCAL_PRIVATE_KEY: secrets.localPrivateKey } : {})
    }),
    shell: false,
    windowsHide: true,
    stdio: ['inherit', 'pipe', 'pipe']
  })

  forwardSanitizedOutput(child.stdout, process.stdout)
  forwardSanitizedOutput(child.stderr, process.stderr)

  let forwardedSignal = false
  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (forwardedSignal || child.killed) return
    forwardedSignal = true
    if (process.platform === 'win32' && child.pid) {
      const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      taskkill.once('error', () => child.kill('SIGTERM'))
      taskkill.once('close', code => {
        if (code !== 0 && !child.killed) child.kill('SIGTERM')
      })
      return
    }
    child.kill(signal)
  }

  process.on('SIGINT', () => forwardSignal('SIGINT'))
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))
  process.on('SIGHUP', () => forwardSignal('SIGHUP'))
  process.on('exit', () => {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL')
  })

  child.on('error', error => {
    process.stderr.write(`启动 EasyTier 失败: ${error.message}\n`)
  })

  child.on('close', async exitCode => {
    try {
      let credentialFileContent: string | undefined
      try {
        credentialFileContent = (await fs.readFile(paths.credentialPath, 'utf-8')).trim() || undefined
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const latest = await store.getRuntimeBundle(profileId, runtimeDirectory)
      await store.saveRuntimeSecrets(latest.profile, {
        ...latest.secrets,
        ...(credentialFileContent ? { credentialFileContent } : {})
      }, runtimeDirectory)
      await fs.rm(paths.credentialPath, { force: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`保存 EasyTier 凭据状态失败: ${message}\n`)
    }
    process.exit(exitCode ?? (forwardedSignal ? 0 : 1))
  })
}

void run().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`启动 EasyTier launcher 失败: ${message}\n`)
  process.exitCode = 2
})
