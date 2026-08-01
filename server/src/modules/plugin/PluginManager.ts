import { promises as fs } from "fs";
import fsSync from "fs";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import type winston from "winston";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
})[character] as string);

const normalizePluginEntryPoint = (value: string): string => {
	const normalized = value.replace(/\\/g, "/").trim();
	const segments = normalized.split("/");
	if (
		!normalized ||
		path.isAbsolute(normalized) ||
		segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith(".")) ||
		!normalized.toLowerCase().endsWith(".html")
	) {
		throw new Error("插件入口必须是插件目录内的 HTML 相对路径");
	}
	return segments.join("/");
};

export interface Plugin {
	name: string;
	displayName: string;
	description: string;
	version: string;
	author: string;
	enabled: boolean;
	hasWebInterface: boolean;
	entryPoint?: string;
	icon?: string;
	category?: string;
}

export interface PluginConfig {
	name: string;
	displayName: string;
	description: string;
	version: string;
	author: string;
	enabled: boolean;
	hasWebInterface: boolean;
	entryPoint?: string;
	icon?: string;
	category?: string;
}

export class PluginManager {
	private plugins: Map<string, Plugin> = new Map();
	private pluginsDir: string;
	private logger: winston.Logger;

	constructor(logger: winston.Logger) {
		this.logger = logger;
		const baseDir = process.cwd();
		const possiblePaths = [
			path.join(baseDir, "data", "plugins"), // 打包后的路径
			path.join(baseDir, "server", "data", "plugins"), // 开发环境路径
			path.join(__dirname, "../../data/plugins"), // dist/modules/plugin -> data/plugins
			path.join(__dirname, "../../../data/plugins"), // src/modules/plugin -> server/data/plugins
		];

		this.pluginsDir = possiblePaths[0];
		for (const possiblePath of possiblePaths) {
			if (fsSync.existsSync(possiblePath)) {
				this.pluginsDir = possiblePath;
				break;
			}
		}

		this.initializePluginsDirectory();
	}

	private async initializePluginsDirectory(): Promise<void> {
		try {
			await fs.mkdir(this.pluginsDir, { recursive: true });
			this.logger.info("插件目录已初始化:", this.pluginsDir);
		} catch (error) {
			this.logger.error("初始化插件目录失败:", error);
		}
	}

	async loadPlugins(): Promise<void> {
		try {
			const entries = await fs.readdir(this.pluginsDir, {
				withFileTypes: true,
			});
			const pluginDirs = entries.filter((entry) => entry.isDirectory());

			for (const dir of pluginDirs) {
				await this.loadPlugin(dir.name);
			}

			this.logger.info(`已加载 ${this.plugins.size} 个插件`);
		} catch (error) {
			this.logger.error("加载插件失败:", error);
		}
	}

	private async loadPlugin(pluginName: string): Promise<void> {
		try {
			const pluginDir = this.resolvePluginDirectory(pluginName);
			const configPath = path.join(pluginDir, "plugin.json");

			// 检查配置文件是否存在
			try {
				await fs.access(configPath);
			} catch {
				// 如果没有配置文件，创建默认配置
				await this.createDefaultPluginConfig(pluginName, pluginDir);
			}

			const configContent = await fs.readFile(configPath, "utf-8");
			const config: PluginConfig = JSON.parse(configContent);

			const plugin: Plugin = {
				name: pluginName,
				displayName: config.displayName || pluginName,
				description: config.description || "暂无描述",
				version: config.version || "1.0.0",
				author: config.author || "未知",
				enabled: config.enabled !== false,
				hasWebInterface: config.hasWebInterface || false,
				entryPoint: config.entryPoint || "index.html",
				icon: config.icon || "puzzle",
				category: config.category || "其他",
			};

			this.plugins.set(pluginName, plugin);
			this.logger.info(`插件已加载: ${pluginName}`);
		} catch (error) {
			this.logger.error(`加载插件 ${pluginName} 失败:`, error);
		}
	}

	private async createDefaultPluginConfig(
		pluginName: string,
		pluginDir: string,
	): Promise<void> {
		const defaultConfig: PluginConfig = {
			name: pluginName,
			displayName: pluginName,
			description: "暂无描述",
			version: "1.0.0",
			author: "未知",
			enabled: true,
			hasWebInterface: true,
			entryPoint: "index.html",
			icon: "puzzle",
			category: "其他",
		};

		const configPath = path.join(pluginDir, "plugin.json");
		await fs.writeFile(
			configPath,
			JSON.stringify(defaultConfig, null, 2),
			"utf-8",
		);
		this.logger.info(`已为插件 ${pluginName} 创建默认配置`);
	}

	getPlugins(): Plugin[] {
		return Array.from(this.plugins.values());
	}

	getPlugin(name: string): Plugin | undefined {
		return this.plugins.get(name);
	}

	async enablePlugin(name: string): Promise<boolean> {
		const plugin = this.plugins.get(name);
		if (!plugin) {
			return false;
		}

		plugin.enabled = true;
		await this.savePluginConfig(name, plugin);
		this.logger.info(`插件已启用: ${name}`);
		return true;
	}

	async disablePlugin(name: string): Promise<boolean> {
		const plugin = this.plugins.get(name);
		if (!plugin) {
			return false;
		}

		plugin.enabled = false;
		await this.savePluginConfig(name, plugin);
		this.logger.info(`插件已禁用: ${name}`);
		return true;
	}

	private async savePluginConfig(name: string, plugin: Plugin): Promise<void> {
		try {
			const pluginDir = this.resolvePluginDirectory(name);
			const configPath = path.join(pluginDir, "plugin.json");
			const temporaryPath = `${configPath}.tmp-${process.pid}-${randomUUID()}`;

			const config: PluginConfig = {
				name: plugin.name,
				displayName: plugin.displayName,
				description: plugin.description,
				version: plugin.version,
				author: plugin.author,
				enabled: plugin.enabled,
				hasWebInterface: plugin.hasWebInterface,
				entryPoint: plugin.entryPoint,
				icon: plugin.icon,
				category: plugin.category,
			};

			await fs.writeFile(temporaryPath, JSON.stringify(config, null, 2), "utf-8");
			try {
				if (process.platform === "win32" && fsSync.existsSync(configPath)) {
					const backupPath = `${configPath}.backup-${process.pid}-${randomUUID()}`;
					await fs.rename(configPath, backupPath);
					try {
						await fs.rename(temporaryPath, configPath);
						await fs.rm(backupPath, { force: true }).catch((error) => {
							this.logger.warn(`清理插件配置备份失败 ${backupPath}:`, error);
						});
					} catch (error) {
						await fs.rename(backupPath, configPath).catch(() => {});
						throw error;
					}
				} else {
					await fs.rename(temporaryPath, configPath);
				}
			} finally {
				await fs.rm(temporaryPath, { force: true }).catch(() => {});
			}
		} catch (error) {
			this.logger.error(`保存插件配置失败 ${name}:`, error);
		}
	}

	async createPlugin(
		name: string,
		config: Partial<PluginConfig>,
	): Promise<boolean> {
		try {
			const pluginDir = this.resolvePluginDirectory(name);

			// 检查插件是否已存在
			if (this.plugins.has(name)) {
				return false;
			}

			// 创建插件目录
			await fs.mkdir(pluginDir, { recursive: true });

			// 创建插件配置
			const pluginConfig: PluginConfig = {
				name,
				displayName: config.displayName || name,
				description: config.description || "暂无描述",
				version: config.version || "1.0.0",
				author: config.author || "未知",
				enabled: config.enabled !== false,
				hasWebInterface: config.hasWebInterface !== false,
				entryPoint: normalizePluginEntryPoint(config.entryPoint || "index.html"),
				icon: config.icon || "puzzle",
				category: config.category || "其他",
			};

			const configPath = path.join(pluginDir, "plugin.json");
			await fs.writeFile(
				configPath,
				JSON.stringify(pluginConfig, null, 2),
				"utf-8",
			);

			// 创建默认的HTML文件
			if (pluginConfig.hasWebInterface) {
				const safeDisplayName = escapeHtml(pluginConfig.displayName);
				const safeVersion = escapeHtml(pluginConfig.version);
				const safeAuthor = escapeHtml(pluginConfig.author);
				const safeDescription = escapeHtml(pluginConfig.description);
				const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeDisplayName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.1);
            padding: 30px;
            border-radius: 15px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        h1 {
            text-align: center;
            margin-bottom: 30px;
            font-size: 2.5em;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }
        .info {
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
        }
        .info h3 {
            margin-top: 0;
            color: #ffd700;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${safeDisplayName}</h1>
        <div class="info">
            <h3>插件信息</h3>
            <p><strong>名称:</strong> ${safeDisplayName}</p>
            <p><strong>版本:</strong> ${safeVersion}</p>
            <p><strong>作者:</strong> ${safeAuthor}</p>
            <p><strong>描述:</strong> ${safeDescription}</p>
        </div>
        <div class="info">
            <h3>开发说明</h3>
            <p>这是一个示例插件页面。您可以在此目录下创建自己的HTML、CSS和JavaScript文件来构建插件界面。</p>
            <p>插件目录: <code>/data/plugins/${name}/</code></p>
        </div>
    </div>
</body>
</html>`;

				const htmlPath = path.join(
					pluginDir,
					pluginConfig.entryPoint || "index.html",
				);
				await fs.mkdir(path.dirname(htmlPath), { recursive: true });
				await fs.writeFile(htmlPath, htmlContent, "utf-8");
			}

			// 重新加载插件
			await this.loadPlugin(name);

			this.logger.info(`插件已创建: ${name}`);
			return true;
		} catch (error) {
			this.logger.error(`创建插件失败 ${name}:`, error);
			return false;
		}
	}

	async deletePlugin(name: string): Promise<boolean> {
		try {
			const pluginDir = this.resolvePluginDirectory(name);

			// 检查插件是否存在
			if (!this.plugins.has(name)) {
				return false;
			}

			// 删除插件目录
			await fs.rm(pluginDir, { recursive: true, force: true });

			// 从内存中移除
			this.plugins.delete(name);

			this.logger.info(`插件已删除: ${name}`);
			return true;
		} catch (error) {
			this.logger.error(`删除插件失败 ${name}:`, error);
			return false;
		}
	}

	getPluginPath(name: string): string {
		return this.resolvePluginDirectory(name);
	}

	private resolvePluginDirectory(name: string): string {
		if (
			!name ||
			name.includes("\0") ||
			path.isAbsolute(name) ||
			name === "." ||
			name === ".." ||
			name.includes("/") ||
			name.includes("\\")
		) {
			throw new Error("插件名称必须是插件目录下的单级目录名");
		}
		const pluginDirectory = path.resolve(this.pluginsDir, name);
		const relative = path.relative(path.resolve(this.pluginsDir), pluginDirectory);
		if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error("插件目录超出允许范围");
		}
		return pluginDirectory;
	}

	cleanup(): void {
		this.plugins.clear();
		this.logger.info("PluginManager 已清理");
	}
}
