#!/bin/bash
# ARM64 node 脚本封装
# 可以作为独立的 node 命令使用

# ARM64 Node.js 路径配置
NODE_BIN="/home/xiaozhu/qemu/Node/node-v20.19.0-linux-arm64/bin/node"

# 检查必要文件是否存在
if [[ ! -f "$NODE_BIN" ]]; then
    echo "错误: ARM64 Node.js 二进制文件未找到: $NODE_BIN"
    exit 1
fi

# 检查 qemu-aarch64-static 是否可用
if ! command -v qemu-aarch64-static &> /dev/null; then
    echo "错误: qemu-aarch64-static 未找到，请先安装 qemu-user-static"
    echo "安装命令: sudo apt-get install qemu-user-static"
    exit 1
fi

# 执行 ARM64 node 命令
qemu-aarch64-static -L /usr/aarch64-linux-gnu \
  "$NODE_BIN" "$@"
