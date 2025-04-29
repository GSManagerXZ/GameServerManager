#!/bin/bash

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # 无颜色

# 创作声明
echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}创作声明：本脚本由${GREEN} 又菜又爱玩的小猪 ${BLUE}独立制作${NC}"
echo -e "${BLUE}项目完全开源，开源协议GPL3.0${NC}"
echo -e "${BLUE}允许商业用途但请勿倒卖！${NC}"
echo -e "${BLUE}=================================================${NC}"
echo ""

# 默认配置
DEFAULT_PANEL_URL="http://192.168.10.43:23333"
DEFAULT_API_KEY="58230ba934ea45af8eab636199f0faac"
DEFAULT_DAEMON_UUID="f334ce6aa88241c29b6edb2bfbf4df74"
DEFAULT_HOST_PATH="/dockerwork"
DEFAULT_DOCKER_IMAGE="dockerwork-steam-server:latest"

# 读取配置文件函数
read_config_file() {
    CONFIG_FILE="/home/steam/games/config.json"
    
    # 检查配置文件是否存在
    if [ -f "$CONFIG_FILE" ]; then
        echo -e "${BLUE}正在从配置文件读取MCSM配置...${NC}"
        
        # 检查jq命令是否可用
        if command -v jq &> /dev/null; then
            # 使用jq读取配置
            PANEL_URL=$(jq -r '.MCSM.PANEL_URL' "$CONFIG_FILE" 2>/dev/null)
            API_KEY=$(jq -r '.MCSM.API_KEY' "$CONFIG_FILE" 2>/dev/null)
            DAEMON_UUID=$(jq -r '.MCSM.DAEMON_UUID' "$CONFIG_FILE" 2>/dev/null)
            HOST_PATH=$(jq -r '.MCSM.HOST_PATH' "$CONFIG_FILE" 2>/dev/null)
            DOCKER_IMAGE=$(jq -r '.MCSM.DOCKER_IMAGE' "$CONFIG_FILE" 2>/dev/null)
            
            # 检查读取的值是否有效
            [ "$PANEL_URL" != "null" ] && [ -n "$PANEL_URL" ] && DEFAULT_PANEL_URL="$PANEL_URL"
            [ "$API_KEY" != "null" ] && [ -n "$API_KEY" ] && DEFAULT_API_KEY="$API_KEY"
            [ "$DAEMON_UUID" != "null" ] && [ -n "$DAEMON_UUID" ] && DEFAULT_DAEMON_UUID="$DAEMON_UUID"
            [ "$HOST_PATH" != "null" ] && [ -n "$HOST_PATH" ] && DEFAULT_HOST_PATH="$HOST_PATH"
            
            # 检查DOCKER_IMAGE配置项是否存在
            if [ "$DOCKER_IMAGE" = "null" ] || [ -z "$DOCKER_IMAGE" ]; then
                echo -e "${YELLOW}警告: 配置文件中缺少DOCKER_IMAGE配置项${NC}"
                echo -e "${YELLOW}由于配置项已更新，请删除config.json文件后重新启动容器生成最新配置项${NC}"
                echo -e "${YELLOW}并按照原有配置重新填写其他配置项${NC}"
            else
                DEFAULT_DOCKER_IMAGE="$DOCKER_IMAGE"
            fi
            
            echo -e "${GREEN}已从配置文件读取MCSM配置${NC}"
        else
            # 使用grep和sed简单解析JSON
            echo -e "${YELLOW}警告: jq命令不可用，使用替代方法解析配置文件${NC}"
            
            PANEL_URL=$(grep -o '"PANEL_URL"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" | sed 's/.*"PANEL_URL"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
            API_KEY=$(grep -o '"API_KEY"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" | sed 's/.*"API_KEY"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
            DAEMON_UUID=$(grep -o '"DAEMON_UUID"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" | sed 's/.*"DAEMON_UUID"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
            HOST_PATH=$(grep -o '"HOST_PATH"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" | sed 's/.*"HOST_PATH"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
            DOCKER_IMAGE=$(grep -o '"DOCKER_IMAGE"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" | sed 's/.*"DOCKER_IMAGE"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
            
            # 检查读取的值是否有效
            [ -n "$PANEL_URL" ] && DEFAULT_PANEL_URL="$PANEL_URL"
            [ -n "$API_KEY" ] && DEFAULT_API_KEY="$API_KEY"
            [ -n "$DAEMON_UUID" ] && DEFAULT_DAEMON_UUID="$DAEMON_UUID"
            [ -n "$HOST_PATH" ] && DEFAULT_HOST_PATH="$HOST_PATH"
            
            # 检查DOCKER_IMAGE配置项是否存在
            if [ -z "$DOCKER_IMAGE" ]; then
                echo -e "${YELLOW}警告: 配置文件中缺少DOCKER_IMAGE配置项${NC}"
                echo -e "${YELLOW}由于配置项已更新，请删除config.json文件后重新启动容器生成最新配置项${NC}"
                echo -e "${YELLOW}并按照原有配置重新填写其他配置项${NC}"
            else
                DEFAULT_DOCKER_IMAGE="$DOCKER_IMAGE"
            fi
            
            echo -e "${GREEN}已从配置文件读取MCSM配置${NC}"
        fi
    else
        echo -e "${YELLOW}配置文件不存在，使用默认配置${NC}"
    fi
}

# 读取配置文件
read_config_file

# 配置函数 - 可被覆盖
MCSM_PANEL_URL=${MCSM_PANEL_URL:-$DEFAULT_PANEL_URL}
MCSM_API_KEY=${MCSM_API_KEY:-$DEFAULT_API_KEY}
MCSM_DAEMON_UUID=${MCSM_DAEMON_UUID:-$DEFAULT_DAEMON_UUID}
MCSM_HOST_PATH=${MCSM_HOST_PATH:-$DEFAULT_HOST_PATH}
MCSM_DOCKER_IMAGE=${MCSM_DOCKER_IMAGE:-$DEFAULT_DOCKER_IMAGE}

# 设置配置变量
mcsm_set_config() {
  MCSM_PANEL_URL=${1:-$MCSM_PANEL_URL}
  MCSM_API_KEY=${2:-$MCSM_API_KEY}
  MCSM_DAEMON_UUID=${3:-$MCSM_DAEMON_UUID}
  MCSM_HOST_PATH=${4:-$MCSM_HOST_PATH}
  MCSM_DOCKER_IMAGE=${5:-$MCSM_DOCKER_IMAGE}
  
  echo -e "${GREEN}已设置MCSManager API配置:${NC}"
  echo -e "${BLUE}面板地址:${NC} $MCSM_PANEL_URL"
  echo -e "${BLUE}API密钥:${NC} $MCSM_API_KEY"
  echo -e "${BLUE}守护进程UUID:${NC} $MCSM_DAEMON_UUID"
  echo -e "${BLUE}宿主路径:${NC} $MCSM_HOST_PATH"
  echo -e "${BLUE}Docker镜像:${NC} $MCSM_DOCKER_IMAGE"
}

# 保存配置到文件
mcsm_save_config() {
    CONFIG_FILE="/home/steam/games/config.json"
    
    echo -e "${BLUE}正在保存MCSM配置到文件...${NC}"
    
    # 确保目录存在
    mkdir -p "/home/steam/games"
    
    # 创建JSON配置文件
    cat > "$CONFIG_FILE" << EOL
{
    "MCSM": {
        "PANEL_URL": "$MCSM_PANEL_URL",
        "API_KEY": "$MCSM_API_KEY",
        "DAEMON_UUID": "$MCSM_DAEMON_UUID",
        "HOST_PATH": "$MCSM_HOST_PATH",
        "DOCKER_IMAGE": "$MCSM_DOCKER_IMAGE"
    }
}
EOL
    
    # 设置权限
    chmod 644 "$CONFIG_FILE"
    
    echo -e "${GREEN}配置已保存到: $CONFIG_FILE${NC}"
}

# 修改设置配置变量函数，增加保存功能
mcsm_set_config_and_save() {
  mcsm_set_config "$@"
  mcsm_save_config
}

# 创建Docker实例 - 基本版本
mcsm_create_instance() {
  local nickname="$1"
  local game_name="$2"
  local image="$3"
  
  # 设置卷映射 - 只映射HOST_PATH到容器内的games目录
  local volumes="$MCSM_HOST_PATH|/home/steam/games"
  
  # 构建请求
  local request_data='{
    "nickname": "'$nickname'",
    "startCommand": "",
    "stopCommand":  "^C",
    "cwd": "'$MCSM_HOST_PATH'/'$nickname'",
    "ie": "utf8",
    "oe": "utf8",
    "type": "steam/universal",
    "tag": [],
    "endTime": 0,
    "fileCode": "utf8",
    "processType": "docker",
    "updateCommand": "",
    "actionCommandList": [],
    "crlf": 2,
    "docker": {
      "image": "'$image'",
      "workingDir":"",
      "ports": [],
      "extraVolumes": [
        "'$volumes'"
      ],
      "env": [
        "AUTO_UPDATE=false",
        "GAME_TO_RUN='$game_name'"
      ]
    }
  }'
  
  # 构建API URL
  local api_url="$MCSM_PANEL_URL/api/instance?apikey=$MCSM_API_KEY&daemonId=$MCSM_DAEMON_UUID"
  
  # 发送请求
  echo -e "${BLUE}正在创建实例: $nickname${NC}"
  local response=$(curl --location --request POST "$api_url" \
    --header 'X-Requested-With: XMLHttpRequest' \
    --header 'Content-Type: application/json; charset=utf-8' \
    --header 'Accept: */*' \
    --data-raw "$request_data")
  
  # 解析响应
  if [[ "$response" == *"\"status\":200"* ]]; then
    echo -e "${GREEN}创建实例成功: $nickname${NC}"
    
    # 提取instanceUuid
    local instance_uuid=$(echo "$response" | grep -o '"instanceUuid":"[^"]*' | cut -d'"' -f4)
    if [ -n "$instance_uuid" ]; then
      echo -e "${BLUE}实例UUID:${NC} $instance_uuid"
    fi
    
    return 0
  else
    echo -e "${RED}创建实例失败: $nickname${NC}"
    echo -e "${YELLOW}错误信息:${NC} $response"
    return 1
  fi
}

# 创建Minecraft Java版实例
mcsm_create_minecraft_java() {
  local nickname="${1:-Minecraft Java服务器}"
  local game_name="${2:-minecraft_java}"
  local image="${3:-itzg/minecraft-server:latest}"
  
  mcsm_create_instance "$nickname" "$game_name" "$image"
}

# 创建Minecraft基岩版实例
mcsm_create_minecraft_bedrock() {
  local nickname="${1:-Minecraft基岩版服务器}"
  local game_name="${2:-minecraft_bedrock}"
  local image="${3:-itzg/minecraft-bedrock-server:latest}"
  
  mcsm_create_instance "$nickname" "$game_name" "$image"
}

# 创建Steam游戏服务器实例
mcsm_create_steam_server() {
  local nickname="${1:-Steam游戏服务器}"
  local game_name="${2:-steam_server}"
  
  mcsm_create_instance "$nickname" "$game_name" "$MCSM_DOCKER_IMAGE"
}

# 创建自定义实例
mcsm_create_custom_instance() {
  local nickname="$1"
  local game_name="$2"
  local image="$3"
  local start_command="${4:-}"
  local ports="${5:-[]}"
  local env="${6:-[\"AUTO_UPDATE=false\",\"GAME_TO_RUN=$game_name\"]}"
  
  # 设置工作目录 - 使用宿主机路径
  local cwd="$MCSM_HOST_PATH/$game_name"
  
  # 设置卷映射 - 只映射HOST_PATH到容器内的games目录
  local volumes="$MCSM_HOST_PATH|/home/steam/games"
  
  # 构建请求
  local request_data='{
    "nickname": "'$nickname'",
    "startCommand": "'$start_command'",
    "stopCommand":  "^C",
    "cwd": "'$MCSM_HOST_PATH'/'$game_name'",
    "ie": "utf8",
    "oe": "utf8",
    "type": "steam/universal",
    "tag": [],
    "endTime": 0,
    "fileCode": "utf8",
    "processType": "docker",
    "updateCommand": "",
    "actionCommandList": [],
    "crlf": 2,
    "docker": {
      "image": "'$image'",
      "workingDir":"",
      "ports": '$ports',
      "extraVolumes": [
        "'$volumes'"
      ],
      "env": '$env'
    }
  }'
  
  # 构建API URL
  local api_url="$MCSM_PANEL_URL/api/instance?apikey=$MCSM_API_KEY&daemonId=$MCSM_DAEMON_UUID"
  
  # 发送请求
  echo -e "${BLUE}正在创建自定义实例: $nickname${NC}"
  local response=$(curl --location --request POST "$api_url" \
    --header 'X-Requested-With: XMLHttpRequest' \
    --header 'Content-Type: application/json; charset=utf-8' \
    --header 'Accept: */*' \
    --data-raw "$request_data")
  
  # 解析响应
  if [[ "$response" == *"\"status\":200"* ]]; then
    echo -e "${GREEN}创建自定义实例成功: $nickname${NC}"
    
    # 提取instanceUuid
    local instance_uuid=$(echo "$response" | grep -o '"instanceUuid":"[^"]*' | cut -d'"' -f4)
    if [ -n "$instance_uuid" ]; then
      echo -e "${BLUE}实例UUID:${NC} $instance_uuid"
    fi
    
    return 0
  else
    echo -e "${RED}创建自定义实例失败: $nickname${NC}"
    echo -e "${YELLOW}错误信息:${NC} $response"
    return 1
  fi
}

# 示例用法 (仅供参考)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo -e "${YELLOW}这是一个库文件，不应直接执行。${NC}"
  echo -e "${GREEN}示例用法:${NC}"
  echo "source ./$(basename "$0")"
  echo 'mcsm_set_config "http://localhost:23333" "your_api_key" "daemon_uuid" "/path/to/games" "dockerwork-steam-server:latest"'
  echo 'mcsm_set_config_and_save "http://localhost:23333" "your_api_key" "daemon_uuid" "/path/to/games" "dockerwork-steam-server:latest" # 设置并保存到配置文件'
  echo 'mcsm_save_config # 保存当前配置到文件'
  echo 'mcsm_create_minecraft_java "我的Java服务器" "minecraft_server_1" "itzg/minecraft-server:latest"'
  echo 'mcsm_create_minecraft_bedrock "我的基岩版服务器" "bedrock_server_1" "itzg/minecraft-bedrock-server:latest"'
  echo 'mcsm_create_steam_server "我的Steam服务器" "steam_server_1"'
  echo 'mcsm_create_custom_instance "自定义服务器" "custom_server" "custom/image:tag" "启动命令" "[{\"hostPort\":\"25565\",\"containerPort\":\"25565\",\"protocol\":\"tcp\"}]" "[\"ENV1=value1\",\"ENV2=value2\"]"'
fi 