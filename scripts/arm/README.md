# ARM64 开发环境脚本

这些脚本用于在 x86_64 系统上通过 QEMU 模拟运行 ARM64 版本的 Node.js 和 npm。

## 文件说明

- `setup-and-run.sh` - 一键安装依赖和启动开发服务器的主脚本
- `npm-arm64.sh` - ARM64 npm 命令封装脚本
- `node-arm64.sh` - ARM64 node 命令封装脚本

## 环境要求

### 1. 安装 QEMU 用户模式模拟器
```bash
sudo apt-get update
sudo apt-get install qemu-user-static
```

### 2. 安装 ARM64 交叉编译库
```bash
sudo apt-get install libc6-dev-arm64-cross
```

### 3. 下载 ARM64 版本的 Node.js
确保 ARM64 版本的 Node.js v20.19.0 已安装到以下路径：
```
/home/xiaozhu/qemu/Node/node-v20.19.0-linux-arm64/
```

如果路径不同，请修改脚本中的 `NODE_BIN` 和 `NPM_CLI` 变量。

## 使用方法

### 快捷启动（推荐）
```bash
# 一键安装依赖并启动双终端开发环境
./start-arm64.sh

# 或者仅启动开发环境（假设依赖已安装）
./dev-arm64.sh
```

### 详细选项
```bash
# 仅安装依赖
./start-arm64.sh install

# 使用双终端启动（推荐，可看到实时输出）
./start-arm64.sh dev-dual

# 使用后台方式启动
./start-arm64.sh dev-simple

# 使用 concurrently 启动
./start-arm64.sh dev

# 显示帮助信息
./start-arm64.sh help
```

### 独立使用 ARM64 命令
```bash
# 使用 ARM64 npm
./scripts/arm/npm-arm64.sh install
./scripts/arm/npm-arm64.sh run dev

# 使用 ARM64 node
./scripts/arm/node-arm64.sh --version
./scripts/arm/node-arm64.sh script.js
```

## 服务器地址

启动成功后，可以通过以下地址访问：

- **客户端（前端）**: http://localhost:5173
- **服务端（API）**: http://localhost:3000

## 故障排除

### 1. qemu-aarch64-static 未找到
```bash
sudo apt-get install qemu-user-static
```

### 2. ARM64 Node.js 路径错误
检查并修改脚本中的路径配置：
- `NODE_BIN` - Node.js 二进制文件路径
- `NPM_CLI` - npm CLI 脚本路径

### 3. 权限问题
确保脚本有执行权限：
```bash
chmod +x scripts/arm/*.sh
```

### 4. 库文件未找到
安装 ARM64 交叉编译库：
```bash
sudo apt-get install libc6-dev-arm64-cross
```

## 注意事项

1. **性能**: 通过 QEMU 模拟运行会比原生运行慢一些，这是正常现象
2. **内存**: 确保系统有足够的内存来运行模拟环境
3. **路径**: 所有路径都使用绝对路径，确保在任何目录下都能正常运行
4. **依赖**: 首次运行会下载大量依赖包，请确保网络连接稳定

## 开发流程

1. 运行 `./start-arm64.sh` 或 `./dev-arm64.sh` 启动开发环境
2. 等待依赖安装完成（首次运行）和服务器启动
3. 系统会自动打开两个终端窗口：
   - **服务端终端**: 显示后端服务器日志和输出
   - **客户端终端**: 显示前端构建和热重载信息
4. 在浏览器中访问 http://localhost:5173 查看前端
5. API 服务运行在 http://localhost:3000
6. 修改代码后会自动热重载
7. 在对应的终端窗口中按 Ctrl+C 停止服务器

### 启动模式说明

- **双终端模式** (`dev-dual`): 推荐用于开发，可以看到前后端的实时输出
- **后台模式** (`dev-simple`): 后台运行，日志输出到文件
- **并发模式** (`dev`): 使用 concurrently 在同一终端显示输出
