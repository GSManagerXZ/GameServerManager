#!/bin/bash

# GSM3 游戏服务端管理面板启动脚本

echo "======================================"
echo "    GSM3 游戏服务端管理面板"
echo "======================================"
echo

# 将打包内置的 lib 资产同步到运行时目录（Docker 数据卷会覆盖 server/data/lib）
seed_runtime_lib_assets() {
    local runtime_lib="$1"
    local builtin_lib="$2"

    mkdir -p "$runtime_lib"
    if [ ! -d "$builtin_lib" ]; then
        return
    fi

    for asset in "$builtin_lib"/*; do
        [ -f "$asset" ] || continue
        local dest="$runtime_lib/$(basename "$asset")"
        if [ ! -e "$dest" ]; then
            cp -a "$asset" "$dest"
        fi
    done
}

# 检查是否存在GSM3应用文件
if [ -f "server/index.js" ]; then
    echo "🚀 启动GSM3管理面板..."
    echo "📍 访问地址: http://localhost:3001"
    echo "📍 默认账户: admin / admin123"
    echo

    # Docker 的持久卷会遮蔽镜像内的 server/data，补充卷中缺失的内置插件。
    # 仅复制不存在的插件目录，避免覆盖用户配置或自行安装的插件。
    DEFAULT_PLUGINS_DIR="data/plugins"
    RUNTIME_PLUGINS_DIR="server/data/plugins"
    if [ -d "$DEFAULT_PLUGINS_DIR" ]; then
        mkdir -p "$RUNTIME_PLUGINS_DIR"
        for plugin_dir in "$DEFAULT_PLUGINS_DIR"/*; do
            if [ ! -d "$plugin_dir" ] || [ ! -f "$plugin_dir/plugin.json" ]; then
                continue
            fi

            plugin_name=$(basename "$plugin_dir")
            runtime_plugin_dir="$RUNTIME_PLUGINS_DIR/$plugin_name"
            if [ ! -e "$runtime_plugin_dir" ]; then
                cp -a "$plugin_dir" "$runtime_plugin_dir"
                echo "✅ 已补充内置插件: $plugin_name"
            fi
        done
    fi
    
    # Docker 的持久卷会遮蔽镜像内的 server/data，补充卷中缺失的内置运行时资产。
    BUILTIN_LIB_DIR="server/builtin/data/lib"
    RUNTIME_LIB_DIR="server/data/lib"
    seed_runtime_lib_assets "$RUNTIME_LIB_DIR" "$BUILTIN_LIB_DIR"

    # PTY 由服务端固定资产管理器校验和探测，避免依赖镜像中未安装的 file 命令。
    # 内置资产缺失或损坏时，服务端会自动选择可写目录并恢复固定版本。

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
