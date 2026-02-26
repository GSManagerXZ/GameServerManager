# PTY 集成说明

## 概述

项目使用 [MCSManager/PTY](https://github.com/MCSManager/PTY) 外部二进制工具处理终端伪终端（PTY）会话。该工具提供跨平台的终端模拟能力。

## 自动下载机制

服务端启动时会自动检测 PTY 二进制文件是否存在：

- **已存在**：跳过下载，记录日志 `PTY 已存在，跳过下载`
- **不存在**：自动下载对应平台的二进制文件（双源策略）
- **下载失败**：记录警告日志但不阻塞服务启动，终端功能可能不可用

### 下载源优先级

1. **自建镜像（主）**：`https://download.xiaozhuhouses.asia/开源项目/GSManager/GSManager3/运行依赖/PTY/`
2. **GitHub Releases（备用）**：`https://github.com/MCSManager/PTY/releases/tag/latest/download/`

运行时优先从自建镜像下载（国内加速），失败后自动回退到 GitHub Releases。

### CI/CD 构建与打包

打包脚本（`scripts/package.js`）和 Docker 构建（`Dockerfile`）在构建时直接从 GitHub Releases 下载 PTY 并内置到产物中，确保用户部署后无需额外下载。

## 支持的平台和架构

| 操作系统 | CPU 架构 | 二进制文件名 |
|---------|---------|-------------|
| Windows | x64 | `pty_win32_x64.exe` |
| Linux | x64 | `pty_linux_x64` |
| Linux | ARM64 | `pty_linux_arm64` |

## 二进制文件存放位置

使用多路径尝试策略，按以下顺序查找：

1. `{项目根目录}/data/lib/` — 打包后环境
2. `{项目根目录}/server/data/lib/` — 开发环境

> **注意**：PTY 文件已从旧的 `server/PTY/` 目录迁移到 `data/lib/` 目录，与 Zip-Tools 统一管理。

## 手动放置二进制文件（离线环境）

如果服务器无法访问外网，可以手动下载并放置二进制文件：

1. 从 [PTY Releases](https://github.com/MCSManager/PTY/releases/tag/latest) 下载对应平台的二进制文件
2. 将文件放置到 `server/data/lib/` 或 `data/lib/` 目录下
3. Linux 平台需要设置可执行权限：`chmod 755 pty_linux_x64`

## 使用的模块

- `PtyManager`（`server/src/utils/ptyManager.ts`）— PTY 二进制文件的路径解析、检测、下载管理
- `TerminalManager`（`server/src/modules/terminal/TerminalManager.ts`）— 通过 PtyManager 获取 PTY 路径并创建终端会话

## 迁移说明（从旧版本升级）

旧版本将 PTY 文件存放在 `server/PTY/` 目录下，新版本已迁移到 `data/lib/` 目录。升级后：

- 旧的 `server/PTY/` 目录可以安全删除
- 服务启动时会自动检测并下载 PTY 到新目录
- 打包产物中不再包含 `server/PTY/` 目录
