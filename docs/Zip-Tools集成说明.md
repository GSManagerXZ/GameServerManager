# Zip-Tools 集成说明

## 概述

项目使用 [MCSManager/Zip-Tools](https://github.com/MCSManager/Zip-Tools) 外部二进制工具（`file_zip`）处理所有 ZIP 压缩/解压操作。该工具使用 Go 语言编写，具有更好的跨平台兼容性和中文编码支持。

## 自动下载机制

服务端启动时会自动检测 Zip-Tools 二进制文件是否存在：

- **已存在**：跳过下载，记录日志 `Zip-Tools 已存在，跳过下载`
- **不存在**：自动下载对应平台的二进制文件（双源策略）
- **下载失败**：记录警告日志但不阻塞服务启动，ZIP 相关功能可能不可用

### 下载源优先级

1. **自建镜像（主）**：`https://download.xiaozhuhouses.asia/开源项目/GSManager/GSManager3/运行依赖/Zip-Tools/`
2. **GitHub Releases（备用）**：`https://github.com/MCSManager/Zip-Tools/releases/latest/download/`

运行时优先从自建镜像下载（国内加速），失败后自动回退到 GitHub Releases。

### CI/CD 构建与打包

打包脚本（`scripts/package.js`）和 Docker 构建（`Dockerfile`）在构建时直接从 GitHub Releases 下载 Zip-Tools 并内置到产物中，确保用户部署后无需额外下载。

## 支持的平台和架构

| 操作系统 | CPU 架构 | 二进制文件名 |
|---------|---------|-------------|
| Windows | x64 | `file_zip_win32_x64.exe` |
| Windows | ARM64 | `file_zip_win32_arm64.exe` |
| Linux | x64 | `file_zip_linux_x64` |
| Linux | ARM64 | `file_zip_linux_arm64` |
| macOS | x64 | `file_zip_darwin_amd64` |
| macOS | ARM64 | `file_zip_darwin_arm64` |

## 二进制文件存放位置

使用多路径尝试策略，按以下顺序查找：

1. `{项目根目录}/data/lib/` — 打包后环境
2. `{项目根目录}/server/data/lib/` — 开发环境

## 手动放置二进制文件（离线环境）

如果服务器无法访问 GitHub，可以手动下载并放置二进制文件：

1. 从 [Zip-Tools Releases](https://github.com/MCSManager/Zip-Tools/releases/latest) 下载对应平台的二进制文件
2. 将文件放置到 `server/data/lib/` 或 `data/lib/` 目录下
3. Linux/macOS 平台需要设置可执行权限：`chmod 755 file_zip_linux_amd64`

## ZIP 操作命令行参数格式

### 解压（mode=2）

```bash
file_zip -mode 2 --zipPath {zip文件名} --DistDirPath {目标目录绝对路径} --code utf-8
```

- `--zipPath`：ZIP 文件名（非完整路径），进程工作目录设为 ZIP 文件所在目录
- `--DistDirPath`：解压目标目录的绝对路径（注意大写 D）
- `--code utf-8`：使用 UTF-8 编码处理文件名
- `-mode`：使用单横线，值通过空格分隔

### 压缩（mode=1）

```bash
file_zip -mode 1 --file {文件1} --file {文件2} ... --zipPath {zip文件名} --code utf-8
```

- `--zipPath`：输出 ZIP 文件名
- `--file`：每个待压缩文件一个 `--file` 参数
- `--code utf-8`：使用 UTF-8 编码处理文件名
- 进程工作目录设为待压缩文件所在目录

## 使用的模块

以下模块已迁移到使用 Zip-Tools：

- `CompressionWorker` — 文件管理的 ZIP 压缩/解压
- `FilesRoute` — 文件路由的 ZIP 解压
- `OnlineDeploy` — 在线部署的 ZIP 解压
- `JavaManager` — Java 环境安装的 ZIP 解压
- `SteamCMDManager` — SteamCMD 安装的 ZIP 解压
- `CloudBuild` — 云构建下载后的 ZIP 解压
- `FactorioDeployer` — Factorio 服务端部署的 ZIP 解压
- `TModDownloader` — TModLoader 服务端的 ZIP 解压
- `MrpackServerAPI` — Modrinth 整合包的 mrpack 文件解压（读取 index 和提取 overrides）
- `unified-functions` — 统一游戏服务器管理函数库中的 ZIP 解压

TAR 相关操作（TAR、TAR.GZ、TAR.XZ）仍使用 Node.js `tar` 库和 `tarSecurityFilter` 安全过滤器。

## 已移除的依赖

迁移完成后，以下 Node.js ZIP 库已从 `server/package.json` 中移除：

- `adm-zip` / `@types/adm-zip`
- `yauzl` / `@types/yauzl`
- `unzipper`

保留的依赖：
- `archiver` — 日志导出等 TAR 压缩仍需使用
- `tar` — TAR/TAR.GZ/TAR.XZ 解压仍需使用
