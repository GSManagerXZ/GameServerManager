#!/bin/bash
# ARM64 快捷启动脚本
# 这是一个简化的入口脚本，调用详细的安装和运行脚本

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 如果没有参数，默认使用双终端模式
if [[ $# -eq 0 ]]; then
    echo "使用双终端模式启动 GameServerManager ARM64 开发环境"
    echo "如需其他选项，请运行: $0 help"
    echo ""
    exec "$SCRIPT_DIR/scripts/arm/setup-and-run.sh" dev-dual
else
    # 调用详细的安装和运行脚本
    exec "$SCRIPT_DIR/scripts/arm/setup-and-run.sh" "$@"
fi
