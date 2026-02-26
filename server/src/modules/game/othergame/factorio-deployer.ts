import axios from 'axios';
import express, { Request, Response } from 'express';
import * as fs from 'fs-extra';
import { promises as fsPromises, existsSync } from 'fs';
import { createWriteStream, createReadStream } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import * as zlib from 'zlib';
import { pipeline } from 'stream';
import { zipToolsManager } from '../../../utils/zipToolsManager.js';
import { createTarSecurityFilter } from '../../../utils/tarSecurityFilter.js';

// ==================== 接口定义 ====================

export interface DeploymentOptions {
  extractPath: string;
  tempDir?: string;
}

export interface DeploymentResult {
  success: boolean;
  message: string;
  extractPath?: string;
  serverExecutablePath?: string;
}

export interface ApiServerOptions {
  port?: number;
  host?: string;
}

// ==================== Factorio部署器类 ====================

export class FactorioDeployer {
  private readonly downloadUrl = 'https://factorio.com/get-download/stable/headless/linux64';
  private readonly defaultTempDir = os.tmpdir();
  private cancelled: boolean = false;
  private currentProcess?: any;
  private currentDownloadController?: AbortController;

  /**
   * 检测文件格式
   * @param filePath 文件路径
   * @returns 文件格式类型
   */
  private async detectFileFormat(filePath: string): Promise<string> {
    try {
      const buffer = Buffer.alloc(512);
      const fd = await fsPromises.open(filePath, 'r');

      try {
        await fd.read(buffer, 0, 512, 0);

        // 检查文件头魔数
        const header = buffer.toString('hex');

        console.log(`文件头魔数: ${header.substring(0, 32)}`);

        // ZIP文件 (PK)
        if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
          console.log('检测到ZIP格式');
          return 'zip';
        }

        // GZIP文件
        if (buffer[0] === 0x1F && buffer[1] === 0x8B) {
          console.log('检测到GZIP格式');
          return 'gzip';
        }

        // XZ文件
        if (buffer[0] === 0xFD && buffer[1] === 0x37 && buffer[2] === 0x7A &&
          buffer[3] === 0x58 && buffer[4] === 0x5A && buffer[5] === 0x00) {
          console.log('检测到XZ格式');
          return 'xz';
        }

        // BZIP2文件
        if (buffer[0] === 0x42 && buffer[1] === 0x5A && buffer[2] === 0x68) {
          console.log('检测到BZIP2格式');
          return 'bzip2';
        }

        // TAR文件需要检查257字节处的ustar标识
        if (buffer.length >= 262 && buffer.slice(257, 262).toString() === 'ustar') {
          console.log('检测到TAR格式');
          return 'tar';
        }

      } finally {
        await fd.close();
      }

      // 如果魔数检测失败，根据文件扩展名判断
      console.log('魔数检测失败，使用文件扩展名判断');
      const basename = path.basename(filePath).toLowerCase();

      if (basename.endsWith('.tar.xz')) {
        console.log('根据扩展名检测到TAR.XZ格式');
        return 'tar.xz';
      }
      if (basename.endsWith('.tar.gz') || basename.endsWith('.tgz')) {
        console.log('根据扩展名检测到TAR.GZ格式');
        return 'tar.gz';
      }

      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.tar') {
        console.log('根据扩展名检测到TAR格式');
        return 'tar';
      }
      if (ext === '.gz') {
        console.log('根据扩展名检测到GZ格式');
        return 'gzip';
      }
      if (ext === '.zip') {
        console.log('根据扩展名检测到ZIP格式');
        return 'zip';
      }
      if (ext === '.xz') {
        console.log('根据扩展名检测到XZ格式');
        return 'xz';
      }
      if (ext === '.bz2') {
        console.log('根据扩展名检测到BZ2格式');
        return 'bzip2';
      }

      console.log('未知文件格式');
      return 'unknown';
    } catch (error) {
      console.error('文件格式检测失败:', error);
      // 降级到扩展名检测
      const basename = path.basename(filePath).toLowerCase();
      if (basename.endsWith('.tar.xz')) return 'tar.xz';
      if (basename.endsWith('.tar.gz') || basename.endsWith('.tgz')) return 'tar.gz';

      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.tar') return 'tar';
      if (ext === '.gz') return 'gzip';
      if (ext === '.zip') return 'zip';
      if (ext === '.xz') return 'xz';
      if (ext === '.bz2') return 'bzip2';

      return 'unknown';
    }
  }

  /**
   * 取消当前部署操作
   */
  cancel(): void {
    this.cancelled = true;

    // 终止当前进程
    if (this.currentProcess && !this.currentProcess.killed) {
      this.currentProcess.kill('SIGTERM');

      // 等待一段时间后强制终止
      setTimeout(() => {
        if (this.currentProcess && !this.currentProcess.killed) {
          this.currentProcess.kill('SIGKILL');
        }
      }, 5000);
    }

    // 取消当前下载
    if (this.currentDownloadController) {
      this.currentDownloadController.abort();
    }

    console.log('Factorio服务端部署已取消');
  }

  /**
   * 检查是否已取消
   */
  isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * 部署Factorio服务端
   * @param options 部署选项
   * @returns 部署结果
   */
  async deploy(options: DeploymentOptions): Promise<DeploymentResult> {
    this.cancelled = false; // 重置取消状态

    const tempDir = options.tempDir || this.defaultTempDir;
    const initialTempFilePath = path.join(tempDir, `factorio-server-${Date.now()}.tar.xz`);
    let actualTempFilePath = initialTempFilePath;

    try {
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      // 1. 下载服务端压缩包
      console.log('正在下载Factorio服务端...');
      await this.downloadServer(initialTempFilePath);

      // 检查实际下载的文件路径
      const tempFiles = await fsPromises.readdir(tempDir);
      const downloadedFile = tempFiles.find(file =>
        file.startsWith('factorio-server-') &&
        (file.endsWith('.tar.xz') || file.endsWith('.tar.gz') || file.endsWith('.zip') || file.endsWith('.tar'))
      );

      if (downloadedFile) {
        actualTempFilePath = path.join(tempDir, downloadedFile);
        console.log(`实际下载的文件: ${actualTempFilePath}`);
      }

      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      // 2. 确保解压目录存在
      await fs.ensureDir(options.extractPath);

      // 3. 解压文件
      console.log('正在解压文件...');
      await this.extractServer(actualTempFilePath, options.extractPath);

      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      // 4. 清理临时文件
      await fs.remove(actualTempFilePath);

      // 5. 清理临时目录（如果指定了tempDir）
      if (options.tempDir && await fs.pathExists(options.tempDir)) {
        try {
          await fs.remove(options.tempDir);
          console.log(`已清理临时目录: ${options.tempDir}`);
        } catch (error) {
          console.warn('清理临时目录时出错:', error);
        }
      }

      // 6. 查找服务端可执行文件
      const serverExecutablePath = await this.findServerExecutable(options.extractPath);

      return {
        success: true,
        message: 'Factorio服务端部署成功',
        extractPath: options.extractPath,
        serverExecutablePath
      };
    } catch (error) {
      // 清理临时文件和目录
      try {
        if (await fs.pathExists(actualTempFilePath)) {
          await fs.remove(actualTempFilePath);
        }
        if (options.tempDir && await fs.pathExists(options.tempDir)) {
          await fs.remove(options.tempDir);
        }
      } catch (cleanupError) {
        console.warn('清理临时文件时出错:', cleanupError);
      }

      return {
        success: false,
        message: `部署失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * 下载服务端文件
   * @param filePath 保存路径
   */
  private async downloadServer(filePath: string): Promise<void> {
    // 检查是否已取消
    if (this.cancelled) {
      throw new Error('操作已取消');
    }

    this.currentDownloadController = new AbortController();

    try {
      console.log(`正在从 ${this.downloadUrl} 下载文件...`);

      const response = await axios({
        method: 'GET',
        url: this.downloadUrl,
        responseType: 'stream',
        timeout: 300000, // 5分钟超时
        signal: this.currentDownloadController.signal,
        maxRedirects: 5, // 允许重定向
        headers: {
          'User-Agent': 'GameServerManager/1.0.0'
        }
      });

      // 检查响应头以确定文件类型
      const contentType = response.headers['content-type'];
      const contentDisposition = response.headers['content-disposition'];

      console.log(`Content-Type: ${contentType}`);
      if (contentDisposition) {
        console.log(`Content-Disposition: ${contentDisposition}`);
      }

      // 根据响应头调整文件扩展名
      let adjustedFilePath = filePath;
      if (contentType) {
        if (contentType.includes('application/zip')) {
          adjustedFilePath = filePath.replace(/\.[^.]+$/, '.zip');
        } else if (contentType.includes('application/gzip') || contentType.includes('application/x-gzip')) {
          adjustedFilePath = filePath.replace(/\.[^.]+$/, '.tar.gz');
        } else if (contentType.includes('application/x-tar')) {
          adjustedFilePath = filePath.replace(/\.[^.]+$/, '.tar');
        }
      }

      console.log(`保存文件到: ${adjustedFilePath}`);

      const writer = createWriteStream(adjustedFilePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          if (this.cancelled) {
            fsPromises.unlink(adjustedFilePath).catch(() => { });
            reject(new Error('操作已取消'));
            return;
          }

          // 更新文件路径引用
          if (adjustedFilePath !== filePath) {
            // 如果文件路径发生了变化，需要通知调用者
            console.log(`文件已保存为: ${adjustedFilePath}`);
          }

          resolve();
        });

        writer.on('error', (error) => {
          fsPromises.unlink(adjustedFilePath).catch(() => { });
          reject(error);
        });

        response.data.on('error', (error: any) => {
          if (error.name === 'AbortError') {
            fsPromises.unlink(adjustedFilePath).catch(() => { });
            reject(new Error('操作已取消'));
          } else {
            reject(error);
          }
        });
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw new Error('下载超时，请检查网络连接');
        } else if (error.response?.status === 404) {
          throw new Error('下载链接不存在，可能Factorio官方已更新下载地址');
        } else if (error.response?.status === 403) {
          throw new Error('访问被拒绝，可能需要登录或验证');
        }
        throw new Error(`下载失败: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 检查文件完整性
   * @param filePath 文件路径
   * @returns 文件是否完整
   */
  private async checkFileIntegrity(filePath: string): Promise<boolean> {
    try {
      const stats = await fsPromises.stat(filePath);
      console.log(`文件大小: ${stats.size} 字节`);

      // 检查文件大小是否合理（Factorio服务端通常大于10MB）
      if (stats.size < 10 * 1024 * 1024) {
        console.warn('警告: 文件大小异常小，可能下载不完整');
        return false;
      }

      // 尝试读取文件头部分来验证文件完整性
      const buffer = Buffer.alloc(1024);
      const fd = await fsPromises.open(filePath, 'r');

      try {
        await fd.read(buffer, 0, 1024, 0);

        // 检查是否为有效的压缩文件头
        if (buffer[0] === 0x00 && buffer[1] === 0x00) {
          console.warn('警告: 文件头部为空，可能文件损坏');
          return false;
        }

        return true;
      } finally {
        await fd.close();
      }
    } catch (error) {
      console.error('文件完整性检查失败:', error);
      return false;
    }
  }

  /**
   * 解压服务端文件
   * @param archivePath 压缩包路径
   * @param extractPath 解压路径
   */
  private async extractServer(archivePath: string, extractPath: string): Promise<void> {
    // 检查是否已取消
    if (this.cancelled) {
      throw new Error('操作已取消');
    }

    // 检查文件完整性
    console.log('检查文件完整性...');
    const isFileIntact = await this.checkFileIntegrity(archivePath);
    if (!isFileIntact) {
      throw new Error('文件完整性检查失败，可能下载不完整或文件损坏');
    }

    // 确保解压目录存在
    await fs.ensureDir(extractPath);

    // 检测文件格式
    const format = await this.detectFileFormat(archivePath);
    console.log(`检测到文件格式: ${format}`);

    try {
      switch (format) {
        case 'zip':
          await this.extractZip(archivePath, extractPath);
          break;
        case 'gzip':
        case 'tar.gz':
          await this.extractGzip(archivePath, extractPath);
          break;
        case 'tar':
          await this.extractTar(archivePath, extractPath);
          break;
        case 'xz':
        case 'tar.xz':
          // 对于tar.xz文件，直接使用系统命令，因为Node.js原生不支持xz
          console.log('检测到tar.xz格式，优先使用系统命令解压...');
          await this.extractWithSystemCommand(archivePath, extractPath);
          break;
        default:
          // 对于未知格式，直接尝试系统命令（通常是tar.xz）
          console.log(`未知格式 ${format}，直接使用系统命令解压...`);
          await this.extractWithSystemCommand(archivePath, extractPath);
      }
    } catch (error) {
      console.error(`使用 ${format} 解压器失败:`, error);

      // 对于tar.xz文件，如果第一次失败了，不要再次尝试系统命令
      if (format === 'tar.xz' || format === 'xz') {
        const errorMsg = `tar.xz文件解压失败: ${error instanceof Error ? error.message : String(error)}\n` +
          `文件路径: ${archivePath}\n` +
          `这通常是因为系统缺少必要的解压工具。请检查是否已安装 tar 和 xz-utils 包。`;
        throw new Error(errorMsg);
      }

      // 对于其他格式，尝试系统命令作为后备方案
      console.log('尝试使用系统命令作为后备方案...');
      try {
        await this.extractWithSystemCommand(archivePath, extractPath);
      } catch (systemError) {
        // 如果系统命令也失败，提供更详细的错误信息
        const errorMsg = `解压失败: 所有解压方法都失败了。\n` +
          `原始错误: ${error instanceof Error ? error.message : String(error)}\n` +
          `系统命令错误: ${systemError instanceof Error ? systemError.message : String(systemError)}\n` +
          `文件格式: ${format}\n` +
          `文件路径: ${archivePath}\n` +
          `建议: 请检查文件是否完整，或尝试手动解压验证文件格式。如果是Linux系统，请确保已安装xz-utils包。`;
        throw new Error(errorMsg);
      }
    }
  }

  /**
   * 诊断系统环境
   * @param toolsAvailable 可用工具状态
   * @param isWindows 是否为Windows系统
   */
  private async diagnoseSystemEnvironment(toolsAvailable: Record<string, boolean>, isWindows: boolean): Promise<void> {
    const missingTools = [];
    const availableTools = [];

    for (const [tool, available] of Object.entries(toolsAvailable)) {
      if (available) {
        availableTools.push(tool);
      } else {
        missingTools.push(tool);
      }
    }

    console.log(`✓ 可用工具 (${availableTools.length}): ${availableTools.join(', ')}`);
    if (missingTools.length > 0) {
      console.log(`✗ 缺失工具 (${missingTools.length}): ${missingTools.join(', ')}`);
    }

    // 检查tar.xz解压的最低要求
    const hasBasicTarXzSupport = toolsAvailable.tar && (toolsAvailable.xz || toolsAvailable.unxz);
    const hasAdvancedSupport = hasBasicTarXzSupport || toolsAvailable['7z'];

    if (!hasAdvancedSupport && !isWindows) {
      console.warn('⚠️  警告: 系统缺少tar.xz解压支持');
      console.log('建议安装命令:');

      // 检测Linux发行版并提供相应的安装命令
      try {
        const fs = require('fs');
        if (existsSync('/etc/debian_version')) {
          console.log('  Ubuntu/Debian: sudo apt-get update && sudo apt-get install tar xz-utils p7zip-full');
        } else if (existsSync('/etc/redhat-release')) {
          console.log('  CentOS/RHEL: sudo yum install tar xz p7zip');
          console.log('  或 (较新版本): sudo dnf install tar xz p7zip');
        } else if (existsSync('/etc/arch-release')) {
          console.log('  Arch Linux: sudo pacman -S tar xz p7zip');
        } else if (existsSync('/etc/alpine-release')) {
          console.log('  Alpine Linux: apk add tar xz p7zip');
        } else {
          console.log('  通用: 请使用系统包管理器安装 tar, xz-utils, p7zip');
        }
      } catch (error) {
        console.log('  通用: 请使用系统包管理器安装 tar, xz-utils, p7zip');
      }
    } else if (hasBasicTarXzSupport) {
      console.log('✓ 系统支持tar.xz解压');
    }

    // 性能优化建议
    if (toolsAvailable.tar && toolsAvailable.xz && !toolsAvailable.pixz && !toolsAvailable.pxz && !isWindows) {
      console.log('💡 性能提示: 可安装 pixz 或 pxz 以获得并行解压支持，提升大文件解压速度');
    }
  }

  /**
   * 检查系统工具是否可用
   * @param command 命令名
   * @returns 是否可用
   */
  private async checkCommandAvailable(command: string): Promise<boolean> {
    const { spawn } = require('child_process');

    try {
      await new Promise<void>((resolve, reject) => {
        // 对于不同的命令使用不同的检查参数
        let args = ['--version'];
        if (command === '7z') {
          args = []; // 7z不需要参数就会显示版本信息
        } else if (command === 'pixz' || command === 'pxz') {
          args = ['-h']; // 这些工具使用-h显示帮助
        }

        const child = spawn(command, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000 // 5秒超时
        });

        let resolved = false;

        child.on('close', (code) => {
          if (!resolved) {
            resolved = true;
            // 对于某些工具，退出码不为0也可能是正常的
            if (code === 0 || (command === '7z' && code === 1)) {
              resolve();
            } else {
              reject(new Error(`Command not available: ${command}, exit code: ${code}`));
            }
          }
        });

        child.on('error', (error) => {
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        });

        // 设置超时
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            child.kill('SIGTERM');
            reject(new Error(`Command check timeout: ${command}`));
          }
        }, 5000);
      });
      return true;
    } catch (error) {
      console.debug(`工具 ${command} 不可用:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * 使用系统命令解压（后备方案）
   * @param archivePath 压缩文件路径
   * @param extractPath 解压目标路径
   */
  private async extractWithSystemCommand(archivePath: string, extractPath: string): Promise<void> {
    const { spawn } = require('child_process');

    return new Promise(async (resolve, reject) => {
      console.log(`尝试使用系统命令解压: ${archivePath}`);
      console.log(`目标路径: ${extractPath}`);
      console.log(`操作系统: ${process.platform}`);

      // 检测操作系统并选择合适的命令
      const isWindows = process.platform === 'win32';

      // 检查关键工具的可用性
      console.log('正在检查系统解压工具...');
      const toolsAvailable = {
        tar: await this.checkCommandAvailable('tar'),
        xz: await this.checkCommandAvailable('xz'),
        unxz: await this.checkCommandAvailable('unxz'),
        pixz: await this.checkCommandAvailable('pixz'),
        pxz: await this.checkCommandAvailable('pxz'),
        lzma: await this.checkCommandAvailable('lzma'),
        '7z': await this.checkCommandAvailable('7z'),
        unzip: await this.checkCommandAvailable('unzip')
      };

      console.log('可用工具:', toolsAvailable);

      // 诊断系统环境
      await this.diagnoseSystemEnvironment(toolsAvailable, isWindows);

      // 根据文件类型和操作系统选择命令
      const commands: Array<[string, string[]]> = [];

      if (archivePath.endsWith('.tar.xz')) {
        if (isWindows) {
          // Windows下的命令优先级
          if (toolsAvailable.tar) {
            commands.push(['tar', ['-xf', archivePath, '-C', extractPath]]); // Windows 10 1803+支持
          }
          if (toolsAvailable['7z']) {
            commands.push(['7z', ['x', archivePath, `-o${extractPath}`, '-y']]); // 7-Zip
          }
          commands.push(['powershell', ['-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractPath}' -Force`]]);
        } else {
          // Linux/Mac下使用tar命令，按优先级排序

          // 方法1: 使用xz工具链解压（最推荐）
          if (toolsAvailable.xz && toolsAvailable.tar) {
            commands.push(['sh', ['-c', `xz -dc "${archivePath}" | tar -xf - -C "${extractPath}"`]]);
          }

          // 方法2: 使用tar的-J参数（需要tar支持xz）
          if (toolsAvailable.tar) {
            commands.push(['tar', ['-xJf', archivePath, '-C', extractPath]]);
          }

          // 方法3: 使用pixz（并行xz解压，如果可用）
          if (await this.checkCommandAvailable('pixz') && toolsAvailable.tar) {
            commands.push(['sh', ['-c', `pixz -dc "${archivePath}" | tar -xf - -C "${extractPath}"`]]);
          }

          // 方法4: 使用unxz + tar组合
          if (toolsAvailable.unxz && toolsAvailable.tar) {
            commands.push(['sh', ['-c', `unxz -c "${archivePath}" | tar -xf - -C "${extractPath}"`]]);
          }

          // 方法5: 尝试让tar自动检测格式
          if (toolsAvailable.tar) {
            commands.push(['tar', ['-xf', archivePath, '-C', extractPath]]);
          }

          // 方法6: 使用7z作为后备
          if (toolsAvailable['7z']) {
            commands.push(['7z', ['x', archivePath, `-o${extractPath}`, '-y']]);
          }

          // 方法7: 尝试使用pxz（另一个并行xz实现）
          if (await this.checkCommandAvailable('pxz') && toolsAvailable.tar) {
            commands.push(['sh', ['-c', `pxz -dc "${archivePath}" | tar -xf - -C "${extractPath}"`]]);
          }

          // 方法8: 使用lzma工具（xz的前身）
          if (await this.checkCommandAvailable('lzma') && toolsAvailable.tar) {
            commands.push(['sh', ['-c', `lzma -dc "${archivePath}" | tar -xf - -C "${extractPath}"`]]);
          }
        }
      } else if (archivePath.endsWith('.tar.gz')) {
        if (toolsAvailable.tar) {
          commands.push(['tar', ['-xzf', archivePath, '-C', extractPath]]);
        }
        if (toolsAvailable['7z']) {
          commands.push(['7z', ['x', archivePath, `-o${extractPath}`, '-y']]);
        }
      } else if (archivePath.endsWith('.tar')) {
        if (toolsAvailable.tar) {
          commands.push(['tar', ['-xf', archivePath, '-C', extractPath]]);
        }
        if (toolsAvailable['7z']) {
          commands.push(['7z', ['x', archivePath, `-o${extractPath}`, '-y']]);
        }
      } else if (archivePath.endsWith('.zip')) {
        if (isWindows) {
          commands.push(['powershell', ['-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractPath}' -Force`]]);
          if (toolsAvailable['7z']) {
            commands.push(['7z', ['x', archivePath, `-o${extractPath}`, '-y']]);
          }
        } else {
          if (toolsAvailable.unzip) {
            commands.push(['unzip', [archivePath, '-d', extractPath]]);
          }
          if (toolsAvailable['7z']) {
            commands.push(['7z', ['x', archivePath, `-o${extractPath}`, '-y']]);
          }
        }
      }

      if (commands.length === 0) {
        const missingTools = [];
        if (!toolsAvailable.tar) missingTools.push('tar');
        if (!toolsAvailable.xz && !toolsAvailable.unxz && !isWindows && archivePath.endsWith('.tar.xz')) missingTools.push('xz-utils');
        if (!toolsAvailable['7z']) missingTools.push('7zip');
        if (!toolsAvailable.unzip && !isWindows) missingTools.push('unzip');

        let installCmd = '';
        if (!isWindows) {
          try {
            const fs = require('fs');
            if (existsSync('/etc/debian_version')) {
              installCmd = 'sudo apt-get update && sudo apt-get install tar xz-utils p7zip-full unzip';
            } else if (existsSync('/etc/redhat-release')) {
              installCmd = 'sudo yum install tar xz p7zip unzip (或使用 dnf)';
            } else if (existsSync('/etc/arch-release')) {
              installCmd = 'sudo pacman -S tar xz p7zip unzip';
            } else {
              installCmd = '请使用系统包管理器安装 tar xz-utils p7zip unzip';
            }
          } catch {
            installCmd = '请使用系统包管理器安装 tar xz-utils p7zip unzip';
          }
        }

        const errorMsg = `❌ 没有可用的解压工具处理 ${path.basename(archivePath)}\n` +
          `缺少工具: ${missingTools.join(', ')}\n` +
          `文件类型: tar.xz (需要 tar + xz 支持)\n` +
          `\n解决方案:\n` +
          (isWindows ?
            `Windows系统:\n` +
            `1. 安装 7-Zip: https://www.7-zip.org/\n` +
            `2. 或安装 Git for Windows (包含tar)\n` +
            `3. 或使用 WSL (Windows Subsystem for Linux)` :
            `Linux系统:\n${installCmd}\n` +
            `\n验证安装: tar --version && xz --version`
          );
        reject(new Error(errorMsg));
        return;
      }

      let currentCommandIndex = 0;
      let lastError: string = '';

      const tryNextCommand = () => {
        if (currentCommandIndex >= commands.length) {
          // 分析失败原因
          const fileName = path.basename(archivePath);
          const fileSize = require('fs').statSync(archivePath).size;
          const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

          let diagnosisMsg = '';

          // 检查是否是工具问题
          const hasAnyXzTool = toolsAvailable.xz || toolsAvailable.unxz || toolsAvailable.pixz || toolsAvailable.pxz;
          if (!toolsAvailable.tar) {
            diagnosisMsg += '❌ 缺少 tar 工具\n';
          } else if (!hasAnyXzTool && !isWindows) {
            diagnosisMsg += '❌ 缺少 xz 解压工具 (xz, unxz, pixz, pxz)\n';
          } else if (lastError.includes('not found') || lastError.includes('command not found')) {
            diagnosisMsg += '❌ 命令未找到，可能是PATH环境变量问题\n';
          } else if (lastError.includes('permission') || lastError.includes('Permission')) {
            diagnosisMsg += '❌ 权限不足，尝试使用 sudo 或检查文件权限\n';
          } else if (lastError.includes('space') || lastError.includes('Space')) {
            diagnosisMsg += '❌ 磁盘空间不足\n';
          } else if (lastError.includes('corrupted') || lastError.includes('invalid')) {
            diagnosisMsg += '❌ 文件可能已损坏\n';
          } else {
            diagnosisMsg += '❓ 未知错误，可能是文件格式或系统兼容性问题\n';
          }

          const errorMsg = `🚫 所有解压方法都失败了\n` +
            `\n📁 文件信息:\n` +
            `  文件名: ${fileName}\n` +
            `  大小: ${fileSizeMB} MB\n` +
            `  路径: ${archivePath}\n` +
            `\n🔍 问题诊断:\n${diagnosisMsg}` +
            `\n💻 系统信息:\n` +
            `  操作系统: ${process.platform}\n` +
            `  可用工具: ${Object.entries(toolsAvailable).filter(([, v]) => v).map(([k]) => k).join(', ') || '无'}\n` +
            `\n🛠️  尝试的命令 (${commands.length}个):\n` +
            commands.map(([cmd, args], i) => `  ${i + 1}. ${cmd} ${args.join(' ')}`).join('\n') +
            `\n❌ 最后错误: ${lastError}\n` +
            `\n🔧 建议解决方案:\n` +
            (isWindows ?
              `  1. 安装 7-Zip: https://www.7-zip.org/\n` +
              `  2. 安装 Git for Windows (包含 tar)\n` +
              `  3. 使用 WSL 或 Docker` :
              `  1. 安装解压工具: sudo apt-get install tar xz-utils p7zip-full\n` +
              `  2. 检查文件完整性: file "${archivePath}"\n` +
              `  3. 手动测试解压: tar -tf "${archivePath}" | head -5\n` +
              `  4. 检查磁盘空间: df -h "${path.dirname(archivePath)}"`
            );
          reject(new Error(errorMsg));
          return;
        }

        const [command, args] = commands[currentCommandIndex];
        currentCommandIndex++;

        console.log(`尝试命令 ${currentCommandIndex}/${commands.length}: ${command} ${args.join(' ')}`);

        const extractProcess = spawn(command, args, {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        this.currentProcess = extractProcess;

        let stdout = '';
        let stderr = '';

        extractProcess.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        extractProcess.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        extractProcess.on('close', (code: number) => {
          this.currentProcess = undefined;

          if (this.cancelled) {
            reject(new Error('操作已取消'));
            return;
          }

          if (code === 0) {
            console.log(`解压成功，使用命令: ${command}`);
            if (stdout) console.log('输出:', stdout.trim());
            resolve();
          } else {
            lastError = stderr || `命令退出码: ${code}`;
            console.warn(`命令失败: ${command}, 错误: ${lastError}`);
            if (stderr) console.error('错误输出:', stderr);
            if (stdout) console.log('标准输出:', stdout);
            // 尝试下一个命令
            tryNextCommand();
          }
        });

        extractProcess.on('error', (error: Error) => {
          this.currentProcess = undefined;
          lastError = error.message;
          console.warn(`命令执行错误: ${command}, 错误: ${error.message}`);
          // 尝试下一个命令
          tryNextCommand();
        });
      };

      tryNextCommand();
    });
  }

  /**
   * 解压ZIP文件
   */
  private async extractZip(archivePath: string, extractPath: string): Promise<void> {
    // 检查是否已取消
    if (this.cancelled) {
      throw new Error('操作已取消');
    }

    // 使用 Zip-Tools 解压
    await zipToolsManager.extractZip(archivePath, extractPath);
  }

  /**
   * 解压GZIP文件
   */
  private async extractGzip(archivePath: string, extractPath: string): Promise<void> {
    const outputPath = path.join(extractPath, path.basename(archivePath, '.gz'));
    await fs.ensureDir(path.dirname(outputPath));

    return new Promise((resolve, reject) => {
      const readStream = createReadStream(archivePath);
      const writeStream = createWriteStream(outputPath);
      const gunzip = zlib.createGunzip();

      pipeline(readStream, gunzip, writeStream, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 解压TAR文件
   */
  private async extractTar(archivePath: string, extractPath: string): Promise<void> {
    const tar = require('tar');

    return tar.extract({
      file: archivePath,
      cwd: extractPath,
      strict: true,
      // 使用统一的安全过滤器：防止 CVE-2026-23745 漏洞和 Unicode 竞态条件漏洞
      filter: createTarSecurityFilter({ cwd: extractPath })
    });
  }

  /**
   * 解压XZ文件
   * @param archivePath 压缩文件路径
   * @param extractPath 解压目标路径
   */
  private async extractXz(archivePath: string, extractPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`开始解压XZ文件: ${archivePath}`);

        const readStream = createReadStream(archivePath);

        // 使用zlib.createUnzip()来处理xz压缩
        // 注意：Node.js的zlib不直接支持xz，这里先尝试作为gzip处理
        const decompressStream = zlib.createUnzip();

        readStream.on('error', (error) => {
          console.error('读取文件错误:', error);
          reject(new Error(`读取压缩文件失败: ${error.message}`));
        });

        decompressStream.on('error', (error) => {
          console.error('解压错误:', error);
          // 如果zlib解压失败，尝试使用系统命令
          this.extractWithSystemCommand(archivePath, extractPath)
            .then(resolve)
            .catch(reject);
        });

        readStream.pipe(decompressStream);

        // 如果是tar.xz，需要进一步解压tar
        if (archivePath.endsWith('.tar.xz')) {
          console.log('检测到tar.xz格式，进行tar解压...');
          const tar = require('tar');
          const tarExtract = tar.extract({
            cwd: extractPath,
            strict: false, // 允许一些不严格的tar格式
            // 使用统一的安全过滤器：防止 CVE-2026-23745 漏洞和 Unicode 竞态条件漏洞
            filter: createTarSecurityFilter({ cwd: extractPath })
          });

          decompressStream.pipe(tarExtract);

          tarExtract.on('end', () => {
            console.log('tar.xz解压完成');
            resolve();
          });

          tarExtract.on('error', (error: Error) => {
            console.error('tar解压错误:', error);
            // 如果tar解压失败，尝试系统命令
            this.extractWithSystemCommand(archivePath, extractPath)
              .then(resolve)
              .catch(reject);
          });
        } else {
          // 直接写入文件
          const outputPath = path.join(extractPath, path.basename(archivePath, '.xz'));
          const writeStream = createWriteStream(outputPath);

          decompressStream.pipe(writeStream);

          writeStream.on('finish', () => {
            console.log('xz解压完成');
            resolve();
          });

          writeStream.on('error', (error) => {
            console.error('写入文件错误:', error);
            reject(new Error(`写入解压文件失败: ${error.message}`));
          });
        }
      } catch (error) {
        console.error('extractXz异常:', error);
        reject(error);
      }
    });
  }

  /**
   * 查找服务端可执行文件
   * @param extractPath 解压路径
   * @returns 可执行文件路径
   */
  private async findServerExecutable(extractPath: string): Promise<string | undefined> {
    const possiblePaths = [
      path.join(extractPath, 'factorio', 'bin', 'x64', 'factorio'),
      path.join(extractPath, 'bin', 'x64', 'factorio'),
      path.join(extractPath, 'factorio')
    ];

    for (const execPath of possiblePaths) {
      if (await fs.pathExists(execPath)) {
        return execPath;
      }
    }

    return undefined;
  }

  /**
   * 检查部署状态
   * @param extractPath 解压路径
   * @returns 是否已部署
   */
  async checkDeployment(extractPath: string): Promise<boolean> {
    const serverExecutable = await this.findServerExecutable(extractPath);
    return serverExecutable !== undefined;
  }

  /**
   * 获取服务端版本信息
   * @param extractPath 解压路径
   * @returns 版本信息
   */
  async getServerVersion(extractPath: string): Promise<string | null> {
    try {
      const serverExecutable = await this.findServerExecutable(extractPath);
      if (!serverExecutable) {
        return null;
      }

      const { exec } = require('child_process');
      const execPromise = promisify(exec);
      const { stdout } = await execPromise(`"${serverExecutable}" --version`);

      return stdout.trim();
    } catch (error) {
      return null;
    }
  }
}