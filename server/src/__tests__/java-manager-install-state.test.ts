import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { JavaManager } from '../modules/environment/javaManager.js'

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('JavaManager install state', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-java-manager-'))
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('does not mark an incomplete install directory as installed', async () => {
    const manager = new JavaManager(tempDir)
    await fs.ensureDir(path.join(tempDir, 'java17'))
    await fs.writeFile(path.join(tempDir, 'java17', 'partial-download.tar.gz'), 'partial')

    const environments = await manager.getJavaEnvironments()
    const java17 = environments.find(env => env.version === 'java17')

    expect(java17).toEqual(expect.objectContaining({
      installed: false,
      installing: false
    }))
    expect(java17?.javaExecutable).toBeUndefined()
  })

  it('keeps an active install visible after the environment list is reloaded', async () => {
    const manager = new JavaManager(tempDir)
    let releaseDownload: (() => void) | null = null
    const javaExecutableName = os.platform() === 'win32' ? 'java.exe' : 'java'

    ;(manager as any).downloadFile = async (
      _url: string,
      _filePath: string,
      onProgress?: (progress: number) => void
    ) => {
      onProgress?.(25)
      await new Promise<void>(resolve => {
        releaseDownload = resolve
      })
      onProgress?.(100)
    }

    ;(manager as any).extractFile = async (_filePath: string, extractDir: string) => {
      const binDir = path.join(extractDir, 'jdk', 'bin')
      await fs.ensureDir(binDir)
      await fs.writeFile(path.join(binDir, javaExecutableName), '')
    }

    ;(manager as any).setExecutablePermissions = async () => {}

    const installPromise = manager.installJava('java30-ea', 'https://example.com/jdk.tar.gz')
    await waitFor(() => releaseDownload !== null)

    expect(() => manager.installJava('java30-ea', 'https://example.com/jdk.tar.gz')).toThrow('java30-ea 正在安装')

    const installingEnvironments = await manager.getJavaEnvironments()
    const installingJava = installingEnvironments.find(env => env.version === 'java30-ea')

    expect(installingJava).toEqual(expect.objectContaining({
      installed: false,
      installing: true,
      installStage: 'download',
      installProgress: 18
    }))

    releaseDownload?.()
    await installPromise

    const completedEnvironments = await manager.getJavaEnvironments()
    const completedJava = completedEnvironments.find(env => env.version === 'java30-ea')

    expect(completedJava).toEqual(expect.objectContaining({
      installed: true,
      installing: false
    }))
    expect(completedJava?.javaExecutable).toContain(javaExecutableName)
  })
})
