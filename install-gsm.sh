#!/bin/bash
# GSManager一键安装脚本
# By tzdtwsj.


echo -en "\x1b[33m"
cat <<EOF
========================================
    GSManager一键安装脚本 By tzdtwsj

官网地址: http://blogpage.xiaozhuhouses.asia/html5/index.html
GitHub地址: https://github.com/yxsj245/GameServerManager

本项目依赖docker，请确认你的系统安装了docker
========================================
EOF
echo -en "\x1b[0m"

if test "$(id -u)" != "0"; then
	echo 脚本执行权限错误：请使用root执行！
	exit 1
fi

if test "$(command -v docker)" = ""; then
	echo -e "\x1b[31m你的系统似乎没有安装docker，请安装docker!\x1b[0m"
	echo -e "\x1b[33m提示: 如果你是红帽系/deb系的系统，你可以以root权限手动运行这一长串命令安装docker: \x1b[32mcurl -fsSL https://ghfast.top/https://github.com/docker/docker-install/raw/master/install.sh | DOWNLOAD_URL=https://mirrors.tuna.tsinghua.edu.cn/docker-ce sh\n\x1b[33m需要注意不同的发行版安装docker方式不同\x1b[0m"
	exit 1
fi

echo "询问信息阶段"

read -p "数据存放目录？(回车默认/opt/gsmanager):" DATADIR
if test "$DATADIR" = ""; then DATADIR="/opt/gsmanager"; fi

while true;do
echo "容器网络模式？"
echo "1.bridge"
echo "2.host"
read -p "(回车默认host):" input
case $input in
	1|bridge) NET_TYPE="bridge" ;;
	2|host|"") NET_TYPE="host" ;;
	*) continue ;;
esac
break
done

read -p "面板访问端口(回车默认5000):" PORT
if test "$PORT" = ""; then
	PORT="5000"
fi

DOCKER_IMAGE_DH="xiaozhu674/gameservermanager:latest"
DOCKER_IMAGE_GH="ghcr.io/yxsj245/gameservermanager:latest"

while true;do
echo "你想要从哪拉取镜像？"
echo "1.从dockerhub拉取，在国内需要配置dockerhub镜像地址(xiaozhu674/gameservermanager:latest)"
echo "2.从github容器仓库拉取，国内可以拉取(ghcr.io/yxsj245/gameservermanager:latest)"
echo "3.从http://langlangy.server.xiaozhuhouses.asia:8082/disk1/Docker/GSM%e9%9d%a2%e6%9d%bf/gameservermanager.tar.xz下载"
echo "4.暂不拉取，你可稍后拉取或手动导入（导入后你可能需要编辑docker-compose.yml来修改镜像名称）"
read -p "(回车默认从dockerhub拉取):" input
case $input in
	1|dockerhub|"")DOCKER_IMAGE="dh";;
	2|github|ghcr)DOCKER_IMAGE="gh";;
	3)if test "$(command -v curl)" = ""; then echo -e "\033[31m系统没有安装curl, 不能使用该选项!!!\033[0m"; continue; fi; DOCKER_IMAGE="xz";;
	4)DOCKER_IMAGE="no";;
	*)continue ;;
esac
break
done

echo "========================================"
echo "信息确认阶段"
echo "安装目录：$DATADIR"
echo "容器网络模式：$NET_TYPE"
echo "面板访问端口：$PORT"
echo -n "镜像拉取地址："
if test "$DOCKER_IMAGE" = "no"; then
	echo "不拉取"
	DOCKER_IMAGE_REAL="$DOCKER_IMAGE_DH"
elif test "$DOCKER_IMAGE" = "dh"; then
	echo "$DOCKER_IMAGE_DH"
	DOCKER_IMAGE_REAL="$DOCKER_IMAGE_DH"
elif test "$DOCKER_IMAGE" = "gh"; then
	echo "$DOCKER_IMAGE_GH"
	DOCKER_IMAGE_REAL="$DOCKER_IMAGE_GH"
elif test "$DOCKER_IMAGE" = "xz"; then
	echo "http://langlangy.server.xiaozhuhouses.asia:8082/disk1/Docker/GSM%e9%9d%a2%e6%9d%bf/gameservermanager.tar.xz"
	DOCKER_IMAGE_REAL="gameservermanager:latest"
fi
echo -e "\n"
echo "如果没有任何问题请直接按下回车安装，不要输入任何内容(或等15s)，否则请执行^C"
read -t 15 input
if test "$?" != "142" && test "$input" != ""; then
	echo "退出安装..."
	exit
fi
echo "开始安装..."
mkdir -pv "$DATADIR"
cat >"$DATADIR/docker-compose.yml" <<EOF
name: gameservermanager

services:
  server:
    container_name: GSManager # 容器名称
    image: $DOCKER_IMAGE_REAL # 镜像名称
    user: root
    network_mode: $NET_TYPE
    ports:
      # 默认开放的常用Steam游戏服务器端口
      - "27015-27020:27015-27020/tcp"  # Steam 匹配和RCON
      - "27015-27020:27015-27020/udp"  # 游戏流量 
      # Web界面端口
      - "${PORT}:${PORT}/tcp"                    # 前端界面
    volumes:
      - $DATADIR/game_data:/home/steam/games  # 游戏数据，请将权限设置为777
      - $DATADIR/game_file:/home/steam/.config # 通用游戏存档路径1。请务必将此宿主目录权限设置为777
      - $DATADIR/game_file:/home/steam/.local  # 通用游戏存档路径2。请务必将此宿主目录权限设置为777
      - $DATADIR/game_environment:/home/steam/environment  # 容器额外运行库安装路径 请将权限设置为777
      - $DATADIR/game_backup:/home/steam/backup # 定时备份路径
    environment:
      - TZ=Asia/Shanghai              # 设置时区
      - USE_GUNICORN=true             # 强制使用Gunicorn
      - GUNICORN_TIMEOUT=120          # Gunicorn超时设置
      - GUNICORN_PORT=$PORT            # Gunicorn监听端口
    command: /home/steam/start_web.sh  # 启动Web界面
    stdin_open: true
    tty: true
EOF
echo "已生成docker-compose.yml"
if test "$DOCKER_IMAGE" = "dh" || test "$DOCKER_IMAGE" = "gh"; then
	echo "正在拉取docker镜像"
	echo -e "\033[32mdocker pull $DOCKER_IMAGE_REAL\033[0m"
	docker pull "$DOCKER_IMAGE_REAL"
	if test "$?" != "0"; then echo -e "\033[31m镜像拉取失败\033[0m"; exit 1; fi
	echo "正在启动GSManager"
	cd "$DATADIR"
	echo -e "\033[32mdocker compose up -d\033[0m"
	docker compose up -d
	if test "$?" != "0"; then echo -e "\033[31m容器启动失败！\033[0m"; exit 1; fi
	chown -R 1000:1000 "$DATADIR"
	echo "容器成功启动，现你可以访问本机器ip地址加上端口 $PORT来访问GSManager"
	echo -e "下次你可使用该命令启动GSManager: \033[33mcd '$DATADIR'; docker compose up -d\033[0m"
elif test "$DOCKER_IMAGE" = "no"; then
	echo -e "接下来，你可手动导入docker镜像(如果需要，编辑\033[32m$DATADIR/docker-compose.yml\033[0m更改docker镜像名),然后运行以下命令启动gsm:\n\033[33mcd '$DATADIR'; docker compose up -d\033[0m"
elif test "$DOCKER_IMAGE" = "xz"; then
	echo "正在下载docker镜像"
	echo -e "\033[32mcurl -L http://langlangy.server.xiaozhuhouses.asia:8082/disk1/Docker/GSM%e9%9d%a2%e6%9d%bf/gameservermanager.tar.xz|docker load\033[0m"
	curl -L "http://langlangy.server.xiaozhuhouses.asia:8082/disk1/Docker/GSM%e9%9d%a2%e6%9d%bf/gameservermanager.tar.xz"|docker load
	if test "$?" != "0"; then echo -e "\033[31m镜像下载失败！\033[0m"; exit 1; fi
	echo "正在启动GSManager"
	cd "$DATADIR"
	echo -e "\033[32mdocker compose up -d\033[0m"
	docker compose up -d
	if test "$?" != "0"; then echo -e "\033[31m容器启动失败！\033[0m"; exit 1; fi
	chown -R 1000:1000 "$DATADIR"
	echo "容器成功启动，现你可以访问本机器ip地址加上端口 $PORT来访问GSManager"
	echo -e "下次你可使用该命令启动GSManager: \033[33mcd '$DATADIR'; docker compose up -d\033[0m"
fi
