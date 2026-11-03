import { promises as fs, fstatSync } from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { pathToFileURL } from 'url'
import {
  cleanupSteamCMDRunScripts,
  createSteamCMDRunScript,
  getSteamCMDRunScriptArguments,
  quoteSteamCMDConsoleArgument,
  type SteamCMDRunScript
} from '../utils/steamcmdRunScript.js'
import { SteamCMDManager } from '../modules/steamcmd/SteamCMDManager.js'

const linuxTest = process.platform === 'linux' ? it : it.skip
const otherPlatformTest = process.platform !== 'linux' ? it : it.skip
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any

describe('SteamCMD script transport', () => {
  jest.setTimeout(15000)

  let tempRoot: string
  let scripts: SteamCMDRunScript[]

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-steamcmd-test-'))
    scripts = []
    jest.spyOn(os, 'tmpdir').mockReturnValue(tempRoot)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await Promise.all(scripts.map(script => script.cleanup()))
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  async function create(commands = ['quit'], options = {}): Promise<SteamCMDRunScript> {
    const script = await createSteamCMDRunScript(commands, options)
    scripts.push(script)
    return script
  }

  function readInChild(script: SteamCMDRunScript, delay = 0, secrets: string[] = []) {
    const args = getSteamCMDRunScriptArguments(script)
    const scriptPath = args[args.indexOf('+runscript') + 1]
    // Load the ESM-only terminal module using the project's TS runtime, not Jest's CJS transform.
    return new Promise<{ code: number; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        '--import', pathToFileURL(require.resolve('tsx')).href,
        path.join(__dirname, '../../test/fixtures/managed-script-reader.ts')
      ], {
        cwd: tempRoot,
        stdio: ['pipe', 'pipe', 'pipe', ...script.inheritedFileDescriptors],
        timeout: 7000
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('error', reject)
      child.stdin.on('error', reject)
      child.on('close', code => {
        if (code !== 0) return reject(new Error(stderr || `Reader exited with ${code}`))
        try { resolve(JSON.parse(stdout)) } catch (error) { reject(error) }
      })
      child.stdin.end(JSON.stringify({ scriptPath, delay, secrets }))
    })
  }

  it('preserves named scripts for interactive terminals and keeps credentials out of argv', async () => {
    const secret = 'test-password'
    const script = await create([`login user ${quoteSteamCMDConsoleArgument(secret)}`, 'quit'])
    const args = getSteamCMDRunScriptArguments(script)
    expect(script.inheritedFileDescriptors).toEqual([])
    expect(await fs.readFile(script.filePath, 'utf8')).toContain(secret)
    expect(args.join(' ')).not.toContain(secret)
    expect(args[args.indexOf('+runscript') + 1]).toBe(script.filePath)
    expect(args.slice(-1)).toEqual(['+quit'])
    expect(args.indexOf('+@ShutdownOnFailedCommand')).toBeLessThan(args.indexOf('+runscript'))
    if (process.platform !== 'win32') {
      expect((await fs.stat(script.filePath)).mode & 0o777).toBe(0o600)
      expect((await fs.stat(path.dirname(script.filePath))).mode & 0o777).toBe(0o700)
    }
  })

  it.each(['login user\nquit', 'login user\rquit', 'login user\0hidden', ''])('rejects command injection before writing files: %j', async command => {
    await expect(create([command])).rejects.toThrow('SteamCMD脚本命令格式无效')
    expect(await fs.readdir(tempRoot)).toEqual([])
  })

  otherPlatformTest('retains file-based transport outside Linux even when inheritance is requested', async () => {
    const script = await create(['quit'], { inheritFileDescriptor: true })
    expect(script.inheritedFileDescriptors).toEqual([])
    expect(await fs.readFile(script.filePath, 'utf8')).toContain('quit\n')
  })

  linuxTest('reads an unlinked script in the child after its entire temporary directory is removed', async () => {
    const script = await create(['quit'], { inheritFileDescriptor: true })
    await expect(fs.access(script.filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(fstatSync(script.inheritedFileDescriptors[0]).mode & 0o777).toBe(0o600)
    await fs.rm(path.dirname(script.filePath), { recursive: true, force: true })
    const result = await readInChild(script)
    expect(result.code).toBe(0)
    expect(result.output).toBe('@ShutdownOnFailedCommand 1\n@NoPromptForPassword 1\nquit\n')
  })

  linuxTest('isolates concurrent jobs from another panel startup and another job cleanup', async () => {
    const first = await create(['first-job', 'quit'], { inheritFileDescriptor: true })
    const second = await create(['second-job', 'quit'], { inheritFileDescriptor: true })
    expect(first.filePath).not.toBe(second.filePath)
    await cleanupSteamCMDRunScripts()
    await first.cleanup()
    const result = await readInChild(second)
    expect(result.code).toBe(0)
    expect(result.output).toContain('second-job')
    expect(result.output).not.toContain('first-job')
  })

  linuxTest('keeps the child copy alive after the parent closes its descriptor and redacts output', async () => {
    const secret = 'fixture-password'
    const script = await create([`login user ${quoteSteamCMDConsoleArgument(secret)}`, 'quit'], { inheritFileDescriptor: true })
    const resultPromise = readInChild(script, 100, [secret])
    const descriptor = script.inheritedFileDescriptors[0]
    await Promise.all([script.cleanup(), script.cleanup()])
    expect(() => fstatSync(descriptor)).toThrow()
    const result = await resultPromise
    expect(result.code).toBe(0)
    expect(result.output).toContain('*'.repeat(secret.length))
    expect(result.output).not.toContain(secret)
  })

  linuxTest('closes the descriptor and removes partial files when unlink fails', async () => {
    const openSpy = jest.spyOn(fs, 'open')
    jest.spyOn(fs, 'unlink').mockRejectedValueOnce(Object.assign(new Error('fixture denied'), { code: 'EACCES' }))
    await expect(create(['quit'], { inheritFileDescriptor: true })).rejects.toThrow('fixture denied')
    const handle = await openSpy.mock.results[0].value
    expect(handle.fd).toBe(-1)
    expect(await fs.readdir(tempRoot)).toEqual([])
  })

  linuxTest('falls back to a private data directory when the system temp directory is read-only', async () => {
    jest.spyOn(process, 'cwd').mockReturnValue(path.join(tempRoot, 'panel'))
    jest.spyOn(fs, 'mkdtemp').mockRejectedValueOnce(Object.assign(new Error('fixture read-only'), { code: 'EROFS' }))
    const script = await create(['quit'], { inheritFileDescriptor: true })
    expect(script.logDirectory).toContain(path.join(tempRoot, 'panel', 'data', 'tmp'))
    const result = await readInChild(script)
    expect(result.code).toBe(0)
  })

  linuxTest('passes the descriptor through branch-query spawning and preserves errors and redaction', async () => {
    const executable = path.join(tempRoot, 'steamcmd-stub')
    await fs.copyFile(path.join(__dirname, '../../test/fixtures/steamcmd-fd-stub.cjs'), executable)
    await fs.chmod(executable, 0o700)
    const manager = new SteamCMDManager(logger, {} as any)
    const secret = 'private-branch-password'
    const run = (commands: string[]) => (manager as any).runSteamCMDForOutput(executable, commands, [secret])
    try {
      const output = await run([`login user ${quoteSteamCMDConsoleArgument(secret)}`, 'quit'])
      expect(output).not.toContain(secret)
      expect(output).toContain('*'.repeat(secret.length))
      await expect(run(['invalid-command', 'quit'])).rejects.toThrow('7')
      expect((await fs.readdir(tempRoot)).filter(name => name.startsWith('gsm3-steamcmd-'))).toEqual([])
    } finally {
      await manager.cleanup()
    }
  })
})
