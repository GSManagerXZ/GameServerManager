# GSM3 Docker 构建说明

## 概述

本项目的 Dockerfile 已经适配为 GSM3 游戏服务端管理面板，在保持原有 Steam 游戏服务器功能的基础上，集成了现代化的 Web 管理界面。现已支持多架构部署，包括 AMD64 和 ARM64 平台。

## 主要特性

- 🎮 **游戏服务器管理**: 支持多种 Steam 游戏服务器（仅AMD64）
- 🌐 **Web 管理界面**: 基于 React + TypeScript 的现代化管理面板
- 🐍 **Python 支持**: 内置 Python 环境用于游戏配置解析
- 📦 **自动构建**: 在 Docker 构建过程中自动运行 `npm run package:linux`
- 🔧 **一键部署**: 使用 Docker Compose 快速部署
- 🏗️ **多架构支持**: 支持 AMD64 和 ARM64 平台

## 架构支持说明

### AMD64 架构 (x86_64)
- ✅ **完整功能支持**
- ✅ GSM3 Web管理界面
- ✅ SteamCMD 游戏服务器管理
- ✅ 所有游戏服务器依赖
- ✅ i386兼容库支持

### ARM64 架构 (aarch64)
- ✅ **GSM3 Web管理界面**
- ✅ Java 21 运行环境
- ✅ Node.js 和 Python 支持
- ❌ SteamCMD（不支持ARM64）
- ❌ 游戏服务器依赖（仅x86游戏）
- 💡 **主要用于管理面板功能**

## 构建过程

### 自动构建流程

1. **环境准备**: 安装 Node.js 22.17.0、Python 3.x 和游戏服务器依赖
2. **项目构建**: 自动执行 `npm run install:all` 安装所有依赖
3. **应用打包**: 自动执行 `npm run package:linux:no-zip` 生成 Linux 生产包（不创建压缩包）
4. **SteamCMD 安装**: 下载并配置 SteamCMD
5. **最终部署**: 将构建好的应用部署到容器中

### 构建命令

#### 多架构构建（推荐）

```bash
# 使用提供的多架构构建脚本
./build-multiarch.sh [tag]

# 手动多架构构建
docker buildx build --platform linux/amd64,linux/arm64 -t xiaozhu674/gameservermanager:latest --push .
```

#### 本地单架构构建

```bash
# 使用本地构建脚本（自动检测架构）
./build-local.sh [tag]

# 手动构建当前架构
docker build -t gsm3-management-panel .

# 或使用 Docker Compose
docker-compose build
```

## 运行说明

### 使用 Docker Compose（推荐）

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 直接使用 Docker

```bash
docker run -d \
  --name gsm3-panel \
  -p 3001:3001 \
  -p 27015-27020:27015-27020 \
  -v ./game_data:/home/steam/games \
  -v ./gsm3_data:/home/steam/server/data \
  gsm3-management-panel
```

## 端口说明

| 端口 | 用途 |
|------|------|
| 3001 | GSM3 Web 管理界面 |
| 27015-27020 | Steam 游戏服务器端口 |
| 7777-7784 | 7 Days to Die 等游戏端口 |
| 25565 | Minecraft 服务器端口 |
| 19132 | Minecraft Bedrock 端口 |

## 数据持久化

- `./game_data` → `/home/steam/games` - 游戏数据
- `./game_file` → `/home/steam/.config` 和 `/home/steam/.local` - 游戏配置
- `./gsm3_data` → `/home/steam/server/data` - GSM3 应用数据

## 运行依赖预置目录说明

运行时路径候选以 Node.js 的 `process.cwd()` 为基准，`data/lib` 与 `server/data/lib` 都相对于该目录解析，并按此顺序尝试。Docker 的 `/root/start.sh` 在启动 Node.js 前执行 `cd server`，因此服务进程的 cwd 是 `/root/server`，两个实际候选依次是：

1. `/root/server/data/lib`
2. `/root/server/server/data/lib`

为避免容器启动后重复下载运行依赖，Docker 构建阶段将当前镜像架构需要的二进制文件预置到第一候选 `/root/server/data/lib`。这只是明确现有候选路径的解析基准，不改变运行时查找顺序。

### PTY 固定资产策略

`Zip-Tools` 和 `7z` 保持现有 GitHub Releases 下载逻辑；PTY 不使用可变发布下载地址。应用打包完成后，最终镜像调用已经随服务端产物打包的 CLI：

```text
node /root/server/utils/ptyAssetCli.js ensure \
  --asset <asset-key> \
  --target-dir /root/server/data/lib
```

`TARGETARCH` 与资产键的映射为：

- `amd64` → `linux-x64`
- `arm64` → `linux-arm64`
- 其他架构 → 构建失败

CLI 读取服务端唯一的固定 release/asset manifest，通过 GitHub API 获取固定资产，并要求文件名、字节数和 SHA-256 全部匹配。最终镜像只选择当前镜像的原生架构，因此只对该原生 PTY 执行 `-h` 能力探测，并要求帮助文本包含 `-fifo`；不会在镜像构建中执行其他架构的二进制文件。

无法验证、无法下载、原生探测失败或架构不受支持时，Docker 构建直接失败，不会保留或接受不可验证的 PTY 文件。固定 release ID、asset ID、大小和哈希详见 `docs/PTY集成说明.md`，不要在 Dockerfile 中另行维护或添加可变 URL 回退。

## 访问管理界面

构建并启动容器后，可通过以下地址访问：

- **Web 界面**: http://localhost:3001
- **默认账户**: admin / admin123

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| NODE_ENV | production | Node.js 运行环境 |
| SERVER_PORT | 3001 | GSM3 服务端口 |
| TZ | Asia/Shanghai | 时区设置 |
| AUTO_UPDATE | true | 自动更新功能 |

## 注意事项

1. **权限设置**: 确保挂载的目录具有正确的权限（建议设置为 777）
2. **防火墙**: 确保相关端口在防火墙中已开放
3. **资源要求**: 建议至少 2GB 内存和 2 CPU 核心
4. **Python 依赖**: 容器启动后会自动安装 Python 依赖
5. **架构选择**:
   - AMD64: 完整功能，适合游戏服务器管理
   - ARM64: 仅管理面板，适合轻量级部署
6. **多架构构建**: 需要 Docker Buildx 支持

## 故障排除

### 查看日志
```bash
# 查看容器日志
docker-compose logs gsm3-server

# 实时查看日志
docker-compose logs -f gsm3-server
```

### 进入容器调试
```bash
# 进入容器
docker-compose exec gsm3-server bash

# 检查应用状态
docker-compose exec gsm3-server ps aux
```

### 重启服务
```bash
# 重启容器
docker-compose restart gsm3-server

# 重新构建并启动
docker-compose up --build -d
```

## 打包选项说明

项目支持多种打包方式：

```bash
# 标准打包（创建压缩包）
npm run package              # 通用版本
npm run package:linux        # Linux版本
npm run package:windows      # Windows版本

# 不创建压缩包（仅生成文件夹）
npm run package:no-zip           # 通用版本，不创建压缩包
npm run package:linux:no-zip    # Linux版本，不创建压缩包
npm run package:windows:no-zip  # Windows版本，不创建压缩包
```

**使用场景**：
- `--no-zip` 参数适用于 Docker 构建，避免创建不必要的压缩包
- 开发和测试环境可以使用不压缩版本，便于快速部署和调试

## 开发模式

如果需要在开发模式下运行，可以直接在宿主机上使用：

```bash
# 安装依赖
npm run install:all

# 开发模式运行
npm run dev
```

## 多架构部署指南

### 构建脚本说明

项目提供了两个构建脚本：

#### 1. `build-multiarch.sh` - 多架构构建脚本
```bash
# 构建并推送到Docker Hub
./build-multiarch.sh latest

# 仅本地构建（AMD64）
./build-multiarch.sh latest
# 选择 'N' 当询问是否推送时
```

**功能特性：**
- 支持 AMD64 和 ARM64 双架构
- 可选择推送到Docker Hub或本地构建
- 自动创建和管理 Docker Buildx 构建器
- 交互式操作，用户友好

#### 2. `build-local.sh` - 本地构建脚本
```bash
# 自动检测当前架构并构建
./build-local.sh latest
```

**功能特性：**
- 自动检测当前系统架构
- 显示架构特定的功能说明
- 适合本地开发和测试
- 无需 Docker Buildx

### 架构特定功能

#### AMD64 部署
```bash
# 完整功能部署
docker run -d \
  --name gsm3-panel \
  -p 3001:3001 \
  -p 27015-27020:27015-27020 \
  -v ./game_data:/root/games \
  -v ./gsm3_data:/root/server/data \
  xiaozhu674/gameservermanager:latest
```

#### ARM64 部署
```bash
# 管理面板部署（无游戏服务器功能）
docker run -d \
  --name gsm3-panel \
  -p 3001:3001 \
  -v ./gsm3_data:/root/server/data \
  xiaozhu674/gameservermanager:latest
```

### Docker Buildx 设置

如果需要手动设置多架构构建环境：

```bash
# 创建新的构建器
docker buildx create --name multiarch-builder --driver docker-container --bootstrap

# 使用构建器
docker buildx use multiarch-builder

# 验证支持的平台
docker buildx inspect --bootstrap

# 构建多架构镜像
docker buildx build --platform linux/amd64,linux/arm64 -t your-image:tag --push .
```

## 更新说明

当项目代码更新后，需要重新构建镜像：

### 单架构更新
```bash
# 停止现有容器
docker-compose down

# 重新构建镜像
docker-compose build --no-cache

# 启动新容器
docker-compose up -d
```

### 多架构更新
```bash
# 使用构建脚本重新构建
./build-multiarch.sh latest

# 或手动构建
docker buildx build --platform linux/amd64,linux/arm64 -t xiaozhu674/gameservermanager:latest --push .
```
