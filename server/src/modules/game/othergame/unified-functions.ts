// ==================== 统一游戏服务器管理函数库 ====================
// 根据GSM3-模块对接文档重构，提供纯函数调用接口
// 移除所有API相关代码，专注于核心功能

import axios from 'axios';
import * as fs from 'fs-extra';
import { createWriteStream, mkdtemp } from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import * as yauzl from 'yauzl';
import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import * as tar from 'tar';
import { MrpackServerAPI } from './mrpack-server-api.js';
import { FileManager } from './minecraft-server-api.js';
import { pipeline } from 'stream';
import { promisify } from 'util';

// 创建promisify版本的mkdtemp
const mkdtempAsync = promisify(mkdtemp);

// 使用传统的 stream pipeline 方法，避免 promisify 导致的编译问题
const streamPipeline = (source: any, destination: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    pipeline(source, destination, (error: Error | null) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
};

// ==================== 通用类型定义 ====================

export type LogLevel = 'info' | 'error' | 'success' | 'warn';
export type LogCallback = (message: string, type?: LogLevel) => void;
// 下载进度接口
export interface DownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;
export type GameType = 'minecraft' | 'tmodloader' | 'factorio' | 'mrpack';

// ==================== 取消部署相关类型 ====================

export interface CancellationToken {
  isCancelled: boolean;
  cancel(): void;
  onCancelled(callback: () => void): void;
  throwIfCancelled(): void;
}

export interface ActiveDeployment {
  id: string;
  game: GameType;
  targetDirectory: string;
  startTime: Date;
  tempDirectories: string[];
  processes: ChildProcess[];
  cancellationToken: CancellationToken;
  onProgress?: LogCallback;
}

export interface DeploymentManager {
  activeDeployments: Map<string, ActiveDeployment>;
  createDeployment(game: GameType, targetDirectory: string, onProgress?: LogCallback, deploymentId?: string): ActiveDeployment;
  cancelDeployment(deploymentId: string): Promise<boolean>;
  cancelAllDeployments(): Promise<number>;
  getActiveDeployments(): ActiveDeployment[];
  cleanupDeployment(deploymentId: string): Promise<void>;
}

// ==================== Minecraft 相关类型 ====================

export interface MinecraftServerInfo {
  name: string;
  displayName: string;
}

export interface MinecraftServerCategory {
  name: string;
  displayName: string;
  servers: MinecraftServerInfo[];
}

export interface MinecraftDownloadData {
  url: string;
  filename: string;
  size?: number;
}

export interface MinecraftDeployOptions {
  server: string;
  version: string;
  targetDirectory: string;
  deploymentId?: string;
  skipJavaCheck?: boolean;
  skipServerRun?: boolean;
  onProgress?: ProgressCallback;
  onLog?: LogCallback;
}

// ==================== tModLoader 相关类型 ====================

export interface TModLoaderOptions {
  downloadDir?: string;
  extractDir?: string;
  deleteAfterExtract?: boolean;
  clearExtractDir?: boolean;
  createVersionDir?: boolean;
}

export interface TModLoaderInfo {
  version: string;
  downloadUrl: string;
}

export interface TModLoaderDeployOptions {
  targetDirectory: string;
  options?: TModLoaderOptions;
  deploymentId?: string;
  onProgress?: LogCallback;
}

// ==================== Factorio 相关类型 ====================

export interface FactorioDeployOptions {
  targetDirectory: string;
  tempDir?: string;
  deploymentId?: string;
  onProgress?: LogCallback;
}

// ==================== Mrpack 相关类型 ====================

export interface MrpackSearchOptions {
  query?: string;
  categories?: string[];
  versions?: string[];
  license?: string;
  limit?: number;
  offset?: number;
  index?: string;
}

export interface MrpackProject {
  project_id: string;
  slug: string;
  author: string;
  title: string;
  description: string;
  categories: string[];
  versions: string[];
  downloads: number;
  icon_url?: string;
  latest_version?: string;
}

export interface MrpackSearchResponse {
  hits: MrpackProject[];
  offset: number;
  limit: number;
  total_hits: number;
}

export interface MrpackDeployOptions {
  projectId?: string;
  versionId?: string;
  mrpackUrl?: string;
  targetDirectory: string;
  minecraftVersion?: string;
  loaderType?: 'forge' | 'fabric' | 'quilt';
  skipJavaCheck?: boolean;
  tempDir?: string;
  deploymentId?: string;
  options?: any;
  onProgress?: LogCallback;
  apiSource?: 'official' | 'mirror';
}

export interface MrpackIndex {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  summary?: string;
  files: MrpackFile[];
  dependencies: Record<string, string>;
}

export interface MrpackFile {
  path: string;
  hashes: {
    sha1: string;
    sha512?: string;
  };
  env?: {
    client?: string;
    server?: string;
  };
  downloads: string[];
  fileSize: number;
}

// ==================== 通用部署结果类型 ====================

export interface DeploymentResult {
  success: boolean;
  message: string;
  targetDirectory?: string;
  details?: any;
  deploymentId?: string;
}

// ==================== 取消令牌实现 ====================

class CancellationTokenImpl implements CancellationToken {
  private _isCancelled = false;
  private _callbacks: (() => void)[] = [];

  get isCancelled(): boolean {
    return this._isCancelled;
  }

  cancel(): void {
    if (!this._isCancelled) {
      this._isCancelled = true;
      this._callbacks.forEach(callback => {
        try {
          callback();
        } catch (error) {
          console.error('取消回调执行失败:', error);
        }
      });
      this._callbacks = [];
    }
  }

  onCancelled(callback: () => void): void {
    if (this._isCancelled) {
      callback();
    } else {
      this._callbacks.push(callback);
    }
  }

  throwIfCancelled(): void {
    if (this._isCancelled) {
      throw new Error('操作已被取消');
    }
  }
}

// ==================== 部署管理器实现 ====================

class DeploymentManagerImpl implements DeploymentManager {
  public activeDeployments = new Map<string, ActiveDeployment>();
  private deploymentCounter = 0;

  createDeployment(game: GameType, targetDirectory: string, onProgress?: LogCallback, deploymentId?: string): ActiveDeployment {
    const finalDeploymentId = deploymentId || `deploy_${++this.deploymentCounter}_${Date.now()}`;
    const cancellationToken = new CancellationTokenImpl();
    
    const deployment: ActiveDeployment = {
      id: finalDeploymentId,
      game,
      targetDirectory,
      startTime: new Date(),
      tempDirectories: [],
      processes: [],
      cancellationToken,
      onProgress
    };
    
    this.activeDeployments.set(finalDeploymentId, deployment);
    return deployment;
  }

  async cancelDeployment(deploymentId: string): Promise<boolean> {
    const deployment = this.activeDeployments.get(deploymentId);
    if (!deployment) {
      return false;
    }

    try {
      // 取消令牌
      deployment.cancellationToken.cancel();
      
      // 终止所有进程
      for (const process of deployment.processes) {
        if (!process.killed) {
          process.kill('SIGTERM');
          // 如果SIGTERM无效，使用SIGKILL
          setTimeout(() => {
            if (!process.killed) {
              process.kill('SIGKILL');
            }
          }, 5000);
        }
      }
      
      // 清理临时目录
      await this.cleanupDeployment(deploymentId);
      
      if (deployment.onProgress) {
        deployment.onProgress(`部署 ${deploymentId} 已取消`, 'warn');
      }
      
      return true;
    } catch (error) {
      console.error(`取消部署 ${deploymentId} 失败:`, error);
      return false;
    }
  }

  async cancelAllDeployments(): Promise<number> {
    const deploymentIds = Array.from(this.activeDeployments.keys());
    let cancelledCount = 0;
    
    for (const deploymentId of deploymentIds) {
      const success = await this.cancelDeployment(deploymentId);
      if (success) {
        cancelledCount++;
      }
    }
    
    return cancelledCount;
  }

  getActiveDeployments(): ActiveDeployment[] {
    return Array.from(this.activeDeployments.values());
  }

  async cleanupDeployment(deploymentId: string): Promise<void> {
    const deployment = this.activeDeployments.get(deploymentId);
    if (!deployment) {
      return;
    }

    try {
      // 清理临时目录
      for (const tempDir of deployment.tempDirectories) {
        try {
          if (await fs.pathExists(tempDir)) {
            await fs.remove(tempDir);
            if (deployment.onProgress) {
              deployment.onProgress(`已清理临时目录: ${tempDir}`, 'info');
            }
          }
        } catch (error) {
          console.error(`清理临时目录失败 ${tempDir}:`, error);
        }
      }
      
      // 从活动部署列表中移除
      this.activeDeployments.delete(deploymentId);
    } catch (error) {
      console.error(`清理部署 ${deploymentId} 失败:`, error);
    }
  }
}

// 全局部署管理器实例
const globalDeploymentManager = new DeploymentManagerImpl();

// ==================== 部署管理器导出函数 ====================

/**
 * 获取所有活动部署
 */
export function getActiveDeployments(): ActiveDeployment[] {
  return globalDeploymentManager.getActiveDeployments();
}

/**
 * 取消指定的部署
 * @param deploymentId 部署ID
 * @returns 是否成功取消
 */
export async function cancelDeployment(deploymentId: string): Promise<boolean> {
  return await globalDeploymentManager.cancelDeployment(deploymentId);
}

/**
 * 取消所有活动部署
 * @returns 成功取消的部署数量
 */
export async function cancelAllDeployments(): Promise<number> {
  return await globalDeploymentManager.cancelAllDeployments();
}

/**
 * 清理指定部署的临时文件
 * @param deploymentId 部署ID
 */
export async function cleanupDeployment(deploymentId: string): Promise<void> {
  return await globalDeploymentManager.cleanupDeployment(deploymentId);
}

/**
 * 创建临时目录并注册到部署管理器
 * @param deployment 活动部署对象
 * @param prefix 临时目录前缀
 * @returns 临时目录路径
 */
export async function createTempDirectory(deployment: ActiveDeployment, prefix: string = 'deploy_temp_'): Promise<string> {
  const tempDir = await mkdtempAsync(path.join(os.tmpdir(), prefix));
  deployment.tempDirectories.push(tempDir);
  return tempDir;
}

// ==================== Minecraft 服务器管理函数 ====================

/**
 * 获取Minecraft服务器分类列表
 */
export async function getMinecraftServerCategories(): Promise<MinecraftServerCategory[]> {
  try {
    // 使用minecraft-server-api.ts中的API服务
    const { getServerCategories } = await import('./minecraft-server-api.js');
    const categories = await getServerCategories();
    
    // 转换为统一函数库的格式
    return categories.map(cat => ({
      name: cat.name,
      displayName: cat.displayName,
      servers: cat.servers.map(server => ({
        name: server,
        displayName: server
      }))
    }));
  } catch (error) {
    throw new Error(`获取服务器分类失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 获取指定服务端的可用版本列表
 */
export async function getMinecraftVersions(server: string): Promise<string[]> {
  try {
    // 使用minecraft-server-api.ts中的API服务
    const { getAvailableVersions } = await import('./minecraft-server-api.js');
    return await getAvailableVersions(server);
  } catch (error) {
    throw new Error(`获取版本列表失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 获取Minecraft服务端下载信息
 */
export async function getMinecraftDownloadInfo(server: string, version: string): Promise<MinecraftDownloadData> {
  try {
    // 使用minecraft-server-api.ts中的API服务
    const { getDownloadInfo } = await import('./minecraft-server-api.js');
    const downloadData = await getDownloadInfo(server, version);
    return {
      url: downloadData.url,
      filename: `${server}-${version}.jar`,
      size: 0 // minecraft-server-api.ts的DownloadData接口没有size字段
    };
  } catch (error) {
    throw new Error(`获取下载信息失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 验证Java环境
 */
export async function validateJavaEnvironment(): Promise<boolean> {
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

/**
 * 下载文件
 */
export async function downloadFile(
  url: string, 
  filePath: string, 
  onProgress?: ProgressCallback, 
  onLog?: LogCallback
): Promise<void> {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const totalLength = parseInt(response.headers['content-length'] || '0', 10);
    let downloadedLength = 0;

    const writer = createWriteStream(filePath);
    
    response.data.on('data', (chunk: Buffer) => {
      downloadedLength += chunk.length;
      if (onProgress && totalLength > 0) {
        const percentage = Math.round((downloadedLength / totalLength) * 100);
        onProgress({
          loaded: downloadedLength,
          total: totalLength,
          percentage
        });
      }
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        if (onLog) onLog(`文件下载完成: ${filePath}`, 'success');
        resolve();
      });
      writer.on('error', reject);
    });
  } catch (error) {
    throw new Error(`下载文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 支持取消的下载文件函数
 */
export async function downloadFileWithCancellation(
  url: string, 
  filePath: string, 
  deployment: ActiveDeployment, 
  onProgress?: ProgressCallback, 
  onLog?: LogCallback
): Promise<void> {
  const controller = new AbortController();
  const writer = createWriteStream(filePath);

  deployment.cancellationToken.onCancelled(() => {
    if (onLog) onLog(`接收到取消信号，正在中止下载: ${url}`, 'warn');
    controller.abort();
  });

  try {
    deployment.cancellationToken.throwIfCancelled();
    
    if (onLog) onLog(`开始下载: ${url}`, 'info');
    
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      signal: controller.signal
    });

    const totalLength = parseInt(response.headers['content-length'] || '0', 10);
    let downloadedLength = 0;

    const stream = response.data.pipe(writer);

    response.data.on('data', (chunk: Buffer) => {
      // 这里的检查是双重保险，主要依赖于 controller.abort()
      if (deployment.cancellationToken.isCancelled) {
        response.data.destroy();
        return;
      }
      downloadedLength += chunk.length;
      if (onProgress && totalLength > 0) {
        const percentage = Math.round((downloadedLength / totalLength) * 100);
        onProgress({
          loaded: downloadedLength,
          total: totalLength,
          percentage
        });
      }
    });

    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', (err) => {
        // 当 controller.abort() 被调用时，这里会收到一个 'AbortError'
        if (err.name === 'AbortError') {
          if (onLog) onLog('下载已成功中止', 'info');
          reject(new Error('操作已被取消'));
        } else {
          reject(err);
        }
      });
    });

  } catch (error) {
    // 清理可能已创建的部分文件
    writer.end();
    try {
      await fsPromises.unlink(filePath);
    } catch (unlinkError) {
      // 忽略删除文件时的错误
    }

    if (error instanceof Error && (error.name === 'AbortError' || error.message === '操作已被取消')) {
       if (onLog) onLog(`下载被取消: ${url}`, 'warn');
      throw new Error('操作已被取消');
    }
    throw new Error(`下载文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 部署Minecraft服务器
 */
export async function deployMinecraftServer(options: MinecraftDeployOptions): Promise<DeploymentResult> {
  const { 
    server, 
    version, 
    targetDirectory, 
    deploymentId,
    skipJavaCheck = false, 
    skipServerRun = false,
    onProgress,
    onLog
  } = options;

  const deployment = globalDeploymentManager.createDeployment('minecraft', targetDirectory, onLog, deploymentId);
  const onLogCallback = (message: string, type?: LogLevel) => {
    if (onLog) onLog(message, type);
  };
  
  onLogCallback(`开始部署Minecraft服务器: ${server} ${version}`, 'info');
  onLogCallback(`部署ID: ${deployment.id}`, 'info');

  try {
    // 检查Java环境
    if (!skipJavaCheck) {
      onLogCallback('正在验证Java环境...', 'info');
      deployment.cancellationToken.throwIfCancelled();
      const javaValid = await validateJavaEnvironment();
      if (!javaValid) {
        throw new Error('Java环境未找到或无效。请确保已正确安装Java并配置了环境变量。');
      }
      onLogCallback('Java环境验证通过', 'success');
    } else {
      onLogCallback('已跳过Java环境验证', 'warn');
    }
    
    // 获取下载信息
    onLogCallback('正在获取下载地址...', 'info');
    deployment.cancellationToken.throwIfCancelled();
    const downloadData = await getMinecraftDownloadInfo(server, version);
    onLogCallback('下载地址获取成功。', 'success');
    
    // 确保目标目录存在
    await fs.ensureDir(targetDirectory);
    
    // 下载服务端核心
    const jarPath = path.join(targetDirectory, downloadData.filename);
    onLogCallback(`正在下载服务端核心到: ${jarPath}`, 'info');
    await downloadFileWithCancellation(downloadData.url, jarPath, deployment, onProgress, onLog);
    onLogCallback(`服务器JAR文件已成功下载到: ${jarPath}`, 'success');

    // 运行一次服务器以生成必要文件 (e.g., eula.txt)
    if (!skipServerRun) {
      onLogCallback('正在首次运行服务器以生成配置文件...', 'info');
      deployment.cancellationToken.throwIfCancelled();
      await runMinecraftServerWithCancellation(jarPath, deployment, onLog);
    } else {
      onLogCallback('已跳过首次运行服务器', 'warn');
    }

    onLogCallback('Minecraft服务器部署成功！', 'success');
    return { 
      success: true, 
      message: '部署成功',
      targetDirectory,
      deploymentId: deployment.id
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    onLogCallback(`部署失败: ${errorMessage}`, 'error');
    if (errorMessage.includes('操作已被取消')) {
      return { success: false, message: '部署已取消', deploymentId: deployment.id };
    }
    return { 
      success: false, 
      message: `部署失败: ${errorMessage}`,
      deploymentId: deployment.id
    };
  } finally {
    // 确保部署记录最终被清理
    await globalDeploymentManager.cleanupDeployment(deployment.id);
    onLogCallback(`部署 ${deployment.id} 清理完成。`, 'info');
  }
}

/**
 * 运行Minecraft服务器一次以生成配置文件
 */
async function runMinecraftServerOnce(jarPath: string, workingDir: string, onLog?: LogCallback): Promise<void> {
  return new Promise((resolve, reject) => {
    if (onLog) onLog('正在启动服务端...', 'info');
    
    const serverProcess = spawn('java', ['-jar', path.basename(jarPath)], {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let hasEulaMessage = false;

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      if (onLog) onLog(output, 'info');
      
      if (output.toLowerCase().includes('eula') || 
          output.toLowerCase().includes('you need to agree to the eula')) {
        hasEulaMessage = true;
        if (onLog) onLog('检测到EULA协议提示，正在关闭服务端...', 'info');
        serverProcess.kill('SIGTERM');
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      if (onLog) onLog(output, 'error');
      
      if (output.toLowerCase().includes('eula')) {
        hasEulaMessage = true;
        if (onLog) onLog('检测到EULA协议提示，正在关闭服务端...', 'info');
        serverProcess.kill('SIGTERM');
      }
    });

    serverProcess.on('close', (code: number | null) => {
      if (hasEulaMessage) {
        if (onLog) onLog('服务端已关闭，EULA协议检测完成。', 'success');
        resolve();
      } else if (code === 0) {
        if (onLog) onLog('服务端正常退出。', 'success');
        resolve();
      } else {
        reject(new Error(`服务端异常退出，退出码: ${code}`));
      }
    });

    serverProcess.on('error', (error: Error) => {
      reject(new Error(`启动服务端失败: ${error.message}`));
    });

    // 设置超时（5分钟）
    setTimeout(() => {
      if (!serverProcess.killed) {
        if (onLog) onLog('服务端运行超时，正在强制关闭...', 'warn');
        serverProcess.kill('SIGKILL');
        resolve();
      }
    }, 5 * 60 * 1000);
  });
}

/**
 * 支持取消的运行Minecraft服务器函数
 */
async function runMinecraftServerOnceWithCancellation(
  jarPath: string, 
  workingDir: string, 
  deployment: ActiveDeployment, 
  onLog?: LogCallback
): Promise<void> {
  return new Promise((resolve, reject) => {
    (deployment.cancellationToken as CancellationTokenImpl).throwIfCancelled();
    
    if (onLog) onLog('正在启动服务端...', 'info');
    
    const serverProcess = spawn('java', ['-jar', path.basename(jarPath)], {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // 将进程添加到部署管理器
    deployment.processes.push(serverProcess);

    let hasEulaMessage = false;
    let isResolved = false;

    // 注册取消回调
    deployment.cancellationToken.onCancelled(() => {
      if (!serverProcess.killed && !isResolved) {
        if (onLog) onLog('正在取消服务端运行...', 'warn');
        serverProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!serverProcess.killed) {
            serverProcess.kill('SIGKILL');
          }
        }, 5000);
        isResolved = true;
        reject(new Error('操作已被取消'));
      }
    });

    serverProcess.stdout?.on('data', (data: Buffer) => {
      if (deployment.cancellationToken.isCancelled) return;
      
      const output = data.toString();
      if (onLog) onLog(output, 'info');
      
      if (output.toLowerCase().includes('eula') || 
          output.toLowerCase().includes('you need to agree to the eula')) {
        hasEulaMessage = true;
        if (onLog) onLog('检测到EULA协议提示，正在关闭服务端...', 'info');
        serverProcess.kill('SIGTERM');
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      if (deployment.cancellationToken.isCancelled) return;
      
      const output = data.toString();
      if (onLog) onLog(output, 'error');
      
      if (output.toLowerCase().includes('eula')) {
        hasEulaMessage = true;
        if (onLog) onLog('检测到EULA协议提示，正在关闭服务端...', 'info');
        serverProcess.kill('SIGTERM');
      }
    });

    serverProcess.on('close', (code: number | null) => {
      if (isResolved) return;
      isResolved = true;
      
      // 从进程列表中移除
      const processIndex = deployment.processes.indexOf(serverProcess);
      if (processIndex > -1) {
        deployment.processes.splice(processIndex, 1);
      }
      
      if (deployment.cancellationToken.isCancelled) {
        reject(new Error('操作已被取消'));
        return;
      }
      
      if (hasEulaMessage) {
        if (onLog) onLog('服务端已关闭，EULA协议检测完成。', 'success');
        resolve();
      } else if (code === 0) {
        if (onLog) onLog('服务端正常退出。', 'success');
        resolve();
      } else {
        reject(new Error(`服务端异常退出，退出码: ${code}`));
      }
    });

    serverProcess.on('error', (error: Error) => {
      if (isResolved) return;
      isResolved = true;
      
      // 从进程列表中移除
      const processIndex = deployment.processes.indexOf(serverProcess);
      if (processIndex > -1) {
        deployment.processes.splice(processIndex, 1);
      }
      
      reject(new Error(`启动服务端失败: ${error.message}`));
    });

    // 设置超时（5分钟）
    setTimeout(() => {
      if (!serverProcess.killed && !isResolved) {
        if (onLog) onLog('服务端运行超时，正在强制关闭...', 'warn');
        serverProcess.kill('SIGKILL');
        isResolved = true;
        resolve();
      }
    }, 5 * 60 * 1000);
  });
}

/**
 * 使用MinecraftAPI运行服务器（支持取消和Forge/NeoForge安装器）
 */
async function runMinecraftServerWithCancellation(
  jarPath: string,
  deployment: ActiveDeployment,
  onLog?: LogCallback
): Promise<void> {
  return new Promise((resolve, reject) => {
    (deployment.cancellationToken as CancellationTokenImpl).throwIfCancelled();
    
    let isResolved = false;
    
    // 注册取消回调
    deployment.cancellationToken.onCancelled(() => {
      if (!isResolved) {
        if (onLog) onLog('正在取消服务端运行...', 'warn');
        isResolved = true;
        reject(new Error('操作已被取消'));
      }
    });
    
    // 使用FileManager运行服务器
     FileManager.runServerUntilEula(jarPath, onLog)
      .then(() => {
        if (!isResolved) {
          isResolved = true;
          resolve();
        }
      })
      .catch((error) => {
        if (!isResolved) {
          isResolved = true;
          reject(error);
        }
      });
  });
}

// ==================== tModLoader 管理函数 ====================

/**
 * 获取tModLoader最新版本信息
 */
export async function getTModLoaderInfo(): Promise<TModLoaderInfo> {
  try {
    const response = await axios.get('https://api.github.com/repos/tModLoader/tModLoader/releases/latest');
    const assets = response.data.assets;
    
    // 查找服务端文件
    const patterns = [
      /tmodloader.*server.*\.zip$/i,
      /tmodloader.*\.zip$/i,
      /.*server.*\.zip$/i,
      /^(?!.*example).*\.zip$/i
    ];
    
    let downloadUrl = '';
    for (const pattern of patterns) {
      const asset = assets.find((a: any) => pattern.test(a.name));
      if (asset) {
        downloadUrl = asset.browser_download_url;
        break;
      }
    }
    
    if (!downloadUrl) {
      throw new Error('未找到tModLoader服务端下载链接');
    }
    
    return {
      version: response.data.tag_name,
      downloadUrl
    };
  } catch (error) {
    throw new Error(`获取tModLoader信息失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 部署tModLoader服务器
 */
export async function deployTModLoaderServer(options: TModLoaderDeployOptions): Promise<DeploymentResult> {
  const { targetDirectory, options: tmodOptions = {}, deploymentId, onProgress } = options;
  
  // 创建部署实例
  const deployment = globalDeploymentManager.createDeployment('tmodloader', targetDirectory, onProgress, deploymentId);
  
  try {
    (deployment.cancellationToken as CancellationTokenImpl).throwIfCancelled();
    
    // 获取版本信息
    if (onProgress) onProgress('获取tModLoader版本信息...', 'info');
    const { downloadUrl, version } = await getTModLoaderInfo();
    if (onProgress) onProgress(`找到版本: ${version}`, 'success');
    
    (deployment.cancellationToken as CancellationTokenImpl).throwIfCancelled();
    
    // 创建临时目录
    const tempDir = await createTempDirectory(deployment, 'tmodloader-');
    
    // 下载文件
    const zipPath = path.join(tempDir, 'tmodloader.zip');
    if (onProgress) onProgress('正在下载tModLoader...', 'info');
    await downloadFileWithCancellation(downloadUrl, zipPath, deployment, undefined, onProgress);
    if (onProgress) onProgress('下载完成', 'success');
    
    (deployment.cancellationToken as CancellationTokenImpl).throwIfCancelled();
    
    // 确保目标目录存在
    await fs.ensureDir(targetDirectory);
    
    // 解压文件
    if (onProgress) onProgress('正在解压文件...', 'info');
    await extractZipFileWithCancellation(zipPath, targetDirectory, deployment);
    if (onProgress) onProgress('解压完成', 'success');
    
    // 延迟清理部署（给用户一些时间来取消操作）
    setTimeout(() => {
      globalDeploymentManager.cleanupDeployment(deployment.id);
    }, 30000); // 30秒后清理
    
    return {
      success: true,
      message: 'tModLoader服务器部署成功',
      targetDirectory,
      deploymentId: deployment.id,
      details: {
        version,
        extractPath: targetDirectory
      }
    };
  } catch (error) {
    // 延迟清理部署
    setTimeout(() => {
      globalDeploymentManager.cleanupDeployment(deployment.id);
    }, 30000); // 30秒后清理
    
    if (error instanceof Error && error.message === '操作已被取消') {
      return {
        success: false,
        message: 'tModLoader服务器部署已取消',
        deploymentId: deployment.id
      };
    }
    
    return {
      success: false,
      message: `tModLoader服务器部署失败: ${error instanceof Error ? error.message : String(error)}`,
      deploymentId: deployment.id
    };
  }
}

// ==================== Factorio 管理函数 ====================

/**
 * 部署Factorio服务器
 */
export async function deployFactorioServer(options: FactorioDeployOptions): Promise<DeploymentResult> {
  const { targetDirectory, tempDir, deploymentId, onProgress } = options;
  
  // 创建部署实例
  const deployment = globalDeploymentManager.createDeployment('factorio', targetDirectory, onProgress, deploymentId);
  
  try {
    (deployment.cancellationToken as CancellationTokenImpl).throwIfCancelled();
    
    const downloadUrl = 'https://factorio.com/get-download/stable/headless/linux64';
    const workingTempDir = tempDir || await createTempDirectory(deployment, 'factorio-');
    const tempFilePath = path.join(workingTempDir, 'factorio-server.tar.xz');
    
    // 下载服务端
    if (onProgress) onProgress('正在下载Factorio服务端...', 'info');
    await downloadFileWithCancellation(downloadUrl, tempFilePath, deployment, undefined, onProgress);
    if (onProgress) onProgress('下载完成', 'success');
    
    (deployment.cancellationToken as CancellationTokenImpl).throwIfCancelled();
    
    // 确保目标目录存在
    await fs.ensureDir(targetDirectory);
    
    // 解压文件
    if (onProgress) onProgress('正在解压文件...', 'info');
    await extractTarXzFileWithCancellation(tempFilePath, targetDirectory, deployment);
    if (onProgress) onProgress('解压完成', 'success');
    
    // 查找服务端可执行文件
    const serverExecutablePath = await findFactorioExecutable(targetDirectory);
    
    // 延迟清理部署（给用户一些时间来取消操作）
    setTimeout(() => {
      globalDeploymentManager.cleanupDeployment(deployment.id);
    }, 30000); // 30秒后清理
    
    return {
      success: true,
      message: 'Factorio服务器部署成功',
      targetDirectory,
      deploymentId: deployment.id,
      details: {
        extractPath: targetDirectory,
        serverExecutablePath
      }
    };
  } catch (error) {
    // 延迟清理部署
    setTimeout(() => {
      globalDeploymentManager.cleanupDeployment(deployment.id);
    }, 30000); // 30秒后清理
    
    if (error instanceof Error && error.message === '操作已被取消') {
      return {
        success: false,
        message: 'Factorio服务器部署已取消',
        deploymentId: deployment.id
      };
    }
    
    return {
      success: false,
      message: `Factorio服务器部署失败: ${error instanceof Error ? error.message : String(error)}`,
      deploymentId: deployment.id
    };
  }
}

/**
 * 查找Factorio服务端可执行文件
 */
async function findFactorioExecutable(extractPath: string): Promise<string | undefined> {
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

// ==================== Mrpack 管理函数 ====================

/**
 * 搜索Mrpack整合包
 */
export async function searchMrpackModpacks(options: MrpackSearchOptions = {}, apiSource: 'official' | 'mirror' = 'official'): Promise<MrpackSearchResponse> {
  const mrpackAPI = new MrpackServerAPI(undefined, apiSource);
  return await mrpackAPI.searchModpacks(options);
}

export async function getMrpackProjectVersions(projectId: string, apiSource: 'official' | 'mirror' = 'official'): Promise<any[]> {
  const mrpackAPI = new MrpackServerAPI(undefined, apiSource);
  return await mrpackAPI.getProjectVersions(projectId);
}

/**
 * 下载并解析Mrpack文件
 * @deprecated 请使用 MrpackServerAPI.downloadAndParseMrpack 方法
 */
export async function downloadAndParseMrpack(mrpackUrl: string, apiSource: 'official' | 'mirror' = 'official'): Promise<MrpackIndex> {
  const mrpackAPI = new MrpackServerAPI(undefined, apiSource);
  return await mrpackAPI.downloadAndParseMrpack(mrpackUrl);
}

/**
 * 部署Mrpack整合包
 */
export async function deployMrpackServer(options: MrpackDeployOptions): Promise<DeploymentResult> {
  const { projectId, versionId, mrpackUrl, targetDirectory, onProgress, apiSource = 'official' } = options;
  
  // 创建部署实例
  const deployment = globalDeploymentManager.createDeployment('mrpack', targetDirectory, onProgress, options.deploymentId);
  
  try {
    (deployment.cancellationToken as CancellationTokenImpl).throwIfCancelled();
    
    let finalMrpackUrl = mrpackUrl;
    
    // 验证参数：必须提供mrpackUrl或者同时提供projectId和versionId
    if (!finalMrpackUrl && (!projectId || !versionId)) {
      throw new Error('必须提供mrpackUrl或者同时提供projectId和versionId');
    }
    
    // 验证versionId格式（Modrinth版本ID通常是8位字符的字符串）
    if (!finalMrpackUrl && versionId && typeof versionId === 'string') {
      if (versionId.length < 8 || !/^[a-zA-Z0-9]+$/.test(versionId)) {
        throw new Error(`无效的版本ID格式: ${versionId}。版本ID应该是至少8位的字母数字字符串。`);
      }
    }
    
    // 如果没有提供mrpackUrl，则通过projectId和versionId获取
    if (!finalMrpackUrl && projectId && versionId) {
      if (onProgress) {
        onProgress('正在获取整合包下载链接...', 'info');
      }
      
      try {
        // 从Modrinth API获取版本信息
        if (onProgress) {
          onProgress(`正在请求版本信息: ${versionId}`, 'info');
        }
        
        // 根据选择的API源构建URL
        const apiBaseUrl = apiSource === 'mirror' ? 'https://mod.mcimirror.top/modrinth/v2' : 'https://api.modrinth.com/v2';
        const versionResponse = await axios.get(`${apiBaseUrl}/version/${versionId}`, {
          headers: {
            'User-Agent': 'GSM3/1.0.0'
          },
          timeout: 10000
        });
        const versionData = versionResponse.data;
        
        if (onProgress) {
          onProgress(`获取到版本数据，查找mrpack文件...`, 'info');
        }
        
        // 查找mrpack文件
        const mrpackFile = versionData.files?.find((file: any) => 
          file.filename?.endsWith('.mrpack') || file.primary === true
        );
        
        if (!mrpackFile || !mrpackFile.url) {
          throw new Error(`未找到有效的mrpack文件下载链接。版本ID: ${versionId}, 可用文件: ${JSON.stringify(versionData.files?.map((f: any) => f.filename) || [])}`);
        }
        
        finalMrpackUrl = mrpackFile.url;
        
        if (onProgress) {
          onProgress(`找到整合包文件: ${mrpackFile.filename}`, 'info');
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const statusText = error.response?.statusText;
          const responseData = error.response?.data;
          throw new Error(`获取整合包下载链接失败: HTTP ${status} ${statusText}. 版本ID: ${versionId}. 响应: ${JSON.stringify(responseData)}`);
        }
        throw new Error(`获取整合包下载链接失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    if (!finalMrpackUrl) {
      throw new Error('缺少整合包下载链接');
    }
    
    // 使用 MrpackServerAPI 进行部署
    const mrpackAPI = new MrpackServerAPI(undefined, apiSource);
    
    // 设置取消监听
    deployment.cancellationToken.onCancelled(() => {
      mrpackAPI.cancel();
    });
    
    // 调用 MrpackServerAPI 的部署方法
    const deployResult = await mrpackAPI.deployModpack({
      mrpackUrl: finalMrpackUrl,
      targetDirectory,
      onProgress,
      skipJavaCheck: options.skipJavaCheck,
      minecraftVersion: options.minecraftVersion,
      loaderType: options.loaderType
    });
    
    // 清理部署
    await globalDeploymentManager.cleanupDeployment(deployment.id);
    
    if (deployResult.success) {
      return {
        success: true,
        message: deployResult.message,
        targetDirectory: deployResult.targetDirectory || targetDirectory,
        deploymentId: deployment.id,
        details: {
          name: 'Mrpack整合包',
          version: deployResult.loaderVersion || 'unknown',
          installedMods: deployResult.installedMods || 0,
          game: 'minecraft'
        }
      };
    } else {
      return {
        success: false,
        message: deployResult.message,
        deploymentId: deployment.id
      };
    }
  } catch (error) {
    // 清理部署
    await globalDeploymentManager.cleanupDeployment(deployment.id);
    
    if (error instanceof Error && error.message === '操作已被取消') {
      return {
        success: false,
        message: 'Mrpack整合包部署已取消',
        deploymentId: deployment.id
      };
    }
    
    return {
      success: false,
      message: `Mrpack整合包部署失败: ${error instanceof Error ? error.message : String(error)}`,
      deploymentId: deployment.id
    };
  }
}

// ==================== 工具函数 ====================

/**
 * 解压ZIP文件
 */
export async function extractZipFile(zipPath: string, extractPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err || new Error('无法打开ZIP文件'));
        return;
      }
      
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) {
          // 目录
          const dirPath = path.join(extractPath, entry.fileName);
          fs.ensureDir(dirPath).then(() => zipfile.readEntry()).catch(reject);
        } else {
          // 文件
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err || !readStream) {
              reject(err || new Error('无法读取文件'));
              return;
            }
            
            const filePath = path.join(extractPath, entry.fileName);
            fs.ensureDir(path.dirname(filePath))
              .then(() => {
                const writeStream = createWriteStream(filePath);
                writeStream.on('finish', () => zipfile.readEntry());
                writeStream.on('error', reject);
                readStream.pipe(writeStream);
              })
              .catch(reject);
          });
        }
      });
      
      zipfile.on('end', () => resolve());
      zipfile.on('error', reject);
    });
  });
}

/**
 * 支持取消的解压ZIP文件函数
 */
export async function extractZipFileWithCancellation(zipPath: string, extractPath: string, deployment: ActiveDeployment): Promise<void> {
  return new Promise((resolve, reject) => {
    (deployment.cancellationToken as CancellationTokenImpl).throwIfCancelled();
    
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err || new Error('无法打开ZIP文件'));
        return;
      }

      let isResolved = false;
      
      // 注册取消回调
      deployment.cancellationToken.onCancelled(() => {
        if (!isResolved) {
          isResolved = true;
          zipfile.close();
          reject(new Error('操作已被取消'));
        }
      });
      
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (deployment.cancellationToken.isCancelled) {
          if (!isResolved) {
            isResolved = true;
            zipfile.close();
            reject(new Error('操作已被取消'));
          }
          return;
        }
        
        if (entry.fileName.endsWith('/')) {
          // 目录
          const dirPath = path.join(extractPath, entry.fileName);
          fs.ensureDir(dirPath)
            .then(() => {
              if (!deployment.cancellationToken.isCancelled) {
                zipfile.readEntry();
              }
            })
            .catch(reject);
        } else {
          // 文件
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err || !readStream) {
              reject(err || new Error('无法读取文件'));
              return;
            }
            
            const filePath = path.join(extractPath, entry.fileName);
            fs.ensureDir(path.dirname(filePath))
              .then(() => {
                if (deployment.cancellationToken.isCancelled) {
                  readStream.destroy();
                  return;
                }
                
                const writeStream = createWriteStream(filePath);
                
                // 注册取消回调
                deployment.cancellationToken.onCancelled(() => {
                  readStream.destroy();
                  writeStream.destroy();
                  fsPromises.unlink(filePath).catch(() => {});
                });
                
                writeStream.on('finish', () => {
                  if (!deployment.cancellationToken.isCancelled) {
                    zipfile.readEntry();
                  }
                });
                writeStream.on('error', reject);
                readStream.pipe(writeStream);
              })
              .catch(reject);
          });
        }
      });
      
      zipfile.on('end', () => {
        if (!isResolved) {
          isResolved = true;
          resolve();
        }
      });
      zipfile.on('error', (error) => {
        if (!isResolved) {
          isResolved = true;
          reject(error);
        }
      });
    });
  });
}

/**
 * 解压tar.xz文件（简化版，实际可能需要更复杂的实现）
 */
export async function extractTarXzFile(filePath: string, extractPath: string): Promise<void> {
  try {
    await tar.extract({
      file: filePath,
      cwd: extractPath,
      strip: 1 // 去掉顶层目录
    });
  } catch (error) {
    throw new Error(`解压tar.xz文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 验证文件是否为有效的tar.xz格式
 */
async function validateTarXzFile(filePath: string): Promise<{ isValid: boolean; fileSize: number; error?: string }> {
  try {
    const stats = await fsPromises.stat(filePath);
    const fileSize = stats.size;
    
    // 检查文件大小
    if (fileSize === 0) {
      return { isValid: false, fileSize, error: '文件为空 (0字节)，可能下载失败或被中断' };
    }
    
    if (fileSize < 100) {
      return { isValid: false, fileSize, error: '文件过小，可能不是有效的tar.xz文件或下载不完整' };
    }
    
    // 检查文件大小是否合理（Factorio服务端通常大于50MB）
    if (fileSize < 50 * 1024 * 1024) {
      return { isValid: false, fileSize, error: `文件大小异常小 (${Math.round(fileSize / 1024 / 1024)}MB)，Factorio服务端通常大于50MB，可能下载不完整` };
    }
    
    // 读取文件头部分析魔数
    const buffer = Buffer.alloc(12);
    const fd = await fsPromises.open(filePath, 'r');
    
    try {
      await fd.read(buffer, 0, 12, 0);
      
      // XZ文件头魔数: FD 37 7A 58 5A 00
      const xzMagic = Buffer.from([0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00]);
      if (buffer.subarray(0, 6).equals(xzMagic)) {
        return { isValid: true, fileSize };
      }
      
      // 检查是否为其他常见格式
      const fileHeader = buffer.toString('hex').toUpperCase();
      let detectedFormat = 'unknown';
      
      if (buffer.subarray(0, 2).equals(Buffer.from([0x1F, 0x8B]))) {
        detectedFormat = 'gzip';
      } else if (buffer.subarray(0, 3).equals(Buffer.from([0x42, 0x5A, 0x68]))) {
        detectedFormat = 'bzip2';
      } else if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04])) || 
                 buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4B, 0x05, 0x06]))) {
        detectedFormat = 'zip';
      } else if (buffer.subarray(0, 8).toString() === 'ustar\x00\x00\x00' || 
                 buffer.subarray(257, 262).toString() === 'ustar') {
        detectedFormat = 'tar';
      }
      
      return { 
        isValid: false, 
        fileSize, 
        error: `文件不是有效的tar.xz格式。检测到的格式: ${detectedFormat}，文件头: ${fileHeader}` 
      };
    } finally {
      await fd.close();
    }
  } catch (error) {
    return { 
      isValid: false, 
      fileSize: 0, 
      error: `文件验证失败: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}

/**
 * 检查系统是否支持tar.xz解压
 */
async function checkSystemTarXzSupport(): Promise<boolean> {
  
  try {
    // 检查tar命令是否可用
    await new Promise<void>((resolve, reject) => {
      const tarCheck = spawn('tar', ['--version'], { stdio: 'pipe' });
      tarCheck.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('tar not available'));
        }
      });
      tarCheck.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
    
    // 检查xz命令是否可用
    await new Promise<void>((resolve, reject) => {
      const xzCheck = spawn('xz', ['--version'], { stdio: 'pipe' });
      xzCheck.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('xz not available'));
        }
      });
      xzCheck.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
    
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 使用系统命令解压tar.xz文件
 */
async function extractTarXzWithSystemCommand(filePath: string, extractPath: string, deployment: ActiveDeployment): Promise<void> {
  
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    let command: string;
    let args: string[];
    
    if (isWindows) {
      // Windows: 尝试使用tar命令（Windows 10 1803+支持）
      command = 'tar';
      args = ['-xf', filePath, '-C', extractPath];
    } else {
      // Linux/Mac: 使用tar + xz组合
      command = 'sh';
      args = ['-c', `xz -dc "${filePath}" | tar -xf - -C "${extractPath}"`];
    }
    
    if (deployment.onProgress) {
      deployment.onProgress(`执行解压命令: ${command} ${args.join(' ')}`, 'info');
    }
    
    const extractProcess = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // 注册到部署管理器
    deployment.processes.push(extractProcess);
    
    let stdout = '';
    let stderr = '';
    let isResolved = false;
    
    // 注册取消回调
    deployment.cancellationToken.onCancelled(() => {
      if (!extractProcess.killed && !isResolved) {
        extractProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!extractProcess.killed) {
            extractProcess.kill('SIGKILL');
          }
        }, 5000);
        isResolved = true;
        reject(new Error('操作已被取消'));
      }
    });
    
    extractProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    extractProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    extractProcess.on('close', (code: number) => {
      if (isResolved) return;
      isResolved = true;
      
      // 从进程列表中移除
      const processIndex = deployment.processes.indexOf(extractProcess);
      if (processIndex > -1) {
        deployment.processes.splice(processIndex, 1);
      }
      
      if (deployment.cancellationToken.isCancelled) {
        reject(new Error('操作已被取消'));
        return;
      }
      
      if (code === 0) {
        if (deployment.onProgress) {
          deployment.onProgress('tar.xz文件解压完成', 'success');
        }
        resolve();
      } else {
        const errorMsg = `tar.xz解压失败，退出码: ${code}\n标准输出: ${stdout}\n错误输出: ${stderr}`;
        if (deployment.onProgress) {
          deployment.onProgress(errorMsg, 'error');
        }
        reject(new Error(errorMsg));
      }
    });
    
    extractProcess.on('error', (error: Error) => {
      if (isResolved) return;
      isResolved = true;
      
      // 从进程列表中移除
      const processIndex = deployment.processes.indexOf(extractProcess);
      if (processIndex > -1) {
        deployment.processes.splice(processIndex, 1);
      }
      
      reject(new Error(`执行解压命令失败: ${error.message}`));
    });
  });
}

/**
 * 支持取消的解压tar.xz文件函数
 */
export async function extractTarXzFileWithCancellation(filePath: string, extractPath: string, deployment: ActiveDeployment): Promise<void> {
  try {
    (deployment.cancellationToken as CancellationTokenImpl).throwIfCancelled();
    
    // 验证文件格式
    if (deployment.onProgress) {
      deployment.onProgress('正在验证tar.xz文件格式...', 'info');
    }
    
    const validation = await validateTarXzFile(filePath);
    if (!validation.isValid) {
      let errorMsg = `Factorio服务器部署失败: 解压tar.xz文件失败: TAR_BAD_ARCHIVE: ${validation.error || 'Unrecognized archive format'}. 文件大小: ${validation.fileSize} bytes, 文件路径: ${filePath}`;
      
      if (deployment.onProgress) {
        deployment.onProgress(errorMsg, 'error');
        
        // 根据文件大小提供不同的建议
        if (validation.fileSize === 0) {
          deployment.onProgress('建议: 1) 检查网络连接是否稳定 2) 重新尝试下载 3) 检查磁盘空间是否充足 4) 验证下载URL是否有效', 'warn');
        } else if (validation.fileSize < 50 * 1024 * 1024) {
          deployment.onProgress('建议: 1) 重新下载完整文件 2) 检查网络连接稳定性 3) 验证下载过程是否被中断', 'warn');
        } else {
          deployment.onProgress('建议: 1) 检查文件格式是否正确 2) 重新下载文件 3) 验证Factorio下载链接是否有效', 'warn');
        }
      }
      throw new Error(errorMsg);
    }
    
    if (deployment.onProgress) {
      deployment.onProgress(`文件验证通过，大小: ${validation.fileSize} bytes`, 'success');
      deployment.onProgress('注意: Node.js tar库不原生支持xz压缩，将尝试系统命令解压', 'warn');
    }
    
    // 由于Node.js的tar库不支持xz压缩，我们需要使用系统命令
    // 首先尝试检查系统是否有必要的工具
    const hasSystemSupport = await checkSystemTarXzSupport();
    if (!hasSystemSupport) {
      const errorMsg = `系统不支持tar.xz解压: 缺少必要的工具 (tar, xz)。请安装相应的软件包：
        - Ubuntu/Debian: sudo apt-get install tar xz-utils
        - CentOS/RHEL: sudo yum install tar xz
        - Windows: 安装 7-Zip 或 Git for Windows`;
      if (deployment.onProgress) {
        deployment.onProgress(errorMsg, 'error');
      }
      throw new Error(errorMsg);
    }
    
    // 使用系统命令解压
    await extractTarXzWithSystemCommand(filePath, extractPath, deployment);
    
  } catch (error) {
    if (error instanceof Error && error.message === '操作已被取消') {
      throw error;
    }
    // 如果包含 "TAR_BAD_ARCHIVE" 就直接抛出，否则包装错误
    if (error instanceof Error && error.message.includes('TAR_BAD_ARCHIVE')) {
      throw error;
    }
    throw new Error(`Factorio服务器部署失败: 解压tar.xz文件失败: TAR_BAD_ARCHIVE: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 已删除 downloadAndParseMrpackWithCancellation 函数，请使用 MrpackServerAPI

// 已删除 extractMrpackIndexWithCancellation 函数，请使用 MrpackServerAPI

// 已删除 extractMrpackIndex 函数，请使用 MrpackServerAPI

// 已删除 extractMrpackOverridesWithCancellation 函数，请使用 MrpackServerAPI

// 已删除 extractMrpackOverrides 函数，请使用 MrpackServerAPI

// 已删除 downloadMrpackModsWithCancellation 函数，请使用 MrpackServerAPI

// 已删除 downloadMrpackMods 函数，请使用 MrpackServerAPI

// ==================== 统一部署函数 ====================

export interface UnifiedDeployOptions {
  game: GameType;
  targetDirectory: string;
  
  // Minecraft特定选项
  server?: string;
  version?: string;
  skipJavaCheck?: boolean;
  skipServerRun?: boolean;
  
  // tModLoader特定选项
  tmodOptions?: TModLoaderOptions;
  
  // Factorio特定选项
  tempDir?: string;
  
  // Mrpack特定选项
  mrpackUrl?: string;
  minecraftVersion?: string;
  
  // 通用选项
  onProgress?: LogCallback;
}

/**
 * 统一部署函数
 */
export async function deployGameServer(options: UnifiedDeployOptions): Promise<DeploymentResult> {
  const { game, targetDirectory, onProgress } = options;
  
  // 验证必需参数
  if (!game || !targetDirectory) {
    throw new Error('缺少必需参数: game和targetDirectory');
  }
  
  // 创建部署实例
  const deployment = globalDeploymentManager.createDeployment(game, targetDirectory, onProgress);
  const cancellationToken = deployment.cancellationToken;
  
  try {
    (cancellationToken as CancellationTokenImpl).throwIfCancelled();
    
    let result: DeploymentResult;
    
    switch (game) {
      case 'minecraft':
        if (!options.server || !options.version) {
          throw new Error('Minecraft部署缺少必需参数: server和version');
        }
        result = await deployMinecraftServer({
          server: options.server,
          version: options.version,
          targetDirectory,
          skipJavaCheck: options.skipJavaCheck,
          skipServerRun: options.skipServerRun,
          onProgress: onProgress ? (progress: DownloadProgress) => onProgress(`进度: ${progress.percentage}%`, 'info') : undefined,
          onLog: onProgress
        });
        break;
        
      case 'tmodloader':
        result = await deployTModLoaderServer({
          targetDirectory,
          options: options.tmodOptions,
          onProgress
        });
        break;
        
      case 'factorio':
        result = await deployFactorioServer({
          targetDirectory,
          tempDir: options.tempDir,
          onProgress
        });
        break;
        
      case 'mrpack':
        if (!options.mrpackUrl) {
          throw new Error('Mrpack部署缺少必需参数: mrpackUrl');
        }
        result = await deployMrpackServer({
          mrpackUrl: options.mrpackUrl,
          targetDirectory,
          minecraftVersion: options.minecraftVersion,
          onProgress
        });
        break;
        
      default:
        throw new Error(`不支持的游戏类型: ${game}`);
    }
    
    // 确保结果包含部署ID
    result.deploymentId = deployment.id;
    
    // 清理部署
    await globalDeploymentManager.cleanupDeployment(deployment.id);
    
    return result;
  } catch (error) {
    // 清理部署
    await globalDeploymentManager.cleanupDeployment(deployment.id);
    
    if (error instanceof Error && error.message === '操作已被取消') {
      throw new Error('统一部署操作已被取消');
    }
    throw error;
  }
}

// 默认导出统一部署函数
export default deployGameServer;