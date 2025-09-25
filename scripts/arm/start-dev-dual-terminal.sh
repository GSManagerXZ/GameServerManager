#!/bin/bash
# ARM64 双终端开发服务器启动脚本
# 在两个独立的终端中分别启动前端和后端

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

# 检测可用的终端模拟器
detect_terminal() {
    if command -v gnome-terminal &> /dev/null; then
        echo "gnome-terminal"
    elif command -v konsole &> /dev/null; then
        echo "konsole"
    elif command -v xfce4-terminal &> /dev/null; then
        echo "xfce4-terminal"
    elif command -v xterm &> /dev/null; then
        echo "xterm"
    elif command -v terminator &> /dev/null; then
        echo "terminator"
    else
        echo "none"
    fi
}

# 设置环境
setup_environment() {
    log_info "设置 ARM64 环境..."
    
    # 创建本地 bin 目录
    mkdir -p ~/.local/bin
    
    # 创建符号链接
    ln -sf "$PROJECT_ROOT/scripts/arm/node-arm64.sh" ~/.local/bin/node
    ln -sf "$PROJECT_ROOT/scripts/arm/npm-arm64.sh" ~/.local/bin/npm
    
    log_success "环境设置完成"
}

# 创建启动脚本
create_startup_scripts() {
    # 创建服务端启动脚本
    cat > /tmp/start-server.sh << EOF
#!/bin/bash
export PATH="\$HOME/.local/bin:\$PATH"
cd "$PROJECT_ROOT/server"

echo "========================================="
echo "启动 GameServerManager 服务端"
echo "项目路径: $PROJECT_ROOT/server"
echo "端口: 3000"
echo "========================================="
echo ""

# 启动服务端
node --import tsx/esm src/index.ts

echo ""
echo "服务端已停止"
read -p "按回车键关闭此窗口..."
EOF

    # 创建客户端启动脚本
    cat > /tmp/start-client.sh << EOF
#!/bin/bash
export PATH="\$HOME/.local/bin:\$PATH"
cd "$PROJECT_ROOT/client"

echo "========================================="
echo "启动 GameServerManager 客户端"
echo "项目路径: $PROJECT_ROOT/client"
echo "端口: 5173"
echo "========================================="
echo ""

# 启动客户端
npm run dev

echo ""
echo "客户端已停止"
read -p "按回车键关闭此窗口..."
EOF

    chmod +x /tmp/start-server.sh /tmp/start-client.sh
}

# 启动双终端
start_dual_terminals() {
    local terminal_app=$(detect_terminal)
    
    if [[ "$terminal_app" == "none" ]]; then
        log_error "未找到可用的终端模拟器"
        log_info "请安装以下终端之一: gnome-terminal, konsole, xfce4-terminal, xterm, terminator"
        exit 1
    fi
    
    log_info "使用终端: $terminal_app"
    
    case "$terminal_app" in
        "gnome-terminal")
            # 启动服务端终端
            gnome-terminal --title="GSM 服务端" -- bash /tmp/start-server.sh &
            sleep 1
            # 启动客户端终端
            gnome-terminal --title="GSM 客户端" -- bash /tmp/start-client.sh &
            ;;
        "konsole")
            konsole --title "GSM 服务端" -e bash /tmp/start-server.sh &
            sleep 1
            konsole --title "GSM 客户端" -e bash /tmp/start-client.sh &
            ;;
        "xfce4-terminal")
            xfce4-terminal --title="GSM 服务端" -e "bash /tmp/start-server.sh" &
            sleep 1
            xfce4-terminal --title="GSM 客户端" -e "bash /tmp/start-client.sh" &
            ;;
        "terminator")
            terminator --title="GSM 服务端" -e "bash /tmp/start-server.sh" &
            sleep 1
            terminator --title="GSM 客户端" -e "bash /tmp/start-client.sh" &
            ;;
        "xterm")
            xterm -title "GSM 服务端" -e bash /tmp/start-server.sh &
            sleep 1
            xterm -title "GSM 客户端" -e bash /tmp/start-client.sh &
            ;;
    esac
}

# 清理函数
cleanup() {
    log_info "清理临时文件..."
    rm -f /tmp/start-server.sh /tmp/start-client.sh
}

# 主函数
main() {
    log_info "启动 GameServerManager ARM64 双终端开发环境"
    echo ""
    
    setup_environment
    create_startup_scripts
    start_dual_terminals
    
    log_success "已启动两个独立终端："
    log_info "• 服务端终端 - 运行在 http://localhost:3000"
    log_info "• 客户端终端 - 运行在 http://localhost:5173"
    echo ""
    log_warning "要停止服务，请在对应的终端窗口中按 Ctrl+C"
    log_info "或者关闭终端窗口"
    echo ""
    
    # 等待用户确认清理
    read -p "按回车键清理临时文件并退出..."
    cleanup
    
    log_success "启动完成！"
}

# 设置退出时清理
trap cleanup EXIT

# 运行主函数
main "$@"
