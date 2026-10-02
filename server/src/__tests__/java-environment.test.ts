import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import {
  buildJavaEnvironmentOverrides,
  buildJavaEnvironmentSetupCommand,
  resolveJavaRuntimeEnvironment
} from '../utils/javaRuntimeEnvironment.js'

describe('Java 运行环境解析与终端注入命令', () => {
  it('由 java 可执行文件推导 bin 目录与 JAVA_HOME', () => {
    const binDirectory = path.join('/opt', 'gsm3', 'environment', 'Java', 'java21', 'jdk-21.0.1', 'bin')
    const javaExecutable = path.join(binDirectory, os.platform() === 'win32' ? 'java.exe' : 'java')

    const runtime = resolveJavaRuntimeEnvironment('java21', javaExecutable)

    expect(runtime).not.toBeNull()
    expect(runtime?.version).toBe('java21')
    expect(runtime?.javaExecutable).toBe(javaExecutable)
    expect(runtime?.javaBinDirectory).toBe(binDirectory)
    expect(runtime?.javaHome).toBe(path.dirname(binDirectory))
  })

  it('输入为空或只有文件名时返回 null，由调用方回退系统 PATH', () => {
    expect(resolveJavaRuntimeEnvironment('java21')).toBeNull()
    expect(resolveJavaRuntimeEnvironment('java21', '')).toBeNull()
    expect(resolveJavaRuntimeEnvironment('java21', '   ')).toBeNull()
    expect(resolveJavaRuntimeEnvironment('', '/opt/jdk/bin/java')).toBeNull()
    expect(resolveJavaRuntimeEnvironment('java21', 'java')).toBeNull()
  })

  it('POSIX 平台生成 export 形式并转义单引号', () => {
    const runtime = resolveJavaRuntimeEnvironment('java21', "/opt/my jdk's/bin/java")
    expect(runtime).not.toBeNull()

    const command = buildJavaEnvironmentSetupCommand(runtime!, 'linux')

    expect(command).toBe(
      "export JAVA_HOME='/opt/my jdk'\\''s'; export PATH='/opt/my jdk'\\''s/bin':\"$PATH\""
    )
  })

  it('win32 平台生成 PowerShell 形式并转义单引号', () => {
    const runtime = resolveJavaRuntimeEnvironment(
      'java17',
      "C:/GSM/data/environment/Java/java17/my jdk's/jdk-17/bin/java.exe"
    )
    expect(runtime).not.toBeNull()

    const command = buildJavaEnvironmentSetupCommand(runtime!, 'win32')

    expect(command).toBe(
      "$env:JAVA_HOME='C:/GSM/data/environment/Java/java17/my jdk''s/jdk-17'; " +
      "$env:PATH='C:/GSM/data/environment/Java/java17/my jdk''s/jdk-17/bin;'+$env:PATH"
    )
  })

  it('终端级环境变量覆盖项把 java bin 目录前置到 PATH', () => {
    const runtime = resolveJavaRuntimeEnvironment('java21', '/opt/gsm3/java21/bin/java')
    expect(runtime).not.toBeNull()

    expect(buildJavaEnvironmentOverrides(runtime!, { PATH: '/usr/bin:/bin' }, ':')).toEqual({
      JAVA_HOME: '/opt/gsm3/java21',
      PATH: '/opt/gsm3/java21/bin:/usr/bin:/bin'
    })

    // 宿主环境没有 PATH 时只保留 java bin 目录
    expect(buildJavaEnvironmentOverrides(runtime!, {}, ':')).toEqual({
      JAVA_HOME: '/opt/gsm3/java21',
      PATH: '/opt/gsm3/java21/bin'
    })
  })

  describe('注入命令在真实 shell 中可用', () => {
    const javaExecutable = path.join(
      os.tmpdir(),
      'gsm3 java test',
      'jdk-test',
      'bin',
      os.platform() === 'win32' ? 'java.exe' : 'java'
    )
    const runtime = resolveJavaRuntimeEnvironment('java-test', javaExecutable)!

    it('win32 分支', () => {
      if (os.platform() !== 'win32') {
        return
      }

      const command = buildJavaEnvironmentSetupCommand(runtime, 'win32')
      const output = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `${command}; Write-Output $env:JAVA_HOME`],
        { encoding: 'utf8', timeout: 20000 }
      )

      expect(output.trim()).toBe(runtime.javaHome)
    })

    it('POSIX 分支', () => {
      if (os.platform() === 'win32') {
        return
      }

      const command = buildJavaEnvironmentSetupCommand(runtime, os.platform())
      const output = execFileSync(
        '/bin/bash',
        ['-c', `${command}; printf '%s' "$JAVA_HOME"`],
        { encoding: 'utf8', timeout: 20000 }
      )

      expect(output.trim()).toBe(runtime.javaHome)
    })
  })
})