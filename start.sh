#!/bin/bash

# GSM3 游戏服务端管理面板启动脚本

echo "======================================"
echo "    GSM3 游戏服务端管理面板"
echo "======================================"
echo

# 检查是否存在GSM3应用文件
if [ -f "server/index.js" ]; then
    echo "🚀 启动GSM3管理面板..."
    echo "📍 访问地址: http://localhost:3001"
    echo "📍 默认账户: admin / admin123"
    echo
    
    # PTY 文件已迁移到 data/lib/ 目录，启动时由服务端自动检测和下载
    # 如果 data/lib/ 中存在 PTY 文件，设置可执行权限
    ARCH=$(uname -m)
    if [ "$ARCH" = "x86_64" ] && [ -f "data/lib/pty_linux_x64" ]; then
        chmod +x data/lib/pty_linux_x64
        echo "✅ PTY权限设置完成 (x64)"
    elif [ "$ARCH" = "aarch64" ] && [ -f "data/lib/pty_linux_arm64" ]; then
        chmod +x data/lib/pty_linux_arm64
        echo "✅ PTY权限设置完成 (arm64)"
    else
        echo "ℹ️  PTY文件将在服务启动时自动下载"
    fi
    
    # 启动应用
    cd server
    node index.js
else
    echo "❌ 未找到GSM3应用文件，正在启动传统Steam服务器管理..."
    echo
    
    # 传统的Steam服务器管理菜单
    ARCH=$(uname -m)
    while true; do
        echo "请选择操作:"
        if [ "$ARCH" = "x86_64" ]; then
            echo "1. 启动SteamCMD"
        else
            echo "1. SteamCMD (不支持ARM64架构)"
        fi
        echo "2. 查看游戏目录"
        echo "3. 退出"
        echo -n "请输入选项 (1-3): "
        read choice

        case $choice in
            1)
                if [ "$ARCH" = "x86_64" ]; then
                    echo "启动SteamCMD..."
                    cd ${STEAMCMD_DIR}
                    ./steamcmd.sh
                else
                    echo "❌ SteamCMD不支持ARM64架构"
                    echo "💡 ARM64版本仅支持GSM3管理面板功能"
                fi
                ;;
            2)
                echo "游戏目录内容:"
                ls -la ${GAMES_DIR}
                ;;
            3)
                echo "退出"
                exit 0
                ;;
            *)
                echo "无效选项，请重新选择"
                ;;
        esac
        echo
    done
fi