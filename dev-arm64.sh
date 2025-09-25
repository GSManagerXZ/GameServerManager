#!/bin/bash
# ARM64 开发环境快捷启动脚本
# 直接启动双终端开发环境，跳过依赖检查（假设已安装）

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "启动 GameServerManager ARM64 双终端开发环境..."
echo "注意: 此脚本假设依赖已安装，如未安装请先运行: ./start-arm64.sh install"
echo ""

# 直接启动双终端
exec "$SCRIPT_DIR/scripts/arm/start-dev-dual-terminal.sh"
