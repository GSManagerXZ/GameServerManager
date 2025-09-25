#!/bin/bash
# ARM64 简化开发服务器启动脚本

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# 获取项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log_info "项目根目录: $PROJECT_ROOT"

# 设置环境
setup_environment() {
    log_info "设置 ARM64 环境..."
    
    # 创建本地 bin 目录
    mkdir -p ~/.local/bin
    
    # 创建符号链接
    ln -sf "$PROJECT_ROOT/scripts/arm/node-arm64.sh" ~/.local/bin/node
    ln -sf "$PROJECT_ROOT/scripts/arm/npm-arm64.sh" ~/.local/bin/npm
    
    # 设置 PATH
    export PATH="$HOME/.local/bin:$PATH"
    
    log_success "环境设置完成"
}

# 启动服务端
start_server() {
    log_info "启动服务端..."
    cd "$PROJECT_ROOT/server"

    # 使用 node 直接运行，避免 tsx 的问题
    nohup node --import tsx/esm src/index.ts > /tmp/gsm-server.log 2>&1 &
    SERVER_PID=$!

    log_success "服务端启动中... PID: $SERVER_PID"
    echo "$SERVER_PID"
}

# 启动客户端
start_client() {
    log_info "启动客户端..."
    cd "$PROJECT_ROOT/client"

    nohup npm run dev > /tmp/gsm-client.log 2>&1 &
    CLIENT_PID=$!

    log_success "客户端启动中... PID: $CLIENT_PID"
    echo "$CLIENT_PID"
}

# 清理函数
cleanup() {
    log_warning "正在停止服务器..."
    
    if [[ -n "$SERVER_PID" ]]; then
        kill $SERVER_PID 2>/dev/null || true
        log_info "服务端已停止"
    fi
    
    if [[ -n "$CLIENT_PID" ]]; then
        kill $CLIENT_PID 2>/dev/null || true
        log_info "客户端已停止"
    fi
    
    # 清理后台进程
    pkill -f "node.*tsx.*src/index.ts" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    
    log_success "清理完成"
    exit 0
}

# 设置信号处理
trap cleanup SIGINT SIGTERM

# 主函数
main() {
    setup_environment
    
    cd "$PROJECT_ROOT"
    
    log_info "启动 GameServerManager 开发环境"
    log_info "客户端地址: http://localhost:5173"
    log_info "服务端地址: http://localhost:3000"
    log_warning "按 Ctrl+C 停止所有服务"
    echo ""
    
    # 启动服务端
    SERVER_PID=$(start_server)

    # 等待服务端启动
    sleep 3

    # 启动客户端
    CLIENT_PID=$(start_client)

    # 等待服务启动完成
    sleep 5

    log_success "所有服务已启动！"
    log_info "查看服务端日志: tail -f /tmp/gsm-server.log"
    log_info "查看客户端日志: tail -f /tmp/gsm-client.log"

    # 等待用户中断
    while true; do
        sleep 1
    done
}

# 运行主函数
main "$@"
