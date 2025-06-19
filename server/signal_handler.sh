#!/bin/bash

# 信号处理包装脚本
# 用于确保容器能够正确处理Docker的停止信号

set -e

# 全局变量存储子进程PID
CHILD_PID=""

# 信号处理函数
handle_signal() {
    local signal=$1
    echo "收到信号: $signal"
    
    if [ -n "$CHILD_PID" ]; then
        echo "转发信号 $signal 给子进程 $CHILD_PID"
        kill -$signal $CHILD_PID 2>/dev/null || true
        
        # 等待子进程结束
        local count=0
        while kill -0 $CHILD_PID 2>/dev/null && [ $count -lt 30 ]; do
            sleep 1
            count=$((count + 1))
        done
        
        # 如果子进程仍然存在，强制杀死
        if kill -0 $CHILD_PID 2>/dev/null; then
            echo "强制结束子进程 $CHILD_PID"
            kill -KILL $CHILD_PID 2>/dev/null || true
        fi
    fi
    
    exit 0
}

# 设置信号处理器
trap 'handle_signal TERM' TERM
trap 'handle_signal INT' INT
trap 'handle_signal QUIT' QUIT

# 检查自定义环境变量
if [ ! -z "$CUSTOM_RUN_DIR" ] && [ ! -z "$CUSTOM_RUN_SCRIPT" ]; then
    echo "检测到自定义运行环境变量，直接启动自定义脚本"
    echo "运行目录: $CUSTOM_RUN_DIR"
    echo "运行脚本: $CUSTOM_RUN_SCRIPT"
    
    # 检查目录是否存在
    if [ ! -d "$CUSTOM_RUN_DIR" ]; then
        echo "错误: 自定义运行目录不存在: $CUSTOM_RUN_DIR"
        exit 1
    fi
    
    # 切换到自定义目录
    cd "$CUSTOM_RUN_DIR"
    echo "已切换到目录: $(pwd)"
    
    # 检查脚本是否存在
    if [ ! -f "$CUSTOM_RUN_SCRIPT" ]; then
        echo "错误: 自定义运行脚本不存在: $CUSTOM_RUN_SCRIPT"
        exit 1
    fi
    
    # 检查脚本是否可执行
    if [ ! -x "$CUSTOM_RUN_SCRIPT" ]; then
        echo "设置脚本执行权限: $CUSTOM_RUN_SCRIPT"
        chmod +x "$CUSTOM_RUN_SCRIPT"
    fi
    
    echo "启动自定义脚本: $CUSTOM_RUN_SCRIPT"
    exec "$CUSTOM_RUN_SCRIPT"
else
    # 启动默认目标脚本
    echo "启动目标脚本: $@"
    "$@" &
    CHILD_PID=$!
fi

echo "子进程PID: $CHILD_PID"

# 等待子进程结束
wait $CHILD_PID
echo "子进程已结束"