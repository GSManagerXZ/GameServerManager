#!/bin/bash

echo "==== 启动游戏服务器网页部署界面 ===="

# 确认前端已构建
if [ ! -d "/home/steam/app/dist" ]; then
  echo "错误: 前端未构建，请检查Dockerfile"
  exit 1
fi

echo "前端已构建，dist目录存在"

# 启动API服务器
echo "启动API服务器..."
cd /home/steam/server
python3 api_server.py 