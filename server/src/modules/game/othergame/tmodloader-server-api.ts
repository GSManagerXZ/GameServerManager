import axios from 'axios';
import * as fs from 'fs';
import { createWriteStream } from 'fs';
import * as path from 'path';
import { zipToolsManager } from '../../../utils/zipToolsManager.js';
import { promisify } from 'util';

export interface TModDownloaderOptions {
  /** 下载目录，默认为当前目录 */
  downloadDir?: string;
  /** 解压目录，默认为下载目录下的tmodloader文件夹 */
  extractDir?: string;
  /** 是否在解压后删除压缩包，默认为true */
  deleteAfterExtract?: boolean;
  /** 是否在解压前清空目标目录，默认为false */
  clearExtractDir?: boolean;
  /** 是否创建版本号子目录，默认为false */
  createVersionDir?: boolean;
}

export class TModDownloader {
  private readonly githubApiUrl = 'https://api.github.com/repos/tModLoader/tModLoader/releases/latest';
  private readonly fileName = 'tmodloader.zip';
  private options: Required<TModDownloaderOptions>;
  private cancelled: boolean = false;
  private currentDownloadController?: AbortController;

  constructor(options: TModDownloaderOptions = {}) {
    const baseDownloadDir = options.downloadDir || process.cwd();
    const baseExtractDir = options.extractDir || path.join(baseDownloadDir, 'tmodloader');
    
    this.options = {
      downloadDir: baseDownloadDir,
      extractDir: baseExtractDir,
      deleteAfterExtract: options.deleteAfterExtract ?? true,
      clearExtractDir: options.clearExtractDir ?? false,
      createVersionDir: options.createVersionDir ?? false
    };
  }

  /**
   * 获取最新版本信息
   */
  private async getLatestReleaseInfo(): Promise<{ downloadUrl: string; version: string }> {
    try {
      const response = await axios.get(this.githubApiUrl);
      const assets = response.data.assets;
      const version = response.data.tag_name || 'unknown';
      
      // 查找tModLoader服务端文件（优先级顺序）
      const patterns = [
        /tmodloader.*server.*\.zip$/i,  // tmodloader-server.zip
        /tmodloader.*\.zip$/i,          // tmodloader.zip
        /.*server.*\.zip$/i,            // 包含server的zip文件
        /^(?!.*example).*\.zip$/i       // 不包含example的zip文件
      ];
      
      for (const pattern of patterns) {
        const asset = assets.find((asset: any) => pattern.test(asset.name));
        if (asset) {
          return { downloadUrl: asset.browser_download_url, version };
        }
      }
      
      // 如果都没找到，返回第一个zip文件（排除ExampleMod）
      const zipAsset = assets.find((asset: any) => 
        asset.name.endsWith('.zip') && 
        !asset.name.toLowerCase().includes('example')
      );
      if (zipAsset) {
        return { downloadUrl: zipAsset.browser_download_url, version };
      }
      
      throw new Error('未找到可下载的zip文件');
    } catch (error) {
      throw new Error(`获取最新版本失败: ${error}`);
    }
  }

  /**
   * 获取最新版本的下载地址（向后兼容）
   */
  private async getLatestDownloadUrl(): Promise<string> {
    const { downloadUrl } = await this.getLatestReleaseInfo();
    return downloadUrl;
  }

  /**
   * 清空目录
   */
  private clearDirectory(dirPath: string): void {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          this.clearDirectory(filePath);
          fs.rmdirSync(filePath);
        } else {
          fs.unlinkSync(filePath);
        }
      }
      console.log(`已清空目录: ${dirPath}`);
    }
  }

  /**
   * 获取最终的解压目录
   */
  private getFinalExtractDir(version?: string): string {
    let extractDir = this.options.extractDir;
    
    if (this.options.createVersionDir && version) {
      // 清理版本号（移除v前缀）
      const cleanVersion = version.replace(/^v/, '');
      extractDir = path.join(extractDir, cleanVersion);
    }
    
    return extractDir;
  }

  /**
   * 获取最新版本的下载地址（旧方法，保持兼容性）
   */
  private async getLatestDownloadUrlLegacy(): Promise<string> {
    try {
      const response = await axios.get(this.githubApiUrl);
      const assets = response.data.assets;
      
      // 查找tModLoader服务端文件（优先级顺序）
      const patterns = [
        /tmodloader.*server.*\.zip$/i,  // tmodloader-server.zip
        /tmodloader.*\.zip$/i,          // tmodloader.zip
        /.*server.*\.zip$/i,            // 包含server的zip文件
        /^(?!.*example).*\.zip$/i       // 不包含example的zip文件
      ];
      
      for (const pattern of patterns) {
        const asset = assets.find((asset: any) => pattern.test(asset.name));
        if (asset) {
          return asset.browser_download_url;
        }
      }
      
      // 如果都没找到，返回第一个zip文件（排除ExampleMod）
      const zipAsset = assets.find((asset: any) => 
        asset.name.endsWith('.zip') && 
        !asset.name.toLowerCase().includes('example')
      );
      if (zipAsset) {
        return zipAsset.browser_download_url;
      }
      
      throw new Error('未找到可下载的zip文件');
    } catch (error) {
      throw new Error(`获取最新版本失败: ${error}`);
    }
  }

  /**
   * 取消当前下载/解压操作
   */
  cancel(): void {
    this.cancelled = true;
    
    // 取消当前下载请求
    if (this.currentDownloadController) {
      this.currentDownloadController.abort();
    }
    
    // 清理临时文件
    this.cleanupDirectory().catch(() => {
      // 忽略清理错误
    });
    
    console.log('tModLoader下载已取消');
  }

  /**
   * 检查是否已取消
   */
  isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * 下载文件
   */
  private async downloadFile(url: string, filePath: string): Promise<void> {
    try {
      // 创建新的AbortController
      this.currentDownloadController = new AbortController();
      
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        signal: this.currentDownloadController.signal
      });

      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      // 使用传统的 stream pipe 方法替代 pipeline
      await new Promise<void>((resolve, reject) => {
        const writeStream = createWriteStream(filePath);
        response.data.pipe(writeStream);
        
        writeStream.on('finish', () => resolve());
        writeStream.on('error', (error) => reject(error));
        response.data.on('error', (error: any) => reject(error));
      });
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }
    } catch (error) {
      if (this.cancelled || (error as any)?.code === 'ABORT_ERR') {
        throw new Error('操作已取消');
      }
      throw new Error(`下载文件失败: ${error}`);
    }
  }

  /**
   * 解压文件
   */
  private async extractZip(zipPath: string, extractPath: string): Promise<void> {
    // 检查是否已取消
    if (this.cancelled) {
      throw new Error('操作已取消');
    }

    // 使用 Zip-Tools 解压
    await zipToolsManager.extractZip(zipPath, extractPath);
  }

  /**
   * 检查并删除已存在的压缩包
   */
  private checkAndDeleteExistingZip(filePath: string): void {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`已删除现有文件: ${filePath}`);
    }
  }

  /**
   * 执行完整的下载和解压流程
   */
  async downloadAndExtract(): Promise<void> {
    this.cancelled = false; // 重置取消状态
    const zipPath = path.join(this.options.downloadDir, this.fileName);
    
    try {
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      console.log('开始获取最新版本信息...');
      
      // 获取版本信息和下载地址
      const { downloadUrl, version } = await this.getLatestReleaseInfo();
      console.log(`找到版本: ${version}`);
      console.log(`找到下载地址: ${downloadUrl}`);
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      // 获取最终解压目录
      const finalExtractDir = this.getFinalExtractDir(version);
      console.log(`解压目录: ${finalExtractDir}`);
      
      // 检查并删除已存在的压缩包
      this.checkAndDeleteExistingZip(zipPath);
      
      // 确保下载目录存在
      if (!fs.existsSync(this.options.downloadDir)) {
        fs.mkdirSync(this.options.downloadDir, { recursive: true });
      }
      
      // 清空解压目录（如果需要）
      if (this.options.clearExtractDir) {
        this.clearDirectory(finalExtractDir);
      }
      
      // 确保解压目录存在
      if (!fs.existsSync(finalExtractDir)) {
        fs.mkdirSync(finalExtractDir, { recursive: true });
      }
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      // 下载文件
      console.log(`开始下载到: ${zipPath}`);
      await this.downloadFile(downloadUrl, zipPath);
      console.log('下载完成');
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      // 解压文件
      console.log(`开始解压到: ${finalExtractDir}`);
      await this.extractZip(zipPath, finalExtractDir);
      console.log('解压完成');
      
      // 检查是否已取消
      if (this.cancelled) {
        throw new Error('操作已取消');
      }

      // 删除压缩包
      if (this.options.deleteAfterExtract) {
        fs.unlinkSync(zipPath);
        console.log('压缩包已删除');
      }
      
      // 清理临时文件
      await this.cleanupDirectory();
      
      console.log(`tModLoader服务端 ${version} 下载和解压完成！`);
      console.log(`服务端位置: ${finalExtractDir}`);
    } catch (error) {
      // 清理失败的下载文件
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
      throw error;
    }
  }

  /**
   * 获取当前配置
   */
  getOptions(): Required<TModDownloaderOptions> {
    return { ...this.options };
  }

  /**
   * 更新配置
   */
  updateOptions(options: Partial<TModDownloaderOptions>): void {
    const newDownloadDir = options.downloadDir || this.options.downloadDir;
    const newExtractDir = options.extractDir || 
      (options.downloadDir ? path.join(newDownloadDir, 'tmodloader') : this.options.extractDir);
    
    this.options = {
      ...this.options,
      ...options,
      downloadDir: newDownloadDir,
      extractDir: newExtractDir
    };
  }

  /**
   * 获取最新版本信息（不下载）
   */
  async getVersionInfo(): Promise<{ version: string; downloadUrl: string }> {
    return await this.getLatestReleaseInfo();
  }

  /**
   * 设置自定义解压目录
   */
  setExtractDir(extractDir: string): void {
    this.options.extractDir = path.resolve(extractDir);
  }

  /**
   * 获取当前解压目录（考虑版本目录设置）
   */
  async getCurrentExtractDir(): Promise<string> {
    if (this.options.createVersionDir) {
      const { version } = await this.getLatestReleaseInfo();
      return this.getFinalExtractDir(version);
    }
    return this.options.extractDir;
  }

  /**
   * 清理临时文件和目录
   */
  private async cleanupDirectory(): Promise<void> {
    try {
      const zipPath = path.join(this.options.downloadDir, this.fileName);
      
      // 删除下载的zip文件
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
        console.log(`已清理临时文件: ${zipPath}`);
      }
      
      // 如果下载目录是临时目录且为空，则删除
      if (this.options.downloadDir.includes('temp') || this.options.downloadDir.includes('tmp')) {
        try {
          const files = fs.readdirSync(this.options.downloadDir);
          if (files.length === 0) {
            fs.rmdirSync(this.options.downloadDir);
            console.log(`已清理临时目录: ${this.options.downloadDir}`);
          }
        } catch (error) {
          // 忽略目录删除错误
        }
      }
    } catch (error) {
      console.warn('清理临时文件时出错:', error);
    }
  }
}

// 导出便捷函数
/**
 * 便捷函数：下载并解压tModLoader服务端
 * @param options 下载配置选项
 */
export async function downloadTModLoader(options: TModDownloaderOptions = {}): Promise<void> {
  const downloader = new TModDownloader(options);
  await downloader.downloadAndExtract();
}

/**
 * 便捷函数：仅获取最新版本信息
 * @returns 版本信息和下载地址
 */
export async function getLatestTModLoaderInfo(): Promise<{ version: string; downloadUrl: string }> {
  const downloader = new TModDownloader();
  return await downloader.getVersionInfo();
}