import axios from 'axios';
import * as fs from 'fs-extra';
import { promises as fsPromises, existsSync, readdirSync } from 'fs';
import { createWriteStream } from 'fs';
import * as path from 'path';
import { zipToolsManager } from '../../../utils/zipToolsManager.js';
import { spawn, ChildProcess } from 'child_process';
import { ApiService as MinecraftAPI, FileManager, LogCallback } from './minecraft-server-api.js';

// ==================== 类型定义 ====================

// Modrinth API响应类型
export interface ModrinthSearchResponse {
  hits: ModrinthProject[];
  offset: number;
  limit: number;
  total_hits: number;
}

export interface ModrinthProject {
  project_id: string;
  project_type: string;
  slug: string;
  author: string;
  title: string;
  description: string;
  categories: string[];
  display_categories: string[];
  versions: string[];
  downloads: number;
  follows: number;
  icon_url?: string;
  date_created: string;
  date_modified: string;
  latest_version?: string;
  license: string;
  client_side: string;
  server_side: string;
  gallery: string[];
  featured_gallery?: string;
  color?: number;
}

// mrpack文件结构
export interface ModrinthIndex {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  summary?: string;
  files: ModrinthFile[];
  dependencies: Record<string, string>;
}

export interface ModrinthFile {
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

// 搜索选项
export interface ModpackSearchOptions {
  query?: string;
  categories?: string[];
  versions?: string[];
  license?: string;
  project_type?: string;
  limit?: number;
  offset?: number;
  index?: string;
}

// 部署选项
export interface ModpackDeployOptions {
  mrpackUrl: string;
  targetDirectory: string;
  minecraftVersion?: string;
  loaderType?: 'forge' | 'neoforge' | 'fabric' | 'quilt';
  skipJavaCheck?: boolean;
  tempDir?: string;
  onProgress?: (message: string, type?: 'info' | 'error' | 'success' | 'warn') => void;
}

// 部署结果
export interface ModpackDeployResult {
  success: boolean;
  message: string;
  targetDirectory?: string;
  installedMods?: number;
  loaderVersion?: string;
  serverType?: string;  // 服务端类型 (forge/neoforge/fabric/quilt)
}

// ==================== Mrpack处理器类 ====================

export class MrpackServerAPI {
  private static readonly MODRINTH_API_BASE = 'https://api.modrinth.com/v2';
  private static readonly SEARCH_ENDPOINT = '/search';
  private tempDir: string;
  private cancelled: boolean = false;
  private currentProcess?: ChildProcess;

  constructor(tempDir?: string) {
    this.tempDir = tempDir || path.join(process.cwd(), 'temp-mrpack');
  }

  /**
   * 搜索整合包（仅显示服务端兼容的）
   */
  async searchModpacks(options: ModpackSearchOptions = {}): Promise<ModrinthSearchResponse> {
    try {
      const params = new URLSearchParams();
      
      // 构建搜索查询
      let facets = [];
      
      // 强制要求：项目类型为modpack
      facets.push('["project_type:modpack"]');
      
      // 强制要求：Environment类型指定为服务端，只显示服务端
      facets.push('["server_side:required","server_side:optional"]');
      
      // 可选参数
      if (options.categories && options.categories.length > 0) {
        const categoryFacets = options.categories.map(cat => `"categories:${cat}"`);
        facets.push(`[${categoryFacets.join(',')}]`);
      }
      
      if (options.versions && options.versions.length > 0) {
        const versionFacets = options.versions.map(ver => `"versions:${ver}"`);
        facets.push(`[${versionFacets.join(',')}]`);
      }
      
      if (options.license) {
        facets.push(`["license:${options.license}"]`);
      }
      
      // 设置facets参数
      if (facets.length > 0) {
        params.append('facets', `[${facets.join(',')}]`);
      }
      
      // 其他参数
      if (options.query) {
        params.append('query', options.query);
      }
      
      params.append('limit', (options.limit || 20).toString());
      params.append('offset', (options.offset || 0).toString());
      params.append('index', options.index || 'relevance');
      
      const response = await axios.get<ModrinthSearchResponse>(
        `${MrpackServerAPI.MODRINTH_API_BASE}${MrpackServerAPI.SEARCH_ENDPOINT}?${params.toString()}`
      );
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`搜索整合包失败: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 获取项目的版本列表
   */
  async getProjectVersions(projectId: string): Promise<any[]> {
    try {
      const response = await axios.get(
        `${MrpackServerAPI.MODRINTH_API_BASE}/project/${projectId}/version`,
        {
          headers: {
            'User-Agent': 'GSM3/1.0.0 (game server manager)'
          },
          timeout: 10000
        }
      );
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`获取项目版本失败: ${error.response?.status} ${error.response?.statusText}`);
      }
      throw new Error(`获取项目版本失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 下载并解析mrpack文件
   */
  async downloadAndParseMrpack(mrpackUrl: string): Promise<ModrinthIndex> {
    try {
      // 确保临时目录存在
      await fs.ensureDir(this.tempDir);
      
      const mrpackPath = path.join(this.tempDir, 'modpack.mrpack');
      
      // 下载mrpack文件
      const response = await axios({
        method: 'GET',
        url: mrpackUrl,
        responseType: 'stream'
      });
      
      const writer = createWriteStream(mrpackPath);
      response.data.pipe(writer);
      
      await new Promise<void>((resolve, reject) => {
        writer.on('finish', () => resolve());
        writer.on('error', reject);
      });
      
      // 解压并解析modrinth.index.json
      const indexData = await this.extractModrinthIndex(mrpackPath);
      
      return indexData;
    } catch (error) {
      throw new Error(`下载和解析mrpack文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 从mrpack文件中提取modrinth.index.json
   */
  private async extractModrinthIndex(mrpackPath: string): Promise<ModrinthIndex> {
    // 先将 mrpack 全量解压到临时目录，然后读取 modrinth.index.json
    const tempDir = path.join(this.tempDir, `mrpack_index_${Date.now()}`);
    try {
      await fs.ensureDir(tempDir);
      await zipToolsManager.extractZip(mrpackPath, tempDir);

      const indexPath = path.join(tempDir, 'modrinth.index.json');
      if (!await fs.pathExists(indexPath)) {
        throw new Error('在mrpack文件中未找到modrinth.index.json');
      }

      const data = await fs.readFile(indexPath, 'utf-8');
      const indexData: ModrinthIndex = JSON.parse(data);
      return indexData;
    } catch (error: any) {
      if (error.message?.includes('modrinth.index.json')) {
        throw error;
      }
      throw new Error(`解析mrpack文件失败: ${error.message || error}`);
    } finally {
      // 清理临时目录
      await fs.remove(tempDir).catch(() => {});
    }
  }

  /**
   * 提取overrides文件夹内容
   */
  private async extractOverrides(mrpackPath: string, targetDir: string): Promise<void> {
    // 先将 mrpack 全量解压到临时目录，然后复制 overrides/ 下的内容到目标目录
    const tempDir = path.join(this.tempDir, `mrpack_overrides_${Date.now()}`);
    try {
      await fs.ensureDir(tempDir);
      await zipToolsManager.extractZip(mrpackPath, tempDir);

      const overridesDir = path.join(tempDir, 'overrides');
      if (await fs.pathExists(overridesDir)) {
        // 将 overrides/ 目录下的所有内容复制到目标目录
        await fs.copy(overridesDir, targetDir, { overwrite: true });
      }
    } finally {
      // 清理临时目录
      await fs.remove(tempDir).catch(() => {});
    }
  }

  /**
   * 下载mod文件
   */
  private async downloadMods(indexData: ModrinthIndex, modsDir: string, onProgress?: LogCallback): Promise<number> {
    await fs.ensureDir(modsDir);
    
    let downloadedCount = 0;
    const totalMods = indexData.files.length;
    
    if (onProgress) {
      onProgress(`开始下载 ${totalMods} 个mod文件...`, 'info');
    }
    
    for (const file of indexData.files) {
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }
      
      // 检查是否为服务端兼容的文件
      if (file.env && file.env.server === 'unsupported') {
        if (onProgress) {
          onProgress(`跳过客户端专用文件: ${path.basename(file.path)}`, 'warn');
        }
        continue;
      }
      
      const fileName = path.basename(file.path);
      const filePath = path.join(modsDir, fileName);
      
      try {
        // 尝试从下载链接下载
        for (const downloadUrl of file.downloads) {
          try {
            const response = await axios({
              method: 'GET',
              url: downloadUrl,
              responseType: 'stream',
              timeout: 60000
            });
            
            const writer = createWriteStream(filePath);
            response.data.pipe(writer);
            
            await new Promise<void>((resolve, reject) => {
              writer.on('finish', () => resolve());
              writer.on('error', reject);
            });
            
            downloadedCount++;
            if (onProgress) {
              onProgress(`已下载: ${fileName} (${downloadedCount}/${totalMods})`, 'info');
            }
            break;
          } catch (downloadError) {
            if (onProgress) {
              onProgress(`下载失败，尝试下一个链接: ${fileName}`, 'warn');
            }
            continue;
          }
        }
      } catch (error) {
        if (onProgress) {
          onProgress(`下载mod失败: ${fileName} - ${error}`, 'error');
        }
      }
    }
    
    return downloadedCount;
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
    
    // 清理临时目录
    this.cleanup().catch(() => {
      // 忽略清理错误
    });
  }

  /**
   * 检查是否已取消
   */
  isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * 部署整合包
   */
  async deployModpack(options: ModpackDeployOptions): Promise<ModpackDeployResult> {
    try {
      const { mrpackUrl, targetDirectory, onProgress } = options;
      this.cancelled = false; // 重置取消状态
      
      if (onProgress) {
        onProgress('开始部署整合包...', 'info');
      }
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }
      
      // 1. 下载并解析mrpack文件
      if (onProgress) {
        onProgress('正在下载和解析mrpack文件...', 'info');
      }
      const indexData = await this.downloadAndParseMrpack(mrpackUrl);
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }
      
      // 2. 确定Minecraft版本和加载器类型
      const minecraftVersion = options.minecraftVersion || indexData.dependencies.minecraft;
      const loaderType = options.loaderType || this.detectLoaderType(indexData);
      
      if (!minecraftVersion) {
        throw new Error('无法确定Minecraft版本');
      }
      
      if (onProgress) {
        onProgress(`检测到Minecraft版本: ${minecraftVersion}, 加载器: ${loaderType}`, 'info');
      }
      
      // 3. 创建临时目录并下载对应的加载器核心
      const tempServerDir = await FileManager.createTempDirectory();
      const serverName = this.getServerName(loaderType, minecraftVersion);
      
      if (onProgress) {
        onProgress(`正在下载${loaderType}服务端核心...`, 'info');
      }
      
      const downloadData = await MinecraftAPI.getDownloadUrl(serverName, minecraftVersion);
      const serverJarPath = FileManager.getServerJarPath(serverName, minecraftVersion);
      
      await MinecraftAPI.downloadFile(downloadData.url, serverJarPath, undefined, onProgress);
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }
      
      // 4. 运行服务端直到EULA协议停止
      if (!options.skipJavaCheck) {
        const hasJava = await FileManager.validateJavaEnvironment();
        if (!hasJava) {
          throw new Error('未检测到Java环境，请安装Java后重试');
        }
      }
      
      if (onProgress) {
        onProgress('正在初始化服务端...', 'info');
      }
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }
      
      this.currentProcess = await this.runServerUntilEulaWithCancel(serverJarPath, tempServerDir, onProgress);
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }
      
      // 5. 下载mod文件到mods文件夹
      const modsDir = path.join(tempServerDir, 'mods');
      const downloadedMods = await this.downloadMods(indexData, modsDir, onProgress);
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }
      
      // 6. 提取overrides文件夹内容（config等）
      if (onProgress) {
        onProgress('正在提取配置文件...', 'info');
      }
      
      const mrpackPath = path.join(this.tempDir, 'modpack.mrpack');
      await this.extractOverrides(mrpackPath, tempServerDir);
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }
      
      // 7. 移动整个目录到指定位置
      if (onProgress) {
        onProgress('正在移动文件到目标目录...', 'info');
      }
      
      // 直接移动tempServerDir中的文件到目标目录
      await this.moveFilesToTarget(tempServerDir, targetDirectory, onProgress);
      
      // 8. 清理临时目录
      if (onProgress) {
        onProgress('正在清理临时文件...', 'info');
      }
      
      // 清理tempServerDir（如果还存在）
      if (await fs.pathExists(tempServerDir)) {
        await fs.remove(tempServerDir);
      }
      
      // 清理mrpack临时目录
      await fs.remove(this.tempDir);
      
      if (onProgress) {
        onProgress('临时文件清理完成', 'info');
      }
      
      if (onProgress) {
        onProgress('整合包部署完成！', 'success');
      }

      return {
        success: true,
        message: '整合包部署成功',
        targetDirectory,
        installedMods: downloadedMods,
        loaderVersion: indexData.dependencies[loaderType] || 'latest',
        serverType: loaderType  // 返回服务端类型，用于前端生成启动命令
      };
    } catch (error) {
      // 清理临时文件
      try {
        await this.cleanup();
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
   * 检测加载器类型
   */
  private detectLoaderType(indexData: ModrinthIndex): 'forge' | 'neoforge' | 'fabric' | 'quilt' {
    // 优先检查neoforge
    if (indexData.dependencies.neoforge) return 'neoforge';
    // 检查forge
    if (indexData.dependencies.forge) return 'forge';
    // 检查fabric
    if (indexData.dependencies.fabric || indexData.dependencies['fabric-loader']) return 'fabric';
    // 检查quilt
    if (indexData.dependencies.quilt || indexData.dependencies['quilt-loader']) return 'quilt';
    
    // 默认返回fabric
    return 'fabric';
  }

  /**
   * 获取服务端名称
   */
  private getServerName(loaderType: string, minecraftVersion: string): string {
    switch (loaderType) {
      case 'forge':
        return 'forge';
      case 'neoforge':
        return 'neoforge';
      case 'fabric':
        return 'fabric';
      case 'quilt':
        return 'quilt';
      default:
        return 'fabric';
    }
  }

  /**
   * 移动文件到目标目录
   */
  private async moveFilesToTarget(sourceDir: string, targetDir: string, onProgress?: LogCallback): Promise<void> {
    // 确保目标目录存在
    await fs.ensureDir(targetDir);
    
    // 获取源目录中的所有文件
    const files = await fsPromises.readdir(sourceDir);
    
    if (onProgress) {
      onProgress(`正在移动 ${files.length} 个文件到目标目录...`, 'info');
    }
    
    for (const file of files) {
      const sourcePath = path.join(sourceDir, file);
      const targetPath = path.join(targetDir, file);
      
      try {
        // 统一使用move操作，无论是文件还是目录
        await fs.move(sourcePath, targetPath, { overwrite: true });
        
        const stat = await fsPromises.stat(targetPath);
        if (stat.isFile()) {
          if (onProgress) {
            onProgress(`已移动文件: ${file}`, 'info');
          }
        } else if (stat.isDirectory()) {
          if (onProgress) {
            onProgress(`已移动目录: ${file}`, 'info');
          }
        }
      } catch (error) {
        if (onProgress) {
          onProgress(`移动失败: ${file} - ${error}`, 'error');
        }
        throw error;
      }
    }
  }

  /**
   * 检查是否为forge或neoforge安装器
   */
  private isForgeInstaller(jarPath: string): boolean {
    const fileName = path.basename(jarPath).toLowerCase();
    return fileName.startsWith('forge-') || fileName.startsWith('neoforge-');
  }

  /**
   * 运行forge/neoforge安装器（支持取消）
   */
  private async runForgeInstallerWithCancel(jarPath: string, workingDir: string, onProgress?: LogCallback): Promise<ChildProcess | undefined> {
    return new Promise(async (resolve, reject) => {
      if (this.cancelled) {
        reject(new Error('操作已取消'));
        return;
      }

      if (onProgress) {
        onProgress('检测到Forge/NeoForge安装器，正在执行静默安装...', 'info');
      }
      
      const installerProcess: ChildProcess = spawn('java', ['-jar', path.basename(jarPath), '--installServer'], {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.currentProcess = installerProcess;
      let installerCompleted = false;

      // 监听标准输出
      installerProcess.stdout?.on('data', async (data: Buffer) => {
        if (this.cancelled) {
          installerProcess.kill('SIGTERM');
          return;
        }

        const output = data.toString();
        if (onProgress) {
          onProgress(output, 'info');
        }
        
        // 检测安装完成标志
        if (output.includes('You can delete this installer file now if you wish')) {
          installerCompleted = true;
          if (onProgress) {
            onProgress('Forge/NeoForge安装器安装完成，准备运行服务端...', 'success');
          }
          
          // 立即运行服务端脚本，不等待安装器进程退出
          try {
            if (onProgress) {
              onProgress(`开始调用runForgeServerWithCancel，目录: ${workingDir}`, 'info');
            }
            await this.runForgeServerWithCancel(workingDir, onProgress);
            if (onProgress) {
              onProgress('runForgeServerWithCancel执行完成', 'success');
            }
            // 强制关闭安装器进程
            if (!installerProcess.killed) {
              installerProcess.kill('SIGTERM');
            }
            resolve(installerProcess);
          } catch (error) {
            if (onProgress) {
              onProgress(`runForgeServerWithCancel执行失败: ${error}`, 'error');
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
        if (this.cancelled) {
          installerProcess.kill('SIGTERM');
          return;
        }

        const output = data.toString();
        if (onProgress) {
          onProgress(output, 'warn');
        }
      });

      // 监听进程退出
      installerProcess.on('close', async (code: number | null) => {
        this.currentProcess = undefined;
        
        // 如果已经在输出监听中处理了完成逻辑，则直接返回
        if (installerCompleted) {
          if (onProgress) {
            onProgress('Forge/NeoForge安装器进程已退出。', 'info');
          }
          return;
        }
        
        if (this.cancelled) {
          reject(new Error('操作已取消'));
          return;
        }

        if (code === 0) {
          if (onProgress) {
            onProgress('Forge/NeoForge安装器执行完成，但未检测到完成标志。', 'warn');
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
          if (onProgress) {
            onProgress('Forge/NeoForge安装器运行超时，正在强制关闭...', 'warn');
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
  private async runServerUntilEulaWithCancel(jarPath: string, workingDir: string, onProgress?: LogCallback): Promise<ChildProcess | undefined> {
    // 检查是否为forge或neoforge安装器
    if (this.isForgeInstaller(jarPath)) {
      return this.runForgeInstallerWithCancel(jarPath, workingDir, onProgress);
    }

    return new Promise((resolve, reject) => {
      if (this.cancelled) {
        reject(new Error('操作已取消'));
        return;
      }

      if (onProgress) {
        onProgress('正在启动服务端...', 'info');
      }
      
      const serverProcess: ChildProcess = spawn('java', ['-jar', path.basename(jarPath)], {
        cwd: workingDir,
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
        if (onProgress) {
          onProgress(output, 'info');
        }
        
        // 检查是否出现EULA相关信息
        if (output.toLowerCase().includes('eula') || 
            output.toLowerCase().includes('you need to agree to the eula')) {
          hasEulaMessage = true;
          if (onProgress) {
            onProgress('检测到EULA协议提示，正在关闭服务端...', 'info');
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
        if (onProgress) {
          onProgress(output, 'warn');
        }
        
        if (output.toLowerCase().includes('eula')) {
          hasEulaMessage = true;
          if (onProgress) {
            onProgress('检测到EULA协议提示，正在关闭服务端...', 'info');
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
          if (onProgress) {
            onProgress('服务端已关闭，EULA协议检测完成。', 'info');
          }
          resolve(serverProcess);
        } else if (code === 0) {
          if (onProgress) {
            onProgress('服务端正常退出。', 'info');
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
          if (onProgress) {
            onProgress('服务端运行超时，正在强制关闭...', 'warn');
          }
          serverProcess.kill('SIGKILL');
          this.currentProcess = undefined;
          resolve(serverProcess);
        }
      }, 10 * 60 * 1000);
    });
  }

  /**
   * 运行forge/neoforge服务端直到EULA协议出现（支持取消）
   */
  private async runForgeServerWithCancel(serverDir: string, onProgress?: LogCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.cancelled) {
        reject(new Error('操作已取消'));
        return;
      }
      
      // 根据操作系统选择启动脚本
      const isWindows = process.platform === 'win32';
      const scriptName = isWindows ? 'run.bat' : 'run.sh';
      const scriptPath = path.join(serverDir, scriptName);
      
      if (onProgress) {
        onProgress(`正在检查启动脚本: ${scriptPath}`, 'info');
      }
      
      // 检查启动脚本是否存在
      if (!existsSync(scriptPath)) {
        if (onProgress) {
          onProgress(`启动脚本${scriptName}不存在于目录${serverDir}，跳过服务端运行`, 'warn');
          // 列出目录中的文件以便调试
          try {
            const files = readdirSync(serverDir);
            onProgress(`目录${serverDir}中的文件: ${files.join(', ')}`, 'info');
          } catch (err) {
            onProgress(`无法读取目录${serverDir}: ${err}`, 'error');
          }
        }
        resolve();
        return;
      }
      
      if (onProgress) {
        onProgress(`找到启动脚本${scriptName}，正在运行...`, 'info');
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

      this.currentProcess = serverProcess;
      let hasEulaMessage = false;

      // 监听标准输出
      serverProcess.stdout?.on('data', (data: Buffer) => {
        if (this.cancelled) {
          serverProcess.kill('SIGTERM');
          return;
        }
        
        const output = data.toString();
        if (onProgress) {
          onProgress(output, 'info');
        }
        
        // 检查是否出现EULA相关信息
        if (output.toLowerCase().includes('eula') || 
            output.toLowerCase().includes('you need to agree to the eula')) {
          hasEulaMessage = true;
          if (onProgress) {
            onProgress('检测到EULA协议提示，正在关闭服务端...', 'info');
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
        if (onProgress) {
          onProgress(output, 'error');
        }
        
        if (output.toLowerCase().includes('eula')) {
          hasEulaMessage = true;
          if (onProgress) {
            onProgress('检测到EULA协议提示，正在关闭服务端...', 'info');
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
          if (onProgress) {
            onProgress('服务端已关闭，EULA协议检测完成。', 'success');
          }
          resolve();
        } else if (code === 0) {
          if (onProgress) {
            onProgress('服务端正常退出。', 'success');
          }
          resolve();
        } else {
          if (onProgress) {
            onProgress(`服务端退出，退出码: ${code}`, 'info');
          }
          resolve();
        }
      });

      // 监听进程错误
      serverProcess.on('error', (error: Error) => {
        this.currentProcess = undefined;
        if (onProgress) {
          onProgress(`启动服务端失败: ${error.message}`, 'error');
        }
        resolve(); // 不抛出错误，继续执行
      });

      // 设置超时（10分钟）
      setTimeout(() => {
        if (!serverProcess.killed && !this.cancelled) {
          if (onProgress) {
            onProgress('服务端运行超时，正在强制关闭...', 'warn');
          }
          serverProcess.kill('SIGKILL');
          this.currentProcess = undefined;
          resolve();
        }
      }, 10 * 60 * 1000);
    });
  }

  /**
   * 清理临时文件
   */
  async cleanup(): Promise<void> {
    try {
      if (await fs.pathExists(this.tempDir)) {
        await fs.remove(this.tempDir);
      }
    } catch (error) {
      console.warn(`清理临时目录失败: ${error}`);
    }
  }
}

// ==================== 导出 ====================

export default MrpackServerAPI;