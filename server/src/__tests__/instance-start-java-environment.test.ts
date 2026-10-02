import fs from 'fs-extra'
import os from 'os'
import path from 'path'

// uuid 为纯 ESM 包，jest 默认不转换 node_modules，这里直接替换为确定性实现
let uuidSeed = 0
jest.mock('uuid', () => ({
  v4: () => `test-instance-${++uuidSeed}`
}))

import { InstanceManager } from '../modules/instance/InstanceManager.js'
import { JavaManager } from '../modules/environment/javaManager.js'

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

interface CreatePtyCall {
  data: any
  options: any
}

const createFakeTerminalManager = () => {
  const sessions = new Set<string>()
  const createPtyCalls: CreatePtyCall[] = []
  const handleInputCalls: any[] = []

  return {
    createPtyCalls,
    handleInputCalls,
    hasTarget: (sessionId: string) => sessions.has(sessionId),
    hasSession: (sessionId: string) => sessions.has(sessionId),
    createPty: async (_socket: any, data: any, options: any) => {
      createPtyCalls.push({ data, options })
      sessions.add(data.sessionId)
      return { status: 'ready' as const, sessionId: data.sessionId }
    },
    handleInput: (_socket: any, payload: any) => {
      handleInputCalls.push(payload)
    },
    closePty: async () => ({ status: 'closed' as const })
  }
}

describe('实例启动时的 Java 环境注入', () => {
  jest.setTimeout(30000)

  let tempRoot: string
  let workingDirectory: string
  let javaInstallDir: string
  let javaHome: string
  let javaBinDirectory: string
  let terminalManager: ReturnType<typeof createFakeTerminalManager>
  let manager: InstanceManager

  const javaExecutableName = os.platform() === 'win32' ? 'java.exe' : 'java'

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm-instance-java-'))
    workingDirectory = path.join(tempRoot, 'server-dir')
    await fs.ensureDir(workingDirectory)
    await fs.writeFile(path.join(workingDirectory, 'server.jar'), '')

    // 模拟一份已安装的 Java 环境（目录名需匹配 JavaManager 的版本目录规则）
    javaInstallDir = path.join(tempRoot, 'Java')
    javaHome = path.join(javaInstallDir, 'java21', 'jdk-21-test')
    javaBinDirectory = path.join(javaHome, 'bin')
    await fs.ensureDir(javaBinDirectory)
    await fs.writeFile(path.join(javaBinDirectory, javaExecutableName), '')

    terminalManager = createFakeTerminalManager()
    manager = new InstanceManager(
      terminalManager as any,
      silentLogger,
      path.join(tempRoot, 'instances.json')
    )
    // 让实例管理器使用临时 Java 安装目录，避免读取开发机的真实环境
    ;(manager as any).javaManager = new JavaManager(javaInstallDir)
  })

  afterEach(async () => {
    await fs.remove(tempRoot)
  })

  const createMinecraftJavaInstance = (javaVersion?: string) => manager.createInstance({
    name: 'java-server',
    description: '',
    workingDirectory,
    startCommand: 'echo Minecraft Java Edition',
    autoStart: false,
    stopCommand: 'stop',
    instanceType: 'minecraft-java',
    javaVersion
  })

  it('注入 JAVA_HOME/PATH 环境变量，启动脚本可直接使用所选 Java', async () => {
    const instance = await createMinecraftJavaInstance('java21')

    await manager.startInstance(instance.id)
    await waitFor(() => terminalManager.handleInputCalls.length > 0)

    // 终端级环境变量：JAVA_HOME 与前置 java bin 目录的 PATH
    expect(terminalManager.createPtyCalls).toHaveLength(1)
    const environmentOverrides = terminalManager.createPtyCalls[0].options.environmentOverrides
    expect(environmentOverrides.JAVA_HOME).toBe(javaHome)
    expect(String(environmentOverrides.PATH).startsWith(`${javaBinDirectory}${path.delimiter}`)).toBe(true)

    // 先注入环境变量，再执行启动命令；启动命令不再拼接 Java 绝对路径
    const payload = terminalManager.handleInputCalls[0].data as string
    const [setupLine, commandLine] = payload.split('\r')
    if (os.platform() === 'win32') {
      expect(setupLine).toContain(`$env:JAVA_HOME='${javaHome}'`)
      expect(setupLine).toContain('$env:PATH=')
    } else {
      expect(setupLine).toContain(`export JAVA_HOME='${javaHome}'`)
      expect(setupLine).toContain(`export PATH='${javaBinDirectory}'`)
    }
    expect(commandLine).toBe('java -jar "server.jar" nogui')
    expect(commandLine).not.toContain(javaHome)
  })

  it('未选择 Java 版本时不注入任何环境变量，命令与既有行为一致', async () => {
    const instance = await createMinecraftJavaInstance(undefined)

    await manager.startInstance(instance.id)
    await waitFor(() => terminalManager.handleInputCalls.length > 0)

    expect(terminalManager.createPtyCalls[0].options.environmentOverrides).toEqual({})
    expect(terminalManager.handleInputCalls[0].data).toBe('java -jar "server.jar" nogui\r')
  })

  it('所选 Java 版本未安装时回退系统 PATH 并在终端给出提示', async () => {
    const instance = await createMinecraftJavaInstance('java17')
    const outputs: any[] = []
    manager.on('instance-output', payload => outputs.push(payload))

    await manager.startInstance(instance.id)
    await waitFor(() => terminalManager.handleInputCalls.length > 0)

    expect(terminalManager.createPtyCalls[0].options.environmentOverrides).toEqual({})
    expect(terminalManager.handleInputCalls[0].data).toBe('java -jar "server.jar" nogui\r')
    expect(outputs.some(output => String(output?.data || '').includes('未找到可用的 Java 环境 java17'))).toBe(true)
  })

  it('检测到启动脚本时按平台补全相对路径前缀', async () => {
    // 工作目录中放入 start.bat / run.sh，覆盖启动脚本检测分支
    await fs.remove(path.join(workingDirectory, 'server.jar'))
    await fs.writeFile(path.join(workingDirectory, 'start.bat'), '@echo off\r\n')
    await fs.writeFile(path.join(workingDirectory, 'run.sh'), '#!/bin/sh\n')

    const instance = await createMinecraftJavaInstance(undefined)

    await manager.startInstance(instance.id)
    await waitFor(() => terminalManager.handleInputCalls.length > 0)

    // Windows 需要 .\ 前缀（PowerShell 不从当前目录解析命令），Linux/Mac 需要 ./ 前缀
    expect(terminalManager.handleInputCalls[0].data).toBe(
      os.platform() === 'win32' ? '.\\start.bat\r' : './start.sh\r'
    )
  })

  it('通用实例把启动命令写成裸脚本名时按平台补全相对路径前缀', async () => {
    await fs.writeFile(path.join(workingDirectory, 'start.bat'), '@echo off\r\n')
    await fs.writeFile(path.join(workingDirectory, 'start.sh'), '#!/bin/sh\n')
    const instance = await manager.createInstance({
      name: 'generic-server',
      description: '',
      workingDirectory,
      startCommand: os.platform() === 'win32' ? 'start.bat --nogui' : 'start.sh --nogui',
      autoStart: false,
      stopCommand: 'ctrl+c'
    })

    await manager.startInstance(instance.id)
    await waitFor(() => terminalManager.handleInputCalls.length > 0)

    expect(terminalManager.handleInputCalls[0].data).toBe(
      os.platform() === 'win32' ? '.\\start.bat --nogui\r' : './start.sh --nogui\r'
    )
    // 仅本次执行的命令被补全，实例配置保持用户原样
    expect(manager.getInstance(instance.id)?.startCommand).toBe(
      os.platform() === 'win32' ? 'start.bat --nogui' : 'start.sh --nogui'
    )
  })
})