import path from 'path'

/** Windows 下需要当前目录前缀才能直接被 PowerShell 调用的文件扩展名 */
const WINDOWS_LOCAL_EXECUTABLE_EXTENSIONS = new Set(['.bat', '.cmd', '.ps1', '.exe', '.com'])

/** Linux/Mac 下需要 ./ 前缀才能被 bash 直接执行的脚本扩展名 */
const POSIX_LOCAL_SCRIPT_EXTENSIONS = new Set(['.sh'])

/**
 * 判断命令的首个词是否已经带有路径信息（绝对路径、相对路径或盘符），
 * 这类命令不需要（也不应该）再加当前目录前缀。
 */
const hasPathPrefix = (token: string): boolean => {
  if (/^[.\\/]/.test(token)) return true
  if (/^[a-zA-Z]:/.test(token)) return true
  return token.includes('\\') || token.includes('/')
}

/**
 * 规范化实例启动命令的相对路径前缀。
 *
 * 终端不会把「当前工作目录」当作命令搜索路径：
 * - Windows PowerShell：工作目录里的 `start.bat` 直接执行会报 CommandNotFoundException，必须写 `.\start.bat`；
 * - Linux/Mac bash：`start.sh` 直接执行同样失败，必须写 `./start.sh`。
 *
 * 这里仅在「首个词是不带路径的本地脚本/程序名，且确实存在于工作目录」时补前缀；
 * 其余情况（`java` 这类走 PATH 的命令、已带前缀、相对/绝对路径、非可执行文件）原样返回。
 */
export const normalizeInstanceStartCommand = (
  command: string,
  platform: NodeJS.Platform,
  isWorkingDirectoryFile: (fileName: string) => boolean
): string => {
  const rawCommand = typeof command === 'string' ? command : ''
  const trimmedCommand = rawCommand.trim()
  if (!trimmedCommand) {
    return rawCommand
  }

  const match = trimmedCommand.match(/^(\S+)([\s\S]*)$/)
  if (!match) {
    return rawCommand
  }

  const [, rawToken, rest] = match

  // 允许用户写成 "start.bat"，仅对裸文件名做判断，改写时保留引号
  const quote = rawToken.length > 2 && rawToken.startsWith('"') && rawToken.endsWith('"') ? '"' : ''
  const token = quote ? rawToken.slice(1, -1) : rawToken

  if (!token || hasPathPrefix(token)) {
    return rawCommand
  }

  const isWindows = platform === 'win32'
  const extension = (isWindows ? path.win32.extname(token) : path.posix.extname(token)).toLowerCase()
  const supportedExtensions = isWindows ? WINDOWS_LOCAL_EXECUTABLE_EXTENSIONS : POSIX_LOCAL_SCRIPT_EXTENSIONS

  if (!supportedExtensions.has(extension) || !isWorkingDirectoryFile(token)) {
    return rawCommand
  }

  return `${quote}${isWindows ? '.\\' : './'}${token}${quote}${rest}`
}