#!/bin/bash

# 版本信息（与云端对比的版本号）
MENU_SCRIPT_VERSION="1.0.1"
CONFIG_SCRIPT_VERSION="1.0.2"
UPDATE_SCRIPT_VERSION="1.0.1"
CONTAINER_VERSION="1.0.3"
GAME_INSTALLERS_VERSION="1.0.5"
GAME_CONFIG_JSON_VERSION="1.0.0"

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # 无颜色

# 基础URL
BASE_URL="http://blogpage.xiaozhuhouses.asia/api"

# 脚本文件定义
UPDATE_SCRIPT="update_scripts.sh"
MENU_SCRIPT="menu.sh"
START_SCRIPT="start.sh"
EXTRA_SCRIPT="game_installers.sh"
GAME_CONFIG_JSON="installgame.json"

# 创建日志目录
LOG_DIR="/home/steam/update_logs"
mkdir -p $LOG_DIR

# 日志文件
LOG_FILE="$LOG_DIR/update_$(date +%Y%m%d%H%M%S).log"

# 版本文件路径
REMOTE_VERSION_FILE="/tmp/remote_versions.json"

# 调试模式
DEBUG=true

# 日志函数
log_message() {
    local message="$1"
    local level="$2"
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    
    case "$level" in
        "INFO") color=$GREEN ;;
        "WARN") color=$YELLOW ;;
        "ERROR") color=$RED ;;
        "DEBUG") color=$BLUE ;;
        *) color=$NC ;;
    esac
    
    echo -e "${color}[$timestamp] [$level] $message${NC}"
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
}

# 调试函数
debug_log() {
    if [ "$DEBUG" = true ]; then
        log_message "$1" "DEBUG"
    fi
}

# 获取远程版本信息
get_remote_versions() {
    log_message "获取远程版本信息..." "INFO"
    
    # 添加时间戳参数避免缓存
    local timestamp=$(date +%s)
    curl -s --fail "$BASE_URL/versions.json?t=$timestamp" -o "$REMOTE_VERSION_FILE"
    
    if [ ! -f "$REMOTE_VERSION_FILE" ] || [ ! -s "$REMOTE_VERSION_FILE" ]; then
        log_message "无法获取远程版本信息，将使用本地版本" "WARN"
        return 1
    fi
    
    return 0
}

# 格式化更新日志
format_changelog() {
    local changelog_json="$1"
    local formatted=""
    
    # 检查是否为数组格式
    if [[ $changelog_json == \[* ]]; then
        # 使用jq解析数组并逐项处理
        local changelog_array=$(echo "$changelog_json" | jq -r '.[]')
        
        while IFS= read -r item; do
            if [ -n "$item" ]; then
                formatted="${formatted}    • ${item}\n"
            fi
        done <<< "$changelog_array"
    else
        # 处理字符串格式（向后兼容）
        changelog_json=$(echo "$changelog_json" | sed 's/\\n/\n/g')
        
        echo "$changelog_json" | while IFS= read -r line || [ -n "$line" ]; do
            if [ -n "$line" ]; then
                formatted="${formatted}    ${line}\n"
            else
                formatted="${formatted}\n"
            fi
        done
    fi
    
    echo -e "$formatted"
}

# 检查版本并显示更新日志
check_versions() {
    local update_needed=false
    local update_log=""
    local scripts_to_update=()
    local other_updates=false
    
    log_message "检查版本更新..." "INFO"
    
    # 获取远程版本信息
    if ! get_remote_versions; then
        export SCRIPTS_TO_UPDATE=()
        return 1
    fi
    
    # 使用jq解析远程版本文件
    # 检查更新脚本版本
    local remote_update_version=$(jq -r '.versions.update_script.version' "$REMOTE_VERSION_FILE")
    
    if [ -n "$remote_update_version" ] && [ "$remote_update_version" != "null" ] && [ "$remote_update_version" != "$UPDATE_SCRIPT_VERSION" ]; then
        update_needed=true
        scripts_to_update+=("$UPDATE_SCRIPT")
        local changelog=$(jq -c '.versions.update_script.changelog' "$REMOTE_VERSION_FILE")
        
        update_log="${update_log}${YELLOW}更新脚本${NC} (${RED}$UPDATE_SCRIPT_VERSION${NC} → ${GREEN}$remote_update_version${NC})"
        if [ -n "$changelog" ] && [ "$changelog" != "null" ]; then
            update_log="${update_log}:\n$(format_changelog "$changelog")\n"
        else
            update_log="${update_log}\n\n"
        fi
    fi
    
    # 检查菜单脚本版本
    local remote_menu_version=$(jq -r '.versions.menu_script.version' "$REMOTE_VERSION_FILE")
    
    if [ -n "$remote_menu_version" ] && [ "$remote_menu_version" != "null" ] && [ "$remote_menu_version" != "$MENU_SCRIPT_VERSION" ]; then
        update_needed=true
        other_updates=true
        scripts_to_update+=("$MENU_SCRIPT")
        local changelog=$(jq -c '.versions.menu_script.changelog' "$REMOTE_VERSION_FILE")
        
        update_log="${update_log}${YELLOW}菜单脚本${NC} (${RED}$MENU_SCRIPT_VERSION${NC} → ${GREEN}$remote_menu_version${NC})"
        if [ -n "$changelog" ] && [ "$changelog" != "null" ]; then
            update_log="${update_log}:\n$(format_changelog "$changelog")\n"
        else
            update_log="${update_log}\n\n"
        fi
    fi
    
    # 检查启动脚本版本
    local remote_config_version=$(jq -r '.versions.config_script.version' "$REMOTE_VERSION_FILE")
    
    if [ -n "$remote_config_version" ] && [ "$remote_config_version" != "null" ] && [ "$remote_config_version" != "$CONFIG_SCRIPT_VERSION" ]; then
        update_needed=true
        other_updates=true
        scripts_to_update+=("$START_SCRIPT")
        local changelog=$(jq -c '.versions.config_script.changelog' "$REMOTE_VERSION_FILE")
        
        update_log="${update_log}${YELLOW}启动脚本${NC} (${RED}$CONFIG_SCRIPT_VERSION${NC} → ${GREEN}$remote_config_version${NC})"
        if [ -n "$changelog" ] && [ "$changelog" != "null" ]; then
            update_log="${update_log}:\n$(format_changelog "$changelog")\n"
        else
            update_log="${update_log}\n\n"
        fi
    fi
    
    # 检查游戏安装脚本版本
    local remote_game_installers_version=$(jq -r '.versions.game_installers.version' "$REMOTE_VERSION_FILE")
    
    if [ -n "$remote_game_installers_version" ] && [ "$remote_game_installers_version" != "null" ] && [ "$remote_game_installers_version" != "$GAME_INSTALLERS_VERSION" ]; then
        update_needed=true
        scripts_to_update+=("$EXTRA_SCRIPT")
        local changelog=$(jq -c '.versions.game_installers.changelog' "$REMOTE_VERSION_FILE")
        
        update_log="${update_log}${YELLOW}快速部署脚本${NC} (${RED}$GAME_INSTALLERS_VERSION${NC} → ${GREEN}$remote_game_installers_version${NC})"
        if [ -n "$changelog" ] && [ "$changelog" != "null" ]; then
            update_log="${update_log}:\n$(format_changelog "$changelog")\n"
        else
            update_log="${update_log}\n\n"
        fi
    fi
    
    # 检查游戏配置文件(installgame.json)版本
    local remote_game_config_json_version=$(jq -r '.versions.game_config_json.version' "$REMOTE_VERSION_FILE")
    
    if [ -n "$remote_game_config_json_version" ] && [ "$remote_game_config_json_version" != "null" ] && [ "$remote_game_config_json_version" != "$GAME_CONFIG_JSON_VERSION" ]; then
        update_needed=true
        scripts_to_update+=("$GAME_CONFIG_JSON")
        local changelog=$(jq -c '.versions.game_config_json.changelog' "$REMOTE_VERSION_FILE")
        
        update_log="${update_log}${YELLOW}游戏配置文件${NC} (${RED}$GAME_CONFIG_JSON_VERSION${NC} → ${GREEN}$remote_game_config_json_version${NC})"
        if [ -n "$changelog" ] && [ "$changelog" != "null" ]; then
            update_log="${update_log}:\n$(format_changelog "$changelog")\n"
        else
            update_log="${update_log}\n\n"
        fi
    fi
    
    # 检查容器版本
    local remote_container_version=$(jq -r '.versions.container.version' "$REMOTE_VERSION_FILE")
    
    if [ -n "$remote_container_version" ] && [ "$remote_container_version" != "null" ] && [ "$remote_container_version" != "$CONTAINER_VERSION" ]; then
        update_needed=true
        other_updates=true
        local changelog=$(jq -c '.versions.container.changelog' "$REMOTE_VERSION_FILE")
        
        update_log="${update_log}${YELLOW}容器${NC} (${RED}$CONTAINER_VERSION${NC} → ${GREEN}$remote_container_version${NC})"
        if [ -n "$changelog" ] && [ "$changelog" != "null" ]; then
            update_log="${update_log}:\n$(format_changelog "$changelog")\n"
        else
            update_log="${update_log}\n\n"
        fi
    fi
    
    # 如果有其他脚本需要更新，并且快速部署脚本还没加入更新列表，则添加
    if [ "$other_updates" = true ] && ! [[ " ${scripts_to_update[*]} " =~ " ${EXTRA_SCRIPT} " ]]; then
        scripts_to_update+=("$EXTRA_SCRIPT")
        update_log="${update_log}${YELLOW}快速部署脚本${NC} (将一并更新)\n\n"
    fi
    
    # 如果快速部署脚本需要更新，并且游戏配置文件还没加入更新列表，则添加
    if [[ " ${scripts_to_update[*]} " =~ " ${EXTRA_SCRIPT} " ]] && ! [[ " ${scripts_to_update[*]} " =~ " ${GAME_CONFIG_JSON} " ]]; then
        scripts_to_update+=("$GAME_CONFIG_JSON")
        update_log="${update_log}${YELLOW}游戏配置文件${NC} (将一并更新)\n\n"
    fi
    
    # 显示更新日志
    if [ "$update_needed" = true ]; then
        # 确保更新脚本总是被包含在更新列表中
        if ! [[ " ${scripts_to_update[*]} " =~ " ${UPDATE_SCRIPT} " ]]; then
            scripts_to_update=("$UPDATE_SCRIPT" "${scripts_to_update[@]}")
            update_log="${update_log}${YELLOW}更新脚本${NC} (将强制更新)\n\n"
            log_message "更新脚本将被强制更新以确保更新功能正常" "INFO"
        fi
        
        # 保存需要更新的脚本列表
        export SCRIPTS_TO_UPDATE=("${scripts_to_update[@]}")
        
        echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║              ${GREEN}发现可用更新${BLUE}                         ║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
        echo -e "\n${update_log}"
        
        # 检查是否设置自动更新
        if [ "$AUTO_UPDATE" != "true" ]; then
            echo -e "${YELLOW}按回车键进行更新，或按Ctrl+C取消${NC}"
            read -r
        else
            log_message "自动更新已启用，将自动更新脚本" "INFO"
            sleep 2
        fi
        
        return 0  # 需要更新
    else
        log_message "所有组件已是最新版本，无需更新" "INFO"
        export SCRIPTS_TO_UPDATE=()
        sleep 1
        return 1  # 不需要更新
    fi
}

# 下载脚本文件
download_script() {
    local script_name="$1"
    local target_dir="$2"
    local full_url="${BASE_URL}/${script_name}"
    local target_file="${target_dir}/${script_name}"
    local backup_file="${target_file}.bak"
    
    log_message "正在下载 ${script_name}..." "INFO"
    
    # 如果文件存在，创建备份
    if [ -f "$target_file" ]; then
        cp "$target_file" "$backup_file"
        log_message "已备份原始文件: ${backup_file}" "INFO"
    fi
    
    # 使用curl下载文件
    if curl -s --fail "$full_url" -o "$target_file.tmp"; then
        # 确保下载的文件不是空的或错误页面
        if [ -s "$target_file.tmp" ] && grep -qv "404 Not Found\|Error\|DOCTYPE" "$target_file.tmp"; then
            # 如果是更新脚本本身，需要先提取新版本的版本号
            if [ "$script_name" = "$UPDATE_SCRIPT" ]; then
                # 提取新文件中的版本号
                local new_version=$(grep "^UPDATE_SCRIPT_VERSION=" "$target_file.tmp" | cut -d'"' -f2)
                if [ -n "$new_version" ]; then
                    log_message "更新脚本版本将更新为: $new_version" "INFO"
                fi
            fi
            
            # 如果是游戏安装脚本，提取新版本号
            if [ "$script_name" = "$EXTRA_SCRIPT" ]; then
                # 提取新文件中的版本号 (如果有的话)
                local new_version=$(grep "^# 版本: " "$target_file.tmp" | cut -d' ' -f3)
                if [ -n "$new_version" ]; then
                    log_message "快速部署脚本版本将更新为: $new_version" "INFO"
                fi
            fi
            
            # 如果是游戏配置文件，检查是否为有效的JSON
            if [ "$script_name" = "$GAME_CONFIG_JSON" ]; then
                if jq empty "$target_file.tmp" 2>/dev/null; then
                    log_message "游戏配置文件JSON格式验证通过" "INFO"
                else
                    log_message "下载的游戏配置文件JSON格式无效，将保留原文件" "ERROR"
                    if [ -f "$backup_file" ]; then
                        mv "$backup_file" "$target_file"
                        log_message "已恢复原始文件: ${script_name}" "INFO"
                    fi
                    rm -f "$target_file.tmp"
                    return 1
                fi
            fi
            
            mv "$target_file.tmp" "$target_file"
            chmod +x "$target_file" 2>/dev/null # 尝试设置执行权限，JSON文件可能会失败，但不影响
            log_message "成功下载并更新: ${script_name}" "INFO"
            return 0
        else
            log_message "下载的文件无效或为错误页面: ${script_name}" "ERROR"
            if [ -f "$backup_file" ]; then
                mv "$backup_file" "$target_file"
                log_message "已恢复原始文件: ${script_name}" "INFO"
            fi
            rm -f "$target_file.tmp"
            return 1
        fi
    else
        log_message "下载失败: ${script_name}" "ERROR"
        if [ -f "$backup_file" ]; then
            log_message "保留原始文件: ${script_name}" "INFO"
        fi
        rm -f "$target_file.tmp"
        return 1
    fi
}

# 主函数
main() {
    local target_dir="/home/steam"
    
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║              ${GREEN}脚本更新程序${BLUE}                         ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    
    log_message "欢迎使用脚本更新程序 v$UPDATE_SCRIPT_VERSION" "INFO"
    
    # 检查环境变量
    AUTO_UPDATE=${AUTO_UPDATE:-false}
    log_message "自动更新设置: $AUTO_UPDATE" "INFO"
    
    # 如果自动更新设置为false，则跳过版本检查
    if [ "$AUTO_UPDATE" = "false" ]; then
        log_message "自动更新已禁用，跳过版本检查" "INFO"
        # 直接启动主程序
        log_message "即将启动主程序..." "INFO"
        
        if [ -x "/home/steam/start.sh" ]; then
            exec /home/steam/start.sh
        elif [ -x "/home/steam/menu.sh" ]; then
            exec /home/steam/menu.sh
        else
            log_message "未找到可执行的主程序脚本，请检查安装" "ERROR"
            exit 1
        fi
        
        return 0
    fi
    
    # 检查版本并确定需要更新的脚本
    check_versions
    
    # 如果没有需要更新的脚本，直接退出
    if [ ${#SCRIPTS_TO_UPDATE[@]} -eq 0 ]; then
        log_message "没有需要更新的脚本，跳过更新" "INFO"
        
        # 直接启动主程序
        log_message "即将启动主程序..." "INFO"
        
        if [ -x "/home/steam/start.sh" ]; then
            exec /home/steam/start.sh
        elif [ -x "/home/steam/menu.sh" ]; then
            exec /home/steam/menu.sh
        else
            log_message "未找到可执行的主程序脚本，请检查安装" "ERROR"
            exit 1
        fi
        
        return 0
    fi
    
    log_message "开始更新脚本文件..." "INFO"
    
    # 下载需要更新的脚本
    local success_count=0
    local script_count=${#SCRIPTS_TO_UPDATE[@]}
    
    # 优先下载更新脚本
    for script_name in "${SCRIPTS_TO_UPDATE[@]}"; do
        if [ "$script_name" = "$UPDATE_SCRIPT" ]; then
            log_message "优先下载更新脚本..." "INFO"
            if download_script "$script_name" "$target_dir"; then
                ((success_count++))
            fi
            break
        fi
    done
    
    # 下载其他脚本
    for script_name in "${SCRIPTS_TO_UPDATE[@]}"; do
        if [ "$script_name" != "$UPDATE_SCRIPT" ]; then
            if download_script "$script_name" "$target_dir"; then
                ((success_count++))
            fi
        fi
    done
    
    echo
    if [ $success_count -eq $script_count ]; then
        log_message "所有脚本更新成功 ($success_count/$script_count)" "INFO"
    else
        log_message "部分脚本更新成功 ($success_count/$script_count)" "WARN"
        log_message "未成功更新的脚本将使用本地版本" "INFO"
    fi
    
    # 确保所有脚本都有执行权限
    chmod +x "${target_dir}/$MENU_SCRIPT" 2>/dev/null
    chmod +x "${target_dir}/$START_SCRIPT" 2>/dev/null
    chmod +x "${target_dir}/$UPDATE_SCRIPT" 2>/dev/null
    chmod +x "${target_dir}/$EXTRA_SCRIPT" 2>/dev/null
    
    echo
    log_message "脚本更新完成，即将启动主程序..." "INFO"
}

# 运行主函数
main

# 执行完更新后启动主程序
if [ -x "/home/steam/start.sh" ]; then
    exec /home/steam/start.sh
elif [ -x "/home/steam/menu.sh" ]; then
    exec /home/steam/menu.sh
else
    log_message "未找到可执行的主程序脚本，请检查安装" "ERROR"
    exit 1
fi 