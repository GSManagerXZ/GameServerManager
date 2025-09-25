# GameServerManager ARM64 启动指南

本指南介绍如何在 ARM64 架构或通过 QEMU 模拟环境中启动 GameServerManager 开发环境。

## 🚀 快速开始

### 首次使用
```bash
# 一键安装依赖并启动双终端开发环境
./start-arm64.sh
```

### 日常开发
```bash
# 直接启动开发环境（假设依赖已安装）
./dev-arm64.sh
```

## 📋 所有启动选项

### 1. 主启动脚本 (`start-arm64.sh`)
```bash
./start-arm64.sh                # 安装依赖 + 双终端启动
./start-arm64.sh install        # 仅安装依赖
./start-arm64.sh dev-dual       # 双终端启动（推荐）
./start-arm64.sh dev-simple     # 后台启动
./start-arm64.sh dev            # 并发启动
./start-arm64.sh help           # 显示帮助
```

### 2. 快速开发脚本 (`dev-arm64.sh`)
```bash
./dev-arm64.sh                  # 直接启动双终端开发环境
```

### 3. 详细脚本 (`scripts/arm/setup-and-run.sh`)
```bash
./scripts/arm/setup-and-run.sh [选项]
```

### 4. 独立启动脚本
```bash
./scripts/arm/start-dev-dual-terminal.sh    # 双终端模式
./scripts/arm/start-dev-simple.sh           # 后台模式
```

## 🎯 启动模式对比

| 模式 | 脚本 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|----------|
| **双终端** | `dev-dual` | 实时输出，易调试 | 需要图形界面 | 日常开发（推荐） |
| **后台** | `dev-simple` | 不占用终端 | 看不到实时输出 | 后台运行 |
| **并发** | `dev` | 单终端显示 | 输出混合 | 简单测试 |

## 🔧 环境要求

### 系统依赖
```bash
# 安装 QEMU 用户模式模拟器
sudo apt-get install qemu-user-static

# 安装 ARM64 交叉编译库
sudo apt-get install libc6-dev-arm64-cross
```

### ARM64 Node.js
确保 ARM64 版本的 Node.js v20.19.0 已安装到：
```
/home/xiaozhu/qemu/Node/node-v20.19.0-linux-arm64/
```

## 🌐 访问地址

启动成功后，可通过以下地址访问：

- **前端（客户端）**: http://localhost:5173
- **后端（API）**: http://localhost:3000

## 🛠️ 故障排除

### 1. 终端未打开
- 确保系统安装了图形界面和终端模拟器
- 支持的终端：gnome-terminal, konsole, xfce4-terminal, xterm, terminator

### 2. 权限问题
```bash
chmod +x *.sh scripts/arm/*.sh
```

### 3. 依赖未安装
```bash
./start-arm64.sh install
```

### 4. 端口被占用
```bash
# 检查端口占用
lsof -i :3000
lsof -i :5173

# 停止相关进程
pkill -f "node.*tsx.*src/index.ts"
pkill -f "vite"
```

### 5. 查看日志（后台模式）
```bash
tail -f /tmp/gsm-server.log    # 服务端日志
tail -f /tmp/gsm-client.log    # 客户端日志
```

## 📝 开发工作流

1. **首次设置**
   ```bash
   ./start-arm64.sh
   ```

2. **日常开发**
   ```bash
   ./dev-arm64.sh
   ```

3. **代码修改**
   - 前端代码修改会自动热重载
   - 后端代码修改会自动重启服务

4. **停止服务**
   - 双终端模式：在对应终端按 `Ctrl+C`
   - 后台模式：运行清理命令或重启脚本

5. **重新启动**
   ```bash
   ./dev-arm64.sh
   ```

## 🎉 成功标志

启动成功后，您应该看到：

1. **双终端模式**：
   - 两个独立的终端窗口
   - 服务端终端显示后端日志
   - 客户端终端显示 Vite 开发服务器信息

2. **浏览器访问**：
   - http://localhost:5173 显示前端界面
   - http://localhost:3000 可访问 API

3. **热重载**：
   - 修改前端代码，浏览器自动刷新
   - 修改后端代码，服务自动重启

## 📚 相关文档

- [scripts/arm/README.md](scripts/arm/README.md) - ARM64 脚本详细说明
- [README.md](README.md) - 项目主文档
- [docs/开发说明.md](docs/开发说明.md) - 开发指南
