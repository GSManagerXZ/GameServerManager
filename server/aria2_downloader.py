#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Aria2 高速下载器模块
用于游戏服务器管理器的在线游戏部署功能
"""

import requests
import zipfile
import tempfile
import shutil
import time
import uuid
import re
import subprocess
import os
import logging

# 获取logger实例
logger = logging.getLogger(__name__)

def deploy_online_game_worker(game_id, game_name, download_url, script_content, deployment_data, deploy_queue):
    """在线游戏部署工作线程
    
    Args:
        game_id: 游戏ID
        game_name: 游戏名称
        download_url: 下载链接
        script_content: 启动脚本内容
        deployment_data: 部署数据字典
        deploy_queue: 部署队列
    """
    temp_zip_path = None
    temp_download_dir = None
    
    try:
        # 检查aria2c是否存在，作为硬性要求
        aria2c_path = shutil.which('aria2c')
        if not aria2c_path:
            raise Exception("高速下载器aria2c未安装，无法执行在线部署。请运行 'apt-get update && apt-get install -y aria2' 安装。")

        # 降低进程优先级
        try:
            if os.name == 'posix':
                os.nice(10)
                pid = os.getpid()
                subprocess.run(['ionice', '-c', '3', '-p', str(pid)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                logger.info(f"成功为部署任务(PID: {pid})设置CPU和I/O优先级")
        except Exception as e:
            logger.warning(f"设置进程优先级时出错: {e}")

        # 阶段1: 准备目录
        deployment_data['status'] = 'preparing'
        deployment_data['progress'] = 5
        deployment_data['message'] = '正在准备部署目录...'
        deploy_queue.put({'progress': 5, 'status': 'preparing', 'message': '正在准备部署目录...'})
        
        games_dir = '/home/steam/games'
        game_dir = os.path.join(games_dir, game_name)
        
        temp_download_dir = os.path.join(games_dir, '.tmp_downloads')
        os.makedirs(temp_download_dir, exist_ok=True)
        temp_zip_filename = f"{uuid.uuid4()}.zip"
        temp_zip_path = os.path.join(temp_download_dir, temp_zip_filename)

        if os.path.exists(game_dir):
            shutil.rmtree(game_dir)
        os.makedirs(game_dir, exist_ok=True)
        
        # 阶段2: 使用aria2c进行高速下载并实时反馈进度
        deployment_data['status'] = 'downloading'
        deployment_data['progress'] = 10
        deployment_data['message'] = '正在初始化高速下载器...'
        deploy_queue.put({'progress': 10, 'status': 'downloading', 'message': '正在初始化高速下载器...'})
        
        logger.info(f"开始使用aria2c下载游戏 {game_name}: {download_url}")

        aria2_cmd = [
            aria2c_path,
            '--dir', temp_download_dir,
            '--out', temp_zip_filename,
            '--split=8', '--max-connection-per-server=8', '--min-split-size=1M',
            '--continue=true', '--max-tries=0', '--retry-wait=5',
            '--user-agent=GSManager/1.0', '--allow-overwrite=true', '--log-level=info',
            '--summary-interval=1', # 每秒更新一次进度
            download_url
        ]
        
        process = subprocess.Popen(
            aria2_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8', errors='ignore'
        )

        # *** 这是最终修正版的正则表达式 ***
        progress_regex = re.compile(r'\[#\w+\s+([\d\.]+[KMG]i?B)/([\d\.]+[KMG]i?B)\s*\((\d+)%\)[^\]]*DL:\s*([^ \]]+)')
        
        for line in iter(process.stdout.readline, ''):
            match = progress_regex.search(line)
            if match:
                downloaded_str, total_str, percent_str, speed_str = match.groups()
                download_percent = int(percent_str)
                
                # 将下载进度(0-100%)映射到部署总进度(10-60%)
                overall_progress = 10 + int(download_percent * 0.5)
                # 如果速度单位不含'/s'，则手动加上
                if not speed_str.endswith('/s'):
                    speed_str += '/s'
                message = f'正在高速下载... {downloaded_str}/{total_str} ({speed_str})'
                
                deployment_data['progress'] = overall_progress
                deployment_data['message'] = message
                deploy_queue.put({'progress': overall_progress, 'status': 'downloading', 'message': message})
        
        process.wait()

        if process.returncode != 0:
            stderr_output = process.stderr.read()
            error_msg = f"高速下载失败。Aria2c返回码: {process.returncode}。"
            logger.error(error_msg)
            logger.error(f"Aria2c STDERR: {stderr_output}")
            raise Exception("下载失败，请检查后端日志获取Aria2c的详细输出。")

        # 检查文件是否存在且不为空
        if not os.path.exists(temp_zip_path) or os.path.getsize(temp_zip_path) == 0:
             raise Exception("下载完成但文件为空，请检查下载源或网络。")

        logger.info(f"aria2c下载成功: {download_url} -> {temp_zip_path}")
        deployment_data['progress'] = 60
        deployment_data['message'] = '下载完成，准备解压...'
        deploy_queue.put({'progress': 60, 'status': 'downloading', 'message': '下载完成，准备解压...'})

        # 阶段3: 解压
        logger.info(f"开始验证并解压下载的文件: {temp_zip_path}")
        if not zipfile.is_zipfile(temp_zip_path):
            raise zipfile.BadZipFile("下载的文件不是有效的ZIP压缩包。请检查下载链接是否指向一个直接的ZIP文件。")
        
        deployment_data['status'] = 'extracting'
        deployment_data['progress'] = 70
        deployment_data['message'] = '正在解压游戏文件...'
        deploy_queue.put({'progress': 70, 'status': 'extracting', 'message': '正在解压游戏文件...'})
        
        with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
            file_list = zip_ref.namelist()
            total_files = len(file_list)
            for i, file_info in enumerate(file_list):
                zip_ref.extract(file_info, game_dir)
                if i % 200 == 0 or i == total_files - 1:
                    extract_progress = 70 + int(((i + 1) / total_files) * 20)
                    deployment_data['progress'] = extract_progress
                    deploy_queue.put({
                        'progress': extract_progress, 'status': 'extracting',
                        'message': f'正在解压游戏文件... ({i+1}/{total_files})'
                    })
        
        # 阶段4: 创建脚本
        if script_content and script_content.strip():
            deployment_data['status'] = 'creating_script'
            deployment_data['progress'] = 90
            deployment_data['message'] = '正在创建启动脚本...'
            deploy_queue.put({'progress': 90, 'status': 'creating_script', 'message': '正在创建启动脚本...'})
            start_script_path = os.path.join(game_dir, 'start.sh')
            with open(start_script_path, 'w', encoding='utf-8') as f: 
                f.write(script_content)
            os.chmod(start_script_path, 0o755)
        else:
            deployment_data['progress'] = 90
            deploy_queue.put({'progress': 90, 'status': 'extracting', 'message': '解压完成'})
        
        # 阶段5: 完成
        deployment_data['status'] = 'completed'
        deployment_data['progress'] = 100
        deployment_data['message'] = f'游戏 {game_name} 部署成功'
        deployment_data['complete'] = True
        deployment_data['game_dir'] = game_dir
        
        deploy_queue.put({
            'progress': 100, 'status': 'completed', 
            'message': f'游戏 {game_name} 部署成功',
            'complete': True, 'game_dir': game_dir
        })
        logger.info(f"游戏 {game_name} 部署成功")
            
    except Exception as e:
        error_msg = f'部署时发生错误: {str(e)}'
        logger.error(f"部署在线游戏时发生错误: {str(e)}", exc_info=True)
        deployment_data['status'] = 'error'
        deployment_data['message'] = error_msg
        deployment_data['complete'] = True
        deploy_queue.put({'progress': deployment_data['progress'], 'status': 'error', 'message': error_msg, 'complete': True})
    
    finally:
        if temp_zip_path and os.path.exists(temp_zip_path):
            os.unlink(temp_zip_path)
        if temp_download_dir and os.path.exists(temp_download_dir) and not os.listdir(temp_download_dir):
            try:
                os.rmdir(temp_download_dir)
            except OSError: 
                pass