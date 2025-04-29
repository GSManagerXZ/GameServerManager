#!/bin/bash

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # 无颜色

# 输出创作声明
echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}创作声明：本容器由${GREEN} 又菜又爱玩的小猪 ${BLUE}独立制作${NC}"
echo -e "${BLUE}项目完全开源，开源协议AGPL3.0${NC}"
echo -e "${BLUE}GitHub: https://github.com/yxsj245/gameserver_container${NC}"
echo -e "${BLUE}Gitee: https://gitee.com/xiao-zhu245/gameserver_container${NC}"
echo -e "${BLUE}允许商业用途但请勿倒卖！${NC}"
echo -e "${BLUE}=================================================${NC}"

# 显示欢迎信息
echo "========================================================="
echo "          欢迎使用星辰的游戏开服容器"
echo "========================================================="
echo ""
echo "正在配置运行环境..."
echo ""

# MCSM默认配置
DEFAULT_PANEL_URL="http://192.168.10.43:23333"
DEFAULT_API_KEY="58230ba934ea45af8eab636199f0faac"
DEFAULT_DAEMON_UUID="f334ce6aa88241c29b6edb2bfbf4df74"
DEFAULT_HOST_PATH="/dockerwork"
DEFAULT_DOCKER_IMAGE="dockerwork-steam-server:latest"

# 创建或更新配置文件函数
create_config_file() {
    CONFIG_DIR="/home/steam/games"
    CONFIG_FILE="$CONFIG_DIR/config.json"
    
    # 确保目录存在
    mkdir -p "$CONFIG_DIR"
    
    # 检查配置文件是否已存在
    if [ ! -f "$CONFIG_FILE" ]; then
        echo "正在创建配置文件: $CONFIG_FILE"
        
        # 创建JSON配置文件
        cat > "$CONFIG_FILE" << EOL
{
    "MCSM": {
        "PANEL_URL": "$DEFAULT_PANEL_URL",
        "API_KEY": "$DEFAULT_API_KEY",
        "DAEMON_UUID": "$DEFAULT_DAEMON_UUID",
        "HOST_PATH": "$DEFAULT_HOST_PATH",
        "DOCKER_IMAGE": "$DEFAULT_DOCKER_IMAGE"
    }
}
EOL
        
        # 设置权限
        if [ "$(id -u)" = "0" ]; then
            chown steam:steam "$CONFIG_FILE"
            chmod 644 "$CONFIG_FILE"
        fi
        
        echo -e "${GREEN}配置文件已创建: $CONFIG_FILE${NC}"
    else
        echo -e "${YELLOW}配置文件已存在，检查是否需要更新...${NC}"
        
        # 检查是否包含DOCKER_IMAGE字段
        if ! grep -q "DOCKER_IMAGE" "$CONFIG_FILE"; then
            echo -e "${YELLOW}配置文件缺少DOCKER_IMAGE配置项${NC}"
            echo -e "${YELLOW}由于配置项已更新，建议删除config.json文件后重新启动容器生成最新配置项${NC}"
            echo -e "${YELLOW}并按照原有配置重新填写其他配置项${NC}"
            echo -e "${YELLOW}或者手动添加: \"DOCKER_IMAGE\": 镜像名 到配置文件中${NC}"
        else
            echo -e "${GREEN}配置文件已经是最新版本${NC}"
        fi
    fi
}

# 配置SteamCMD默认安装目录
function configure_steam_default_dir() {
    # 创建或修改SteamCMD配置
    STEAM_CONFIG_DIR="/home/steam/Steam/config"
    mkdir -p "$STEAM_CONFIG_DIR"
    
    echo "\"InstallConfigStore\"
{
	\"Software\"
	{
		\"Valve\"
		{
			\"Steam\"
			{
				\"BaseInstallFolder_1\"		\"/home/steam/games\"
				\"DownloadThrottleKB\"		\"0\"
				\"AutoUpdateWindowEnabled\"		\"0\"
			}
		}
	}
}" > "$STEAM_CONFIG_DIR/config.vdf"

    # 设置权限
    if [ -f "$STEAM_CONFIG_DIR/config.vdf" ]; then
        chown -R steam:steam "$STEAM_CONFIG_DIR"
        echo "已配置SteamCMD默认安装目录为: /home/steam/games"
    else
        echo "警告: 无法配置SteamCMD默认安装目录"
    fi
}

# 确保MCSM目录和库文件存在
setup_mcsm_libs() {
    # 检查MCSM目录是否存在，不存在则创建
    if [ ! -d "/home/steam/MCSM" ]; then
        echo "创建MCSM目录..."
        mkdir -p /home/steam/MCSM
    fi
    
    # 检查是否需要从游戏目录复制库文件
    if [ ! -f "/home/steam/MCSM/mcsm_api_lib.sh" ] && [ -f "/home/steam/games/MCSM/mcsm_api_lib.sh" ]; then
        # 从挂载目录复制
        echo "从挂载目录复制MCSM API库文件到/home/steam/MCSM目录..."
        cp -f /home/steam/games/MCSM/mcsm_api_lib.sh /home/steam/MCSM/
        chmod 755 /home/steam/MCSM/mcsm_api_lib.sh
    elif [ -f "/home/steam/MCSM/mcsm_api_lib.sh" ]; then
        echo "MCSM API库文件已存在，跳过复制"
    else
        echo "未找到MCSM API库文件，MCSM相关功能可能无法正常工作"
        echo "请检查以下位置:"
        echo "  - /home/steam/MCSM/mcsm_api_lib.sh"
        echo "  - /home/steam/games/MCSM/mcsm_api_lib.sh"
        return 1
    fi
    
    # 设置正确的权限
    if [ "$(id -u)" = "0" ]; then
        chown -R steam:steam /home/steam/MCSM
    fi
    
    echo "MCSM API库文件准备就绪"
    return 0
}

# 确保数据目录存在
mkdir -p /home/steam/games

# 检查是否设置了直接运行游戏的环境变量
if [ -n "$GAME_TO_RUN" ]; then
    echo "检测到环境变量 GAME_TO_RUN=$GAME_TO_RUN，将直接启动游戏"
    # 直接启动模式不需要创建MCSM配置文件
    echo "直接启动模式无需创建MCSM配置文件"
    
    GAMES_DIR="/home/steam/games"
    GAME_PATH="$GAMES_DIR/$GAME_TO_RUN"
    
    # 设置权限
    if [ "$(id -u)" = "0" ]; then
        # 确保目录存在
        mkdir -p /home/steam/games
        mkdir -p /home/steam/Steam
        mkdir -p /home/steam/Steam/steamapps/common
        
        # 设置递归权限，确保steam用户对所有目录有完全控制权
        chown -R steam:steam /home/steam/games
        chown -R steam:steam /home/steam/Steam
        chmod -R 755 /home/steam/games
        chmod -R 755 /home/steam/Steam
        
        echo "已设置目录权限，确保游戏安装和迁移正常工作"
        
        # 配置SteamCMD默认安装目录
        su - steam -c "mkdir -p /home/steam/Steam"
        configure_steam_default_dir
        chown -R steam:steam /home/steam/Steam
    else
        echo "${RED}警告: 容器未以root用户运行，某些操作可能会受到权限限制${NC}"
        echo "建议使用 'docker run --user root ...' 或在 docker-compose.yml 中设置 'user: root'"
    fi
    
    # 检查游戏目录是否存在
    if [ -d "$GAME_PATH" ]; then
        echo "找到游戏目录: $GAME_PATH"
        
        # 优先使用用户指定的启动命令
        if [ -n "$GAME_ARGS" ]; then
            # 用户指定了启动参数，直接使用
            echo "使用环境变量GAME_ARGS作为启动命令"
            echo "正在启动游戏服务器: $GAME_TO_RUN..."
            
            # 检查命令是否包含路径，如果不包含可能是当前目录下的脚本
            if [[ "$GAME_ARGS" != /* ]] && [[ "$GAME_ARGS" != ./* ]] && [[ "$GAME_ARGS" != ~/* ]]; then
                # 命令不包含路径，检查第一个单词是否是当前目录中的可执行文件
                CMD_FIRST=$(echo "$GAME_ARGS" | awk '{print $1}')
                
                if [ -f "$GAME_PATH/$CMD_FIRST" ] && [ -x "$GAME_PATH/$CMD_FIRST" ]; then
                    # 当前目录存在这个可执行文件，添加路径前缀
                    echo "找到执行文件: $GAME_PATH/$CMD_FIRST"
                    GAME_ARGS="./$CMD_FIRST $(echo "$GAME_ARGS" | cut -d' ' -f2-)"
                elif [ -f "$GAME_PATH/$CMD_FIRST" ]; then
                    # 文件存在但不可执行，添加权限并添加路径前缀
                    echo "找到文件: $GAME_PATH/$CMD_FIRST，添加执行权限"
                    chmod +x "$GAME_PATH/$CMD_FIRST"
                    GAME_ARGS="./$CMD_FIRST $(echo "$GAME_ARGS" | cut -d' ' -f2-)"
                fi
            fi
            
            echo "实际执行命令: $GAME_ARGS"
            echo ""
            
            # 以steam用户身份运行游戏
            if [ "$(id -u)" = "0" ]; then
                cd "$GAME_PATH" && su - steam -c "cd \"$GAME_PATH\" && $GAME_ARGS"
                EXIT_CODE=$?
                echo ""
                echo "游戏服务器已退出，退出码: $EXIT_CODE"
                echo "按任意键继续..."
                read -n 1
                exit $EXIT_CODE
            else
                cd "$GAME_PATH" && eval "$GAME_ARGS"
                EXIT_CODE=$?
                echo ""
                echo "游戏服务器已退出，退出码: $EXIT_CODE"
                echo "按任意键继续..."
                read -n 1
                exit $EXIT_CODE
            fi
        # 其次尝试使用启动脚本
        elif [ -f "$GAME_PATH/start.sh" ]; then
            echo "找到启动脚本: $GAME_PATH/start.sh"
            echo "正在启动游戏服务器: $GAME_TO_RUN..."
            echo ""
            
            # 以steam用户身份运行游戏
            if [ "$(id -u)" = "0" ]; then
                cd "$GAME_PATH" && su - steam -c "cd \"$GAME_PATH\" && ./start.sh"
                EXIT_CODE=$?
                echo ""
                echo "游戏服务器已退出，退出码: $EXIT_CODE"
                echo "按任意键继续..."
                read -n 1
                exit $EXIT_CODE
            else
                cd "$GAME_PATH" && ./start.sh
                EXIT_CODE=$?
                echo ""
                echo "游戏服务器已退出，退出码: $EXIT_CODE"
                echo "按任意键继续..."
                read -n 1
                exit $EXIT_CODE
            fi
        else
            # 尝试查找目录中的所有可执行sh脚本
            echo "未找到start.sh，搜索目录中的其他启动脚本..."
            cd "$GAME_PATH"
            
            # 查找所有可执行的.sh文件
            SH_SCRIPTS=()
            while IFS= read -r script; do
                if [ -x "$script" ]; then
                    SH_SCRIPTS+=("$script")
                fi
            done < <(find . -maxdepth 1 -name "*.sh" -type f | sort)
            
            # 检查是否找到了脚本
            if [ ${#SH_SCRIPTS[@]} -gt 0 ]; then
                echo -e "${GREEN}找到以下可执行脚本:${NC}"
                for i in "${!SH_SCRIPTS[@]}"; do
                    echo -e "${YELLOW}[$((i+1))]${NC} ${SH_SCRIPTS[$i]}"
                done
                
                # 提示用户选择脚本
                echo -e "\n${YELLOW}请选择要执行的脚本 [1-${#SH_SCRIPTS[@]}] (输入q退出):${NC}"
                read -r selection
                
                # 处理用户选择
                if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le ${#SH_SCRIPTS[@]} ]; then
                    selected_script="${SH_SCRIPTS[$((selection-1))]}"
                    echo -e "${GREEN}正在执行: $selected_script${NC}"
                    
                    # 以steam用户身份运行选择的脚本
                    if [ "$(id -u)" = "0" ]; then
                        su - steam -c "cd \"$GAME_PATH\" && ./$selected_script"
                        EXIT_CODE=$?
                        echo ""
                        echo "脚本已执行完毕，退出码: $EXIT_CODE"
                        echo "按任意键继续..."
                        read -n 1
                        exit $EXIT_CODE
                    else
                        ./$selected_script
                        EXIT_CODE=$?
                        echo ""
                        echo "脚本已执行完毕，退出码: $EXIT_CODE"
                        echo "按任意键继续..."
                        read -n 1
                        exit $EXIT_CODE
                    fi
                elif [[ "$selection" == "q" ]]; then
                    echo "已取消启动"
                    exit 0
                else
                    echo -e "${RED}无效选择，尝试其他启动方式...${NC}"
                fi
            else
                echo -e "${YELLOW}未找到可执行的.sh脚本，尝试其他启动方式...${NC}"
            fi
            
            # 尝试寻找可能的可执行文件
            echo "搜索常见可执行文件..."
            # 尝试常见的可执行文件名
            for executable in bedrock_server server server.jar PalServer.sh RustDedicated ShooterGameServer srcds_run; do
                if [ -f "$GAME_PATH/$executable" ]; then
                    echo "找到可执行文件: $executable"
                    echo "正在启动游戏服务器: $GAME_TO_RUN..."
                    echo ""
                    
                    # 以steam用户身份运行游戏
                    if [ "$(id -u)" = "0" ]; then
                        cd "$GAME_PATH" && su - steam -c "cd \"$GAME_PATH\" && ./$executable"
                        EXIT_CODE=$?
                        echo ""
                        echo "游戏服务器已退出，退出码: $EXIT_CODE"
                        echo "按任意键继续..."
                        read -n 1
                        exit $EXIT_CODE
                    else
                        cd "$GAME_PATH" && ./$executable
                        EXIT_CODE=$?
                        echo ""
                        echo "游戏服务器已退出，退出码: $EXIT_CODE"
                        echo "按任意键继续..."
                        read -n 1
                        exit $EXIT_CODE
                    fi
                    break
                fi
            done

            echo "错误: 无法确定如何启动游戏"
            echo "请设置GAME_ARGS环境变量指定启动命令，或创建启动脚本，或添加常见的可执行文件"
            sleep 5
        fi
    else
        echo "错误: 找不到游戏目录 $GAME_PATH"
        echo "请确保游戏已安装到 /home/steam/games 目录"
        sleep 5
    fi
else
    # 菜单模式，需要创建MCSM配置
    # 设置权限
    if [ "$(id -u)" = "0" ]; then
        # 确保目录存在
        mkdir -p /home/steam/games
        mkdir -p /home/steam/Steam
        mkdir -p /home/steam/Steam/steamapps/common
        
        # 设置递归权限，确保steam用户对所有目录有完全控制权
        chown -R steam:steam /home/steam/games
        chown -R steam:steam /home/steam/Steam
        chmod -R 755 /home/steam/games
        chmod -R 755 /home/steam/Steam
        
        echo "已设置目录权限，确保游戏安装和迁移正常工作"
        
        # 配置SteamCMD默认安装目录
        su - steam -c "mkdir -p /home/steam/Steam"
        configure_steam_default_dir
        chown -R steam:steam /home/steam/Steam
        
        # 创建MCSM配置文件
        create_config_file
        
        # 设置MCSM库文件
        setup_mcsm_libs
    else
        echo "${RED}警告: 容器未以root用户运行，某些操作可能会受到权限限制${NC}"
        echo "建议使用 'docker run --user root ...' 或在 docker-compose.yml 中设置 'user: root'"
        
        # 仍然尝试创建配置文件，但可能会有权限问题
        create_config_file
        
        # 设置MCSM库文件
        setup_mcsm_libs
    fi

    echo "正在启动交互式菜单..."
    echo ""
    sleep 2

    # 创建菜单启动脚本，解决docker attach连接问题
    cat > /tmp/menu_starter.sh << EOL
#!/bin/bash
# 这个脚本用于确保docker attach连接时能正常显示菜单
# 发送一个清屏命令和欢迎消息
clear
echo ""
# 输出创作声明
echo -e "\033[0;34m================================================="
echo -e "创作声明：本容器由\033[0;32m 又菜又爱玩的小猪 \033[0;34m独立制作"
echo -e "项目完全开源，开源协议AGPL3.0"
echo -e "GitHub: https://github.com/yxsj245/gameserver_container"
echo -e "Gitee: https://gitee.com/xiao-zhu245/gameserver_container"
echo -e "允许商业用途但请勿倒卖！"
echo -e "=================================================\033[0m"

echo "========================================================="
echo "          欢迎使用星辰的游戏容器"
echo "           按回车键显示菜单 (如果菜单未显示)"
echo "========================================================="
echo ""

# 启动实际的菜单脚本
exec /home/steam/menu.sh
EOL

    chmod +x /tmp/menu_starter.sh

    # 以steam用户身份运行菜单
    if [ "$(id -u)" = "0" ]; then
        exec su - steam -c "/tmp/menu_starter.sh"
    else
        exec /tmp/menu_starter.sh
    fi
fi 