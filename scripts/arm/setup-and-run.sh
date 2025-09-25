#!/bin/bash
# ARM64 一键安装依赖和运行开发服务器脚本
# 基于 qemu-aarch64-static 模拟运行 ARM64 Node.js

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[信息]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[成功]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[警告]${NC} $1"
}

log_error() {
    echo -e "${RED}[错误]${NC} $1"
}

# ARM64 Node.js 路径配置
NODE_BIN="/home/xiaozhu/qemu/Node/node-v20.19.0-linux-arm64/bin/node"
NPM_CLI="/home/xiaozhu/qemu/Node/node-v20.19.0-linux-arm64/lib/node_modules/npm/bin/npm-cli.js"
QEMU_ARM64="/usr/bin/qemu-aarch64-static"
QEMU_LIB="/usr/aarch64-linux-gnu"

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 项目根目录（脚本在 scripts/arm/ 目录下）
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log_info "项目根目录: $PROJECT_ROOT"

# ARM64 npm 命令封装函数
run_arm_npm() {
    local npm_args="$@"
    log_info "执行 ARM64 npm 命令: npm $npm_args"
    
    if ! command -v qemu-aarch64-static &> /dev/null; then
        log_error "qemu-aarch64-static 未找到，请先安装 qemu-user-static"
        log_info "安装命令: sudo apt-get install qemu-user-static"
        exit 1
    fi
    
    if [[ ! -f "$NODE_BIN" ]]; then
        log_error "ARM64 Node.js 二进制文件未找到: $NODE_BIN"
        log_info "请确保 ARM64 Node.js 已正确安装到指定路径"
        exit 1
    fi
    
    if [[ ! -f "$NPM_CLI" ]]; then
        log_error "ARM64 npm CLI 文件未找到: $NPM_CLI"
        exit 1
    fi
    
    qemu-aarch64-static -L "$QEMU_LIB" "$NODE_BIN" "$NPM_CLI" $npm_args
}

# ARM64 node 命令封装函数
run_arm_node() {
    local node_args="$@"
    log_info "执行 ARM64 node 命令: node $node_args"
    
    if ! command -v qemu-aarch64-static &> /dev/null; then
        log_error "qemu-aarch64-static 未找到"
        exit 1
    fi
    
    if [[ ! -f "$NODE_BIN" ]]; then
        log_error "ARM64 Node.js 二进制文件未找到: $NODE_BIN"
        exit 1
    fi
    
    qemu-aarch64-static -L "$QEMU_LIB" "$NODE_BIN" $node_args
}

# 检查依赖环境
check_dependencies() {
    log_info "检查运行环境..."
    
    # 检查 qemu-aarch64-static
    if ! command -v qemu-aarch64-static &> /dev/null; then
        log_error "qemu-aarch64-static 未安装"
        log_info "请运行: sudo apt-get install qemu-user-static"
        exit 1
    fi
    
    # 检查 ARM64 Node.js
    if [[ ! -f "$NODE_BIN" ]]; then
        log_error "ARM64 Node.js 未找到: $NODE_BIN"
        log_info "请确保已下载并解压 ARM64 版本的 Node.js 到指定路径"
        exit 1
    fi
    
    # 检查 ARM64 npm
    if [[ ! -f "$NPM_CLI" ]]; then
        log_error "ARM64 npm 未找到: $NPM_CLI"
        exit 1
    fi
    
    # 检查 qemu 库路径
    if [[ ! -d "$QEMU_LIB" ]]; then
        log_error "QEMU 库路径未找到: $QEMU_LIB"
        log_info "请运行: sudo apt-get install libc6-dev-arm64-cross"
        exit 1
    fi
    
    log_success "环境检查通过"
}

# 安装项目依赖
install_dependencies() {
    log_info "开始安装项目依赖..."

    # 设置 node 命令的符号链接，以便 postinstall 脚本可以找到 node
    mkdir -p ~/.local/bin
    ln -sf "$PROJECT_ROOT/scripts/arm/node-arm64.sh" ~/.local/bin/node
    export PATH="$HOME/.local/bin:$PATH"

    cd "$PROJECT_ROOT"

    # 安装根目录依赖
    log_info "安装根目录依赖..."
    run_arm_npm install

    # 安装服务端依赖
    log_info "安装服务端依赖..."
    cd "$PROJECT_ROOT/server"
    run_arm_npm install

    # 安装客户端依赖
    log_info "安装客户端依赖..."
    cd "$PROJECT_ROOT/client"
    run_arm_npm install

    cd "$PROJECT_ROOT"
    log_success "所有依赖安装完成"
}

# 启动开发服务器
start_dev_server() {
    log_info "启动开发服务器..."

    # 设置环境变量
    export PATH="$HOME/.local/bin:$PATH"

    # 确保符号链接存在
    mkdir -p ~/.local/bin
    ln -sf "$PROJECT_ROOT/scripts/arm/node-arm64.sh" ~/.local/bin/node
    ln -sf "$PROJECT_ROOT/scripts/arm/npm-arm64.sh" ~/.local/bin/npm

    cd "$PROJECT_ROOT"

    log_info "将同时启动客户端和服务端开发服务器"
    log_info "客户端将运行在 http://localhost:5173"
    log_info "服务端将运行在 http://localhost:3000"
    log_warning "按 Ctrl+C 停止所有服务器"

    # 创建一个临时的启动脚本来处理并发启动
    cat > /tmp/start-dev.sh << 'EOF'
#!/bin/bash
export PATH="$HOME/.local/bin:$PATH"

# 启动服务端
start_server() {
    echo "启动服务端..."
    cd "$1/server"
    node --import tsx/esm src/index.ts
}

# 启动客户端
start_client() {
    echo "启动客户端..."
    cd "$1/client"
    npm run dev
}

# 并发启动
start_server "$1" &
SERVER_PID=$!
sleep 3  # 等待服务端启动
start_client "$1" &
CLIENT_PID=$!

# 等待任一进程结束
wait $SERVER_PID $CLIENT_PID

# 清理进程
kill $SERVER_PID $CLIENT_PID 2>/dev/null
EOF

    chmod +x /tmp/start-dev.sh
    /tmp/start-dev.sh "$PROJECT_ROOT"

    # 清理临时文件
    rm -f /tmp/start-dev.sh
}

# 显示帮助信息
show_help() {
    echo "ARM64 GameServerManager 一键安装和运行脚本"
    echo ""
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  install      仅安装依赖"
    echo "  dev          使用 concurrently 启动开发服务器（需要先安装依赖）"
    echo "  dev-simple   使用后台方式启动开发服务器"
    echo "  dev-dual     使用双终端启动开发服务器（推荐）"
    echo "  help         显示此帮助信息"
    echo "  无参数        安装依赖并使用双终端启动开发服务器"
    echo ""
    echo "环境要求:"
    echo "  - qemu-user-static"
    echo "  - ARM64 Node.js v20.19.0 安装在 $NODE_BIN"
    echo "  - libc6-dev-arm64-cross"
    echo ""
}

# 主函数
main() {
    case "${1:-}" in
        "install")
            check_dependencies
            install_dependencies
            log_success "依赖安装完成！运行 '$0 dev-dual' 启动开发服务器"
            ;;
        "dev")
            check_dependencies
            start_dev_server
            ;;
        "dev-simple")
            check_dependencies
            exec "$SCRIPT_DIR/start-dev-simple.sh"
            ;;
        "dev-dual")
            check_dependencies
            exec "$SCRIPT_DIR/start-dev-dual-terminal.sh"
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        "")
            check_dependencies
            install_dependencies
            log_success "依赖安装完成，即将启动开发服务器..."
            sleep 2
            exec "$SCRIPT_DIR/start-dev-dual-terminal.sh"
            ;;
        *)
            log_error "未知选项: $1"
            show_help
            exit 1
            ;;
    esac
}

# 脚本入口
main "$@"
