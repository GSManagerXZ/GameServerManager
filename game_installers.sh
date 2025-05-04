#!/bin/bash

# 游戏服务端快速部署脚本集合
# 此文件包含各种游戏服务端的一键部署脚本
# 版本: 2.0.0
# 更新日期: 2023-06-01

# DEBUG模式设置
# 设置为true将跳过实际的游戏安装过程，仅执行脚本剩余部分
DEBUG_MODE=false

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # 无颜色

# 游戏安装目录
GAMES_DIR="/home/steam/games"

# 游戏信息配置文件 - 使用绝对路径
GAME_CONFIG_FILE="/home/steam/installgame.json"

# 函数：显示安装后提示信息
show_post_install_tips() {
    local game_name=$1
    local install_dir="$GAMES_DIR/$game_name"
    local game_tip=$2
    
    echo -e "\n${GREEN}+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+${NC}"
    echo -e "${GREEN}|               安装后提示                        |${NC}"
    echo -e "${GREEN}+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+${NC}"
    echo -e "${YELLOW}• 游戏安装位置: ${NC}$install_dir"
    echo -e "${YELLOW}• 启动游戏方法:${NC}"
    echo -e "  1. 从主菜单选择 [${GREEN}2${NC}] 管理已安装游戏"
    echo -e "  2. 选择 ${GREEN}$game_name${NC} 游戏"
    echo -e "  3. 选择 [${GREEN}1${NC}] 启动服务端"
    echo -e "${YELLOW}• 如需手动启动:${NC}"
    echo -e "  cd $install_dir && ./start.sh"
    echo -e "${YELLOW}• 如需修改配置:${NC}"
    echo -e "  从游戏菜单中选择 [${GREEN}3${NC}] 编辑配置文件 或 [${GREEN}5${NC}] 编写/修改启动脚本"
    
    # 显示游戏特定提示信息
    if [ ! -z "$game_tip" ]; then
        echo -e "${YELLOW}• 游戏特定信息:${NC}"
        echo -e "  $game_tip"
    fi
}

# 函数：询问用户是否创建MCSM实例
ask_create_mcsm_instance() {
    local game_name="$1"
    local server_name="$2"
    local image="${3:-dockerwork-steam-server:latest}"
    local start_command="${4:-./start.sh}"
    
    echo -e "\n${BLUE}是否要将此游戏服务器注册到MCSManager面板？[y/N]${NC}"
    read -n 1 -r register_choice
    echo ""
    
    if [[ "$register_choice" =~ ^[Yy]$ ]]; then
        # 查找MCSM库文件
        local mcsm_lib=""
        for lib_path in \
            "/home/steam/MCSM/mcsm_api_lib.sh" \
            "/home/steam/games/MCSM/mcsm_api_lib.sh" \
            "/MCSM/mcsm_api_lib.sh" \
            "/home/steam/mcsm_api_lib.sh"; do
            if [ -f "$lib_path" ]; then
                mcsm_lib="$lib_path"
                break
            fi
        done
        
        if [ -n "$mcsm_lib" ]; then
            # 在DEBUG模式下显示使用的库文件
            if [ "$DEBUG_MODE" = true ]; then
                echo -e "${YELLOW}DEBUG: 使用MCSM库文件: $mcsm_lib${NC}"
            fi
            
            # 尝试加载库文件
            if source "$mcsm_lib"; then
                # 检查必要的函数是否存在
                if ! type mcsm_create_custom_instance >/dev/null 2>&1; then
                    echo -e "${RED}错误: MCSManager API库加载失败${NC}"
                    return 1
                fi
                
                # 检查是否读取到配置中的镜像名称
                if [ -n "$MCSM_DOCKER_IMAGE" ]; then
                    image="$MCSM_DOCKER_IMAGE"
                    if [ "$DEBUG_MODE" = true ]; then
                        echo -e "${YELLOW}DEBUG: 使用配置镜像: $image${NC}"
                    fi
                fi
                
                # 设置端口映射（通过游戏名查找）
                local ports="[]"
                case "$game_name" in
                    "Palworld")
                        ports='["8211:8211/udp"]'
                        ;;
                    "Rust")
                        ports='["28015:28015/udp","28016:28016/tcp"]'
                        ;;
                    "Satisfactory")
                        ports='["7777:7777/udp"]'
                        ;;
                    "L4D2")
                        ports='["27015:27015/tcp"]'
                        ;;
                    "7_Days_to_Die")
                        ports='["26900:26900/tcp"]'
                        ;;
                    "Unturned")
                        ports='["27015:27015/udp"]'
                        ;;
                    "Project_Zomboid")
                        ports='["16261:16261/udp","16262:16262/udp"]'
                        ;;
                    "Valheim")
                        ports='["2457:2457/udp"]'
                        ;;
                    "Team_Fortress_2")
                        ports='["27015:27015/tcp","27015:27015/udp"]'
                        ;;
                    "Insurgency_Sandstorm")
                        ports='["27015:27015/tcp","27015:27015/udp"]'
                        ;;
                    "ARK")
                        ports='["7777:7777/udp","7778:7778/udp","27015:27015/udp"]'
                        ;;
                    "Squad")
                        ports='["7787:7787/udp","27165:27165/udp"]'
                        ;;
                    "Insurgency_2014")
                        ports='["27015:27015/tcp","27015:27015/udp"]'
                        ;;
                    "Euro_Truck_Simulator_2")
                        ports='["27015:27015/udp"]'
                        ;;
                    "American_Truck_Simulator")
                        ports='["27015:27015/udp"]'
                        ;;
                    "ECO")
                        ports='["3001:3001/tcp","3000:3000/udp"]'
                        ;;
                    "Soulmask")
                        ports='["27015:27015/udp"]'
                        ;;  
                    "MORDHAU")
                        ports='["7777:7777/udp"]'
                        ;;    
                    "No_More_Room_in_Hell")
                        ports='["27015:27015/udp","27020:27020/udp","27015:27015/tcp"]'
                        ;;     
                    "No_More_Room_in_Hell")
                        ports='["27015:27015/udp","27020:27020/udp","27015:27015/tcp"]'
                        ;;
                    "Hurtworld")
                        ports='["12881:12881/udp"]'
                        ;;                                            
                esac
                
                # 在DEBUG模式下显示端口信息
                if [ "$DEBUG_MODE" = true ]; then
                    echo -e "${YELLOW}DEBUG: 使用端口映射: $ports${NC}"
                fi
                
                # 设置环境变量
                local env='["AUTO_UPDATE=false","GAME_TO_RUN='$game_name'"]'
                
                # 创建实例，捕获输出
                if [ "$DEBUG_MODE" = true ]; then
                    echo -e "${YELLOW}DEBUG: 执行命令 mcsm_create_custom_instance 参数如下:${NC}"
                    echo -e "${YELLOW}DEBUG: 服务器名: $server_name${NC}"
                    echo -e "${YELLOW}DEBUG: 游戏名称: $game_name${NC}"
                    echo -e "${YELLOW}DEBUG: 镜像: $image${NC}"
                    echo -e "${YELLOW}DEBUG: 启动命令: $start_command${NC}"
                    echo -e "${YELLOW}DEBUG: 端口映射: $ports${NC}"
                    echo -e "${YELLOW}DEBUG: 环境变量: $env${NC}"
                fi
                
                local output=$(mcsm_create_custom_instance "$server_name" "$game_name" "$image" "$start_command" "$ports" "$env" 2>&1)
                local status=$?
                
                # 在DEBUG模式下始终显示完整输出
                if [ "$DEBUG_MODE" = true ]; then
                    echo -e "${YELLOW}DEBUG: API完整输出:${NC}"
                    echo "$output"
                fi
                
                # 从输出中提取UUID
                local uuid=$(echo "$output" | grep -o '实例UUID:.*' | cut -d' ' -f2)
                
                if [ $status -eq 0 ]; then
                    echo -e "${GREEN}MCSManager实例创建成功${NC}"
                    if [ -n "$uuid" ]; then
                        echo -e "${GREEN}实例UUID: ${BLUE}$uuid${NC}"
                    else
                        # 调试输出，如果没有找到UUID
                        echo -e "${YELLOW}未能从输出中提取UUID${NC}"
                    fi
                    return 0
                else
                    echo -e "${RED}MCSManager实例创建失败：${NC}"
                    echo -e "${RED}$output${NC}"
                    return 1
                fi
            else
                echo -e "${RED}错误: 无法加载MCSManager API库${NC}"
                return 1
            fi
        else
            echo -e "${RED}错误: 找不到MCSManager API库${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}已跳过创建MCSManager实例${NC}"
        return 0
    fi
}

# 函数：解析JSON配置文件并获取游戏信息
get_game_info() {
    local game_name=$1
    local field=$2
    local config_file=$3
    
    # 确保jq命令可用
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}错误: 未找到jq命令。请安装jq（apt-get install jq）后再试。${NC}"
        return 1
    fi
    
    # 读取指定字段的值
    local value=$(jq -r ".[\"$game_name\"][\"$field\"]" "$config_file")
    
    # 检查字段是否存在
    if [[ "$value" == "null" ]]; then
        echo ""
        return 1
    fi
    
    echo "$value"
}

# 函数：从配置文件中获取所有游戏列表
get_all_games() {
    local config_file=$1
    
    # 确保jq命令可用
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}错误: 未找到jq命令。请安装jq（apt-get install jq）后再试。${NC}"
        return 1
    fi
    
    # 获取所有游戏名称
    jq -r 'keys[]' "$config_file"
}

# 函数：Steam游戏通用安装函数
install_steam_game() {
    local app_id=$1
    local game_name=$2
    local use_custom_account=${3:-false}  # 默认为false，使用匿名账户
    local install_dir="$GAMES_DIR/$game_name"
    
    echo -e "${GREEN}正在安装 $game_name (AppID: $app_id) 到 $install_dir...${NC}\n"
    
    # 如果处于DEBUG模式，则跳过实际安装
    if [ "$DEBUG_MODE" = true ]; then
        echo -e "${YELLOW}DEBUG模式：跳过实际安装过程${NC}"
        
        # 确保目录存在，便于后续步骤
        mkdir -p "$install_dir"
        
        # 模拟成功安装
        echo "$app_id" > "$install_dir/steam_appid.txt"
        echo -e "${GREEN}DEBUG模式：模拟 $game_name 安装成功!${NC}"
        return 0
    fi
    
    echo -e "${YELLOW}这可能需要一段时间，请耐心等待...${NC}\n"
    
    # 创建安装目录
    mkdir -p "$install_dir"
    
    # 设置登录命令
    if [ "$use_custom_account" = true ]; then
        echo -e "${YELLOW}由于此服务端需要正版验证，请登录已购买后的游戏账户${NC}"
        echo -e "${YELLOW}请输入Steam账户: ${NC}"
        read steam_account
        echo -e "${YELLOW}是否需要输入密码？(y/n)${NC}"
        read need_password
        
        if [[ "$need_password" == "y" || "$need_password" == "Y" ]]; then
            echo -e "${YELLOW}请输入密码 (密码不会显示): ${NC}"
            read -s steam_password
            login_cmd="+login $steam_account $steam_password"
        else
            login_cmd="+login $steam_account"
        fi
    else
        login_cmd="+login anonymous"
    fi
    
    # 运行SteamCMD安装游戏
    if [ -x "/home/steam/steamcmd/steamcmd.sh" ]; then
        cd /home/steam/steamcmd
        ./steamcmd.sh $login_cmd +force_install_dir "$install_dir" +app_update "$app_id" validate +quit
        
        # 检查游戏是否安装成功
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}$game_name 安装成功!${NC}"
            
            # 保存AppID到游戏目录
            echo "$app_id" > "$install_dir/steam_appid.txt"
            
            return 0
        else
            echo -e "${RED}$game_name 安装失败!${NC}"
            return 1
        fi
    else
        echo -e "${RED}错误: 找不到SteamCMD可执行文件!${NC}"
        return 1
    fi
}

# 函数：在游戏服务端目录创建文件
create_game_file() {
    local install_dir=$1
    local file_name=$2
    local file_content=$3
    
    # 创建完整的文件路径
    local file_path="$install_dir/$file_name"
    
    # 创建文件并写入内容
    echo "$file_content" > "$file_path"
    
    # 检查文件是否创建成功
    if [ -f "$file_path" ]; then
        echo -e "${GREEN}文件 $file_name 创建成功!${NC}"
        return 0
    else
        echo -e "${RED}文件 $file_name 创建失败!${NC}"
        return 1
    fi
}

# 函数：创建自定义启动脚本
create_startup_script() {
    local install_dir=$1
    local script_content=$2
    
    echo "$script_content" > "$install_dir/start.sh"
    chmod +x "$install_dir/start.sh"
    
    if [ -x "$install_dir/start.sh" ]; then
        echo -e "${GREEN}启动脚本创建成功!${NC}"
        return 0
    else
        echo -e "${RED}启动脚本创建失败!${NC}"
        return 1
    fi
}

# 函数：清理安装目录（如果安装失败）
cleanup_install() {
    local install_dir=$1
    echo -e "${YELLOW}正在清理安装目录...${NC}"
    rm -rf "$install_dir"
}

# 函数：安装游戏服务端（通过配置文件）
install_game_from_config() {
    local game_name=$1
    local config_file=$2
    local install_dir="$GAMES_DIR/$game_name"
    
    # 从配置文件获取游戏信息
    local game_nameCN=$(get_game_info "$game_name" "game_nameCN" "$config_file")
    local appid=$(get_game_info "$game_name" "appid" "$config_file")
    local anonymous=$(get_game_info "$game_name" "anonymous" "$config_file")
    local script=$(get_game_info "$game_name" "script" "$config_file")
    local script_name=$(get_game_info "$game_name" "script_name" "$config_file")
    local tip=$(get_game_info "$game_name" "tip" "$config_file")
    
    # 检查必要的字段是否存在
    if [[ -z "$game_nameCN" || -z "$appid" ]]; then
        echo -e "${RED}错误: 游戏配置信息不完整!${NC}"
        return 1
    fi
    
    echo -e "${BLUE}========== 安装 $game_nameCN 服务端 ==========${NC}"
    
    # 确定是否使用匿名账号
    local use_custom_account=false
    if [[ "$anonymous" == "false" ]]; then
        use_custom_account=true
    fi
    
    # 安装游戏
    install_steam_game "$appid" "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    # 如果需要创建启动脚本
    if [[ "$script" == "true" && ! -z "$script_name" ]]; then
        # 检查script_name是否为特殊值"echo=none"，如果是，则不创建启动脚本
        if [[ "$script_name" != "echo=none" ]]; then
            create_startup_script "$install_dir" "$script_name"
        else
            echo -e "${YELLOW}跳过创建启动脚本${NC}"
        fi
    fi
    
    echo -e "${GREEN}$game_nameCN 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    
    # 显示安装后提示信息
    show_post_install_tips "$game_name" "$tip"
    
    # 询问是否创建MCSM实例
    ask_create_mcsm_instance "$game_name" "$game_nameCN"
    
    return 0
}

# 函数：安装调试工具
install_debug_tools() {
    echo -e "${YELLOW}正在安装调试工具，这可能需要root权限...${NC}"
    if [ $(id -u) -ne 0 ]; then
        echo -e "${RED}警告: 非root用户，某些工具可能无法安装${NC}"
    fi
    
    # 更新apt源并安装调试工具
    apt-get update -y 2>/dev/null || echo -e "${RED}无法更新apt源，继续安装...${NC}"
    apt-get install -y gdb strace ltrace lsof procps jq 2>/dev/null || echo -e "${RED}无法安装部分调试工具，继续...${NC}"
    
    # 显示安装了哪些工具
    echo -e "${GREEN}已安装的调试工具:${NC}"
    which gdb strace ltrace lsof jq 2>/dev/null
    
    echo -e "\n${YELLOW}系统信息:${NC}"
    free -h
    df -h
    cat /proc/cpuinfo | grep "model name" | head -1
}

# 函数：从远程API获取游戏配置
fetch_game_config() {
    echo -e "${YELLOW}找不到本地配置文件，正在尝试从远程API获取...${NC}"
    
    # 确保curl命令可用
    if ! command -v curl &> /dev/null; then
        echo -e "${RED}错误: 未找到curl命令。正在尝试安装...${NC}"
        apt-get update -y >/dev/null 2>&1 && apt-get install -y curl >/dev/null 2>&1
        
        if ! command -v curl &> /dev/null; then
            echo -e "${RED}错误: 无法安装curl。请手动安装后再试。${NC}"
            return 1
        fi
    fi
    
    # 从远程API获取配置
    echo -e "${BLUE}正在从 http://blogpage.xiaozhuhouses.asia/api/installgame.json 获取配置...${NC}"
    curl -s -o "$GAME_CONFIG_FILE" "http://blogpage.xiaozhuhouses.asia/api/installgame.json"
    
    # 检查下载是否成功
    if [ $? -ne 0 ] || [ ! -s "$GAME_CONFIG_FILE" ]; then
        echo -e "${RED}错误: 无法从远程API获取配置文件!${NC}"
        return 1
    fi
    
    # 验证下载的是否为有效的JSON文件
    if ! jq . "$GAME_CONFIG_FILE" > /dev/null 2>&1; then
        echo -e "${RED}错误: 下载的配置文件不是有效的JSON格式!${NC}"
        rm -f "$GAME_CONFIG_FILE"
        return 1
    fi
    
    echo -e "${GREEN}游戏配置文件已成功从远程API获取！${NC}"
    return 0
}

# 获取可用的游戏安装脚本列表
list_available_installers() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║           ${GREEN}游戏服务端快速部署菜单${BLUE}                 ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║                                                    ║${NC}"
    
    # 检查配置文件是否存在，不存在则尝试从远程获取
    if [ ! -f "$GAME_CONFIG_FILE" ]; then
        fetch_game_config
        if [ $? -ne 0 ]; then
            echo -e "${BLUE}║  ${RED}[0]${NC} 返回主菜单                                    ${BLUE}║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            return 1
        fi
    fi
    
    # 确保jq命令可用
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}错误: 未找到jq命令。正在尝试安装...${NC}"
        apt-get update -y >/dev/null 2>&1 && apt-get install -y jq >/dev/null 2>&1
        
        if ! command -v jq &> /dev/null; then
            echo -e "${RED}错误: 无法安装jq。请手动安装后再试。${NC}"
            echo -e "${BLUE}║  ${RED}[0]${NC} 返回主菜单                                    ${BLUE}║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            return 1
        fi
    fi
    
    # 获取并列出所有游戏
    local counter=1
    local games=$(get_all_games "$GAME_CONFIG_FILE")
    
    for game in $games; do
        local game_nameCN=$(get_game_info "$game" "game_nameCN" "$GAME_CONFIG_FILE")
        echo -e "${BLUE}║  ${YELLOW}[$counter]${NC} $game_nameCN                             ${BLUE}║${NC}"
        counter=$((counter + 1))
    done
    
    echo -e "${BLUE}║  ${YELLOW}[0]${NC} 返回主菜单                                    ${BLUE}║${NC}"
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
}

# 主函数：启动指定的安装脚本
run_installer() {
    local choice=$1
    
    # 检查配置文件是否存在，不存在则尝试从远程获取
    if [ ! -f "$GAME_CONFIG_FILE" ]; then
        fetch_game_config
        if [ $? -ne 0 ]; then
            return 1
        fi
    fi
    
    # 获取所有游戏列表
    local games=($(get_all_games "$GAME_CONFIG_FILE"))
    
    # 检查选择是否有效
    if [[ "$choice" == "0" ]]; then
        echo -e "${YELLOW}返回主菜单...${NC}"
        return 0
    elif [[ "$choice" -gt 0 && "$choice" -le ${#games[@]} ]]; then
        local index=$((choice - 1))
        local game_name=${games[$index]}
        
        clear
        local game_nameCN=$(get_game_info "$game_name" "game_nameCN" "$GAME_CONFIG_FILE")
        
        echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║           ${GREEN}正在安装 $game_nameCN 服务端${BLUE}                   ║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
        echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
        
        # 安装指定的游戏
        install_game_from_config "$game_name" "$GAME_CONFIG_FILE"
    else
        echo -e "${RED}无效选择！${NC}"
        sleep 2
        return 1
    fi
    
    local result=$?
    if [ $result -eq 0 ]; then
        echo -e "\n${BLUE}╔════════════════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║               ${GREEN}全部操作已完成！${BLUE}                     ║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
        
        # 创建/打开游戏的提醒
        echo -e "\n${YELLOW}游戏服务器已安装完成，您可以:${NC}"
        echo -e "  ${GREEN}1.${NC} 从主菜单选择 [2] 管理已安装游戏 来启动服务器"
        echo -e "  ${GREEN}2.${NC} 如果注册了MCSManager实例，可以通过MCSManager面板管理服务器"
    else
        echo -e "\n${BLUE}╔════════════════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║               ${RED}安装失败！${BLUE}                          ║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    fi
    echo -e "\n${YELLOW}按任意键继续...${NC}"
    read -n 1
    return $result
}

# 如果直接运行此脚本，显示可用安装脚本列表并循环处理选择
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # 解析命令行参数
    for arg in "$@"; do
        case $arg in
            --debug)
                DEBUG_MODE=true
                echo -e "${YELLOW}已启用DEBUG模式${NC}"
                shift
                ;;
        esac
    done
    
    # 检查并安装必要的工具
    if ! command -v jq &> /dev/null; then
        echo -e "${YELLOW}正在安装必要的工具（jq）...${NC}"
        apt-get update -y >/dev/null 2>&1 && apt-get install -y jq >/dev/null 2>&1
        
        if ! command -v jq &> /dev/null; then
            echo -e "${RED}错误: 无法安装必要工具。请确保有足够的权限或手动安装jq后再试。${NC}"
            exit 1
        fi
    fi
    
    # 如果配置文件不存在，尝试从远程获取
    if [ ! -f "$GAME_CONFIG_FILE" ]; then
        fetch_game_config
    fi
    
    while true; do
        list_available_installers
        echo -e "\n请选择要安装的游戏 [0-$(get_all_games "$GAME_CONFIG_FILE" | wc -l)]: "
        read choice
        
        if [[ "$choice" == "0" ]]; then
            exit 0
        fi
        
        run_installer $choice
    done
fi 