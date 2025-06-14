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

# 启动目标脚本
echo "启动目标脚本: $@"
"$@" &
CHILD_PID=$!

echo "子进程PID: $CHILD_PID"

# 等待子进程结束
wait $CHILD_PID
echo "子进程已结束"