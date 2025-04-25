#!/bin/bash

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # 无颜色

# 清空输入缓冲区
read -t 0.1 -n 10000 discard || true

# 清屏
clear

# 设置输入超时，防止docker attach时卡住
TMOUT=60  # 60秒无输入自动刷新菜单
export TMOUT

# 打印Steam游戏服务器管理菜单
function show_main_menu() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║          ${GREEN}欢迎使用星辰的游戏开服容器${BLUE}                 ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[1]${NC} 运行 SteamCMD                                 ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[2]${NC} 管理已安装游戏                                ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[3]${NC} 通过AppID安装游戏                             ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[4]${NC} 系统信息                                      ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[5]${NC} 打开Shell终端                                 ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[6]${NC} 快速部署游戏                                  ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[7]${NC} 设置                                          ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[0]${NC} 退出                                          ${BLUE}║${NC}"
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    echo -e "\n请选择操作 [0-7]: "
}

# 显示主菜单
show_main_menu
read choice

# 如果用户输入为空（比如按了多次回车），默认刷新菜单
if [ -z "$choice" ]; then
    exec "$0"
    exit 0
fi

# 函数：显示游戏列表菜单
function show_games_menu() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║               ${GREEN}已安装游戏列表${BLUE}                      ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    
    # 检查游戏目录
    GAMES_DIR="/home/steam/games"
    STEAM_GAMES_DIR="/home/steam/Steam/steamapps/common"
    
    # 初始化游戏数组
    game_dirs=()
    game_names=()
    i=1
    found_games=false
    
    # 检查主游戏目录
    if [ -d "$GAMES_DIR" ] && [ ! -z "$(ls -A $GAMES_DIR 2>/dev/null)" ]; then
        for dir in "$GAMES_DIR"/*; do
            if [ -d "$dir" ]; then
                game_name=$(basename "$dir")
                game_dirs+=("$dir")
                game_names+=("$game_name")
                echo -e "${BLUE}║  ${YELLOW}[$i]${NC} $game_name ${GREEN}(games目录)${NC}"
                ((i++))
                found_games=true
            fi
        done
    fi
    
    # 检查Steam默认目录
    if [ -d "$STEAM_GAMES_DIR" ] && [ ! -z "$(ls -A $STEAM_GAMES_DIR 2>/dev/null)" ]; then
        for dir in "$STEAM_GAMES_DIR"/*; do
            if [ -d "$dir" ]; then
                game_name=$(basename "$dir")
                game_dirs+=("$dir")
                game_names+=("$game_name")
                echo -e "${BLUE}║  ${YELLOW}[$i]${NC} $game_name ${YELLOW}(Steam目录)${NC}"
                ((i++))
                found_games=true
            fi
        done
    fi
    
    if [ "$found_games" = false ]; then
        echo -e "${BLUE}║  ${RED}没有找到已安装的游戏${BLUE}                           ║${NC}"
        echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
        echo -e "${BLUE}║  ${YELLOW}[M]${NC} 迁移Steam游戏到持久化目录                     ${BLUE}║${NC}"
        echo -e "${BLUE}║  ${YELLOW}[0]${NC} 返回主菜单                                    ${BLUE}║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
        echo -e "\n请选择操作 [0/M]: "
        read game_choice
        
        if [[ "$game_choice" == "M" || "$game_choice" == "m" ]]; then
            migrate_games
        fi
        return
    fi
    
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║  ${YELLOW}[M]${NC} 迁移Steam游戏到持久化目录                     ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[0]${NC} 返回主菜单                                    ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    
    echo -e "\n请选择游戏 [0-$((i-1))/M]: "
    read game_choice
    
    if [[ "$game_choice" == "M" || "$game_choice" == "m" ]]; then
        migrate_games
    elif [[ $game_choice =~ ^[0-9]+$ ]] && [ $game_choice -ge 1 ] && [ $game_choice -le $((i-1)) ]; then
        selected_game="${game_dirs[$((game_choice-1))]}"
        show_game_options "$selected_game"
    fi
}

# 函数：迁移游戏到持久化目录
function migrate_games() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║               ${GREEN}迁移游戏到持久化目录${BLUE}                ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    
    STEAM_GAMES_DIR="/home/steam/Steam/steamapps/common"
    GAMES_DIR="/home/steam/games"
    
    if [ ! -d "$STEAM_GAMES_DIR" ] || [ -z "$(ls -A $STEAM_GAMES_DIR 2>/dev/null)" ]; then
        echo -e "${BLUE}║  ${RED}Steam目录中没有找到游戏${BLUE}                        ║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
        echo -e "\n${YELLOW}按任意键返回...${NC}"
        read -n 1
        return
    fi
    
    # 列出Steam目录中的游戏
    game_dirs=()
    i=1
    
    for dir in "$STEAM_GAMES_DIR"/*; do
        if [ -d "$dir" ]; then
            game_name=$(basename "$dir")
            game_dirs+=("$dir")
            echo -e "${BLUE}║  ${YELLOW}[$i]${NC} $game_name"
            ((i++))
        fi
    done
    
    echo -e "${BLUE}║  ${YELLOW}[A]${NC} 迁移所有游戏"
    echo -e "${BLUE}║  ${YELLOW}[0]${NC} 返回上级菜单"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    
    echo -e "\n请选择要迁移的游戏 [0-$((i-1))/A]: "
    read choice
    
    if [[ "$choice" == "A" || "$choice" == "a" ]]; then
        # 迁移所有游戏
        echo -e "\n${YELLOW}正在迁移所有游戏...${NC}\n"
        
        # 检查目标目录权限
        if [ ! -w "$GAMES_DIR" ] && [ -d "$GAMES_DIR" ]; then
            echo -e "${RED}错误: 没有目标目录的写入权限${NC}"
            echo -e "${YELLOW}请以Root用户运行容器，或手动设置目录权限${NC}"
            echo -e "\n${YELLOW}按任意键返回...${NC}"
            read -n 1
            return
        fi
        
        # 尝试创建目标目录（如果不存在）
        if [ ! -d "$GAMES_DIR" ]; then
            mkdir -p "$GAMES_DIR" 2>/dev/null
            if [ ! -d "$GAMES_DIR" ]; then
                echo -e "${RED}错误: 无法创建游戏目录，权限不足${NC}"
                echo -e "${YELLOW}请以Root用户运行容器，或手动设置目录权限${NC}"
                echo -e "\n${YELLOW}按任意键返回...${NC}"
                read -n 1
                return
            fi
        fi
        
        success_count=0
        fail_count=0
        
        for dir in "${game_dirs[@]}"; do
            game_name=$(basename "$dir")
            target_dir="$GAMES_DIR/$game_name"
            
            echo -e "${GREEN}正在迁移 $game_name...${NC}"
            if [ -d "$target_dir" ]; then
                echo -e "${RED}目标目录已存在，跳过...${NC}"
                ((fail_count++))
                continue
            fi
            
            # 创建目标目录并设置权限
            mkdir -p "$target_dir" 2>/dev/null
            if [ ! -d "$target_dir" ]; then
                echo -e "${RED}错误: 无法创建目标目录，跳过...${NC}"
                ((fail_count++))
                continue
            fi
            
            chmod -R 755 "$target_dir" 2>/dev/null
            
            # 复制文件
            if cp -r "$dir"/* "$target_dir"/ 2>/dev/null; then
                chmod -R u+w "$target_dir" 2>/dev/null
                
                # 尝试获取AppID并存储到文件中
                if [ -f "$dir/steam_appid.txt" ]; then
                    cp "$dir/steam_appid.txt" "$target_dir/steam_appid.txt" 2>/dev/null
                else
                    # 尝试在其他位置寻找AppID
                    app_id=""
                    for potential_file in "$dir/steamclient.so" "$dir/GameInfo.txt" "$dir/*.exe"; do
                        if [ -f "$potential_file" ]; then
                            app_id=$(strings "$potential_file" | grep -E '^[0-9]{3,6}$' | head -1)
                            if [ -n "$app_id" ]; then
                                break
                            fi
                        fi
                    done
                    
                    if [ -n "$app_id" ]; then
                        echo "$app_id" > "$target_dir/steam_appid.txt" 2>/dev/null
                    fi
                fi
                
                echo -e "${GREEN}$game_name 迁移完成${NC}"
                ((success_count++))
            else
                echo -e "${RED}错误: 复制文件失败，跳过...${NC}"
                ((fail_count++))
            fi
        done
        
        # 显示迁移结果统计
        echo -e "\n${GREEN}迁移完成: $success_count 个成功, $fail_count 个失败${NC}"
        if [ $fail_count -gt 0 ]; then
            echo -e "${YELLOW}注意: 某些游戏迁移失败，可能是权限问题。${NC}"
            echo -e "${YELLOW}请以Root用户运行容器，或手动设置目录权限${NC}"
        fi
    elif [[ $choice =~ ^[0-9]+$ ]] && [ $choice -ge 1 ] && [ $choice -le $((i-1)) ]; then
        # 迁移单个游戏
        selected_dir="${game_dirs[$((choice-1))]}"
        game_name=$(basename "$selected_dir")
        target_dir="$GAMES_DIR/$game_name"
        
        echo -e "\n${YELLOW}正在迁移 $game_name...${NC}\n"
        
        # 检查目标目录是否存在
        if [ -d "$target_dir" ]; then
            echo -e "${RED}目标目录已存在，是否覆盖？(y/n): ${NC}"
            read overwrite
            if [[ "$overwrite" != "y" && "$overwrite" != "Y" ]]; then
                echo -e "${YELLOW}已取消迁移${NC}"
                echo -e "\n${YELLOW}按任意键返回...${NC}"
                read -n 1
                return
            fi
        fi
        
        # 尝试创建目标目录并设置权限
        mkdir -p "$target_dir" 2>/dev/null
        
        # 检查目录是否创建成功
        if [ ! -d "$target_dir" ]; then
            echo -e "${RED}错误: 无法创建目标目录，权限不足${NC}"
            echo -e "${YELLOW}请以Root用户运行容器，或手动设置目录权限${NC}"
            echo -e "\n${YELLOW}按任意键返回...${NC}"
            read -n 1
            return
        fi
        
        # 设置目录权限
        chmod -R 755 "$target_dir" 2>/dev/null
        
        # 复制文件
        echo -e "${YELLOW}正在复制文件，这可能需要一些时间...${NC}"
        if cp -r "$selected_dir"/* "$target_dir"/ 2>/dev/null; then
            # 设置文件权限
            chmod -R u+w "$target_dir" 2>/dev/null
            
            # 尝试获取AppID并存储到文件中
            if [ -f "$selected_dir/steam_appid.txt" ]; then
                cp "$selected_dir/steam_appid.txt" "$target_dir/steam_appid.txt" 2>/dev/null
            fi
            
            echo -e "${GREEN}$game_name 迁移完成${NC}"
        else
            echo -e "${RED}错误: 复制文件失败，可能是权限不足或空间不足${NC}"
            echo -e "${YELLOW}请以Root用户运行容器，或手动设置目录权限${NC}"
        fi
    fi
    
    echo -e "\n${YELLOW}按任意键返回...${NC}"
    read -n 1
}

# 函数：显示指定游戏的选项
function show_game_options() {
    local game_dir="$1"
    local game_name=$(basename "$game_dir")
    
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║               ${GREEN}$game_name${BLUE}                         ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║  ${YELLOW}[1]${NC} 启动服务端                                    ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[2]${NC} 更新服务端                                      ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[0]${NC} 返回上级菜单                                  ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    
    echo -e "\n请选择操作 [0-2]: "
    read option_choice
    
    case $option_choice in
        1)
            # 查找启动脚本
                clear
                echo -e "${GREEN}正在启动 $game_name 服务器...${NC}\n"
            
            # 记录启动前的开放端口列表
            echo -e "${YELLOW}整理监控端口信息...${NC}"
            # 获取TCP端口
            tcp_ports_before=$(netstat -tuln | grep "LISTEN" | awk '{print $4}' | awk -F: '{print $NF}' | sort -n | uniq)
            # 获取UDP端口（UDP没有LISTEN状态，直接获取）
            udp_ports_before=$(netstat -tuln | grep "^udp" | awk '{print $4}' | awk -F: '{print $NF}' | sort -n | uniq)
            # 合并端口列表
            ports_before=$(echo "$tcp_ports_before $udp_ports_before" | tr ' ' '\n' | sort -n | uniq)
            
            # 创建临时信号文件作为监控控制
            SIGNAL_FILE="/tmp/server_running_$$.signal"
            touch $SIGNAL_FILE
            
            # 自动检测脚本文件
            sh_scripts=()
            i=1
            
            # 查找所有.sh结尾的脚本文件
            for script in "$game_dir"/*.sh; do
                if [ -f "$script" ] && [ -x "$script" ]; then
                    sh_scripts+=("$script")
                            ((i++))
                fi
            done
            
            # 如果只找到一个.sh脚本，直接执行
            if [ ${#sh_scripts[@]} -eq 1 ]; then
                launch_script="${sh_scripts[0]}"
            # 如果找到多个.sh脚本，让用户选择
            elif [ ${#sh_scripts[@]} -gt 1 ]; then
                echo -e "${YELLOW}找到多个启动脚本，请选择:${NC}\n"
                i=1
                for script in "${sh_scripts[@]}"; do
                    script_name=$(basename "$script")
                    echo -e "${YELLOW}[$i]${NC} $script_name"
                        ((i++))
                done
                echo -e "\n请选择要启动的脚本 [1-$((i-1))]: "
                read script_choice
                
                if [[ $script_choice =~ ^[0-9]+$ ]] && [ $script_choice -ge 1 ] && [ $script_choice -le $((i-1)) ]; then
                    launch_script="${sh_scripts[$((script_choice-1))]}"
                else
                    echo -e "${RED}无效选择，退出启动过程${NC}"
                echo -e "${YELLOW}按任意键继续...${NC}"
                read -n 1
                return
            fi
            # 如果没有找到.sh脚本，查找可执行文件
            else
                executable_files=()
                i=1
                echo -e "${YELLOW}未找到.sh脚本，正在查找可执行文件...${NC}\n"
                
                # 查找所有可执行文件但排除.sh文件
                for exec_file in $(find "$game_dir" -maxdepth 1 -type f -executable ! -name "*.sh"); do
                    if [ -f "$exec_file" ]; then
                        executable_files+=("$exec_file")
                        exec_name=$(basename "$exec_file")
                        echo -e "${YELLOW}[$i]${NC} $exec_name"
                    ((i++))
                fi
            done
            
                # 如果只找到一个可执行文件，直接执行
                if [ ${#executable_files[@]} -eq 1 ]; then
                    launch_script="${executable_files[0]}"
                # 如果找到多个可执行文件，让用户选择
                elif [ ${#executable_files[@]} -gt 1 ]; then
                    echo -e "\n请选择要启动的可执行文件 [1-$((i-1))]: "
                    read exec_choice
                    
                    if [[ $exec_choice =~ ^[0-9]+$ ]] && [ $exec_choice -ge 1 ] && [ $exec_choice -le $((i-1)) ]; then
                        launch_script="${executable_files[$((exec_choice-1))]}"
                    else
                        echo -e "${RED}无效选择，退出启动过程${NC}"
                echo -e "${YELLOW}按任意键继续...${NC}"
                read -n 1
                return
            fi
            else
                    echo -e "${RED}没有找到启动脚本或可执行文件。请先创建启动脚本。${NC}"
                echo -e "${YELLOW}按任意键继续...${NC}"
                    read -n 1
                    return
                fi
            fi
            
            # 启动端口监控进程
            (
                sleep 10 # 给服务器一些启动时间
                
                local check_interval=5  # 每5秒检查一次
                local max_checks=720     # 最多检查720次 (60分钟)
                local checks=0
                local found_new_ports=false
                # 跟踪已经通知过的端口
                local notified_ports=""
                
                echo -e "\n${YELLOW}开始持续检测端口状况...${NC}"
                
                while [ $checks -lt $max_checks ] && [ -f "$SIGNAL_FILE" ]; do
                    # 获取当前开放端口 (TCP和UDP)
                    tcp_ports_now=$(netstat -tuln | grep "LISTEN" | awk '{print $4}' | awk -F: '{print $NF}' | sort -n | uniq)
                    udp_ports_now=$(netstat -tuln | grep "^udp" | awk '{print $4}' | awk -F: '{print $NF}' | sort -n | uniq)
                    ports_now=$(echo "$tcp_ports_now $udp_ports_now" | tr ' ' '\n' | sort -n | uniq)
                    
                    # 找出新开放的端口
                    new_ports=""
                    new_tcp_ports=""
                    new_udp_ports=""
                    really_new_ports=false
                    
                    for port in $ports_now; do
                        if ! echo "$ports_before" | grep -q "$port"; then
                            # 检查是否已经通知过这个端口
                            if ! echo "$notified_ports" | grep -q "$port"; then
                                new_ports="$new_ports $port"
                                # 判断是TCP还是UDP
                                if netstat -tuln | grep "^tcp" | grep ":$port" > /dev/null; then
                                    new_tcp_ports="$new_tcp_ports $port"
                                fi
                                if netstat -tuln | grep "^udp" | grep ":$port" > /dev/null; then
                                    new_udp_ports="$new_udp_ports $port"
                                fi
                                really_new_ports=true
                                # 添加到已通知列表
                                notified_ports="$notified_ports $port"
                            fi
                            found_new_ports=true
                        fi
                    done
                    
                    # 如果发现新端口，显示提示（不清屏，保留之前的输出）
                    if [ "$really_new_ports" = true ] && [ ! -z "$new_ports" ]; then
                        echo -e "\n\n"
                        echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
                        echo -e "${GREEN}║                    ${YELLOW}服务端已运行!${GREEN}                      ║${NC}"
                        echo -e "${GREEN}╠═══════════════════════════════════════════════════════════╣${NC}"
                        echo -e "${GREEN}║                                                           ║${NC}"
                        echo -e "${GREEN}║  ${BLUE}检测到以下新开放的端口:${NC}                                ${GREEN}║${NC}"
                        
                        # 显示所有新TCP端口
                        for port in $new_tcp_ports; do
                            port_str=$(printf "%-5s" "$port")  # 固定宽度显示端口
                            echo -e "${GREEN}║  ${RED}•${NC} ${YELLOW}$port_str${NC} ${GREEN}(TCP)${NC} - 监听地址: ${BLUE}0.0.0.0:$port${NC}           ${GREEN}║${NC}"
                        done
                        
                        # 显示所有新UDP端口
                        for port in $new_udp_ports; do
                            port_str=$(printf "%-5s" "$port")  # 固定宽度显示端口
                            echo -e "${GREEN}║  ${RED}•${NC} ${YELLOW}$port_str${NC} ${GREEN}(UDP)${NC} - 监听地址: ${BLUE}0.0.0.0:$port${NC}           ${GREEN}║${NC}"
                        done
                        
                        echo -e "${GREEN}║                                                           ║${NC}"
                        echo -e "${GREEN}║  ${BLUE}这表明游戏服务器可能已启动完成${NC}                        ${GREEN}║${NC}"
                        echo -e "${GREEN}║                                                           ║${NC}"
                        # 分割长消息为多行，保持边距对齐
                        echo -e "${GREEN}║  ${BLUE}* 如果容器外部端口和内部端口不一致，请使用容器外部端口进服。${NC}${GREEN}║${NC}"
                        echo -e "${GREEN}║    ${BLUE}部分游戏可能无法连接端口转发类网络，建议外部端口和内部${NC}  ${GREEN}║${NC}"
                        echo -e "${GREEN}║    ${BLUE}端口保持一致以确保兼容性${NC}                            ${GREEN}║${NC}"
                        echo -e "${GREEN}║  ${BLUE}* 确保您的防火墙已经开放上述端口${NC}                      ${GREEN}║${NC}"
                        echo -e "${GREEN}║  ${BLUE}* 某些游戏同时使用TCP和UDP协议，请开放两种类型${NC}        ${GREEN}║${NC}"
                        echo -e "${GREEN}║                                                           ║${NC}"
                        echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
                        echo -e "\n${YELLOW}服务端仍然在继续运行，您可以输入命令与服务端交互(一些steam服务端可能不支持终端命令，请使用RCON。)...${NC}\n"
                    fi
                    
                    # 等待一段时间后再次检查
                    sleep $check_interval
                    ((checks++))
                    
                    # 只在找到新端口前显示进度点
                    if [ "$found_new_ports" = false ]; then
                        echo -n "."
                    fi
                done
                
                # 如果超时仍未发现新端口，且信号文件仍然存在
                if [ "$found_new_ports" = false ] && [ -f "$SIGNAL_FILE" ]; then
                    echo -e "\n${YELLOW}监控超时，未检测到新开放的端口。服务器可能仍在启动中...${NC}"
                    echo -e "${YELLOW}您可以继续与服务器交互...${NC}\n"
                fi
            ) &
            MONITOR_PID=$!
            
            # 直接在前台启动服务器，允许用户交互
            cd "$game_dir"
            echo -e "\n${YELLOW}服务器正在启动中，执行: $(basename "$launch_script")${NC}\n"
            "$launch_script"
            EXIT_CODE=$?
            
            # 结束监控进程，移除信号文件
            rm -f $SIGNAL_FILE
            sleep 1
            kill $MONITOR_PID 2>/dev/null
            
            # 显示退出信息
            echo -e "\n${YELLOW}游戏服务器已退出，退出码: $EXIT_CODE${NC}"
            echo -e "${YELLOW}按任意键继续...${NC}"
                                read -n 1
            ;;
        2)
            # 更新游戏
            clear
            echo -e "${GREEN}正在更新 $game_name...${NC}\n"
            app_id=$(find "$game_dir" -name "steam_appid.txt" -exec cat {} \; 2>/dev/null)
            
            if [ -z "$app_id" ]; then
                echo -e "${YELLOW}未找到AppID，请手动输入游戏的Steam AppID: ${NC}"
                read app_id
            fi
            
            if [ -n "$app_id" ]; then
                # 直接使用steamcmd.sh，避免符号链接
                if [ -x "/home/steam/steamcmd/steamcmd.sh" ]; then
                    cd /home/steam/steamcmd
                    ./steamcmd.sh +login anonymous +force_install_dir "$game_dir" +app_update "$app_id" validate +quit
                else
                    echo -e "${RED}错误: 找不到SteamCMD可执行文件!${NC}"
                    echo -e "${YELLOW}无法更新游戏。请先确保SteamCMD正常工作。${NC}"
                fi
            else
                echo -e "${RED}未提供AppID，无法更新游戏。${NC}"
            fi
            
            echo -e "\n${YELLOW}按任意键继续...${NC}"
            read -n 1
            ;;
        0)
            # 返回上级菜单
            return
            ;;
        *)
            echo -e "${RED}无效选择${NC}"
            sleep 1
            ;;
    esac
}

# 函数：安装新游戏
function install_new_game() {
    clear
    # 定义游戏安装目录
    GAMES_DIR="/home/steam/games"
    
    # 直接调用手动安装函数
            manual_install_steam_game
}

# 手动安装Steam游戏
function manual_install_steam_game() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║            ${GREEN}通过AppID安装游戏服务端${BLUE}                ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}║  请输入Steam游戏服务端的AppID                       ║${NC}"
    echo -e "${BLUE}║  您可以在SteamDB或Valve开发者文档中查找AppID         ║${NC}"
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║  输入0返回主菜单                                    ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    
    echo -e "\n${YELLOW}请输入游戏AppID${NC} > "
    read app_id
    
    if [ "$app_id" == "0" ]; then
        return
    fi
    
    if [[ ! $app_id =~ ^[0-9]+$ ]]; then
        echo -e "${RED}无效的AppID，必须是数字。${NC}"
        sleep 2
        return
    fi
    
    # 提示用户输入游戏目录名称
    echo -e "\n${YELLOW}请输入游戏安装目录名称 (留空使用默认名称)${NC} > "
    read custom_name
    
    # 获取游戏名称（基于AppID或用户输入）
    if [ -n "$custom_name" ]; then
        # 使用用户输入的名称，但替换空格为连字符
        game_name=$(echo "$custom_name" | tr ' ' '-')
    else
            # 使用AppID作为默认名称
            game_name="game_$app_id"
    fi
    
    # 提示用户输入Steam账户
    echo -e "\n${YELLOW}请输入Steam账户 (留空使用匿名账户)${NC} > "
    read steam_account
    
    # 设置登录命令
    if [ -n "$steam_account" ]; then
        login_cmd="+login $steam_account"
        echo -e "\n${YELLOW}是否需要输入密码？(y/n)${NC} > "
        read need_password
        
        if [[ "$need_password" == "y" || "$need_password" == "Y" ]]; then
            echo -e "${YELLOW}请输入密码 (密码不会显示)${NC} > "
            read -s steam_password
            login_cmd="$login_cmd $steam_password"
        fi
    else
        login_cmd="+login anonymous"
    fi
    
    # 直接将游戏安装到/home/steam/games目录，使用游戏名作为子目录
    install_dir="$GAMES_DIR/$game_name"
    
    # 检查目录是否已存在
    if [ -d "$install_dir" ] && [ -n "$(ls -A $install_dir 2>/dev/null)" ]; then
        echo -e "\n${YELLOW}警告: 游戏目录 '$game_name' 已存在。是否覆盖安装？(y/n)${NC} > "
        read overwrite
        if [[ "$overwrite" != "y" && "$overwrite" != "Y" ]]; then
            echo -e "${RED}安装已取消。${NC}"
            sleep 2
            return
        fi
    fi
    
    # 创建安装目录
    mkdir -p "$install_dir"
    
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                ${GREEN}游戏安装进行中${BLUE}                      ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    echo -e "\n${GREEN}正在安装 $game_name (AppID: $app_id) 到 $install_dir...${NC}\n"
    echo -e "${YELLOW}使用账户: ${NC}$(echo $login_cmd | cut -d' ' -f2)"
    echo -e "${YELLOW}这可能需要一段时间，请耐心等待...${NC}\n"
    
    # 运行SteamCMD安装游戏
    if [ -x "/home/steam/steamcmd/steamcmd.sh" ]; then
        cd /home/steam/steamcmd
        # 强制指定安装目录，确保安装到持久化目录
        ./steamcmd.sh $login_cmd +force_install_dir "$install_dir" +app_update "$app_id" validate +quit
        
        # 检查游戏是否成功安装以及目录权限
        if [ ! -d "$install_dir" ]; then
            echo -e "${RED}错误: 游戏目录未创建成功，可能是权限问题${NC}"
            
            # 尝试创建目录并设置权限
            mkdir -p "$install_dir" 2>/dev/null
            chmod -R 755 "$install_dir" 2>/dev/null
            
            # 如果游戏仍然安装到了默认Steam目录，自动迁移
            steam_game_dir="/home/steam/Steam/steamapps/common/$game_name"
            if [ -d "$steam_game_dir" ]; then
                echo -e "${YELLOW}游戏已安装到Steam默认目录，正在尝试迁移...${NC}\n"
                mkdir -p "$install_dir" 2>/dev/null
                chmod 755 "$install_dir" 2>/dev/null
                cp -r "$steam_game_dir"/* "$install_dir"/ 2>/dev/null
                if [ $? -eq 0 ]; then
                    chmod -R u+w "$install_dir" 2>/dev/null
                    echo -e "${GREEN}游戏迁移完成${NC}"
                else
                    echo -e "${RED}迁移失败，权限不足。请以Root用户运行容器，或手动设置目录权限。${NC}"
                fi
            fi
        else
            # 确保目录有写入权限
            chmod -R u+w "$install_dir" 2>/dev/null
        fi
    else
        echo -e "${RED}错误: 找不到SteamCMD可执行文件!${NC}"
        echo -e "${YELLOW}无法安装游戏。请先确保SteamCMD正常工作。${NC}"
        echo -e "\n${YELLOW}按任意键返回...${NC}"
        read -n 1
        return
    fi
    
    # 保存AppID到游戏目录
    if [ -d "$install_dir" ] && [ -w "$install_dir" ]; then
        echo "$app_id" > "$install_dir/steam_appid.txt" 2>/dev/null
        
        # 检查是否写入成功
        if [ ! -f "$install_dir/steam_appid.txt" ]; then
            echo -e "${RED}警告: 无法写入AppID文件，可能是权限问题${NC}"
        fi
        
        echo -e "\n${GREEN}游戏安装完成！${NC}"
        
        # 询问用户是否需要创建启动脚本
        echo -e "\n${YELLOW}是否要创建启动脚本？(y/n)${NC} > "
        read create_script
        
        if [[ "$create_script" == "y" || "$create_script" == "Y" ]]; then
            echo -e "\n${YELLOW}请选择启动脚本类型:${NC}"
            echo -e "${BLUE}[1]${NC} 空白模板"
            echo -e "${BLUE}[2]${NC} 基本Shell脚本"
            echo -e "${BLUE}[0]${NC} 取消"
            
            read template_choice
            
            case $template_choice in
                1)
                    # 空白模板
                    echo '#!/bin/bash' > "$install_dir/start.sh"
                    ;;
                2)
                    # 基本Shell脚本
                    cat > "$install_dir/start.sh" << EOL
#!/bin/bash
cd "\$(dirname "\$0")"
# 在此添加启动命令
# 例如: ./server_executable
EOL
                ;;
                0)
                    echo -e "${YELLOW}已取消创建启动脚本${NC}"
                ;;
            *)
                    echo -e "${RED}无效选择，已取消创建启动脚本${NC}"
                ;;
        esac
        
            # 如果创建了脚本，打开编辑器让用户编辑
            if [[ "$template_choice" == "1" || "$template_choice" == "2" ]]; then
                # 设置执行权限
            chmod +x "$install_dir/start.sh" 2>/dev/null
                
                # 提示用户是否要编辑脚本
                echo -e "\n${YELLOW}是否要立即编辑启动脚本？(y/n)${NC} > "
                read edit_script
                
                if [[ "$edit_script" == "y" || "$edit_script" == "Y" ]]; then
                    nano "$install_dir/start.sh"
                fi
                
            if [ -x "$install_dir/start.sh" ]; then
                    echo -e "${GREEN}启动脚本已创建并设置执行权限${NC}"
            else
                echo -e "${RED}警告: 无法设置启动脚本执行权限，可能是权限问题${NC}"
            fi
            fi
        fi
        
        # 显示安装后提示信息
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
    else
        echo -e "${RED}错误: 安装目录不存在或无写入权限${NC}"
    fi
    
    echo -e "\n${YELLOW}按任意键继续...${NC}"
    read -n 1
}

# 函数：显示系统信息
function show_system_info() {
    clear
    # 定义游戏安装目录
    GAMES_DIR="/home/steam/games"
    
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║               ${GREEN}系统信息${BLUE}                           ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    
    echo -e "${BLUE}║  ${YELLOW}CPU信息:${NC}                                          ${BLUE}║${NC}"
    cpu_info=$(cat /proc/cpuinfo | grep "model name" | head -n 1 | cut -d ':' -f 2 | sed 's/^[ \t]*//')
    cpu_cores=$(grep -c processor /proc/cpuinfo)
    echo -e "${BLUE}║  ${NC}$cpu_info (${cpu_cores}核)${BLUE}                       ║${NC}"
    
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}║  ${YELLOW}内存信息:${NC}                                         ${BLUE}║${NC}"
    total_mem=$(free -h | grep "Mem:" | awk '{print $2}')
    used_mem=$(free -h | grep "Mem:" | awk '{print $3}')
    free_mem=$(free -h | grep "Mem:" | awk '{print $4}')
    echo -e "${BLUE}║  ${NC}总内存: $total_mem / 已用: $used_mem / 剩余: $free_mem${BLUE}      ║${NC}"
    
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}║  ${YELLOW}磁盘信息:${NC}                                         ${BLUE}║${NC}"
    disk_info=$(df -h | grep "/home" | awk '{print "总空间: " $2 ", 已用: " $3 ", 剩余: " $4 ", 使用率: " $5}')
    if [ -z "$disk_info" ]; then
        disk_info=$(df -h | grep "/$" | awk '{print "总空间: " $2 ", 已用: " $3 ", 剩余: " $4 ", 使用率: " $5}')
    fi
    echo -e "${BLUE}║  ${NC}$disk_info${BLUE}                     ║${NC}"
    
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}║  ${YELLOW}网络信息:${NC}                                         ${BLUE}║${NC}"
    ip_info=$(hostname -I | awk '{print $1}')
    echo -e "${BLUE}║  ${NC}IP地址: $ip_info${BLUE}                               ║${NC}"
    
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}║  ${YELLOW}版本信息:${NC}                                         ${BLUE}║${NC}"
    
    # 获取各组件版本号
    if [ -f "/home/steam/update_scripts.sh" ]; then
        update_version=$(grep "^UPDATE_SCRIPT_VERSION=" "/home/steam/update_scripts.sh" | cut -d'"' -f2)
        menu_version=$(grep "^MENU_SCRIPT_VERSION=" "/home/steam/update_scripts.sh" | cut -d'"' -f2)
        config_version=$(grep "^CONFIG_SCRIPT_VERSION=" "/home/steam/update_scripts.sh" | cut -d'"' -f2)
        container_version=$(grep "^CONTAINER_VERSION=" "/home/steam/update_scripts.sh" | cut -d'"' -f2)
        game_installers_version=$(grep "^GAME_INSTALLERS_VERSION=" "/home/steam/update_scripts.sh" | cut -d'"' -f2 2>/dev/null)
    else
        update_version="未知"
        menu_version="未知"
        config_version="未知"
        container_version="未知"
        game_installers_version="未知"
    fi
    
    echo -e "${BLUE}║  ${NC}菜单脚本: ${GREEN}v${menu_version}${BLUE}                                 ║${NC}"
    echo -e "${BLUE}║  ${NC}更新脚本: ${GREEN}v${update_version}${BLUE}                                 ║${NC}"
    echo -e "${BLUE}║  ${NC}配置脚本: ${GREEN}v${config_version}${BLUE}                                 ║${NC}"
    echo -e "${BLUE}║  ${NC}快速部署: ${GREEN}v${game_installers_version}${BLUE}                                 ║${NC}"
    echo -e "${BLUE}║  ${NC}容器版本: ${GREEN}v${container_version}${BLUE}                                 ║${NC}"
    
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}║  ${YELLOW}容器环境信息:${NC}                                     ${BLUE}║${NC}"
    os_version=$(cat /etc/os-release | grep "PRETTY_NAME" | cut -d '"' -f 2)
    echo -e "${BLUE}║  ${NC}容器底层系统: $os_version${BLUE}                      ║${NC}"
    
    # 显示已安装的重要软件包
    echo -e "${BLUE}║  ${NC}已安装依赖/软件:${BLUE}                                     ║${NC}"
    
    # 检查SteamCMD
    if [ -x "/home/steam/steamcmd/steamcmd.sh" ]; then
        echo -e "${BLUE}║  ${GREEN}• SteamCMD${BLUE}                                        ║${NC}"
    else
        echo -e "${BLUE}║  ${RED}• SteamCMD (未找到)${BLUE}                               ║${NC}"
    fi
    
    # 使用apt list命令获取已安装包信息
    important_packages=("lib32gcc" "lib32stdc" "curl" "wget" "screen" "java" "python" "libsdl2" "libcurl" "libc6")
    
    for pkg in "${important_packages[@]}"; do
        # 检查是否安装了与该关键字相关的包
        pkg_info=$(apt list --installed 2>/dev/null | grep -i "$pkg" | head -n 1)
        if [ ! -z "$pkg_info" ]; then
            # 提取包名和版本
            pkg_name=$(echo "$pkg_info" | cut -d'/' -f1)
            pkg_version=$(echo "$pkg_info" | grep -o '[0-9][0-9.]*' | head -n 1)
            if [ ! -z "$pkg_version" ]; then
                echo -e "${BLUE}║  ${GREEN}• $pkg_name ($pkg_version)${BLUE}                       ║${NC}"
            else
                echo -e "${BLUE}║  ${GREEN}• $pkg_name${BLUE}                                   ║${NC}"
            fi
        fi
    done
    
    # 检查Java
    if command -v java &> /dev/null; then
        java_version=$(java -version 2>&1 | head -n 1 | cut -d '"' -f 2)
        echo -e "${BLUE}║  ${GREEN}• Java ($java_version)${BLUE}                            ║${NC}"
    fi
    
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}║  ${YELLOW}已安装游戏目录:${NC}                                   ${BLUE}║${NC}"
    found_games=false
    
    if [ -d "$GAMES_DIR" ] && [ ! -z "$(ls -A $GAMES_DIR 2>/dev/null)" ]; then
        for dir in "$GAMES_DIR"/*; do
            if [ -d "$dir" ]; then
                dir_name=$(basename "$dir")
                dir_size=$(du -sh "$dir" 2>/dev/null | cut -f1)
                echo -e "${BLUE}║  ${NC}$dir_name ($dir_size)${BLUE}                                ║${NC}"
                found_games=true
            fi
        done
    fi
    
    if [ "$found_games" = false ]; then
        echo -e "${BLUE}║  ${RED}未找到已安装的游戏${BLUE}                               ║${NC}"
    fi
    
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    
    echo -e "\n${YELLOW}按任意键返回主菜单...${NC}"
    read -n 1
}

# 添加设置功能
function show_settings() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║               ${GREEN}系统设置${BLUE}                           ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║  ${YELLOW}[1]${NC} 管理SteamCMD配置                               ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[2]${NC} 设置默认安装目录                               ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[3]${NC} 迁移已安装游戏到持久化目录                     ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[0]${NC} 返回主菜单                                     ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    
    echo -e "\n请选择操作 [0-3]: "
    read setting_choice
    
    case $setting_choice in
        1)
            # 管理SteamCMD配置
            manage_steamcmd_config
            ;;
        2)
            # 设置默认安装目录
            set_default_install_dir
            ;;
        3)
            # 迁移游戏
            migrate_games
            ;;
        0)
            # 返回主菜单
            return
            ;;
        *)
            echo -e "${RED}无效选择${NC}"
            sleep 1
            show_settings
            ;;
    esac
}

# 设置默认安装目录
function set_default_install_dir() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║            ${GREEN}设置默认安装目录${BLUE}                      ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}║  当前默认安装目录:                                  ║${NC}"
    echo -e "${BLUE}║  ${GREEN}/home/steam/games${NC}                                ${BLUE}║${NC}"
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}║  注意: 推荐使用这个目录，因为它被映射到宿主机，      ║${NC}"
    echo -e "${BLUE}║       数据会持久保存，不会因容器重启而丢失。        ║${NC}"
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    
    echo -e "\n${YELLOW}需要修改SteamCMD配置文件，以确保游戏安装到持久化目录。${NC}"
    echo -e "是否继续？ [y/n]: "
    read confirm
    
    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
        # 创建或修改SteamCMD配置
        steam_config_dir="/home/steam/Steam/config"
        mkdir -p "$steam_config_dir"
        
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
}" > "$steam_config_dir/config.vdf"
        
        echo -e "\n${GREEN}已配置SteamCMD默认安装到: /home/steam/games${NC}"
    fi
    
    echo -e "\n${YELLOW}按任意键返回...${NC}"
    read -n 1
}

# 管理SteamCMD配置
function manage_steamcmd_config() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║            ${GREEN}管理SteamCMD配置${BLUE}                      ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    
    # 检查Steam配置目录
    steam_config="/home/steam/Steam/config/config.vdf"
    
    if [ -f "$steam_config" ]; then
        echo -e "${BLUE}║  ${GREEN}已找到SteamCMD配置文件${BLUE}                          ║${NC}"
        echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
        echo -e "${BLUE}║  ${YELLOW}[1]${NC} 查看配置文件                                   ${BLUE}║${NC}"
        echo -e "${BLUE}║  ${YELLOW}[2]${NC} 编辑配置文件                                   ${BLUE}║${NC}"
        echo -e "${BLUE}║  ${YELLOW}[3]${NC} 重置配置文件                                   ${BLUE}║${NC}"
    else
        echo -e "${BLUE}║  ${RED}未找到SteamCMD配置文件${BLUE}                          ║${NC}"
        echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
        echo -e "${BLUE}║  ${YELLOW}[1]${NC} 创建默认配置文件                               ${BLUE}║${NC}"
    fi
    
    echo -e "${BLUE}║  ${YELLOW}[0]${NC} 返回上级菜单                                   ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    
    echo -e "\n请选择操作: "
    read config_choice
    
    if [ -f "$steam_config" ]; then
        case $config_choice in
            1)
                # 查看配置
                clear
                echo -e "${GREEN}SteamCMD配置文件内容:${NC}\n"
                cat "$steam_config"
                echo -e "\n${YELLOW}按任意键返回...${NC}"
                read -n 1
                ;;
            2)
                # 编辑配置
                nano "$steam_config"
                ;;
            3)
                # 重置配置
                echo -e "\n${RED}确定要重置配置文件？这将恢复默认设置。(y/n): ${NC}"
                read confirm
                if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
                    set_default_install_dir
                fi
                ;;
            0)
                # 返回
                return
                ;;
            *)
                echo -e "${RED}无效选择${NC}"
                sleep 1
                ;;
        esac
    else
        case $config_choice in
            1)
                # 创建配置
                set_default_install_dir
                ;;
            0)
                # 返回
                return
                ;;
            *)
                echo -e "${RED}无效选择${NC}"
                sleep 1
                ;;
        esac
    fi
    
    manage_steamcmd_config
}

# 处理用户选择
function process_choice() {
    case $1 in
        1)
            # 运行SteamCMD
            clear
            echo -e "${GREEN}正在启动SteamCMD...${NC}\n"
            echo -e "${YELLOW}提示: 如果需要安装游戏，请在SteamCMD中登录匿名账户:${NC}"
            echo -e "${YELLOW}      login anonymous${NC}\n"
            echo -e "${YELLOW}提示: 按Ctrl+C可以中断SteamCMD并返回菜单${NC}\n"
            
            # 直接使用steamcmd.sh，避免符号链接
            if [ -x "/home/steam/steamcmd/steamcmd.sh" ]; then
                cd /home/steam/steamcmd
                ./steamcmd.sh
            else
                echo -e "${RED}错误: 找不到SteamCMD可执行文件!${NC}"
                echo -e "${YELLOW}尝试重新安装SteamCMD...${NC}\n"
                
                # 尝试重新安装SteamCMD
                mkdir -p /home/steam/steamcmd
                cd /home/steam/steamcmd
                wget -qO- https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar zxf -
                chmod +x /home/steam/steamcmd/steamcmd.sh
                
                echo -e "${GREEN}SteamCMD安装完成，尝试启动...${NC}\n"
                ./steamcmd.sh
            fi
            ;;
        2)
            # 管理已安装游戏
            show_games_menu
            ;;
        3)
            # 安装新游戏
            install_new_game
            ;;
        4)
            # 系统信息
            show_system_info
            ;;
        5)
            # 打开Shell终端
            clear
            echo -e "${GREEN}进入Shell终端。输入 'exit' 返回菜单。${NC}\n"
            $SHELL
            ;;
        6)
            # 快速部署游戏
            # 检查多个可能的位置
            if [ -f "./game_installers.sh" ]; then
                chmod +x ./game_installers.sh
                bash ./game_installers.sh
                echo -e "\n${YELLOW}按任意键返回主菜单...${NC}"
                read -n 1
            elif [ -f "/home/steam/game_installers.sh" ]; then
                chmod +x /home/steam/game_installers.sh
                bash /home/steam/game_installers.sh
                echo -e "\n${YELLOW}按任意键返回主菜单...${NC}"
                read -n 1
            elif [ -f "$PWD/game_installers.sh" ]; then
                chmod +x "$PWD/game_installers.sh"
                bash "$PWD/game_installers.sh"
                echo -e "\n${YELLOW}按任意键返回主菜单...${NC}"
                read -n 1
            else
                clear
                echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
                echo -e "${BLUE}║               ${RED}文件未找到${BLUE}                          ║${NC}"
                echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
                echo -e "${BLUE}║                                                    ║${NC}"
                echo -e "${BLUE}║  找不到game_installers.sh文件!                     ║${NC}"
                echo -e "${BLUE}║                                                    ║${NC}"
                echo -e "${BLUE}║  该文件应与menu.sh位于同一目录下。                 ║${NC}"
                echo -e "${BLUE}║  您可以尝试以下操作:                               ║${NC}"
                echo -e "${BLUE}║                                                    ║${NC}"
                echo -e "${BLUE}║  ${YELLOW}• 检查当前目录是否存在该文件${NC}                     ${BLUE}║${NC}"
                echo -e "${BLUE}║  ${YELLOW}• 从容器映像中重新复制该文件${NC}                     ${BLUE}║${NC}"
                echo -e "${BLUE}║  ${YELLOW}• 使用选项3直接通过AppID安装游戏${NC}                 ${BLUE}║${NC}"
                echo -e "${BLUE}║                                                    ║${NC}"
                echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
                echo -e "\n${YELLOW}按任意键返回主菜单...${NC}"
                read -n 1
            fi
            ;;
        7)
            # 设置
            show_settings
            ;;
        0)
            # 退出
            clear
            echo -e "${GREEN}感谢使用Steam游戏服务器管理系统，再见！${NC}"
            exit 0
            ;;
        *)
            # 无效选择
            echo -e "${RED}无效选择，请重试${NC}"
            sleep 1
            ;;
    esac

    # 显示主菜单并处理用户输入
    show_main_menu
    read choice
    
    # 如果用户输入为空（比如按了多次回车），默认刷新菜单
    if [ -z "$choice" ]; then
        show_main_menu
        read choice
    fi
    
    # 处理新的选择
    process_choice "$choice"
}

# 处理初始选择
process_choice "$choice" 