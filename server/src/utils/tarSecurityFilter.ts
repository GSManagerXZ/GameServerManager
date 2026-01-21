/**
 * TAR 安全过滤器模块
 * 
 * 用于防御以下漏洞：
 * - CVE-2026-23745: 符号链接投毒和硬链接逃逸攻击
 * - Unicode 路径冲突竞态条件漏洞 (macOS APFS 上的 ß/ss 等字符冲突)
 * 
 * 由于 node-tar 库无法升级到 7.5.4+，通过在代码层面过滤符号链接条目来缓解风险
 */

import path from 'path'
import * as tar from 'tar'

/**
 * 过滤选项
 */
export interface TarSecurityFilterOptions {
  /** 解压目标目录 (cwd) */
  cwd: string
  /** 是否阻止所有符号链接（用于缓解 Unicode 竞态条件漏洞） */
  blockSymbolicLinks?: boolean
  /** 是否阻止所有硬链接 */
  blockHardLinks?: boolean
  /** 是否启用详细日志 */
  verbose?: boolean
}

/**
 * 创建 TAR 安全过滤器
 * 
 * 此过滤器可防止：
 * 1. 符号链接投毒攻击（SymbolicLink 指向绝对路径或路径遍历）
 * 2. 硬链接逃逸攻击（HardLink 指向危险路径）
 * 3. 路径遍历攻击（文件路径包含 .. 或绝对路径）
 * 4. Unicode 路径冲突竞态条件漏洞（通过完全阻止符号链接）
 * 
 * @param options 过滤选项
 * @returns tar.extract 可用的 filter 函数
 */
export function createTarSecurityFilter(options: TarSecurityFilterOptions) {
  const { 
    cwd, 
    blockSymbolicLinks = true,  // 默认开启，防御 Unicode 竞态条件漏洞
    blockHardLinks = true,      // 同时阻止硬链接
    verbose = false 
  } = options

  return (filePath: string, entry: tar.ReadEntry): boolean => {
    // 1. 阻止所有符号链接 (防御 Unicode 竞态条件漏洞)
    if (entry.type === 'SymbolicLink') {
      if (blockSymbolicLinks) {
        if (verbose) {
          console.warn(`[TAR安全过滤] 阻止符号链接: ${filePath} (防御 Unicode 竞态条件漏洞)`)
        }
        return false
      }

      // 如果不完全阻止，则检查链接目标是否安全
      const linkpath = (entry as any).linkpath as string
      if (linkpath && (path.isAbsolute(linkpath) || linkpath.includes('..'))) {
        if (verbose) {
          console.warn(`[TAR安全过滤] 阻止危险符号链接: ${filePath} -> ${linkpath}`)
        }
        return false
      }
    }

    // 2. 阻止所有硬链接
    if (entry.type === 'Link') {
      if (blockHardLinks) {
        if (verbose) {
          console.warn(`[TAR安全过滤] 阻止硬链接: ${filePath}`)
        }
        return false
      }

      // 如果不完全阻止，则检查链接目标是否安全
      const linkpath = (entry as any).linkpath as string
      if (linkpath && (path.isAbsolute(linkpath) || linkpath.includes('..'))) {
        if (verbose) {
          console.warn(`[TAR安全过滤] 阻止危险硬链接: ${filePath} -> ${linkpath}`)
        }
        return false
      }
    }

    // 3. 阻止绝对路径
    if (path.isAbsolute(filePath)) {
      if (verbose) {
        console.warn(`[TAR安全过滤] 阻止绝对路径: ${filePath}`)
      }
      return false
    }

    // 4. 阻止路径遍历
    if (filePath.includes('..')) {
      if (verbose) {
        console.warn(`[TAR安全过滤] 阻止路径遍历: ${filePath}`)
      }
      return false
    }

    // 5. 检查解压后的路径是否超出目标目录
    const resolvedPath = path.resolve(cwd, filePath)
    const resolvedCwd = path.resolve(cwd)
    if (!resolvedPath.startsWith(resolvedCwd)) {
      if (verbose) {
        console.warn(`[TAR安全过滤] 阻止目录逃逸: ${filePath} -> ${resolvedPath}`)
      }
      return false
    }

    return true
  }
}

/**
 * 创建简化版安全过滤器（用于兼容旧代码）
 * 
 * @param cwd 解压目标目录
 * @returns tar.extract 可用的 filter 函数
 */
export function createSimpleTarSecurityFilter(cwd: string) {
  return createTarSecurityFilter({ 
    cwd, 
    blockSymbolicLinks: true, 
    blockHardLinks: true,
    verbose: true 
  })
}

/**
 * 安全的 tar.extract 选项生成器
 * 
 * @param file tar 文件路径
 * @param cwd 解压目标目录
 * @param additionalOptions 额外选项
 * @returns tar.extract 选项对象
 */
export function createSafeTarExtractOptions(
  file: string, 
  cwd: string, 
  additionalOptions?: Partial<tar.ExtractOptions>
): tar.ExtractOptions {
  return {
    file,
    cwd,
    filter: createTarSecurityFilter({ cwd, blockSymbolicLinks: true, blockHardLinks: true }),
    ...additionalOptions
  } as tar.ExtractOptions
}

export default {
  createTarSecurityFilter,
  createSimpleTarSecurityFilter,
  createSafeTarExtractOptions
}
