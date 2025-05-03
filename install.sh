#!/bin/bash

# 定义镜像信息（方便统一修改）
IMAGE_NAME="xiaozhu674/gameserver"
IMAGE_VERSION="latest"
GHCR_IMAGE_NAME="yxsj245/gameserver"

# 定义颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # 无颜色

# 检测系统类型
echo "检测系统类型..."
if command -v apt &> /dev/null; then
    SYSTEM_TYPE="ubuntu"
    echo -e "${GREEN}检测到Ubuntu系统${NC}"
elif command -v yum &> /dev/null; then
    SYSTEM_TYPE="centos"
    echo -e "${GREEN}检测到CentOS系统${NC}"
else
    SYSTEM_TYPE="unknown"
    echo -e "${YELLOW}无法确定系统类型，可能影响自动安装${NC}"
fi

# 检查Docker是否已安装
echo "检查Docker是否已安装..."
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}未检测到Docker，需要安装Docker才能继续${NC}"
    
    # 询问用户是否要安装Docker
    read -p "是否要自动安装Docker？(y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "开始安装Docker..."
        
        # 根据系统类型安装Docker
        if [ "$SYSTEM_TYPE" = "ubuntu" ]; then
            echo "检测到Ubuntu系统，使用专用脚本安装Docker..."
            curl -k -o ubuntu_docker_install.sh https://pub-46d21cac9c7d44b79d73abfeb727999f.r2.dev/Linux%E8%84%9A%E6%9C%AC/ubuntu%E5%AE%89%E8%A3%85docker%E8%84%9A%E6%9C%AC/ubuntu_docker_install.sh
            chmod +x ubuntu_docker_install.sh
            sudo ./ubuntu_docker_install.sh
            rm ubuntu_docker_install.sh
        elif [ "$SYSTEM_TYPE" = "centos" ]; then
            echo "检测到CentOS系统，使用专用脚本安装Docker..."
            curl -k -o centos_install_docker.sh https://pub-46d21cac9c7d44b79d73abfeb727999f.r2.dev/Linux%E8%84%9A%E6%9C%AC/centos%E5%AE%89%E8%A3%85%E5%9B%BD%E5%86%85%E6%BA%90docker/centos_install_docker.sh
            chmod +x centos_install_docker.sh
            sudo ./centos_install_docker.sh
            rm centos_install_docker.sh
        else
            echo -e "${RED}无法确定您的系统类型，请参考Docker官方文档手动安装: https://docs.docker.com/engine/install/${NC}"
            exit 1
        fi
    else
        echo -e "${RED}需要安装Docker才能继续，请手动安装后重试${NC}"
        exit 1
    fi
fi

# 检查Docker是否安装成功
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker安装失败，请手动安装后重试${NC}"
    exit 1
fi

# 检查Docker-Compose是否已安装
echo "检查Docker-Compose是否已安装..."
if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}未检测到Docker-Compose，正在尝试安装...${NC}"
    if [ "$SYSTEM_TYPE" = "ubuntu" ]; then
        sudo apt update && sudo apt install -y docker-compose
    elif [ "$SYSTEM_TYPE" = "centos" ]; then
        sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.3/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
        sudo ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose
    else
        echo -e "${RED}无法自动安装Docker-Compose，请手动安装后重试${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}Docker环境已准备就绪，继续安装流程...${NC}"

echo "正在检测网络环境..."

# 检查是否安装了curl
if ! command -v curl &> /dev/null; then
    echo -e "${YELLOW}未检测到curl工具，正在尝试安装...${NC}"
    if command -v apt &> /dev/null; then
        sudo apt update && sudo apt install -y curl
    elif command -v yum &> /dev/null; then
        sudo yum install -y curl
    elif command -v brew &> /dev/null; then
        brew install curl
    else
        echo -e "${RED}无法自动安装curl，请手动安装后重试${NC}"
        exit 1
    fi
fi

# 测试Docker Hub连接
echo "正在检测Docker Hub连接..."
if curl -s --connect-timeout 5 https://registry.hub.docker.com/v2/ &> /dev/null; then
    echo -e "${GREEN}Docker Hub 连接正常${NC}"
    DOCKERHUB_OK=true
else
    echo -e "${RED}无法连接到Docker Hub${NC}"
    DOCKERHUB_OK=false
fi

# 测试GitHub Container Registry连接
echo "正在检测GitHub Container Registry连接..."
if curl -s --connect-timeout 5 https://ghcr.io/v2/ &> /dev/null; then
    echo -e "${GREEN}GitHub Container Registry 连接正常${NC}"
    GHCR_OK=true
else
    echo -e "${RED}无法连接到GitHub Container Registry${NC}"
    GHCR_OK=false
fi

# 检测本地Docker配置源是否可用
echo "正在检测本地Docker镜像源是否可用..."
LOCAL_REGISTRY_URL=$(docker info 2>/dev/null | grep "Registry" | grep -v "Default" | awk '{print $2}')
if [ -n "$LOCAL_REGISTRY_URL" ]; then
    # 尝试HTTPS连接（不验证证书）
    if curl -sk --connect-timeout 5 "https://$LOCAL_REGISTRY_URL/v2/" &> /dev/null; then
        echo -e "${GREEN}本地镜像源 $LOCAL_REGISTRY_URL (HTTPS) 连接正常${NC}"
        LOCAL_REGISTRY_OK=true
    # 尝试HTTP连接
    elif curl -s --connect-timeout 5 "http://$LOCAL_REGISTRY_URL/v2/" &> /dev/null; then
        echo -e "${GREEN}本地镜像源 $LOCAL_REGISTRY_URL (HTTP) 连接正常${NC}"
        LOCAL_REGISTRY_OK=true
    # 直接假设可用（因为可能有证书问题但实际可用）
    else
        echo -e "${YELLOW}检测到本地镜像源配置 $LOCAL_REGISTRY_URL 但连接测试失败，仍将尝试使用${NC}"
        LOCAL_REGISTRY_OK=true
    fi
else
    echo -e "${YELLOW}未检测到本地Docker镜像源配置${NC}"
    LOCAL_REGISTRY_OK=false
fi

# 根据连接情况决定使用哪个源
if [ "$LOCAL_REGISTRY_OK" = true ]; then
    echo -e "${GREEN}将使用本地镜像源进行安装${NC}"
    IMAGE_SOURCE="${IMAGE_NAME}:${IMAGE_VERSION}"
    USE_LOCAL=true
elif [ "$DOCKERHUB_OK" = true ]; then
    echo -e "${GREEN}将使用Docker Hub作为镜像源进行安装${NC}"
    IMAGE_SOURCE="docker.io/${IMAGE_NAME}:${IMAGE_VERSION}"
    USE_LOCAL=false
elif [ "$GHCR_OK" = true ]; then
    echo -e "${YELLOW}Docker Hub不可用，将使用GitHub Container Registry作为镜像源进行安装${NC}"
    IMAGE_SOURCE="ghcr.io/${GHCR_IMAGE_NAME}:${IMAGE_VERSION}"
    USE_LOCAL=false
else
    echo -e "${RED}由于您当前网络不能够访问到目前支持的镜像仓库站，建议您按照文档手动下载镜像安装${NC}"
    echo -e "${RED}文档地址：http://blogpage.xiaozhuhouses.asia/html4/index.html#/./docs/%E5%BF%AB%E9%80%9F%E5%85%A5%E9%97%A8${NC}"
    exit 1
fi

# 拉取所需的Docker镜像
echo "正在拉取所需的Docker镜像..."
if [ "$USE_LOCAL" = true ]; then
    echo "正在从本地镜像源拉取镜像..."
    echo -e "${YELLOW}执行命令: docker pull $IMAGE_SOURCE${NC}"
    docker pull $IMAGE_SOURCE
    if [ $? -ne 0 ]; then
        echo -e "${RED}从本地镜像源拉取镜像失败，错误命令：docker pull $IMAGE_SOURCE${NC}"
        echo -e "${YELLOW}尝试从Docker Hub拉取...${NC}"
        if [ "$DOCKERHUB_OK" = true ]; then
            IMAGE_SOURCE="docker.io/${IMAGE_NAME}:${IMAGE_VERSION}"
            echo -e "${YELLOW}执行命令: docker pull $IMAGE_SOURCE${NC}"
            docker pull $IMAGE_SOURCE
            if [ $? -ne 0 ]; then
                echo -e "${RED}从Docker Hub拉取镜像失败，尝试GitHub Container Registry${NC}"
                if [ "$GHCR_OK" = true ]; then
                    IMAGE_SOURCE="ghcr.io/${GHCR_IMAGE_NAME}:${IMAGE_VERSION}"
                    echo -e "${YELLOW}执行命令: docker pull $IMAGE_SOURCE${NC}"
                    docker pull $IMAGE_SOURCE
                    if [ $? -ne 0 ]; then
                        echo -e "${RED}所有镜像源拉取失败，请检查网络连接或手动下载镜像${NC}"
                        exit 1
                    fi
                else
                    echo -e "${RED}GitHub Container Registry不可用，无法继续${NC}"
                    exit 1
                fi
            fi
        elif [ "$GHCR_OK" = true ]; then
            IMAGE_SOURCE="ghcr.io/${GHCR_IMAGE_NAME}:${IMAGE_VERSION}"
            echo -e "${YELLOW}执行命令: docker pull $IMAGE_SOURCE${NC}"
            docker pull $IMAGE_SOURCE
            if [ $? -ne 0 ]; then
                echo -e "${RED}从GitHub Container Registry拉取镜像失败，请检查网络连接或手动下载镜像${NC}"
                exit 1
            fi
        else
            echo -e "${RED}无可用镜像源，请手动下载镜像${NC}"
            exit 1
        fi
    fi
elif [ "$DOCKERHUB_OK" = true ]; then
    echo "正在从Docker Hub拉取镜像..."
    echo -e "${YELLOW}执行命令: docker pull $IMAGE_SOURCE${NC}"
    docker pull $IMAGE_SOURCE
    if [ $? -ne 0 ]; then
        echo -e "${RED}从Docker Hub拉取镜像失败，错误命令：docker pull $IMAGE_SOURCE${NC}"
        echo -e "${RED}请检查网络连接或手动下载镜像${NC}"
        exit 1
    fi
elif [ "$GHCR_OK" = true ]; then
    echo "正在从GitHub Container Registry拉取镜像..."
    echo -e "${YELLOW}执行命令: docker pull $IMAGE_SOURCE${NC}"
    docker pull $IMAGE_SOURCE
    if [ $? -ne 0 ]; then
        echo -e "${RED}从GitHub Container Registry拉取镜像失败，错误命令：docker pull $IMAGE_SOURCE${NC}"
        echo -e "${RED}请检查网络连接或手动下载镜像${NC}"
        exit 1
    fi
fi

# 创建所需目录
echo "创建游戏数据目录结构..."

# 获取用户输入的映射路径
read -p "请输入游戏数据目录路径 (默认: ./game_data): " GAME_DATA_PATH
GAME_DATA_PATH=${GAME_DATA_PATH:-./game_data}

read -p "请输入游戏配置目录路径 (默认: ./game_file): " GAME_CONFIG_PATH
GAME_CONFIG_PATH=${GAME_CONFIG_PATH:-./game_file}

read -p "请输入游戏存档目录路径 (默认: ./game_file): " GAME_SAVE_PATH
GAME_SAVE_PATH=${GAME_SAVE_PATH:-./game_file}

read -p "是否开启自动更新？(y/n, 默认: y): " -n 1 -r AUTO_UPDATE
echo
AUTO_UPDATE=${AUTO_UPDATE:-y}
if [[ $AUTO_UPDATE =~ ^[Yy]$ ]]; then
    AUTO_UPDATE_VALUE="true"
else
    AUTO_UPDATE_VALUE="false"
fi

# 创建目录
mkdir -p "$GAME_DATA_PATH" "$GAME_CONFIG_PATH" "$GAME_SAVE_PATH"

# 设置目录权限
chmod -R 777 "$GAME_DATA_PATH" "$GAME_CONFIG_PATH" "$GAME_SAVE_PATH"

# 创建docker-compose.yml文件
echo "创建docker-compose.yml文件..."
cat > docker-compose.yml << EOF
version: '3'

services:
  server:
    image: $IMAGE_SOURCE
    container_name: game_server
    user: root                         # 使用root用户运行容器
    ports:
      # 默认开放的常用Steam游戏服务器端口
      - "27015-27020:27015-27020/tcp"  # Steam 匹配和RCON
      - "27015-27020:27015-27020/udp"  # 游戏流量 
    volumes:
      - $GAME_DATA_PATH:/home/steam/games  # 游戏数据
      - $GAME_CONFIG_PATH:/home/steam/.config # 通用游戏存档路径1
      - $GAME_SAVE_PATH:/home/steam/.local  # 通用游戏存档路径2
    environment:
      - TZ=Asia/Shanghai              # 设置时区
      - AUTO_UPDATE=$AUTO_UPDATE_VALUE              # 自动更新脚本 (true/false)
      #- GAME_TO_RUN=Palworld         # 可选：直接启动指定游戏，无需进入菜单
      #- GAME_ARGS="-port=8211 -players=32"  # 可选：游戏启动参数
    stdin_open: true                  # 保持STDIN打开
    tty: true                         # 分配TTY
    
    # 如果需要，取消注释下面的行来限制资源
    # deploy:
    #   resources:
    #     limits:
    #       cpus: '4.0'
    #       memory: 8G
    #     reservations:
    #       cpus: '2.0'
    #       memory: 4G 
EOF

echo -e "${GREEN}配置文件已创建！${NC}"
echo -e "${YELLOW}请检查docker-compose.yml文件中的配置是否正确${NC}"
echo -e "${GREEN}安装完成！您可以使用以下命令启动服务器：${NC}"
echo -e "${YELLOW}docker-compose up -d 或 docker-compose -p docker-compose up -d${NC}"
echo -e "${GREEN}使用以下命令进入容器：${NC}"
echo -e "${YELLOW}docker attach game_server${NC}"