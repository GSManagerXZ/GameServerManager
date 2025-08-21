#!/bin/bash
# GameServerManager3 Install Script.
# By tzdtwsj.

echo "========================================"
cat << EOF
  ___ ___ __  __                            ____
 / __/ __|  \/  |__ _ _ _  __ _ __ _ ___ _ |__ /
| (_ \__ \ |\/| / _\` | ' \/ _\` / _\` / -_) '_|_ \ 
 \___|___/_|  |_\__,_|_||_\__,_\__, \___|_||___/
                               |___/
EOF
echo "GSManager3安装脚本 By tzdtwsj"
echo "开源地址：https://github.com/GSManagerXZ/GameServerManager"
echo "========================================"

if test "$(id -u)" != "0"; then
	echo -e "\x1b[31m请使用root用户安装！\x1b[0m"
	exit 1
fi

echo "询问信息阶段"

while true;do
echo "请选择安装方式"
echo "1.常规安装"
echo "2.Docker安装（推荐）"
read -p "(回车默认2):" input
case $input in
	1)install_type=1;;
	2|"")install_type=2;;
	*)continue;;
esac
break
done

if test "$install_type" = "2"; then
	if test "$(command -v docker)" = ""; then
		echo -e "\x1b[31m没有安装docker，不能使用该安装方式！\x1b[0m"
		echo -e "\x1b[33m提示: 如果你是红帽系/deb系的系统，你可以以root权限手动运行这一长串命令安装docker: \x1b[32mcurl -fsSL https://ghfast.top/https://github.com/docker/docker-install/raw/master/install.sh | DOWNLOAD_URL=https://mirrors.tuna.tsinghua.edu.cn/docker-ce bash\n\x1b[33m需要注意不同的发行版安装docker方式不同\x1b[0m"
		exit 1
	fi
	while true;do
	echo "请选择容器的网络类型"
	echo "1.bridge"
	echo "2.host"
	read -p "(回车默认host):" input
	case $input in
		1|bridge)docker_net_type=bridge;;
		2|host|"")docker_net_type=host;;
		*)echo "无效输入";continue;;
	esac
	break
	done
	echo "使用镜像站拉取镜像吗？将会使用1毫秒镜像站"
	read -p "(Y/n):" input
	case "$input" in
		N|n|no|No)docker_use_mirror=no;;
		Y|y|yes|YES|*)docker_use_mirror=yes;;
	esac
else
	if test -x /usr/bin/systemctl || test -x /bin/systemctl; then
	echo "安装到系统服务systemd吗？这样就可以实现开机自启和后台托管GSM3"
	read -p "(Y/n):" input
	case "$input" in
		N|n|no|NO)install_to_systemd=no;;
		Y|y|yes|YES|*)install_to_systemd=yes;;
	esac
	fi
fi

echo "请输入安装路径"
read -p "(回车默认/opt/gsmanager3):" install_path
if test "$install_path" = ""; then install_path="/opt/gsmanager3"; fi

echo "请输入服务访问端口"
read -p "(回车默认3001):" server_port
if test "$server_port" = ""; then
	server_port=3001
fi

echo 信息确认阶段
echo "========================================"
echo -n "安装方式："
if test "$install_type" = "1"; then
	echo "常规安装"
	echo "安装到systemd(开机自启)：$install_to_systemd"
elif test "$install_type" = "2"; then
	echo "Docker安装(默认已启用开机自启)"
	echo "网络类型：$docker_net_type"
fi
echo "访问端口：$server_port"
echo "安装路径：$install_path"
echo "========================================"

echo -e "\n"
echo "如果没有任何问题请直接按下回车安装，不要输入任何内容(或等15s)，否则请执行^C"
read -t 15 input
if test "$?" != "142" && test "$input" != ""; then
        echo "退出安装..."
	exit
fi
echo "开始安装..."
mkdir -pv "$install_path"
cd "$install_path"

if test "$install_type" = "1"; then
	if command -v curl &>/dev/null;then
		curl -Lo gsm3.tgz https://ghfast.top/https://github.com/GSManagerXZ/GameServerManager/releases/latest/download/gsm3-management-panel-linux.tar.gz
	elif command -v wget &>/dev/null; then
		wget -O gsm3.tgz https://ghfast.top/https://github.com/GSManagerXZ/GameServerManager/releases/latest/download/gsm3-management-panel-linux.tar.gz
	else
		echo -e "\x1b[31m错误：既没有安装curl也没有安装wget，无法下载gsm3程序，请安装这俩其中一个工具后再次执行该脚本！"
		exit 1
	fi
	if test "$?" != "0"; then
		echo -e "\x1b[31m下载似乎失败了...\x1b[0m"
		rm -rf gsm3.tgz
		exit 1
	fi
	echo "下载完毕，解压中，请稍等"
	tar -xzf gsm3.tgz -C "$install_path"
	rm -rf gsm3.tgz
	chmod 755 "$install_path/node/bin/node" "$install_path/start.sh" "$install_path"/server/PTY/pty*
	echo "SERVER_PORT=$server_port" >> "$install_path/.env"
	if test "$install_to_systemd" = "yes"; then
		mkdir -pv /usr/local/lib/systemd/system
		echo -e "\x1b[33m正在安装systemd服务...\x1b[0m"
		cat > /usr/local/lib/systemd/system/gsm3.service <<EOF
[Unit]
Description=GameServerManager 3
After=network.target

[Service]
Type=simple
WorkingDirectory=$install_path
ExecStart=$install_path/node/bin/node server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
		systemctl daemon-reload
		systemctl enable --now gsm3
		echo "安装完成，已自动帮你启动GSM3，并且已启用自启，访问机器ip加端口$server_port即可开始使用GSM3，使用方式："
		echo -e "启动gsm3：\x1b[32msystemctl start gsm3\x1b[0m"
		echo -e "停止gsm3：\x1b[32msystemctl stop gsm3\x1b[0m"
		echo -e "启用开机自启：\x1b[32msystemctl enable gsm3\x1b[0m"
		echo -e "禁用开机自启：\x1b[32msystemctl disable gsm3\x1b[0m"
		echo -e "一键卸载gsm3命令：\x1b[31msystemctl stop gsm3&&systemctl disable gsm3&&systemctl daemon-reload&&rm -rf \"$install_path\" /usr/local/lib/systemd/system/gsm3.service\x1b[0m"
	else
		echo "安装完成，需要你手动启动，启动方式："
		echo -e "\x1b[32mcd '$install_path'; ./start.sh\x1b[0m"
		echo "如果想要后台运行，请安装screen，并使用该命令："
		echo -e "\x1b[32mscreen -dmS gsm3 bash -c \"cd '$install_path'; ./start.sh\"\x1b[0m"
		echo "启动后，访问机器ip加端口$server_port即可开始使用GSM3"
		echo -e "一键卸载gsm3命令：\x1b[31mrm -rf \"$install_path\"\x1b[0m"
	fi
elif test "$install_type" = "2"; then
	cat > docker-compose.yml <<EOF
services:
  gsm3:
    container_name: GSManager3
    image: xiaozhu674/gameservermanager:latest
    user: root
    network_mode: $docker_net_type
    ports:
      # GSM3管理面板端口
      - "$server_port:$server_port"
      # 游戏端口，按需映射
      - "27015:27015"
    volumes:
    #steam用户数据目录 不建议修改
      - $install_path/game_data:/home/steam/.config
      - $install_path/game_data:/home/steam/.local
      - $install_path/game_file:/home/steam/games
    #root用户数据目录 不建议修改
      - $install_path/game_data:/root/.config
      - $install_path/game_data:/root/.local
      - $install_path/game_file:/root/steam/games
    #面板数据，请勿改动
      - $install_path/gsm3_data:/root/server/data
    environment:
      - TZ=Asia/Shanghai
      - SERVER_PORT=$server_port
    stdin_open: true
    tty: true
    restart: unless-stopped
EOF
	echo "已生成docker-compose.yml"
	mkdir game_data game_file gsm3_data
	chmod 777 game_data game_file
	if test "$docker_use_mirror" = "yes"; then
		docker pull docker.1ms.run/xiaozhu674/gameservermanager:latest
		if test "$?" != "0"; then echo -e "\x1b[31mdocker镜像拉取失败\x1b[0m"; exit 1; fi
		docker tag docker.1ms.run/xiaozhu674/gameservermanager:latest xiaozhu674/gameservermanager:latest
		docker rmi docker.1ms.run/xiaozhu674/gameservermanager:latest
	else
		docker pull xiaozhu674/gameservermanager:latest
		if test "$?" != "0"; then echo -e "\x1b[31mdocker镜像拉取失败\x1b[0m"; exit 1; fi
	fi
	echo -e "\x1b[32m镜像拉取完成，现在，请复制\x1b[33m启动命令\x1b[32m，粘贴并按下回车，然后访问机器的ip地址加上端口$server_port，开始使用GSManager3吧\x1b[0m"
	echo -e "启动命令：\x1b[33mcd '$install_path'; docker compose up -d\x1b[0m"
	echo -e "停止命令：\x1b[33mcd '$install_path'; docker compose down\x1b[0m"
	echo -e "一键卸载命令：\x1b[31mcd '$install_path'; docker compose down; docker rmi xiaozhu674/gameservermanager:latest\x1b[0m"
fi
