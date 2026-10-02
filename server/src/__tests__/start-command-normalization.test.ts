import { normalizeInstanceStartCommand } from '../utils/startCommandNormalization.js'

describe('实例启动命令当前目录前缀补全', () => {
  // 模拟工作目录中存在的文件
  const workingDirectoryFiles = new Set(['start.bat', 'run.cmd', 'server.exe', 'start.sh', 'run.sh', 'readme.txt'])
  const isWorkingDirectoryFile = (fileName: string) => workingDirectoryFiles.has(fileName)

  it('Windows：裸脚本/程序名补全为 .\\ 前缀（PowerShell 不从当前目录解析命令）', () => {
    expect(normalizeInstanceStartCommand('start.bat', 'win32', isWorkingDirectoryFile)).toBe('.\\start.bat')
    expect(normalizeInstanceStartCommand('run.cmd', 'win32', isWorkingDirectoryFile)).toBe('.\\run.cmd')
    expect(normalizeInstanceStartCommand('server.exe', 'win32', isWorkingDirectoryFile)).toBe('.\\server.exe')
  })

  it('Linux/Mac：裸脚本名补全为 ./ 前缀（bash 不从当前目录解析命令）', () => {
    expect(normalizeInstanceStartCommand('start.sh', 'linux', isWorkingDirectoryFile)).toBe('./start.sh')
    expect(normalizeInstanceStartCommand('run.sh', 'darwin', isWorkingDirectoryFile)).toBe('./run.sh')
    // .bat 不属于 Linux 的本地脚本范围
    expect(normalizeInstanceStartCommand('start.bat', 'linux', isWorkingDirectoryFile)).toBe('start.bat')
  })

  it('保留脚本参数与首尾空白以外的原始内容', () => {
    expect(normalizeInstanceStartCommand('start.bat --nogui -Xmx2G', 'win32', isWorkingDirectoryFile))
      .toBe('.\\start.bat --nogui -Xmx2G')
    expect(normalizeInstanceStartCommand('start.sh --nogui', 'linux', isWorkingDirectoryFile))
      .toBe('./start.sh --nogui')
    expect(normalizeInstanceStartCommand('  start.bat  ', 'win32', isWorkingDirectoryFile)).toBe('.\\start.bat')
  })

  it('带引号的裸脚本名同样补全并保留引号', () => {
    expect(normalizeInstanceStartCommand('"start.bat"', 'win32', isWorkingDirectoryFile)).toBe('".\\start.bat"')
    expect(normalizeInstanceStartCommand('"start.sh"', 'linux', isWorkingDirectoryFile)).toBe('"./start.sh"')
  })

  it('已带前缀或路径的命令保持原样', () => {
    expect(normalizeInstanceStartCommand('.\\start.bat', 'win32', isWorkingDirectoryFile)).toBe('.\\start.bat')
    expect(normalizeInstanceStartCommand('./start.sh', 'linux', isWorkingDirectoryFile)).toBe('./start.sh')
    expect(normalizeInstanceStartCommand('C:\\servers\\1\\start.bat', 'win32', isWorkingDirectoryFile))
      .toBe('C:\\servers\\1\\start.bat')
    expect(normalizeInstanceStartCommand('sub\\start.bat', 'win32', isWorkingDirectoryFile)).toBe('sub\\start.bat')
    expect(normalizeInstanceStartCommand('\\\\server\\share\\start.bat', 'win32', isWorkingDirectoryFile))
      .toBe('\\\\server\\share\\start.bat')
    expect(normalizeInstanceStartCommand('/opt/server/start.sh', 'linux', isWorkingDirectoryFile))
      .toBe('/opt/server/start.sh')
    expect(normalizeInstanceStartCommand('sub/start.sh', 'linux', isWorkingDirectoryFile)).toBe('sub/start.sh')
  })

  it('PATH 中的命令与非脚本文件不改写', () => {
    expect(normalizeInstanceStartCommand('java -jar "server.jar" nogui', 'win32', isWorkingDirectoryFile))
      .toBe('java -jar "server.jar" nogui')
    expect(normalizeInstanceStartCommand('bash run.sh', 'linux', isWorkingDirectoryFile)).toBe('bash run.sh')
    expect(normalizeInstanceStartCommand('readme.txt', 'win32', isWorkingDirectoryFile)).toBe('readme.txt')
  })

  it('工作目录中不存在同名文件时不改写', () => {
    expect(normalizeInstanceStartCommand('start.cmd', 'win32', isWorkingDirectoryFile)).toBe('start.cmd')
    expect(normalizeInstanceStartCommand('other.exe', 'win32', isWorkingDirectoryFile)).toBe('other.exe')
    expect(normalizeInstanceStartCommand('other.sh', 'linux', isWorkingDirectoryFile)).toBe('other.sh')
  })

  it('空命令与非法输入不报错', () => {
    expect(normalizeInstanceStartCommand('', 'win32', isWorkingDirectoryFile)).toBe('')
    expect(normalizeInstanceStartCommand('   ', 'linux', isWorkingDirectoryFile)).toBe('   ')
    // 非字符串输入按空命令处理
    expect(normalizeInstanceStartCommand(undefined as any, 'win32', isWorkingDirectoryFile)).toBe('')
  })
})