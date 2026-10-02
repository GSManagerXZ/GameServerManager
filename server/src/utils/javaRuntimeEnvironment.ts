import path from 'path'

/**
 * Java 运行环境描述。
 * 由 JavaManager 扫描得到的 java 可执行文件路径推导出 bin 目录与 JAVA_HOME。
 */
export interface JavaRuntimeEnvironment {
  /** Java 版本标识，例如 java21 */
  version: string
  /** java 可执行文件绝对路径 */
  javaExecutable: string
  /** JAVA_HOME，即 bin 目录的上级目录 */
  javaHome: string
  /** java 可执行文件所在目录，用于前置到 PATH */
  javaBinDirectory: string
}

/**
 * 由 java 可执行文件路径解析 Java 运行环境。
 * 输入为空或无法推导时返回 null，调用方据此回退到系统 PATH 中的 java。
 */
export const resolveJavaRuntimeEnvironment = (
  version: string,
  javaExecutable?: string | null
): JavaRuntimeEnvironment | null => {
  const normalizedVersion = typeof version === 'string' ? version.trim() : ''
  const normalizedExecutable = typeof javaExecutable === 'string' ? javaExecutable.trim() : ''

  if (!normalizedVersion || !normalizedExecutable) {
    return null
  }

  const javaBinDirectory = path.dirname(normalizedExecutable)
  const javaHome = path.dirname(javaBinDirectory)

  // 目录推导失败（例如只给了文件名）时视为无效，避免注入错误的 PATH
  if (!javaBinDirectory || !javaHome || javaBinDirectory === '.' || javaHome === '.') {
    return null
  }

  return {
    version: normalizedVersion,
    javaExecutable: normalizedExecutable,
    javaHome,
    javaBinDirectory
  }
}

/**
 * 转义单引号包裹的字符串值（PowerShell 单引号串用两个单引号表示一个单引号）。
 */
const quoteForPowerShell = (value: string): string => `'${value.replace(/'/g, "''")}'`

/**
 * 转义单引号包裹的字符串值（POSIX shell 用 '\'' 表示一个单引号）。
 */
const quoteForPosixShell = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

/**
 * 生成写入终端会话的一行环境变量设置命令。
 * 该行被注入到实例的 PTY 会话中，随后才执行启动命令，
 * 因此 run.sh / start.bat 这类启动脚本可以直接使用所选版本的 java。
 */
export const buildJavaEnvironmentSetupCommand = (
  runtime: JavaRuntimeEnvironment,
  platform: NodeJS.Platform = process.platform
): string => {
  if (platform === 'win32') {
    // 面板在 Windows 下固定使用 powershell.exe 作为实例终端
    return [
      `$env:JAVA_HOME=${quoteForPowerShell(runtime.javaHome)}`,
      `$env:PATH=${quoteForPowerShell(`${runtime.javaBinDirectory};`)}+$env:PATH`
    ].join('; ')
  }

  // Linux / macOS 使用 bash --login
  return [
    `export JAVA_HOME=${quoteForPosixShell(runtime.javaHome)}`,
    `export PATH=${quoteForPosixShell(runtime.javaBinDirectory)}:"$PATH"`
  ].join('; ')
}

/**
 * 生成终端会话的环境变量覆盖项（终端级环境变量），
 * 使得终端内直接输入的 java 命令也能命中所选版本。
 */
export const buildJavaEnvironmentOverrides = (
  runtime: JavaRuntimeEnvironment,
  environment: NodeJS.ProcessEnv = process.env,
  delimiter: string = path.delimiter
): NodeJS.ProcessEnv => {
  const currentPath = typeof environment.PATH === 'string' ? environment.PATH : ''

  return {
    JAVA_HOME: runtime.javaHome,
    PATH: currentPath
      ? `${runtime.javaBinDirectory}${delimiter}${currentPath}`
      : runtime.javaBinDirectory
  }
}