import { exec } from 'child_process'
import { promisify } from 'util'

// 将exec函数转换为Promise版本
const execPromise = promisify(exec)

/**
 * 异步执行命令
 * @param command 要执行的命令
 * @param options 执行选项
 * @returns Promise<{stdout: string, stderr: string}>
 */
export async function execAsync(command: string, options?: any): Promise<{stdout: string, stderr: string}> {
  const result = await execPromise(command, { encoding: 'utf8', ...options })
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString()
  }
}

export default execAsync