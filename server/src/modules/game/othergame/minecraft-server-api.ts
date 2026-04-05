import axios from 'axios';
import fs from '../../../utils/fsExtraCompat.js';
import { promises as fsPromises, existsSync, readdirSync } from 'fs';
import { createWriteStream } from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

// ==================== 类型定义 ====================

// API响应类型定义
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// 服务器分类数据类型
export interface ServerClassifyData {
  pluginsCore: string[];
  pluginsAndModsCore_Forge: string[];
  pluginsAndModsCore_Fabric: string[];
  modsCore_Forge: string[];
  modsCore_Fabric: string[];
  vanillaCore: string[];
  bedrockCore: string[];
  proxyCore: string[];
}

// 版本列表数据类型
export interface VersionListData {
  versionList: string[];
}

// 下载数据类型
export interface DownloadData {
  url: string;
  sha256: string;
}

// 服务器分类选项
export interface ServerCategory {
  name: string;
  displayName: string;
  servers: string[];
}

// 下载选项配置
export interface DownloadOptions {
  server: string; // 指定服务端
  version: string; // 指定版本
  targetDirectory?: string; // 指定目标目录，默认为 './minecraft-server'
  skipJavaCheck?: boolean; // 跳过Java环境检查
  skipServerRun?: boolean; // 跳过服务端运行
  silent?: boolean; // 静默模式，不输出日志
}

// 下载进度回调
export interface DownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;
export type LogCallback = (message: string, type?: 'info' | 'error' | 'success' | 'warn') => void;

// ==================== API服务类 ====================

export class ApiService {
  private static readonly BASE_URL = 'https://api.mslmc.cn/v3';

  /**
   * 获取服务器分类核心列表
   */
  static async getServerClassify(): Promise<ServerClassifyData> {
    try {
      const response = await axios.get<ApiResponse<ServerClassifyData>>(
        `${this.BASE_URL}/query/server_classify`
      );
      
      if (response.data.code !== 200) {
        throw new Error(`API错误: ${response.data.message}`);
      }
      
      return response.data.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`网络请求失败: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 查询特定服务端支持的MC版本
   */
  static async getAvailableVersions(server: string): Promise<string[]> {
    try {
      const response = await axios.get<ApiResponse<VersionListData>>(
        `${this.BASE_URL}/query/available_versions/${server}`
      );
      
      if (response.data.code !== 200) {
        throw new Error(`API错误: ${response.data.message}`);
      }
      
      return response.data.data.versionList;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`网络请求失败: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 获取服务端下载地址
   */
  static async getDownloadUrl(server: string, version: string): Promise<DownloadData> {
    try {
      const response = await axios.get<ApiResponse<DownloadData>>(
        `${this.BASE_URL}/download/server/${server}/${version}`
      );
      
      if (response.data.code !== 200) {
        throw new Error(`API错误: ${response.data.message}`);
      }
      
      return response.data.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`网络请求失败: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 下载文件
   */
  static async downloadFile(
    url: string, 
    filePath: string, 
    onProgress?: ProgressCallback,
    onLog?: LogCallback
  ): Promise<void> {
    try {
      if (onLog && !onLog.length) {
        onLog('开始下载文件...', 'info');
      }
      
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 300000, // 5分钟超时
        onDownloadProgress: (progressEvent) => {
          if (progressEvent.total && onProgress) {
            const percentage = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress({
              loaded: progressEvent.loaded,
              total: progressEvent.total,
              percentage
            });
          }
        }
      });

      const writer = createWriteStream(filePath);
      
      response.data.pipe(writer);
      
      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          if (onLog) {
            onLog('文件下载完成!', 'success');
          }
          resolve();
        });
        writer.on('error', (error: Error) => {
          if (onLog) {
            onLog('文件写入失败!', 'error');
          }
          reject(error);
        });
        
        // 添加超时处理
        const timeout = setTimeout(() => {
          writer.destroy();
          reject(new Error('下载超时'));
        }, 300000);
        
        writer.on('finish', () => clearTimeout(timeout));
        writer.on('error', () => clearTimeout(timeout));
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw new Error('下载超时，请检查网络连接');
        }
        throw new Error(`文件下载失败: ${error.message}`);
      }
      throw error;
    }
  }
}

// ==================== 文件管理类 ====================

export class FileManager {
  private static tempDir = path.join(process.cwd(), 'temp-minecraft-server');

  /**
   * 规范化路径，确保跨平台兼容性
   */
  static normalizePath(inputPath: string): string {
    // 处理相对路径
    if (!path.isAbsolute(inputPath)) {
      inputPath = path.resolve(process.cwd(), inputPath);
    }
    // 规范化路径分隔符
    return path.normalize(inputPath);
  }

  /**
   * 检查目录权限（Linux/Unix系统）
   */
  static async checkDirectoryPermissions(dirPath: string): Promise<boolean> {
    try {
      // 尝试在目录中创建一个临时文件来测试写权限
      const testFile = path.join(dirPath, '.write-test-' + Date.now());
      await fsPromises.writeFile(testFile, 'test');
      await fs.remove(testFile);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 创建临时目录
   */
  static async createTempDirectory(): Promise<string> {
    await fs.ensureDir(this.tempDir);
    return this.tempDir;
  }

  /**
   * 获取服务端jar文件路径
   */
  static getServerJarPath(server: string, version: string): string {
    return path.join(this.tempDir, `${server}-${version}.jar`);
  }

  /**
   * 检查文件是否存在
   */
  static async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查是否为forge或neoforge安装器
   */
  static isForgeInstaller(jarPath: string): boolean {
    const fileName = path.basename(jarPath).toLowerCase();
    return fileName.startsWith('forge-') || fileName.startsWith('neoforge-');
  }

  /**
   * 运行forge/neoforge安装器
   */
  static async runForgeInstaller(jarPath: string, onLog?: LogCallback): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (onLog) {
        onLog('检测到Forge/NeoForge安装器，正在执行静默安装...', 'info');
      }
      
      const installerProcess: ChildProcess = spawn('java', ['-jar', path.basename(jarPath), '--installServer'], {
        cwd: path.dirname(jarPath),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let installerCompleted = false;

      // 监听标准输出
      installerProcess.stdout?.on('data', async (data: Buffer) => {
        const output = data.toString();
        if (onLog) {
          onLog(output, 'info');
        }
        
        // 检测安装完成标志
        if (output.includes('You can delete this installer file now if you wish')) {
          installerCompleted = true;
          if (onLog) {
            onLog('Forge/NeoForge安装器安装完成，准备运行服务端...', 'success');
          }
          
          // 立即运行服务端脚本，不等待安装器进程退出
          try {
            if (onLog) {
              onLog(`开始调用runForgeServer，目录: ${path.dirname(jarPath)}`, 'info');
            }
            await this.runForgeServer(path.dirname(jarPath), onLog);
            if (onLog) {
              onLog('runForgeServer执行完成', 'success');
            }
            // 强制关闭安装器进程
            if (!installerProcess.killed) {
              installerProcess.kill('SIGTERM');
            }
            resolve();
          } catch (error) {
            if (onLog) {
              onLog(`runForgeServer执行失败: ${error}`, 'error');
            }
            if (!installerProcess.killed) {
              installerProcess.kill('SIGTERM');
            }
            reject(error);
          }
        }
      });

      // 监听标准错误
      installerProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        if (onLog) {
          onLog(output, 'error');
        }
      });

      // 监听进程退出
      installerProcess.on('close', async (code: number | null) => {
        // 如果已经在输出监听中处理了完成逻辑，则直接返回
        if (installerCompleted) {
          if (onLog) {
            onLog('Forge/NeoForge安装器进程已退出。', 'info');
          }
          return;
        }
        
        if (code === 0) {
          if (onLog) {
            onLog('Forge/NeoForge安装器执行完成，但未检测到完成标志。', 'warn');
          }
          resolve();
        } else {
          reject(new Error(`Forge/NeoForge安装器异常退出，退出码: ${code}`));
        }
      });

      // 监听进程错误
      installerProcess.on('error', (error: Error) => {
        reject(new Error(`启动Forge/NeoForge安装器失败: ${error.message}`));
      });

      // 设置超时（10分钟）
      setTimeout(() => {
        if (!installerProcess.killed) {
          if (onLog) {
            onLog('Forge/NeoForge安装器运行超时，正在强制关闭...', 'warn');
          }
          installerProcess.kill('SIGKILL');
          resolve();
        }
      }, 10 * 60 * 1000);
    });
  }

  /**
   * 运行forge/neoforge服务端直到EULA协议出现
   */
  static async runForgeServer(serverDir: string, onLog?: LogCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      // 根据操作系统选择启动脚本
      const isWindows = process.platform === 'win32';
      const scriptName = isWindows ? 'run.bat' : 'run.sh';
      const scriptPath = path.join(serverDir, scriptName);
      
      if (onLog) {
        onLog(`正在检查启动脚本: ${scriptPath}`, 'info');
      }
      
      // 检查启动脚本是否存在
      if (!existsSync(scriptPath)) {
        if (onLog) {
          onLog(`启动脚本${scriptName}不存在于目录${serverDir}，跳过服务端运行`, 'warn');
          // 列出目录中的文件以便调试
          try {
            const files = readdirSync(serverDir);
            onLog(`目录${serverDir}中的文件: ${files.join(', ')}`, 'info');
          } catch (err) {
            onLog(`无法读取目录${serverDir}: ${err}`, 'error');
          }
        }
        resolve();
        return;
      }
      
      if (onLog) {
        onLog(`找到启动脚本${scriptName}，正在运行...`, 'info');
      }
      
      const serverProcess: ChildProcess = isWindows 
        ? spawn('cmd', ['/c', scriptName], {
            cwd: serverDir,
            stdio: ['pipe', 'pipe', 'pipe']
          })
        : spawn('bash', [scriptName], {
            cwd: serverDir,
            stdio: ['pipe', 'pipe', 'pipe']
          });

      let hasEulaMessage = false;

      // 监听标准输出
      serverProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        if (onLog) {
          onLog(output, 'info');
        }
        
        // 检查是否出现EULA相关信息
        if (output.toLowerCase().includes('eula') || 
            output.toLowerCase().includes('you need to agree to the eula')) {
          hasEulaMessage = true;
          if (onLog) {
            onLog('检测到EULA协议提示，正在关闭服务端...', 'info');
          }
          serverProcess.kill('SIGTERM');
        }
      });

      // 监听标准错误
      serverProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        if (onLog) {
          onLog(output, 'error');
        }
        
        if (output.toLowerCase().includes('eula')) {
          hasEulaMessage = true;
          if (onLog) {
            onLog('检测到EULA协议提示，正在关闭服务端...', 'info');
          }
          serverProcess.kill('SIGTERM');
        }
      });

      // 监听进程退出
      serverProcess.on('close', (code: number | null) => {
        if (hasEulaMessage) {
          if (onLog) {
            onLog('服务端已关闭，EULA协议检测完成。', 'success');
          }
          resolve();
        } else if (code === 0) {
          if (onLog) {
            onLog('服务端正常退出。', 'success');
          }
          resolve();
        } else {
          if (onLog) {
            onLog(`服务端退出，退出码: ${code}`, 'info');
          }
          resolve();
        }
      });

      // 监听进程错误
      serverProcess.on('error', (error: Error) => {
        if (onLog) {
          onLog(`启动服务端失败: ${error.message}`, 'error');
        }
        resolve(); // 不抛出错误，继续执行
      });

      // 设置超时（10分钟）
      setTimeout(() => {
        if (!serverProcess.killed) {
          if (onLog) {
            onLog('服务端运行超时，正在强制关闭...', 'warn');
          }
          serverProcess.kill('SIGKILL');
          resolve();
        }
      }, 10 * 60 * 1000);
    });
  }

  /**
   * 运行服务端直到EULA协议出现
   */
  static async runServerUntilEula(jarPath: string, onLog?: LogCallback): Promise<void> {
    // 检查是否为forge或neoforge安装器
    if (this.isForgeInstaller(jarPath)) {
      return this.runForgeInstaller(jarPath, onLog);
    }

    return new Promise((resolve, reject) => {
      if (onLog) {
        onLog('正在启动服务端...', 'info');
      }
      
      const serverProcess: ChildProcess = spawn('java', ['-jar', path.basename(jarPath)], {
        cwd: path.dirname(jarPath),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let hasEulaMessage = false;

      // 监听标准输出
      serverProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        if (onLog) {
          onLog(output, 'info');
        }
        
        // 检查是否出现EULA相关信息
        if (output.toLowerCase().includes('eula') || 
            output.toLowerCase().includes('you need to agree to the eula')) {
          hasEulaMessage = true;
          if (onLog) {
            onLog('检测到EULA协议提示，正在关闭服务端...', 'info');
          }
          serverProcess.kill('SIGTERM');
        }
      });

      // 监听标准错误
      serverProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        if (onLog) {
          onLog(output, 'error');
        }
        
        if (output.toLowerCase().includes('eula')) {
          hasEulaMessage = true;
          if (onLog) {
            onLog('检测到EULA协议提示，正在关闭服务端...', 'info');
          }
          serverProcess.kill('SIGTERM');
        }
      });

      // 监听进程退出
      serverProcess.on('close', (code: number | null) => {
        if (hasEulaMessage) {
          if (onLog) {
            onLog('服务端已关闭，EULA协议检测完成。', 'success');
          }
          resolve();
        } else if (code === 0) {
          if (onLog) {
            onLog('服务端正常退出。', 'success');
          }
          resolve();
        } else {
          reject(new Error(`服务端异常退出，退出码: ${code}`));
        }
      });

      // 监听进程错误
      serverProcess.on('error', (error: Error) => {
        reject(new Error(`启动服务端失败: ${error.message}`));
      });

      // 设置超时（10分钟）
      setTimeout(() => {
        if (!serverProcess.killed) {
          if (onLog) {
            onLog('服务端运行超时，正在强制关闭...', 'warn');
          }
          serverProcess.kill('SIGKILL');
          resolve();
        }
      }, 10 * 60 * 1000);
    });
  }

  /**
   * 移动文件到目标目录
   */
  static async moveFilesToTarget(targetDir: string, onLog?: LogCallback): Promise<void> {
    // 规范化目标目录路径
    const normalizedTargetDir = this.normalizePath(targetDir);
    
    // 确保目标目录存在
    await fs.ensureDir(normalizedTargetDir);
    
    // 检查目录权限（特别是在Linux环境下）
    const hasPermission = await this.checkDirectoryPermissions(normalizedTargetDir);
    if (!hasPermission) {
      throw new Error(`目标目录没有写权限: ${normalizedTargetDir}。请检查目录权限或使用sudo运行。`);
    }
    
    // 获取临时目录中的所有文件
    const files = await fsPromises.readdir(this.tempDir);
    
    if (onLog) {
      onLog(`正在移动 ${files.length} 个文件到目标目录: ${normalizedTargetDir}`, 'info');
    }
    
    for (const file of files) {
      const sourcePath = path.join(this.tempDir, file);
      const targetPath = path.join(normalizedTargetDir, file);
      
      try {
        // 检查源文件是否存在
        const sourceExists = await this.fileExists(sourcePath);
        if (!sourceExists) {
          if (onLog) {
            onLog(`跳过不存在的文件: ${file}`, 'warn');
          }
          continue;
        }
        
        // 统一使用move操作，无论是文件还是目录
        await fs.move(sourcePath, targetPath, { overwrite: true });
        
        // 验证移动是否成功
        const targetExists = await this.fileExists(targetPath);
        if (!targetExists) {
          throw new Error(`文件移动后验证失败: ${file}`);
        }
        
        const stat = await fsPromises.stat(targetPath);
        if (stat.isFile()) {
          if (onLog) {
            onLog(`已移动文件: ${file}`, 'info');
          }
        } else if (stat.isDirectory()) {
          if (onLog) {
            onLog(`已移动目录: ${file}`, 'info');
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (onLog) {
          onLog(`移动失败: ${file} - ${errorMessage}`, 'error');
        }
        
        // 在Linux环境下，提供更详细的错误信息
        if (process.platform !== 'win32' && errorMessage.includes('EACCES')) {
          throw new Error(`权限被拒绝，无法移动文件 ${file}。请检查文件权限或使用sudo运行。`);
        } else if (errorMessage.includes('ENOSPC')) {
          throw new Error(`磁盘空间不足，无法移动文件 ${file}。`);
        } else if (errorMessage.includes('EXDEV')) {
          throw new Error(`跨设备移动文件失败 ${file}。尝试复制后删除源文件。`);
        }
        
        throw new Error(`移动文件失败: ${file} - ${errorMessage}`);
      }
    }
  }

  /**
   * 清理临时目录
   */
  static async cleanupTempDirectory(onLog?: LogCallback): Promise<void> {
    try {
      if (await this.fileExists(this.tempDir)) {
        await fs.remove(this.tempDir);
        if (onLog) {
          onLog('临时目录已清理。', 'info');
        }
      }
    } catch (error) {
      if (onLog) {
        onLog(`清理临时目录时出现警告: ${error}`, 'warn');
      }
    }
  }

  /**
   * 强制清理指定临时目录
   */
  static async forceCleanupDirectory(dirPath: string, onLog?: LogCallback): Promise<void> {
    try {
      if (await this.fileExists(dirPath)) {
        await fs.remove(dirPath);
        if (onLog) {
          onLog(`已清理目录: ${dirPath}`, 'info');
        }
      }
    } catch (error) {
      if (onLog) {
        onLog(`清理目录时出现警告: ${dirPath} - ${error}`, 'warn');
      }
    }
  }

  /**
   * 获取临时目录路径
   */
  static getTempDirectory(): string {
    return this.tempDir;
  }

  /**
   * 验证Java环境
   */
  static async validateJavaEnvironment(): Promise<boolean> {
    return new Promise((resolve) => {
      const javaProcess = spawn('java', ['-version'], { stdio: 'pipe' });
      
      javaProcess.on('close', (code) => {
        resolve(code === 0);
      });
      
      javaProcess.on('error', () => {
        resolve(false);
      });
    });
  }
}

// ==================== 主要下载器类 ====================

/**
 * Minecraft服务端核心下载工具 - 纯API版本
 * 专为模块集成设计，无交互式界面
 */
export class MinecraftServerDownloader {
  private onProgress?: ProgressCallback;
  private onLog?: LogCallback;
  private cancelled: boolean = false;
  private currentProcess?: ChildProcess;
  private tempDir?: string;

  constructor(onProgress?: ProgressCallback, onLog?: LogCallback) {
    this.onProgress = onProgress;
    this.onLog = onLog;
  }

  /**
   * 取消当前下载/部署操作
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
    
    // 清理临时目录
    if (this.tempDir) {
      FileManager.cleanupTempDirectory(this.onLog).catch(() => {
        // 忽略清理错误
      });
    }
    
    if (this.onLog) {
      this.onLog('Minecraft服务端部署已取消', 'warn');
    }
  }

  /**
   * 检查是否已取消
   */
  isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * 下载服务端
   * @param options 下载选项
   */
  async downloadServer(options: DownloadOptions): Promise<void> {
    const {
      server,
      version,
      targetDirectory = './minecraft-server',
      skipJavaCheck = false,
      skipServerRun = false,
      silent = false
    } = options;

    // 规范化目标目录路径，确保跨平台兼容性
    const normalizedTargetDirectory = FileManager.normalizePath(targetDirectory);

    const log = silent ? undefined : this.onLog;
    this.cancelled = false; // 重置取消状态

    try {
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      // 验证Java环境（除非跳过）
      if (!skipJavaCheck) {
        if (log) log('检查Java环境...', 'info');
        const hasJava = await FileManager.validateJavaEnvironment();
        if (!hasJava) {
          throw new Error('未检测到Java环境，请确保已安装Java并添加到PATH环境变量中。');
        }
        if (log) log('Java环境检查通过。', 'success');
      }

      if (!server || !version) {
        throw new Error('缺少必要参数：server 和 version');
      }

      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      // 创建临时目录
      if (log) log('创建临时工作目录...', 'info');
      this.tempDir = await FileManager.createTempDirectory();
      if (log) log(`临时目录创建成功: ${this.tempDir}`, 'success');
      
      try {
        // 检查是否已取消
        if (this.cancelled) {
          throw new Error('操作已取消');
        }

        // 获取下载地址
        if (log) log('正在获取下载地址...', 'info');
        const downloadData = await ApiService.getDownloadUrl(server, version);
        if (log) log('下载地址获取成功。', 'success');
        
        // 检查是否已取消
        if (this.cancelled) {
          throw new Error('操作已取消');
        }

        // 下载服务端核心
        const jarPath = FileManager.getServerJarPath(server, version);
        if (log) log(`正在下载服务端核心到: ${jarPath}`, 'info');
        await ApiService.downloadFile(downloadData.url, jarPath, this.onProgress, log);
        if (log) log('服务端核心下载完成。', 'success');
        
        // 检查是否已取消
        if (this.cancelled) {
          throw new Error('操作已取消');
        }

        // 运行服务端直到EULA协议（除非跳过）
        if (!skipServerRun) {
          if (log) log('正在运行服务端核心...', 'info');
          if (log) log('注意: 服务端将运行直到出现EULA协议提示，然后自动关闭。', 'info');
          this.currentProcess = await this.runServerUntilEulaWithCancel(jarPath, log);
          if (log) log('服务端运行完成。', 'success');
        }
        
        // 检查是否已取消
        if (this.cancelled) {
          throw new Error('操作已取消');
        }

        // 移动文件到目标目录
        if (log) log(`正在移动文件到目标目录: ${normalizedTargetDirectory}`, 'info');
        await FileManager.moveFilesToTarget(normalizedTargetDirectory, log);
        if (log) log('文件移动完成。', 'success');
        
      } finally {
        // 清理临时目录
        if (log) log('正在清理临时文件...', 'info');
        await FileManager.cleanupTempDirectory(log);
        if (log) log('临时文件清理完成。', 'success');
        this.tempDir = undefined;
      }
      
      if (!this.cancelled && log) {
        log('=== 所有操作完成 ===', 'success');
        log(`服务端文件已保存到: ${normalizedTargetDirectory}`, 'info');
        log('您现在可以在目标目录中找到服务端文件。', 'info');
        if (!skipServerRun) {
          log('如需同意EULA协议，请编辑 eula.txt 文件并将 eula=false 改为 eula=true', 'info');
        }
      }
      
    } catch (error) {
      // 确保清理临时目录
      try {
        await FileManager.cleanupTempDirectory();
        this.tempDir = undefined;
      } catch (cleanupError) {
        if (log) log(`清理临时目录时出现问题: ${cleanupError}`, 'warn');
      }
      
      throw error;
    }
  }

  /**
   * 获取可用的服务器分类
   */
  async getServerCategories(): Promise<ServerCategory[]> {
    const serverClassifyData = await ApiService.getServerClassify();
    return this.formatServerCategories(serverClassifyData);
  }

  /**
   * 获取指定服务端的可用版本
   */
  async getAvailableVersions(server: string): Promise<string[]> {
    return await ApiService.getAvailableVersions(server);
  }

  /**
   * 获取下载信息（不实际下载）
   */
  async getDownloadInfo(server: string, version: string): Promise<DownloadData> {
    return await ApiService.getDownloadUrl(server, version);
  }

  /**
   * 运行forge/neoforge安装器（支持取消）
   */
  private async runForgeInstallerWithCancel(jarPath: string, onLog?: LogCallback): Promise<ChildProcess | undefined> {
    return new Promise((resolve, reject) => {
      if (this.cancelled) {
        reject(new Error('操作已取消'));
        return;
      }

      if (onLog) {
        onLog('检测到Forge/NeoForge安装器，正在执行静默安装...', 'info');
      }
      
      const installerProcess: ChildProcess = spawn('java', ['-jar', path.basename(jarPath), '--installServer'], {
        cwd: path.dirname(jarPath),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.currentProcess = installerProcess;

      // 监听标准输出
      installerProcess.stdout?.on('data', (data: Buffer) => {
        if (this.cancelled) {
          installerProcess.kill('SIGTERM');
          return;
        }

        const output = data.toString();
        if (onLog) {
          onLog(output, 'info');
        }
      });

      // 监听标准错误
      installerProcess.stderr?.on('data', (data: Buffer) => {
        if (this.cancelled) {
          installerProcess.kill('SIGTERM');
          return;
        }

        const output = data.toString();
        if (onLog) {
          onLog(output, 'error');
        }
      });

      // 监听进程退出
      installerProcess.on('close', (code: number | null) => {
        this.currentProcess = undefined;
        
        if (this.cancelled) {
          reject(new Error('操作已取消'));
          return;
        }

        if (code === 0) {
          if (onLog) {
            onLog('Forge/NeoForge安装器执行完成。', 'success');
          }
          resolve(installerProcess);
        } else {
          reject(new Error(`Forge/NeoForge安装器异常退出，退出码: ${code}`));
        }
      });

      // 监听进程错误
      installerProcess.on('error', (error: Error) => {
        this.currentProcess = undefined;
        reject(new Error(`启动Forge/NeoForge安装器失败: ${error.message}`));
      });

      // 设置超时（10分钟）
      setTimeout(() => {
        if (!installerProcess.killed && !this.cancelled) {
          if (onLog) {
            onLog('Forge/NeoForge安装器运行超时，正在强制关闭...', 'warn');
          }
          installerProcess.kill('SIGKILL');
          this.currentProcess = undefined;
          resolve(installerProcess);
        }
      }, 10 * 60 * 1000);
    });
  }

  /**
   * 运行服务端直到EULA协议（支持取消）
   */
  private async runServerUntilEulaWithCancel(jarPath: string, onLog?: LogCallback): Promise<ChildProcess | undefined> {
    // 检查是否为forge或neoforge安装器
    if (FileManager.isForgeInstaller(jarPath)) {
      return this.runForgeInstallerWithCancel(jarPath, onLog);
    }

    return new Promise((resolve, reject) => {
      if (this.cancelled) {
        reject(new Error('操作已取消'));
        return;
      }

      if (onLog) {
        onLog('正在启动服务端...', 'info');
      }
      
      const serverProcess: ChildProcess = spawn('java', ['-jar', path.basename(jarPath)], {
        cwd: path.dirname(jarPath),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.currentProcess = serverProcess;
      let hasEulaMessage = false;

      // 监听标准输出
      serverProcess.stdout?.on('data', (data: Buffer) => {
        if (this.cancelled) {
          serverProcess.kill('SIGTERM');
          return;
        }

        const output = data.toString();
        if (onLog) {
          onLog(output, 'info');
        }
        
        // 检查是否出现EULA相关信息
        if (output.toLowerCase().includes('eula') || 
            output.toLowerCase().includes('you need to agree to the eula')) {
          hasEulaMessage = true;
          if (onLog) {
            onLog('检测到EULA协议提示，正在关闭服务端...', 'info');
          }
          serverProcess.kill('SIGTERM');
        }
      });

      // 监听标准错误
      serverProcess.stderr?.on('data', (data: Buffer) => {
        if (this.cancelled) {
          serverProcess.kill('SIGTERM');
          return;
        }

        const output = data.toString();
        if (onLog) {
          onLog(output, 'error');
        }
        
        if (output.toLowerCase().includes('eula')) {
          hasEulaMessage = true;
          if (onLog) {
            onLog('检测到EULA协议提示，正在关闭服务端...', 'info');
          }
          serverProcess.kill('SIGTERM');
        }
      });

      // 监听进程退出
      serverProcess.on('close', (code: number | null) => {
        this.currentProcess = undefined;
        
        if (this.cancelled) {
          reject(new Error('操作已取消'));
          return;
        }

        if (hasEulaMessage) {
          if (onLog) {
            onLog('服务端已关闭，EULA协议检测完成。', 'success');
          }
          resolve(serverProcess);
        } else if (code === 0) {
          if (onLog) {
            onLog('服务端正常退出。', 'success');
          }
          resolve(serverProcess);
        } else {
          reject(new Error(`服务端异常退出，退出码: ${code}`));
        }
      });

      // 监听进程错误
      serverProcess.on('error', (error: Error) => {
        this.currentProcess = undefined;
        reject(new Error(`启动服务端失败: ${error.message}`));
      });

      // 设置超时（10分钟）
      setTimeout(() => {
        if (!serverProcess.killed && !this.cancelled) {
          if (onLog) {
            onLog('服务端运行超时，正在强制关闭...', 'warn');
          }
          serverProcess.kill('SIGKILL');
          this.currentProcess = undefined;
          resolve(serverProcess);
        }
      }, 10 * 60 * 1000);
    });
  }

  /**
   * 验证Java环境
   */
  async validateJava(): Promise<boolean> {
    return await FileManager.validateJavaEnvironment();
  }

  /**
   * 将服务器分类数据转换为用户友好的格式
   */
  private formatServerCategories(data: ServerClassifyData): ServerCategory[] {
    const categories = [
      {
        name: 'pluginsCore',
        displayName: '插件服务端核心',
        servers: data.pluginsCore || []
      },
      {
        name: 'pluginsAndModsCore_Forge',
        displayName: '插件+模组服务端核心 (Forge)',
        servers: data.pluginsAndModsCore_Forge || []
      },
      {
        name: 'pluginsAndModsCore_Fabric',
        displayName: '插件+模组服务端核心 (Fabric)',
        servers: data.pluginsAndModsCore_Fabric || []
      },
      {
        name: 'modsCore_Forge',
        displayName: '模组服务端核心 (Forge)',
        servers: data.modsCore_Forge || []
      },
      {
        name: 'modsCore_Fabric',
        displayName: '模组服务端核心 (Fabric)',
        servers: data.modsCore_Fabric || []
      },
      {
        name: 'vanillaCore',
        displayName: '原版服务端核心',
        servers: data.vanillaCore || []
      },
      {
        name: 'bedrockCore',
        displayName: '基岩版服务端核心',
        servers: data.bedrockCore || []
      },
      {
        name: 'proxyCore',
        displayName: '代理服务端核心',
        servers: data.proxyCore || []
      }
    ];
    
    // 过滤掉没有服务器的分类
    return categories.filter(cat => cat.servers.length > 0);
  }
}

// ==================== 便捷函数 ====================

/**
 * 快速下载指定服务端
 * @param server 服务端名称
 * @param version MC版本
 * @param targetDirectory 目标目录
 * @param options 额外选项
 */
export async function downloadMinecraftServer(
  server: string,
  version: string,
  targetDirectory?: string,
  options?: Partial<DownloadOptions>
): Promise<void> {
  const downloader = new MinecraftServerDownloader();
  await downloader.downloadServer({
    server,
    version,
    targetDirectory,
    ...options
  });
}

/**
 * 获取所有可用的服务器分类
 */
export async function getServerCategories(): Promise<ServerCategory[]> {
  const downloader = new MinecraftServerDownloader();
  return await downloader.getServerCategories();
}

/**
 * 获取指定服务端的可用版本
 */
export async function getAvailableVersions(server: string): Promise<string[]> {
  const downloader = new MinecraftServerDownloader();
  return await downloader.getAvailableVersions(server);
}

/**
 * 获取下载信息（不实际下载）
 */
export async function getDownloadInfo(server: string, version: string): Promise<DownloadData> {
  const downloader = new MinecraftServerDownloader();
  return await downloader.getDownloadInfo(server, version);
}

/**
 * 验证Java环境
 */
export async function validateJavaEnvironment(): Promise<boolean> {
  return await FileManager.validateJavaEnvironment();
}

// 默认导出主类
export default MinecraftServerDownloader;
