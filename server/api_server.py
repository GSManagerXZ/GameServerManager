#!/usr/bin/env python3
import os
import sys
import json
import time
import logging
import subprocess
import shlex
import shutil
import tempfile
import queue
import threading
import pty
import fcntl
import select
import re
import psutil
import uuid
import hashlib
import base64
import datetime
import zipfile
import tarfile
import gzip
import bz2
import rarfile
import lzma
import stat
import zstandard as zstd
from functools import wraps
from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context, g, render_template_string, send_file, make_response
from werkzeug.utils import secure_filename
from flask_cors import CORS
from auth_middleware import auth_required, generate_token, verify_token, save_user, is_public_route, hash_password, verify_password
import jwt
import signal
import secrets
import socket
import requests

# 导入PTY管理器
from pty_manager import pty_manager

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('api_server.log')
    ]
)
logger = logging.getLogger("api_server")

# FRP相关配置
FRP_DIR = "/home/steam/FRP"
FRP_CONFIG_FILE = os.path.join("/home/steam/games", "frp.json")
FRP_BINARY = os.path.join(FRP_DIR, "LoCyanFrp/frpc")
FRP_LOGS_DIR = os.path.join(FRP_DIR, "logs")
CUSTOM_FRP_DIR = os.path.join(FRP_DIR, "frpc")
CUSTOM_FRP_CONFIG_FILE = os.path.join(CUSTOM_FRP_DIR, "frpc.toml")
CUSTOM_FRP_BINARY = os.path.join(CUSTOM_FRP_DIR, "frpc")
# 添加mefrp相关配置
MEFRP_DIR = os.path.join(FRP_DIR, "mefrp")
MEFRP_BINARY = os.path.join(MEFRP_DIR, "frpc")
# Sakura内网穿透
SAKURA_DIR = os.path.join(FRP_DIR, "Sakura")
SAKURA_BINARY = os.path.join(SAKURA_DIR, "frpc")

# 确保FRP相关目录存在
os.makedirs(FRP_DIR, exist_ok=True)
os.makedirs(os.path.join(FRP_DIR, "LoCyanFrp"), exist_ok=True)
os.makedirs(FRP_LOGS_DIR, exist_ok=True)
os.makedirs(CUSTOM_FRP_DIR, exist_ok=True)
os.makedirs(os.path.join(FRP_DIR, "logs"), exist_ok=True)
os.makedirs(MEFRP_DIR, exist_ok=True)
os.makedirs(SAKURA_DIR, exist_ok=True)

# FRP进程字典
running_frp_processes = {}  # id: {'process': process, 'log_file': log_file_path}

# 添加一个全局变量来跟踪人工停止的服务器
manually_stopped_servers = set()  # 存储人工停止的服务器ID

# 添加一个全局变量来跟踪人工停止的内网穿透
manually_stopped_frps = set()  # 存储人工停止的内网穿透ID

app = Flask(__name__, static_folder='../app/dist')
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0  # 禁用缓存，确保始终获取最新文件

# 允许跨域请求
CORS(app, resources={r"/*": {"origins": "*"}})  # 允许所有来源的跨域请求

# 导入JWT配置
from config import JWT_SECRET, JWT_EXPIRATION

# 生成JWT令牌
def generate_token(user):
    """生成JWT令牌"""
    payload = {
        'username': user.get('username'),
        'role': user.get('role', 'user'),
        'exp': datetime.datetime.utcnow() + datetime.timedelta(seconds=JWT_EXPIRATION)
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm='HS256')
    return token

# 验证JWT令牌
def verify_token(token):
    """验证JWT令牌"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        logger.warning("令牌已过期")
        return None
    except jwt.InvalidTokenError:
        logger.warning("无效的令牌")
        return None

# 保存用户到auth_middleware
def save_user(user):
    """保存用户到auth_middleware"""
    try:
        # 这里简化处理，直接返回True
        return True
    except Exception as e:
        logger.error(f"保存用户失败: {str(e)}")
        return False

# 定义公共路由列表
def is_public_route(path):
    """检查路径是否为公共路由"""
    public_routes = [
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/check_first_use'
        # 注意：/api/terminate_install 需要认证，不应该出现在这个列表中
    ]
    return path in public_routes

# 在每个请求前检查认证
@app.before_request
def check_auth():
    # 记录请求路径，帮助调试
    logger.debug(f"收到请求: {request.method} {request.path}, 参数: {request.args}, 头部: {request.headers}")
    
    # 前端资源路由不需要认证
    if request.path == '/' or not request.path.startswith('/api/') or is_public_route(request.path):
        # logger.debug(f"公共路由，无需认证: {request.path}")
        return None
        
    # 所有API路由需要认证，除了登录API
    if request.path.startswith('/api/'):
        # 登录路由不需要认证
        if request.path == '/api/auth/login' or request.path == '/api/auth/register' or request.path == '/api/auth/check_first_use':
            # logger.debug("登录/注册路由，无需认证")
            return None
            
        auth_header = request.headers.get('Authorization')
        token_param = request.args.get('token')
        
        # logger.debug(f"认证检查 - 路径: {request.path}, 认证头: {auth_header}, Token参数: {token_param}")
        
        # 检查是否有令牌
        if not auth_header and not token_param:
            logger.warning(f"API请求无认证令牌: {request.path}")
            return jsonify({
                'status': 'error',
                'message': '未授权的访问，请先登录'
            }), 401
            
        # 验证令牌
        token = None
        if auth_header:
            parts = auth_header.split()
            if len(parts) == 2 and parts[0].lower() == 'bearer':
                token = parts[1]
                # logger.debug(f"从认证头部获取到token: {token[:10]}...")
                
        if not token and token_param:
            token = token_param
            # logger.debug(f"从URL参数获取到token: {token_param[:10]}...")
            
        if token:
            payload = verify_token(token)
            if not payload:
                logger.warning(f"无效令牌: {request.path}, token: {token[:10]}...")
                return jsonify({
                    'status': 'error',
                    'message': '令牌无效或已过期，请重新登录'
                }), 401
            # 令牌有效，保存用户信息到g对象
            g.user = payload
            # logger.debug(f"认证通过: {request.path}, 用户: {payload.get('username')}")
            return None

# 游戏安装脚本路径
INSTALLER_SCRIPT = os.path.join(os.path.dirname(__file__), "game_installer.py")
GAMES_CONFIG = os.path.join(os.path.dirname(__file__), "installgame.json")
GAMES_DIR = "/home/steam/games"
USER_CONFIG_PATH = os.path.join(GAMES_DIR, "config.json")

# 用于存储正在进行的安装进程和它们的输出
active_installations = {}

# 创建一个全局的输出队列字典，用于实时传输安装进度
output_queues = {}

# 新增：用于存储每个游戏的运行中服务器进程和输出
running_servers = {}  # game_id: {'process': process, 'output': [], 'master_fd': fd, 'started_at': time.time()}
server_output_queues = {}  # game_id: queue.Queue()

# 加载游戏配置
def load_games_config():
    with open(GAMES_CONFIG, 'r', encoding='utf-8') as f:
        return json.load(f)

# 在单独线程中使用PTY运行安装任务
def run_installation(game_id, cmd):
    logger.info(f"开始使用PTY运行游戏 {game_id} 的安装进程")
    
    try:
        # 准备命令字符串
        logger.info(f"执行命令: {cmd}")
        
        # 生成进程ID
        process_id = f"install_{game_id}"
        logger.info(f"生成进程ID: {process_id}")
        
        # 创建并启动PTY进程
        process = pty_manager.create_process(
            process_id=process_id,
            cmd=cmd,
            log_prefix=f"game_install_{game_id}"
        )
        
        # 将进程对象和输出队列关联到安装数据
        if game_id in active_installations:
            active_installations[game_id]['pty_process'] = process
            active_installations[game_id]['process_id'] = process_id
            output_queues[game_id] = process.output_queue
            logger.debug(f"进程已创建，准备启动，process_id={process_id}")
        else:
            logger.error(f"找不到游戏 {game_id} 的安装数据")
            return
        
        # 启动进程
        if not process.start():
            logger.error(f"启动游戏 {game_id} 的安装进程失败")
            active_installations[game_id]['error'] = "启动进程失败"
            active_installations[game_id]['complete'] = True
            return
        
        # 主安装线程等待进程完成
        return_code = process.wait()
        logger.info(f"游戏 {game_id} 安装主进程已结束，返回码: {return_code}")
        
        # 确保安装状态已更新
        if game_id in active_installations:
            active_installations[game_id]['return_code'] = return_code
            active_installations[game_id]['complete'] = True
            active_installations[game_id]['output_file'] = process.output_file
            
    except Exception as e:
        logger.error(f"运行安装进程时出错: {str(e)}")
        if game_id in active_installations:
            active_installations[game_id]['error'] = str(e)
            active_installations[game_id]['complete'] = True
            
        # 向队列添加错误消息
        if game_id in output_queues:
            output_queues[game_id].put({'complete': True, 'status': 'error', 'message': f'安装错误: {str(e)}'})

# 在单独线程中使用PTY运行服务器
def run_game_server(game_id, cmd, cwd):
    """在单独线程中使用PTY运行服务器"""
    logger.info(f"开始使用PTY运行游戏服务器 {game_id}")
    
    try:
        # 准备命令字符串
        logger.info(f"执行命令: {cmd}, 工作目录: {cwd}")
        
        # 生成进程ID
        process_id = f"server_{game_id}"
        logger.info(f"生成进程ID: {process_id}")
        
        # 创建并启动PTY进程
        process = pty_manager.create_process(
            process_id=process_id,
            cmd=cmd,
            cwd=cwd,
            env=dict(os.environ, TERM="xterm"),
            log_prefix=f"game_server_{game_id}"
        )
        
        # 将进程对象和输出队列关联到服务器数据
        if game_id in running_servers:
            running_servers[game_id]['pty_process'] = process
            running_servers[game_id]['process_id'] = process_id
            running_servers[game_id]['running'] = True  # 确保设置运行状态为True
            
            # 创建一个自定义队列，用于保存历史输出
            class HistoryQueue(queue.Queue):
                def __init__(self, *args, **kwargs):
                    super().__init__(*args, **kwargs)
                    self.history = []  # 用于存储历史输出
                    
                def put(self, item, *args, **kwargs):
                    # 保存历史记录
                    if isinstance(item, str):
                        self.history.append(item)
                    super().put(item, *args, **kwargs)
                    
                def get_history(self):
                    return self.history
            
            # 创建保存历史的队列
            history_queue = HistoryQueue()
            server_output_queues[game_id] = history_queue
            
            # 将PTY进程的输出队列转发到历史队列
            def output_forwarder():
                try:
                    logger.info(f"启动输出转发线程: game_id={game_id}")
                    
                    # 先添加一些初始输出，确保有内容显示
                    server_output_queues[game_id].put(f"正在启动 {game_id} 服务器...")
                    
                    if 'output' not in running_servers[game_id]:
                        running_servers[game_id]['output'] = []
                    running_servers[game_id]['output'].append(f"正在启动 {game_id} 服务器...")
                    
                    # 添加脚本路径信息
                    script_path = os.path.join(cwd, "start.sh")
                    if os.path.exists(script_path):
                        try:
                            with open(script_path, 'r') as f:
                                script_content = f.read()
                                server_output_queues[game_id].put(f"启动脚本内容: \n{script_content}")
                                running_servers[game_id]['output'].append(f"启动脚本内容: \n{script_content}")
                        except Exception as e:
                            logger.error(f"读取启动脚本失败: {str(e)}")
                    
                    # 添加一个计数器，用于记录处理的输出行数
                    output_count = 0
                    last_log_time = time.time()
                    
                    # 添加一个测试输出
                    test_message = "输出转发线程已启动，开始监听服务器输出..."
                    server_output_queues[game_id].put(test_message)
                    running_servers[game_id]['output'].append(test_message)
                    
                    # 持续监听队列
                    while True:
                        try:
                            # 从原始队列获取数据，不设置超时，避免CPU占用过高
                            item = process.output_queue.get(block=True, timeout=1.0)
                            output_count += 1
                            
                            # 记录日志
                            if output_count % 10 == 0 or time.time() - last_log_time > 5:
                                logger.debug(f"已处理 {output_count} 行输出: game_id={game_id}")
                                last_log_time = time.time()
                            
                            # 转发到历史队列
                            if isinstance(item, str):
                                # 添加到队列
                                server_output_queues[game_id].put(item)
                                
                                # 同时保存到输出历史
                                if 'output' not in running_servers[game_id]:
                                    running_servers[game_id]['output'] = []
                                running_servers[game_id]['output'].append(item)
                                
                                # 输出到日志
                                logger.debug(f"服务器输出: {item[:100]}")
                            
                            # 检查进程是否已结束
                            if hasattr(process, 'poll'):
                                # 如果有poll方法，使用poll方法检查
                                if process.poll() is not None:
                                    logger.info(f"进程已结束，退出输出转发线程: game_id={game_id}")
                                    break
                            elif hasattr(process, 'complete'):
                                # 如果有complete属性，检查complete属性
                                if process.complete:
                                    logger.info(f"进程已完成，退出输出转发线程: game_id={game_id}")
                                    break
                            elif hasattr(process, 'running'):
                                # 如果有running属性，检查running属性
                                if not process.running:
                                    logger.info(f"进程已停止运行，退出输出转发线程: game_id={game_id}")
                                    break
                            else:
                                # 如果都没有，检查process_id是否还在pty_manager中
                                if process_id not in pty_manager.processes:
                                    logger.info(f"进程ID不再存在于PTY管理器中，退出输出转发线程: game_id={game_id}")
                                    break
                        
                        except queue.Empty:
                            # 队列为空，检查进程是否已结束
                            if hasattr(process, 'poll'):
                                # 如果有poll方法，使用poll方法检查
                                if process.poll() is not None:
                                    logger.info(f"进程已结束(队列空)，退出输出转发线程: game_id={game_id}")
                                    break
                            elif hasattr(process, 'complete'):
                                # 如果有complete属性，检查complete属性
                                if process.complete:
                                    logger.info(f"进程已完成(队列空)，退出输出转发线程: game_id={game_id}")
                                    break
                            elif hasattr(process, 'running'):
                                # 如果有running属性，检查running属性
                                if not process.running:
                                    logger.info(f"进程已停止运行(队列空)，退出输出转发线程: game_id={game_id}")
                                    break
                            else:
                                # 如果都没有，检查process_id是否还在pty_manager中
                                if process_id not in pty_manager.processes:
                                    logger.info(f"进程ID不再存在于PTY管理器中(队列空)，退出输出转发线程: game_id={game_id}")
                                    break
                            
                            # 每10秒记录一次空队列日志
                            current_time = time.time()
                            if current_time - last_log_time > 10:
                                logger.info(f"队列为空，等待输出: game_id={game_id}, 已处理 {output_count} 行")
                                
                                # 不再发送心跳消息到客户端
                                last_log_time = current_time
                            
                            continue
                        
                        except Exception as e:
                            logger.error(f"处理输出时出错: {str(e)}")
                            error_msg = f"处理输出时出错: {str(e)}"
                            server_output_queues[game_id].put(error_msg)
                            running_servers[game_id]['output'].append(error_msg)
                
                except Exception as e:
                    logger.error(f"输出转发线程异常: {str(e)}")
                    
                # 添加结束消息
                end_msg = f"输出转发线程结束: game_id={game_id}, 总共处理 {output_count} 行输出"
                logger.info(end_msg)
                server_output_queues[game_id].put(end_msg)
                
                # 如果游戏ID还在running_servers中，添加到输出历史
                if game_id in running_servers:
                    running_servers[game_id]['output'].append(end_msg)
                    # 标记服务器已停止
                    running_servers[game_id]['running'] = False
                    
                    # 如果不是用户手动停止的，记录自动停止信息
                    if not running_servers[game_id].get('stopped_by_user', False):
                        stop_msg = f"游戏服务器 {game_id} 已自动停止运行"
                        logger.info(stop_msg)
                        server_output_queues[game_id].put(stop_msg)
                        running_servers[game_id]['output'].append(stop_msg)
                        
                        # 从运行中的服务器字典中移除该游戏服务器
                        logger.info(f"从运行中的服务器列表中移除游戏服务器: {game_id}")
                        del running_servers[game_id]
                        
                        # 确保从PTY管理器中删除进程
                        if pty_manager.get_process(process_id):
                            logger.info(f"从PTY管理器中删除进程: {process_id}")
                            pty_manager.remove_process(process_id)
                
                # 从输出队列字典中移除该游戏服务器（延迟60秒，确保客户端能收到最后的消息）
                def delayed_cleanup():
                    time.sleep(60)  # 延长到60秒
                    if game_id in server_output_queues:
                        logger.info(f"从输出队列列表中移除游戏服务器: {game_id}")
                        del server_output_queues[game_id]
                
                # 启动延迟清理线程
                cleanup_thread = threading.Thread(target=delayed_cleanup, daemon=True)
                cleanup_thread.start()
            
            # 启动输出转发线程
            forwarder_thread = threading.Thread(
                target=output_forwarder,
                daemon=True
            )
            forwarder_thread.start()
            
            logger.info(f"服务器进程已创建，准备启动，process_id={process_id}")
        else:
            logger.error(f"找不到游戏服务器 {game_id} 的运行数据")
            return
        
        # 启动进程
        if not process.start():
            logger.error(f"启动游戏服务器 {game_id} 失败")
            running_servers[game_id]['error'] = "启动进程失败"
            running_servers[game_id]['running'] = False
            return
        
        # 获取进程对象并保存
        try:
            # 获取底层进程并保存
            if hasattr(process, 'process') and process.process:
                running_servers[game_id]['process'] = process.process
                logger.info(f"已保存游戏服务器 {game_id} 的底层进程对象，PID={process.process.pid}")
        except Exception as e:
            logger.warning(f"无法获取游戏服务器 {game_id} 的底层进程对象: {str(e)}")
        
        # 记录进程状态
        logger.info(f"游戏服务器 {game_id} 启动成功，process_id={process_id}")
        
        # 主线程等待进程完成
        return_code = process.wait()
        logger.info(f"游戏服务器 {game_id} 主进程已结束，返回码: {return_code}")
        
        # 确保服务器状态已更新
        if game_id in running_servers:
            running_servers[game_id]['return_code'] = return_code
            running_servers[game_id]['running'] = False
            running_servers[game_id]['output_file'] = process.output_file
            
            # 检查是否是异常退出（非人工关闭）
            if game_id not in manually_stopped_servers:
                # 检查是否需要自动重启
                config = load_config()
                auto_restart_servers = config.get('auto_restart_servers', [])
                
                if game_id in auto_restart_servers:
                    logger.info(f"游戏服务器 {game_id} 异常退出（非人工停止），自动重启中...")
                    
                    # 在新线程中重启服务器
                    restart_thread = threading.Thread(
                        target=lambda: restart_server(game_id, cwd),
                        daemon=True
                    )
                    restart_thread.start()
                else:
                    logger.info(f"游戏服务器 {game_id} 异常退出，但未配置自动重启")
            else:
                # 从人工停止集合中移除
                manually_stopped_servers.discard(game_id)
                logger.info(f"游戏服务器 {game_id} 人工停止，不进行自动重启，返回码: {return_code}")
            
    except Exception as e:
        logger.error(f"运行服务器进程时出错: {str(e)}")
        if game_id in running_servers:
            running_servers[game_id]['error'] = str(e)
            running_servers[game_id]['running'] = False
            
        # 向队列添加错误消息
        if game_id in server_output_queues:
            server_output_queues[game_id].put({'complete': True, 'status': 'error', 'message': f'服务器错误: {str(e)}'})

# 添加一个新函数来确保目录权限正确
def ensure_steam_permissions(directory):
    """确保目录和子目录的所有者为steam用户"""
    try:
        logger.info(f"正在检查并修复目录权限: {directory}")
        # 使用chown -R steam:steam递归修改目录所有权
        cmd = f"chown -R steam:steam {shlex.quote(directory)}"
        logger.info(f"执行权限修复命令: {cmd}")
        subprocess.run(cmd, shell=True, check=True)
        return True
    except Exception as e:
        logger.error(f"修复目录权限失败: {str(e)}")
        return False

# 简单的错误页面模板
ERROR_PAGE = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>游戏服务器部署系统</title>
    <style>
        body { font-family: 'Microsoft YaHei', sans-serif; text-align: center; padding: 50px; }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { color: #1677ff; }
        .error { color: #ff4d4f; margin: 20px 0; }
        .api-list { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
    </style>
</head>
<body>
    <div class="container">
        <h1>游戏服务器部署系统</h1>
        <div class="error">
            <p>{{ error_message }}</p>
        </div>
        <div class="api-list">
            <h3>可用API接口：</h3>
            <ul>
                <li><a href="/api/games">/api/games</a> - 获取游戏列表</li>
                <li>/api/install - 安装游戏（POST）</li>
                <li>/api/check_installation?game_id=XXX - 检查安装状态</li>
            </ul>
        </div>
    </div>
</body>
</html>
"""

@app.route('/')
def index():
    """首页路由"""
    try:
        return send_from_directory('../app/dist', 'index.html')
    except Exception as e:
        return render_template_string(ERROR_PAGE, error_message=f"前端页面未找到：{str(e)}"), 404

@app.route('/<path:path>')
def static_files(path):
    """静态文件路由"""
    try:
        # 如果请求的是API路径，不进行处理，让后续的路由处理
        if path.startswith('api/'):
            return None
            
        # 检查是否存在对应的静态文件
        file_path = os.path.join('../app/dist', path)
        if os.path.isfile(file_path):
            return send_from_directory('../app/dist', path)
        
        # 如果不是静态文件，返回index.html给前端路由处理
        return send_from_directory('../app/dist', 'index.html')
    except Exception as e:
        # 遇到错误也返回index.html，让前端路由处理
        return send_from_directory('../app/dist', 'index.html')

@app.route('/api/games', methods=['GET'])
def get_games():
    """获取所有可安装的游戏列表"""
    try:
        logger.debug("获取游戏列表")
        games = load_games_config()
        game_list = []
        
        for game_id, game_info in games.items():
            game_list.append({
                'id': game_id,
                'name': game_info.get('game_nameCN', game_id),
                'appid': game_info.get('appid'),
                'anonymous': game_info.get('anonymous', True),
                'has_script': game_info.get('script', False),
                'tip': game_info.get('tip', ''),
                'image': game_info.get('image', ''),
                'url': game_info.get('url', '')
            })
        
        logger.debug(f"找到 {len(game_list)} 个游戏")
        return jsonify({'status': 'success', 'games': game_list})
    except Exception as e:
        logger.error(f"获取游戏列表失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/install', methods=['POST'])
def install_game():
    """安装游戏 - 只启动安装进程并返回，不等待完成"""
    try:
        data = request.json
        game_id = data.get('game_id')
        account = data.get('account')
        password = data.get('password')
        if not game_id:
            logger.error("缺少游戏ID")
            return jsonify({'status': 'error', 'message': '缺少游戏ID'}), 400
        logger.info(f"请求安装游戏: {game_id}")
        # 检查游戏是否存在
        games = load_games_config()
        if game_id not in games:
            logger.error(f"游戏不存在: {game_id}")
            return jsonify({'status': 'error', 'message': f'游戏 {game_id} 不存在'}), 404
        # 如果已经有正在运行的安装进程，则返回
        if game_id in active_installations and active_installations[game_id].get('process') and active_installations[game_id]['process'].poll() is None:
            logger.debug(f"游戏 {game_id} 已经在安装中")
            return jsonify({
                'status': 'success', 
                'message': f'游戏 {game_id} 已经在安装中'
            })
        # 清理任何旧的安装数据
        if game_id in active_installations:
            logger.info(f"清理游戏 {game_id} 的旧安装数据")
            old_process = active_installations[game_id].get('process')
            if old_process and old_process.poll() is None:
                try:
                    old_process.terminate()
                except:
                    pass
        # 重置输出队列
        if game_id in output_queues:
            try:
                while not output_queues[game_id].empty():
                    output_queues[game_id].get_nowait()
            except:
                output_queues[game_id] = queue.Queue()
        else:
            output_queues[game_id] = queue.Queue()
        # 构建安装命令 (确保以steam用户运行)
        cmd = f"su - steam -c 'python3 {INSTALLER_SCRIPT} {game_id}"
        if account:
            cmd += f" --account {shlex.quote(account)}"
        if password:
            cmd += f" --password {shlex.quote(password)}"
        cmd += " 2>&1'"
        logger.debug(f"准备执行命令 (将使用PTY): {cmd}")
        # 初始化安装状态跟踪
        active_installations[game_id] = {
            'process': None,
            'output': [],
            'started_at': time.time(),
            'complete': False,
            'cmd': cmd
        }
        
        # 在单独的线程中启动安装进程
        install_thread = threading.Thread(
            target=run_installation,
            args=(game_id, cmd),
            daemon=True
        )
        install_thread.start()
        
        # 添加一个确保安装后权限正确的线程
        def check_and_fix_permissions():
            # 等待安装进程完成
            install_thread.join(timeout=3600)  # 最多等待1小时
            # 检查安装是否已完成
            if game_id in active_installations and active_installations[game_id].get('complete'):
                # 安装完成后，确保游戏目录权限正确
                game_dir = os.path.join(GAMES_DIR, game_id)
                if os.path.exists(game_dir):
                    logger.info(f"安装完成，修复游戏目录权限: {game_dir}")
                    ensure_steam_permissions(game_dir)
                    
        # 启动权限修复线程
        permission_thread = threading.Thread(
            target=check_and_fix_permissions,
            daemon=True
        )
        permission_thread.start()
        
        logger.info(f"游戏 {game_id} 安装进程已启动")
        
        return jsonify({
            'status': 'success', 
            'message': f'游戏 {game_id} 安装已开始'
        })
    except Exception as e:
        logger.error(f"启动安装进程失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/install_stream', methods=['GET', 'POST'])
def install_game_stream():
    """以流式方式获取安装进度"""
    try:
        # 尝试从POST请求体获取游戏ID
        if request.method == 'POST' and request.is_json:
            data = request.json
            game_id = data.get('game_id')
        else:
            # 尝试从GET参数获取游戏ID
            game_id = request.args.get('game_id')
        
        if not game_id:
            logger.error("流式获取安装进度时缺少游戏ID")
            return jsonify({'status': 'error', 'message': '缺少游戏ID'}), 400
        
        logger.info(f"开始流式获取游戏 {game_id} 的安装进度")
        
        # 检查游戏是否存在于配置中，对于以app_开头的ID，不进行检查
        games = load_games_config()
        if not game_id.startswith('app_') and game_id not in games:
            logger.error(f"游戏不存在: {game_id}")
            return jsonify({'status': 'error', 'message': f'游戏 {game_id} 不存在'}), 404

        # 检查是否有正在进行的安装进程
        if game_id not in active_installations:
            logger.error(f"游戏 {game_id} 没有活跃的安装任务")
            return jsonify({'status': 'error', 'message': f'游戏 {game_id} 没有活跃的安装任务'}), 404
        
        # 确保有队列
        if game_id not in output_queues:
            output_queues[game_id] = queue.Queue()
            
            # 如果安装已完成，但没有队列，添加完成消息
            installation_data = active_installations[game_id]
            if installation_data.get('complete', False):
                status = 'success' if installation_data.get('return_code', 1) == 0 else 'error'
                message = installation_data.get('final_message', f'游戏 {game_id} 安装已完成')
                output_queues[game_id].put({'complete': True, 'status': status, 'message': message})
                
                # 同时把历史输出添加到队列
                for line in installation_data.get('output', []):
                    output_queues[game_id].put(line)
        
        # 使用队列传输数据
        def generate():
            installation_data = active_installations[game_id]
            output_queue = output_queues[game_id]
            
            # 发送所有已有的输出
            logger.info(f"准备发送游戏 {game_id} 的安装输出")
            
            # 马上发送一条测试消息，验证流正常工作
            yield f"data: {json.dumps({'line': '建立连接成功，开始接收实时安装进度...'})}\n\n"
            
            # 超时设置
            timeout_seconds = 300  # 5分钟无输出则超时
            last_output_time = time.time()
            heartbeat_interval = 10  # 每10秒发送一次心跳
            next_heartbeat = time.time() + heartbeat_interval
            
            # 持续监听队列
            while True:
                try:
                    # 尝试获取队列中的数据，最多等待1秒
                    try:
                        item = output_queue.get(timeout=1)
                        last_output_time = time.time()  # 重置超时时间
                        
                        # 处理完成消息
                        if isinstance(item, dict) and item.get('complete', False):
                            # logger.debug(f"发送安装完成消息: {item.get('message', '')}")
                            yield f"data: {json.dumps(item)}\n\n"
                            break
                        
                        # 处理 prompt 消息
                        if isinstance(item, dict) and item.get('prompt'):
                            # logger.debug(f"发送prompt消息: {item.get('prompt')}")
                            yield f"data: {json.dumps(item)}\n\n"
                            continue
                        
                        # 处理普通输出
                        if isinstance(item, str):
                            # logger.debug(f"发送输出: {item}")
                            yield f"data: {json.dumps({'line': item})}\n\n"
                        
                    except queue.Empty:
                        # 心跳检查
                        current_time = time.time()
                        if current_time >= next_heartbeat:
                            logger.debug(f"发送心跳包: game_id={game_id}")
                            yield f"data: {json.dumps({'heartbeat': True, 'timestamp': current_time})}\n\n"
                            next_heartbeat = current_time + heartbeat_interval
                        
                        # 检查是否超时
                        if time.time() - last_output_time > timeout_seconds:
                            logger.warning(f"游戏 {game_id} 的安装流超过 {timeout_seconds}秒 无输出，结束连接")
                            yield f"data: {json.dumps({'line': '安装流超时，请刷新页面查看最新状态'})}\n\n"
                            yield f"data: {json.dumps({'complete': True, 'status': 'warning', 'message': '安装流超时'})}\n\n"
                            break
                        
                        # 检查进程是否结束但未发送完成消息
                        process = installation_data.get('process')
                        if process and process.poll() is not None and installation_data.get('complete', False):
                            logger.warn(f"进程已结束但未发送完成消息，发送完成状态")
                            status = 'success' if installation_data.get('return_code', 1) == 0 else 'error'
                            message = installation_data.get('final_message', f'游戏 {game_id} 安装已完成')
                            yield f"data: {json.dumps({'complete': True, 'status': status, 'message': message})}\n\n"
                            break
                        
                        continue
                
                except Exception as e:
                    logger.error(f"生成流数据时出错: {str(e)}")
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"
                    break
        
        return Response(stream_with_context(generate()), 
                       mimetype='text/event-stream',
                       headers={
                           'Cache-Control': 'no-cache',
                           'X-Accel-Buffering': 'no'  # 禁用Nginx缓冲
                       })
            
    except Exception as e:
        logger.error(f"安装流处理错误: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/check_installation', methods=['GET'])
def check_installation():
    """检查游戏是否已安装"""
    game_id = request.args.get('game_id')
    if not game_id:
        return jsonify({'status': 'error', 'message': '缺少游戏ID'}), 400
    
    logger.debug(f"检查游戏 {game_id} 是否已安装")
    
    games_dir = "/home/steam/games"
    game_dir = os.path.join(games_dir, game_id)
    
    if os.path.exists(game_dir) and os.path.isdir(game_dir):
        # 检查目录是否不为空
        if os.listdir(game_dir):
            logger.debug(f"游戏 {game_id} 已安装")
            return jsonify({'status': 'success', 'installed': True})
    
    logger.debug(f"游戏 {game_id} 未安装")
    return jsonify({'status': 'success', 'installed': False})

@app.route('/api/batch_check_installation', methods=['POST'])
def batch_check_installation():
    """批量检查多个游戏是否已安装"""
    try:
        data = request.json
        game_ids = data.get('game_ids', [])
        
        if not game_ids:
            return jsonify({'status': 'error', 'message': '缺少游戏ID列表'}), 400
        
        logger.debug(f"批量检查游戏安装状态: {game_ids}")
        
        games_dir = "/home/steam/games"
        result = {}
        
        for game_id in game_ids:
            game_dir = os.path.join(games_dir, game_id)
            
            if os.path.exists(game_dir) and os.path.isdir(game_dir):
                # 检查目录是否不为空
                if os.listdir(game_dir):
                    result[game_id] = True
                    continue
            
            result[game_id] = False
        
        return jsonify({'status': 'success', 'installations': result})
        
    except Exception as e:
        logger.error(f"批量检查游戏安装状态失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/installation_status', methods=['GET'])
def installation_status():
    """获取所有安装任务的状态"""
    try:
        game_id = request.args.get('game_id')
        
        if game_id:
            # 获取特定游戏的安装状态
            if game_id not in active_installations:
                return jsonify({'status': 'error', 'message': f'没有找到游戏 {game_id} 的安装任务'}), 404
            
            install_data = active_installations[game_id]
            return jsonify({
                'status': 'success',
                'installation': {
                    'game_id': game_id,
                    'started_at': install_data.get('started_at'),
                    'complete': install_data.get('complete', False),
                    'return_code': install_data.get('return_code'),
                    'output_length': len(install_data.get('output', [])),
                    'error': install_data.get('error')
                }
            })
        else:
            # 获取所有安装任务的状态
            installations = {}
            for game_id, install_data in active_installations.items():
                installations[game_id] = {
                    'started_at': install_data.get('started_at'),
                    'complete': install_data.get('complete', False),
                    'return_code': install_data.get('return_code'),
                    'output_length': len(install_data.get('output', [])),
                    'error': install_data.get('error')
                }
            
            return jsonify({
                'status': 'success',
                'installations': installations
            })
    
    except Exception as e:
        logger.error(f"获取安装状态失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/installed_games', methods=['GET'])
def get_installed_games():
    """检测 /home/steam/games 下的文件夹，返回所有已安装的游戏ID列表和外部游戏"""
    try:
        games_config = load_games_config()
        all_game_ids = set(games_config.keys())
        
        if not os.path.exists(GAMES_DIR):
            return jsonify({'status': 'success', 'installed': [], 'external': []})
            
        installed = []
        external = []
        
        for name in os.listdir(GAMES_DIR):
            path = os.path.join(GAMES_DIR, name)
            if os.path.isdir(path):
                if name in all_game_ids:
                    # 配置中已有的游戏
                    installed.append(name)
                else:
                    # 配置中没有的外部游戏
                    external.append({
                        'id': name,
                        'name': name,  # 使用文件夹名作为游戏名
                        'external': True
                    })
        
        return jsonify({
            'status': 'success', 
            'installed': installed,
            'external': external
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/uninstall', methods=['POST'])
def uninstall_game():
    """卸载游戏，删除/home/steam/games/游戏名目录"""
    try:
        data = request.json
        game_id = data.get('game_id')
        if not game_id:
            return jsonify({'status': 'error', 'message': '缺少游戏ID'}), 400
            
        # 不再要求游戏必须在配置中
        games_config = load_games_config()
        is_external = game_id not in games_config
        
        game_dir = os.path.join(GAMES_DIR, game_id)
        if not os.path.exists(game_dir):
            return jsonify({'status': 'error', 'message': '游戏目录不存在'}), 404
        
        # 如果游戏服务器正在运行，先停止它
        if game_id in running_servers:
            process = running_servers[game_id].get('process')
            if process and process.poll() is None:
                logger.info(f"游戏服务器 {game_id} 正在运行，先停止它")
                try:
                    # 发送终止信号
                    process.terminate()
                    # 等待进程终止，最多等待5秒
                    for _ in range(10):
                        if process.poll() is not None:
                            break
                        time.sleep(0.5)
                    # 如果仍未终止，强制终止
                    if process.poll() is None:
                        process.kill()
                except Exception as e:
                    logger.error(f"停止游戏服务器 {game_id} 时出错: {str(e)}")
                    
        # 使用steam用户删除目录，避免权限问题
        try:
            # 先尝试使用steam用户删除
            uninstall_cmd = f"su - steam -c 'rm -rf {shlex.quote(game_dir)}'"
            logger.info(f"以steam用户运行卸载命令: {uninstall_cmd}")
            subprocess.run(uninstall_cmd, shell=True, check=True)
        except subprocess.CalledProcessError:
            # 如果失败，尝试直接删除
            logger.warning(f"使用steam用户删除失败，尝试直接删除: {game_dir}")
            shutil.rmtree(game_dir)
            
        # 清理服务器状态
        if game_id in running_servers:
            running_servers.pop(game_id)
            
        # 清理输出队列
        if game_id in server_output_queues:
            server_output_queues.pop(game_id)
            
        return jsonify({
            'status': 'success', 
            'message': f'游戏{" (外部)" if is_external else ""} {game_id} 已卸载'
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/send_input', methods=['POST'])
def send_input():
    data = request.json
    game_id = data.get('game_id')
    value = data.get('value')
    if not game_id or not value:
        return jsonify({'status': 'error', 'message': '缺少参数'}), 400
    
    # 使用PTY管理器设置输入值
    process_id = f"install_{game_id}"
    if pty_manager.set_input_value(process_id, value):
        return jsonify({'status': 'success'})
    else:
        return jsonify({'status': 'error', 'message': '无等待输入的进程'}), 404

@app.route('/api/server/start', methods=['POST'])
def start_game_server():
    """启动游戏服务器"""
    try:
        data = request.json
        game_id = data.get('game_id')
        
        if not game_id:
            logger.error("缺少游戏ID")
            return jsonify({'status': 'error', 'message': '缺少游戏ID'}), 400
            
        logger.info(f"请求启动游戏服务器: {game_id}")
        
        # 检查游戏是否存在于配置中
        games = load_games_config()
        is_external_game = False
        
        if game_id not in games:
            logger.warning(f"游戏 {game_id} 不在配置列表中，作为外部游戏处理")
            is_external_game = True
            
        # 检查游戏是否已安装
        game_dir = os.path.join(GAMES_DIR, game_id)
        if not os.path.exists(game_dir) or not os.path.isdir(game_dir):
            logger.error(f"游戏 {game_id} 未安装")
            return jsonify({'status': 'error', 'message': f'游戏 {game_id} 未安装'}), 400
            
        # 检查启动脚本
        start_script = os.path.join(game_dir, "start.sh")
        if not os.path.exists(start_script):
            logger.error(f"游戏 {game_id} 缺少启动脚本: start.sh")
            return jsonify({'status': 'error', 'message': f'游戏 {game_id} 缺少启动脚本，请确保游戏目录中有start.sh文件'}), 400
            
        # 确保启动脚本有执行权限
        if not os.access(start_script, os.X_OK):
            logger.info(f"添加启动脚本执行权限: {start_script}")
            os.chmod(start_script, 0o755)
            
        # 确保游戏目录的所有者为steam用户
        ensure_steam_permissions(game_dir)
            
        # 检查是否有正在运行的服务器进程
        process_id = f"server_{game_id}"
        
        # 首先检查PTY管理器中是否存在该进程ID
        if pty_manager.get_process(process_id):
            logger.info(f"PTY管理器中存在进程ID {process_id}，但可能是残留的记录")
            # 移除PTY管理器中的进程记录，而不是直接返回错误
            pty_manager.remove_process(process_id)
            logger.info(f"已从PTY管理器中移除可能残留的进程记录: {process_id}")
        
        # 然后检查running_servers字典中是否存在该游戏ID
        if game_id in running_servers:
            server_data = running_servers[game_id]
            process = server_data.get('process')
            
            # 检查进程是否仍在运行
            if process and process.poll() is None:
                logger.info(f"游戏服务器 {game_id} 已经在运行中")
                return jsonify({
                    'status': 'success', 
                    'message': f'游戏服务器 {game_id} 已经在运行中',
                    'already_running': True
                })
            else:
                # 进程已结束，但字典中仍有记录，清理旧数据
                logger.info(f"清理游戏服务器 {game_id} 的旧运行数据")
                
                # 尝试终止任何可能仍在运行的进程
                try:
                    if process and process.poll() is None:
                        process.terminate()
                        time.sleep(0.5)
                        if process.poll() is None:
                            process.kill()
                except Exception as e:
                    logger.warning(f"终止旧进程时出错: {str(e)}")
                
                # 从字典中移除
                del running_servers[game_id]
        
        # 检查系统中是否有同名进程在运行
        try:
            for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                try:
                    cmdline = proc.cmdline()
                    if len(cmdline) > 1 and game_id in ' '.join(cmdline) and './start.sh' in ' '.join(cmdline):
                        logger.warning(f"发现系统中可能有相关进程正在运行: PID={proc.pid}, CMD={' '.join(cmdline)}")
                        # 尝试终止这个进程
                        try:
                            proc.terminate()
                            logger.info(f"已终止可能相关的进程: PID={proc.pid}")
                        except:
                            logger.warning(f"无法终止可能相关的进程: PID={proc.pid}")
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    pass
        except Exception as e:
            logger.warning(f"检查系统进程时出错: {str(e)}")
            
        # 清理任何旧的服务器数据
        logger.info(f"清理游戏服务器 {game_id} 的旧运行数据")
        
        # 清理输出队列
        if game_id in server_output_queues:
            try:
                while not server_output_queues[game_id].empty():
                    server_output_queues[game_id].get_nowait()
            except:
                server_output_queues[game_id] = queue.Queue()
        else:
            server_output_queues[game_id] = queue.Queue()
            
        # 读取启动脚本内容
        try:
            with open(start_script, 'r') as f:
                script_content = f.read()
                logger.info(f"启动脚本内容: \n{script_content}")
        except Exception as e:
            logger.warning(f"读取启动脚本失败: {str(e)}")
            
        # 构建启动命令，确保以steam用户运行
        cmd = f"su - steam -c 'cd {game_dir} && ./start.sh'"
        logger.debug(f"准备执行命令 (将使用PTY): {cmd}")
        
        # 初始化服务器状态跟踪
        running_servers[game_id] = {
            'process': None,
            'output': [],
            'started_at': time.time(),
            'running': True,
            'return_code': None,
            'cmd': cmd,
            'master_fd': None,
            'game_dir': game_dir,
            'external': is_external_game  # 添加外部游戏标记
        }
        
        # 在单独的线程中启动服务器
        server_thread = threading.Thread(
            target=run_game_server,
            args=(game_id, cmd, game_dir),
            daemon=True
        )
        server_thread.start()
        
        logger.info(f"游戏服务器 {game_id} 启动线程已启动")
        time.sleep(0.5)
        server_output_queues[game_id].put("服务器启动中...")
        
        # 添加一些额外的调试信息
        server_output_queues[game_id].put(f"游戏目录: {game_dir}")
        server_output_queues[game_id].put(f"启动命令: {cmd}")
        
        # 添加到输出历史
        if 'output' not in running_servers[game_id]:
            running_servers[game_id]['output'] = []
        running_servers[game_id]['output'].append("服务器启动中...")
        running_servers[game_id]['output'].append(f"游戏目录: {game_dir}")
        running_servers[game_id]['output'].append(f"启动命令: {cmd}")
        
        return jsonify({
            'status': 'success', 
            'message': f'游戏服务器 {game_id} 启动已开始'
        })
        
    except Exception as e:
        logger.error(f"启动游戏服务器失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/terminate_install', methods=['POST'])
def terminate_install():
    """终止游戏安装进程"""
    try:
        data = request.json
        game_id = data.get('game_id')
        
        if not game_id:
            return jsonify({'status': 'error', 'message': '缺少游戏ID'}), 400
            
        logger.info(f"请求终止游戏 {game_id} 的安装进程")
        
        # 检查游戏是否正在安装
        if game_id not in active_installations:
            # 游戏未在安装中，返回成功状态
            logger.info(f"游戏 {game_id} 未在安装中，但仍返回成功状态")
            return jsonify({'status': 'success', 'message': f'游戏 {game_id} 未在安装中'})
            
        installation_data = active_installations[game_id]
        
        # 如果已经完成，则直接返回
        if installation_data.get('complete', False):
            logger.info(f"游戏 {game_id} 安装已完成，无需终止")
            return jsonify({'status': 'success', 'message': f'游戏 {game_id} 安装已完成'})
            
        # 尝试获取PTY进程对象
        pty_process = installation_data.get('pty_process')
        process_id = f"install_{game_id}"
        
        # 记录详细的进程信息
        logger.info(f"进程信息: process_id={process_id}, pty_process存在={pty_process is not None}")
        if pty_process:
            logger.info(f"PTY进程状态: running={pty_process.running}, complete={pty_process.complete}")
        
        # 尝试使用PTY管理器终止进程
        logger.info(f"尝试使用PTY管理器终止进程: {process_id}")
        pty_result = False
        
        # 首先尝试通过进程ID终止
        if pty_manager.get_process(process_id):
            logger.info(f"在pty_manager中找到进程: {process_id}")
            pty_result = pty_manager.terminate_process(process_id, force=True)
        # 如果通过ID终止失败，但我们有进程对象，直接终止它
        elif pty_process:
            logger.info(f"直接终止PTY进程对象")
            pty_result = pty_process.terminate(force=True)
        
        if pty_result:
            logger.info(f"成功终止进程: {process_id}")
            # 更新安装状态
            installation_data['complete'] = True
            installation_data['terminated'] = True
            installation_data['error'] = "安装被用户终止"
            
            # 向队列添加终止消息
            if game_id in output_queues:
                output_queues[game_id].put({'complete': True, 'status': 'terminated', 'message': f'游戏 {game_id} 安装已被用户终止'})
                
            return jsonify({'status': 'success', 'message': f'游戏 {game_id} 安装已终止'})
        else:
            logger.warning(f"使用PTY管理器终止进程失败，尝试使用备选方案: {process_id}")
            
            # 尝试直接终止进程
            try:
                # 检查是否有进程对象
                process = installation_data.get('process')
                if process and process.poll() is None:
                    logger.info(f"尝试直接终止进程 PID: {process.pid}")
                    try:
                        # 找到所有子进程并终止
                        parent = psutil.Process(process.pid)
                        children = parent.children(recursive=True)
                        
                        # 首先杀死所有子进程
                        for child in children:
                            logger.info(f"杀死子进程: {child.pid}")
                            try:
                                child.kill()
                            except:
                                pass
                        
                        # 然后杀死主进程
                        parent.kill()
                        logger.info(f"已杀死进程及其子进程")
                        
                        # 更新安装状态
                        installation_data['complete'] = True
                        installation_data['terminated'] = True
                        installation_data['error'] = "安装被用户强制终止"
                        
                        # 向队列添加终止消息
                        if game_id in output_queues:
                            output_queues[game_id].put({'complete': True, 'status': 'terminated', 'message': f'游戏 {game_id} 安装已被用户强制终止'})
                        
                        return jsonify({'status': 'success', 'message': f'游戏 {game_id} 安装已强制终止'})
                    except Exception as e:
                        logger.error(f"直接终止进程失败: {str(e)}")
                else:
                    logger.warning(f"没有找到活动的进程对象")
                    
                # 即使无法终止进程，也标记为完成
                installation_data['complete'] = True
                installation_data['terminated'] = True
                installation_data['error'] = "尝试终止安装，但无法找到进程"
                
                # 向队列添加终止消息
                if game_id in output_queues:
                    output_queues[game_id].put({'complete': True, 'status': 'warning', 'message': f'游戏 {game_id} 安装标记为终止，但可能仍在后台运行'})
                
                return jsonify({'status': 'warning', 'message': f'游戏 {game_id} 安装标记为终止，但可能仍在后台运行'})
            except Exception as e:
                logger.error(f"备选终止方案失败: {str(e)}")
                return jsonify({'status': 'error', 'message': f'无法终止游戏 {game_id} 的安装进程: {str(e)}'}), 500
            
    except Exception as e:
        logger.error(f"终止安装进程失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/server/stop', methods=['POST'])
def stop_game_server():
    """停止游戏服务器"""
    try:
        data = request.json
        game_id = data.get('game_id')
        force = data.get('force', False)  # 是否强制停止
        
        if not game_id:
            logger.error("缺少游戏ID")
            return jsonify({'status': 'error', 'message': '缺少游戏ID'}), 400
            
        logger.info(f"请求停止游戏服务器: {game_id}, 强制模式: {force}")
        
        # 将此服务器标记为人工停止
        manually_stopped_servers.add(game_id)
        logger.info(f"已将游戏服务器 {game_id} 标记为人工停止")
        
        # 检查游戏服务器是否在运行
        if game_id not in running_servers:
            logger.error(f"游戏服务器 {game_id} 未运行")
            return jsonify({'status': 'error', 'message': f'游戏服务器 {game_id} 未运行'}), 400
            
        # 尝试获取PTY进程对象
        server_data = running_servers[game_id]
        pty_process = server_data.get('pty_process')
        process_id = server_data.get('process_id') or f"server_{game_id}"
        
        # 记录详细的进程信息
        logger.info(f"进程信息: process_id={process_id}, pty_process存在={pty_process is not None}")
        if pty_process:
            logger.info(f"PTY进程状态: running={pty_process.running}, complete={pty_process.complete}")
        
        # 尝试使用PTY管理器终止进程
        logger.info(f"尝试使用PTY管理器终止进程: {process_id}")
        pty_result = False
        
        # 首先尝试通过进程ID终止
        if pty_manager.get_process(process_id):
            logger.info(f"在pty_manager中找到进程: {process_id}")
            pty_result = pty_manager.terminate_process(process_id, force=force)
        # 如果通过ID终止失败，但我们有进程对象，直接终止它
        elif pty_process:
            logger.info(f"直接终止PTY进程对象")
            pty_result = pty_process.terminate(force=force)
            
        # 进行额外的进程检查
        process = running_servers[game_id].get('process')
        process_still_running = False
        
        if process:
            # 检查进程是否仍在运行
            if process.poll() is None:
                process_still_running = True
                logger.warning(f"PTY管理器报告终止成功，但进程仍在运行，PID: {process.pid}")
                
                # 尝试使用psutil进行更深入的检查
                try:
                    # 检查进程是否真的存在
                    if psutil.pid_exists(process.pid):
                        p = psutil.Process(process.pid)
                        logger.warning(f"进程 {process.pid} 仍然存在，状态: {p.status()}")
                        
                        # 如果是强制模式或PTY终止失败，直接杀死进程
                        if force or not pty_result:
                            logger.info(f"强制杀死进程 {process.pid}")
                            p.kill()
                            
                            # 检查子进程并杀死
                            try:
                                children = p.children(recursive=True)
                                for child in children:
                                    logger.info(f"杀死子进程: {child.pid}")
                                    child.kill()
                            except:
                                pass
                    else:
                        logger.info(f"进程 {process.pid} 不存在于系统中，可能已经终止")
                        process_still_running = False
                except Exception as e:
                    logger.error(f"检查进程状态时出错: {str(e)}")
            else:
                logger.info(f"进程已终止，返回码: {process.poll()}")
                process_still_running = False
        
        # 如果PTY终止成功或进程确实不再运行
        if pty_result or not process_still_running:
            logger.info(f"成功终止进程: {process_id}")
            # 更新服务器状态
            running_servers[game_id]['running'] = False
            running_servers[game_id]['stopped_by_user'] = True
            
            # 清理终端日志
            clean_server_output(game_id)
            
            # 从运行中的服务器字典中移除该游戏服务器
            if game_id in running_servers:
                logger.info(f"从运行中的服务器列表中移除游戏服务器: {game_id}")
                del running_servers[game_id]
                
            # 从输出队列字典中移除该游戏服务器
            if game_id in server_output_queues:
                logger.info(f"从输出队列列表中移除游戏服务器: {game_id}")
                del server_output_queues[game_id]
                
            # 确保从PTY管理器中删除进程
            if pty_manager.get_process(process_id):
                logger.info(f"从PTY管理器中删除进程: {process_id}")
                pty_manager.remove_process(process_id)
            
            return jsonify({'status': 'success', 'message': f'游戏服务器 {game_id} 已停止'})
        else:
            logger.warning(f"使用PTY管理器终止进程失败，尝试使用备选方案: {process_id}")
            
            # 尝试直接终止进程
            try:
                # 检查是否有进程对象
                process = running_servers[game_id].get('process')
                if process and process.poll() is None:
                    logger.info(f"尝试直接终止进程 PID: {process.pid}")
                    try:
                        # 找到所有子进程并终止
                        parent = psutil.Process(process.pid)
                        children = parent.children(recursive=True)
                        
                        # 如果不是强制模式，先尝试正常终止
                        if not force:
                            logger.info("尝试正常终止进程")
                            parent.terminate()
                            # 等待一段时间
                            for _ in range(10):  # 最多等待5秒
                                if process.poll() is not None:
                                    break
                                time.sleep(0.5)
                        
                        # 如果仍在运行或强制模式，强制终止
                        if force or process.poll() is None:
                            # 首先杀死所有子进程
                            for child in children:
                                logger.info(f"杀死子进程: {child.pid}")
                                try:
                                    child.kill()
                                except:
                                    pass
                            
                            # 然后杀死主进程
                            parent.kill()
                            logger.info(f"已杀死进程及其子进程")
                        
                        # 更新服务器状态
                        running_servers[game_id]['running'] = False
                        running_servers[game_id]['stopped_by_user'] = True
                        
                        # 清理终端日志
                        clean_server_output(game_id)
                        
                        # 从运行中的服务器字典中移除该游戏服务器
                        if game_id in running_servers:
                            logger.info(f"从运行中的服务器列表中移除游戏服务器: {game_id}")
                            del running_servers[game_id]
                            
                        # 从输出队列字典中移除该游戏服务器
                        if game_id in server_output_queues:
                            logger.info(f"从输出队列列表中移除游戏服务器: {game_id}")
                            del server_output_queues[game_id]
                        
                        # 确保从PTY管理器中删除进程
                        if pty_manager.get_process(process_id):
                            logger.info(f"从PTY管理器中删除进程: {process_id}")
                            pty_manager.remove_process(process_id)
                        
                        return jsonify({'status': 'success', 'message': f'游戏服务器 {game_id} 已强制停止'})
                    except Exception as e:
                        logger.error(f"直接终止进程失败: {str(e)}")
                else:
                    logger.warning(f"没有找到活动的进程对象")
                
                # 即使无法终止进程，也标记为停止
                running_servers[game_id]['running'] = False
                running_servers[game_id]['stopped_by_user'] = True
                
                # 清理终端日志
                clean_server_output(game_id)
                
                # 从运行中的服务器字典中移除该游戏服务器
                if game_id in running_servers:
                    logger.info(f"从运行中的服务器列表中移除游戏服务器: {game_id}")
                    del running_servers[game_id]
                    
                # 从输出队列字典中移除该游戏服务器
                if game_id in server_output_queues:
                    logger.info(f"从输出队列列表中移除游戏服务器: {game_id}")
                    del server_output_queues[game_id]
                
                # 确保从PTY管理器中删除进程
                if pty_manager.get_process(process_id):
                    logger.info(f"从PTY管理器中删除进程: {process_id}")
                    pty_manager.remove_process(process_id)
                
                return jsonify({'status': 'warning', 'message': f'游戏服务器 {game_id} 标记为停止，但可能仍在后台运行'})
            except Exception as e:
                logger.error(f"备选终止方案失败: {str(e)}")
                return jsonify({'status': 'error', 'message': f'无法停止游戏服务器 {game_id}: {str(e)}'}), 500
            
    except Exception as e:
        logger.error(f"停止游戏服务器失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# 添加一个清理服务器输出的函数
def clean_server_output(game_id):
    """清理服务器终端日志"""
    try:
        logger.info(f"清理游戏服务器 {game_id} 的终端日志")
        
        # 清空服务器输出历史
        if game_id in running_servers:
            running_servers[game_id]['output'] = []
            logger.info(f"已清空游戏服务器 {game_id} 的输出历史")
        
        # 清空输出队列
        if game_id in server_output_queues:
            try:
                while not server_output_queues[game_id].empty():
                    server_output_queues[game_id].get_nowait()
                logger.info(f"已清空游戏服务器 {game_id} 的输出队列")
            except:
                pass
        
        return True
    except Exception as e:
        logger.error(f"清理游戏服务器 {game_id} 终端日志失败: {str(e)}")
        return False

@app.route('/api/server/send_input', methods=['POST'])
def server_send_input():
    """向游戏服务器发送输入"""
    try:
        data = request.json
        game_id = data.get('game_id')
        value = data.get('value')
        
        if not game_id or value is None:
            logger.error("缺少参数")
            return jsonify({'status': 'error', 'message': '缺少游戏ID或输入值'}), 400
            
        logger.info(f"向游戏服务器发送输入: game_id={game_id}, value={value}")
        
        # 检查服务器是否在运行
        if game_id not in running_servers:
            logger.error(f"游戏服务器 {game_id} 未运行")
            return jsonify({'status': 'error', 'message': '服务器未运行'}), 400
            
        # 使用PTY管理器发送输入
        process_id = f"server_{game_id}"
        
        # 检查进程是否存在
        if not pty_manager.get_process(process_id):
            logger.error(f"PTY进程不存在: {process_id}")
            return jsonify({'status': 'error', 'message': '服务器进程不存在'}), 400
            
        # 发送输入
        if pty_manager.send_input(process_id, value):
            logger.info(f"输入发送成功: game_id={game_id}")
            
            # 将输入回显到输出队列
            if game_id in server_output_queues:
                echo_message = f"> {value}"
                server_output_queues[game_id].put(echo_message)
                logger.debug(f"输入已回显到输出队列: game_id={game_id}")
                
                # 同时保存到输出历史
                if game_id in running_servers:
                    if 'output' not in running_servers[game_id]:
                        running_servers[game_id]['output'] = []
                    running_servers[game_id]['output'].append(echo_message)
                
            return jsonify({'status': 'success', 'message': '输入已发送'})
        else:
            logger.error(f"发送输入失败: game_id={game_id}")
            return jsonify({'status': 'error', 'message': '服务器未运行或无法发送输入'}), 400
        
    except Exception as e:
        logger.error(f"向游戏服务器发送输入失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/server/status', methods=['GET'])
def server_status():
    """获取游戏服务器状态"""
    try:
        game_id = request.args.get('game_id')
        
        if game_id:
            # 获取特定游戏服务器的状态
            if game_id not in running_servers:
                return jsonify({'status': 'success', 'server_status': 'stopped'})
                
            server_data = running_servers[game_id]
            process = server_data.get('process')
            pty_process = server_data.get('pty_process')
            process_id = server_data.get('process_id') or f"server_{game_id}"
            
            # 检查进程是否仍在运行
            is_running = False
            
            # 首先检查subprocess进程
            if process:
                if process.poll() is None:
                    is_running = True
                    # 使用psutil进行额外验证
                    try:
                        if psutil.pid_exists(process.pid):
                            p = psutil.Process(process.pid)
                            if p.status() in ['running', 'sleeping', 'disk-sleep', 'waking']:
                                is_running = True
                            else:
                                logger.warning(f"进程 {process.pid} 存在但状态为: {p.status()}")
                                is_running = False
                        else:
                            is_running = False
                    except Exception as e:
                        logger.error(f"使用psutil检查进程状态时出错: {str(e)}")
            
            # 然后检查PTY进程
            if not is_running and pty_process:
                if hasattr(pty_process, 'running') and pty_process.running:
                    is_running = True
            
            # 最后检查PTY管理器中的进程
            if not is_running and pty_manager.get_process(process_id):
                pty_proc = pty_manager.get_process(process_id)
                if pty_proc and pty_proc.is_running():
                    is_running = True
            
            if not is_running:
                return jsonify({'status': 'success', 'server_status': 'stopped'})
                
            return jsonify({
                'status': 'success',
                'server_status': 'running',
                'pid': process.pid if process else None,
                'started_at': server_data.get('started_at'),
                'uptime': time.time() - server_data.get('started_at', time.time())
            })
        else:
            # 获取所有游戏服务器的状态
            servers = {}
            for game_id, server_data in running_servers.items():
                process = server_data.get('process')
                pty_process = server_data.get('pty_process')
                process_id = server_data.get('process_id') or f"server_{game_id}"
                
                # 检查进程是否仍在运行
                is_running = False
                
                # 首先检查subprocess进程
                if process:
                    if process.poll() is None:
                        is_running = True
                        # 使用psutil进行额外验证
                        try:
                            if psutil.pid_exists(process.pid):
                                p = psutil.Process(process.pid)
                                if p.status() in ['running', 'sleeping', 'disk-sleep', 'waking']:
                                    is_running = True
                                else:
                                    logger.warning(f"进程 {process.pid} 存在但状态为: {p.status()}")
                                    is_running = False
                            else:
                                is_running = False
                        except Exception as e:
                            logger.error(f"使用psutil检查进程状态时出错: {str(e)}")
                
                # 然后检查PTY进程
                if not is_running and pty_process:
                    if hasattr(pty_process, 'running') and pty_process.running:
                        is_running = True
                
                # 最后检查PTY管理器中的进程
                if not is_running and pty_manager.get_process(process_id):
                    pty_proc = pty_manager.get_process(process_id)
                    if pty_proc and pty_proc.is_running():
                        is_running = True
                
                if is_running:
                    servers[game_id] = {
                        'status': 'running',
                        'pid': process.pid if process else None,
                        'started_at': server_data.get('started_at'),
                        'uptime': time.time() - server_data.get('started_at', time.time())
                    }
                else:
                    servers[game_id] = {
                        'status': 'stopped',
                        'return_code': process.poll() if process else None
                    }
                    
            return jsonify({
                'status': 'success',
                'servers': servers
            })
            
    except Exception as e:
        logger.error(f"获取服务器状态失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/server/stream', methods=['GET'])
def server_stream():
    """游戏服务器输出流"""
    try:
        game_id = request.args.get('game_id')
        token = request.args.get('token')
        include_history = request.args.get('include_history', 'true').lower() == 'true'
        is_restart = request.args.get('restart', 'false').lower() == 'true'
        
        if not game_id:
            return jsonify({'status': 'error', 'message': '缺少游戏ID参数'}), 400
            
        # 验证token (如果提供)
        if token:
            payload = verify_token(token)
            if not payload:
                return jsonify({'status': 'error', 'message': '无效的认证令牌'}), 401
        
        logger.info(f"请求游戏 {game_id} 的输出流, include_history={include_history}, is_restart={is_restart}")
            
        # 如果服务器不在运行中，但请求了流
        if game_id not in running_servers:
            logger.warning(f"游戏服务器 {game_id} 未运行，但请求了输出流")
            
            # 如果是重启请求，创建一个新的输出队列，不返回错误
            if is_restart:
                logger.info(f"检测到重启请求，为游戏 {game_id} 创建新的输出队列")
                server_output_queues[game_id] = queue.Queue()
                # 添加一条初始消息
                server_output_queues[game_id].put(f"正在准备重启游戏服务器 {game_id}...")
            else:
                # 返回SSE流，而不是直接返回404错误
                def generate_error():
                    yield f"data: {json.dumps({'line': f'游戏服务器 {game_id} 未运行或已停止'})}\n\n"
                    yield f"data: {json.dumps({'complete': True, 'status': 'error', 'message': f'游戏服务器 {game_id} 未运行或已停止'})}\n\n"
                
                return Response(stream_with_context(generate_error()), 
                              mimetype='text/event-stream',
                              headers={
                                  'Cache-Control': 'no-cache',
                                  'X-Accel-Buffering': 'no'  # 禁用Nginx缓冲
                              })
            
        # 确保有队列
        if game_id not in server_output_queues:
            server_output_queues[game_id] = queue.Queue()
        
        # 获取服务器数据和历史输出
        output_history = []
        if game_id in running_servers:
            server_data = running_servers[game_id]
            output_history = server_data.get('output', [])
            
        # 添加历史记录到队列开头
        if include_history and output_history:
            logger.info(f"将 {len(output_history)} 行历史输出添加到流中: game_id={game_id}")
            for line in output_history:
                if isinstance(line, str) and not line.startswith('[历史记录]'):
                    server_output_queues[game_id].put(f"[历史记录] {line}")
                else:
                    server_output_queues[game_id].put(line)
        
        # 生成器函数
        def generate():
            output_queue = server_output_queues[game_id]
            
            # 发送一条连接成功消息
            yield f"data: {json.dumps({'line': '已连接到服务器输出流，等待服务器输出...'})}\n\n"
            
            # 检查进程是否已结束
            process_ended = False
            return_code = None
            
            if game_id in running_servers:
                process = running_servers[game_id].get('process')
                pty_process = running_servers[game_id].get('pty_process')
            else:
                process = None
                pty_process = None
                # 如果是重启请求，尝试从PTY管理器获取进程
                if is_restart:
                    process_id = f"server_{game_id}"
                    if pty_manager.get_process(process_id):
                        pty_process = pty_manager.get_process(process_id)
            
            if process and hasattr(process, 'poll'):
                return_code = process.poll()
                if return_code is not None:
                    process_ended = True
            elif pty_process:
                if hasattr(pty_process, 'complete') and pty_process.complete:
                    process_ended = True
                    return_code = pty_process.return_code if hasattr(pty_process, 'return_code') else 0
                elif hasattr(pty_process, 'running') and not pty_process.running:
                    process_ended = True
                    return_code = pty_process.return_code if hasattr(pty_process, 'return_code') else 0
            
            if process_ended:
                status = 'success' if return_code == 0 else 'error'
                message = f'游戏服务器 {game_id} ' + ('正常关闭' if return_code == 0 else f'异常退出，返回码: {return_code}')
                logger.info(f"服务器已停止，发送完成消息: game_id={game_id}, 状态={status}")
                yield f"data: {json.dumps({'complete': True, 'status': status, 'message': message})}\n\n"
                return
            
            # 超时设置
            timeout_seconds = 3600  # 1小时无输出则超时
            last_output_time = time.time()
            heartbeat_interval = 10  # 每10秒发送一次心跳
            next_heartbeat = time.time() + heartbeat_interval
            
            # 持续监听队列
            logger.info(f"开始监听实时输出队列: game_id={game_id}")
            
            # 发送一条实时输出测试消息
            test_message = f"服务器 {game_id} 已启动，等待输出..."
            yield f"data: {json.dumps({'line': test_message})}\n\n"
            
            # 添加一个计数器，用于记录处理的输出行数
            output_count = 0
            
            # 记录错误消息
            error_messages = []
            has_exit_message = False
            
            try:
                while True:
                    # 检查进程是否已结束
                    process_ended = False
                    if game_id in running_servers:
                        process = running_servers[game_id].get('process')
                        pty_process = running_servers[game_id].get('pty_process')
                        
                        if process and hasattr(process, 'poll'):
                            return_code = process.poll()
                            if return_code is not None:
                                process_ended = True
                        elif pty_process:
                            if hasattr(pty_process, 'complete') and pty_process.complete:
                                process_ended = True
                                return_code = pty_process.return_code if hasattr(pty_process, 'return_code') else 0
                            elif hasattr(pty_process, 'running') and not pty_process.running:
                                process_ended = True
                                return_code = pty_process.return_code if hasattr(pty_process, 'return_code') else 0
                    else:
                        # 进程已从running_servers中移除
                        process_ended = True
                        return_code = 0  # 假设成功完成
                        process = None
                        pty_process = None
                    
                    # 如果进程已结束且队列为空，发送完成消息并退出
                    if process_ended and output_queue.empty():
                        if not has_exit_message:
                            # 收集可能的错误消息
                            if error_messages:
                                error_summary = "; ".join(error_messages)
                                logger.warning(f"服务器 {game_id} 退出时有错误: {error_summary}")
                                yield f"data: {json.dumps({'line': f'服务器退出时有错误: {error_summary}'})}\n\n"
                            
                            # 发送完成消息
                            status = 'success' if return_code == 0 else 'error'
                            message = f'游戏服务器 {game_id} ' + ('正常关闭' if return_code == 0 else f'异常退出，返回码: {return_code}')
                            logger.info(f"服务器已停止，发送完成消息: game_id={game_id}, 状态={status}, 已处理 {output_count} 行输出")
                            yield f"data: {json.dumps({'complete': True, 'status': status, 'message': message})}\n\n"
                            has_exit_message = True
                        break
                    
                    # 检查是否有新输出
                    try:
                        line = output_queue.get(timeout=0.5)
                        output_count += 1
                        
                        # 如果是字典类型（特殊消息），直接发送
                        if isinstance(line, dict):
                            if 'complete' in line:  # 完成消息
                                logger.info(f"检测到完成消息: game_id={game_id}, 状态={line.get('status', 'unknown')}")
                                yield f"data: {json.dumps(line)}\n\n"
                                has_exit_message = True
                                break
                            else:  # 其他特殊消息
                                logger.debug(f"发送特殊消息 #{output_count}: {line}")
                                yield f"data: {json.dumps(line)}\n\n"
                        else:  # 普通文本行
                            # 检查是否包含错误信息
                            if isinstance(line, str) and any(err_keyword in line.lower() for err_keyword in ['error', 'exception', 'fail', '错误', '异常', '失败']):
                                # 保存错误消息
                                if len(error_messages) < 5:  # 最多保存5条错误消息
                                    error_messages.append(line)
                            
                            # 检查是否包含退出信息
                            if isinstance(line, str) and any(exit_keyword in line.lower() for exit_keyword in ['exit', 'shutdown', 'terminate', '退出', '关闭', '停止']):
                                logger.info(f"检测到退出消息: {line}")
                            
                            if output_count % 10 == 0:  # 每10行输出打印一次调试信息
                                logger.debug(f"已处理 {output_count} 行输出: game_id={game_id}")
                            
                            # 截断长输出
                            if isinstance(line, str) and len(line) > 10000:
                                logger.warning(f"输出行过长，已截断: {len(line)} 字符")
                                line = line[:10000] + "... (输出过长，已截断)"
                            
                            logger.debug(f"发送服务器输出 #{output_count}: {line[:100]}...")
                            yield f"data: {json.dumps({'line': line})}\n\n"
                        
                        # 更新最后输出时间
                        last_output_time = time.time()
                        
                    except queue.Empty:
                        # 队列为空，检查是否需要发送心跳
                        current_time = time.time()
                        
                        # 检查是否超时
                        if current_time - last_output_time > timeout_seconds:
                            logger.warning(f"服务器 {game_id} 长时间无输出，超时")
                            yield f"data: {json.dumps({'line': '[心跳检查] 服务器长时间无输出，连接超时'})}\n\n"
                            yield f"data: {json.dumps({'complete': True, 'status': 'timeout', 'message': '服务器长时间无输出，连接超时'})}\n\n"
                            break
                        
                        # 发送心跳包
                        if current_time > next_heartbeat:
                            heartbeat_msg = f"[心跳检查] 连接正常，等待服务器输出... ({time.strftime('%H:%M:%S')})"
                            logger.debug(f"发送心跳包: game_id={game_id}, 已处理 {output_count} 行")
                            yield f"data: {json.dumps({'line': heartbeat_msg})}\n\n"
                            next_heartbeat = current_time + heartbeat_interval
                        
                        # 如果队列为空且进程仍在运行，等待片刻再继续
                        if not process_ended:
                            logger.info(f"队列为空，等待输出: game_id={game_id}, 已处理 {output_count} 行")
                            time.sleep(1)
            except GeneratorExit:
                logger.info(f"客户端断开连接: game_id={game_id}, 已处理 {output_count} 行输出")
            except Exception as e:
                logger.error(f"生成输出流时出错: {str(e)}")
                yield f"data: {json.dumps({'line': f'处理输出流时出错: {str(e)}'})}\n\n"
                yield f"data: {json.dumps({'complete': True, 'status': 'error', 'message': f'处理输出流时出错: {str(e)}'})}\n\n"
            
            logger.info(f"输出转发线程结束: game_id={game_id}, 总共处理 {output_count} 行输出")
        
        # 返回流式响应
        return Response(stream_with_context(generate()), 
                       mimetype='text/event-stream',
                       headers={
                           'Cache-Control': 'no-cache',
                           'X-Accel-Buffering': 'no'  # 禁用Nginx缓冲
                       })
    
    except Exception as e:
        logger.error(f"创建服务器输出流失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/container_info', methods=['GET'])
def get_container_info():
    """获取容器信息，包括系统资源占用、已安装游戏和正在运行的游戏"""
    try:
        # 获取系统信息
        system_info = {
            'cpu_usage': psutil.cpu_percent(),
            'memory': {
                'total': psutil.virtual_memory().total / (1024 * 1024 * 1024),  # GB
                'used': psutil.virtual_memory().used / (1024 * 1024 * 1024),    # GB
                'percent': psutil.virtual_memory().percent
            },
            'disk': {
                'total': 0,
                'used': 0,
                'percent': 0
            }
        }
        
        # 获取游戏目录磁盘使用情况
        if os.path.exists(GAMES_DIR):
            disk_usage = shutil.disk_usage(GAMES_DIR)
            system_info['disk'] = {
                'total': disk_usage.total / (1024 * 1024 * 1024),  # GB
                'used': disk_usage.used / (1024 * 1024 * 1024),    # GB
                'percent': disk_usage.used * 100 / disk_usage.total if disk_usage.total > 0 else 0
            }
            
            # 计算各游戏占用空间
            games_space = {}
            for game_id in os.listdir(GAMES_DIR):
                game_path = os.path.join(GAMES_DIR, game_id)
                if os.path.isdir(game_path):
                    try:
                        size = 0
                        for dirpath, dirnames, filenames in os.walk(game_path):
                            for f in filenames:
                                fp = os.path.join(dirpath, f)
                                if os.path.exists(fp):
                                    size += os.path.getsize(fp)
                        games_space[game_id] = size / (1024 * 1024)  # MB
                    except Exception as e:
                        logger.error(f"计算游戏 {game_id} 空间占用时出错: {str(e)}")
                        games_space[game_id] = 0
            system_info['games_space'] = games_space
        
        # 获取已安装游戏（仅包含在配置中的游戏）
        installed_games = []
        games_config = load_games_config()
        if os.path.exists(GAMES_DIR):
            for name in os.listdir(GAMES_DIR):
                path = os.path.join(GAMES_DIR, name)
                if os.path.isdir(path) and name in games_config:
                    game_info = {
                        'id': name,
                        'name': games_config[name].get('game_nameCN', name),
                        'size_mb': system_info['games_space'].get(name, 0) if 'games_space' in system_info else 0
                    }
                    installed_games.append(game_info)
        
        # 获取正在运行的游戏
        running_games = []
        for game_id, server_data in running_servers.items():
            process = server_data.get('process')
            if process and process.poll() is None:
                game_name = game_id
                if game_id in games_config:
                    game_name = games_config[game_id].get('game_nameCN', game_id)
                game_info = {
                    'id': game_id,
                    'name': game_name,
                    'started_at': server_data.get('started_at'),
                    'uptime': time.time() - server_data.get('started_at', time.time()),
                    'external': game_id not in games_config  # 标记是否为外部游戏
                }
                running_games.append(game_info)
        
        return jsonify({
            'status': 'success',
            'system_info': system_info,
            'installed_games': installed_games,
            'running_games': running_games
        })
    except Exception as e:
        logger.error(f"获取容器信息失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# 添加一个清理安装输出的函数，类似于清理服务器输出的函数
def clean_installation_output(game_id):
    """清理安装终端日志"""
    try:
        logger.info(f"清理游戏 {game_id} 的安装终端日志")
        
        # 清空安装输出历史
        if game_id in active_installations:
            active_installations[game_id]['output'] = []
            logger.info(f"已清空游戏 {game_id} 的安装输出历史")
        
        # 清空输出队列
        if game_id in output_queues:
            try:
                while not output_queues[game_id].empty():
                    output_queues[game_id].get_nowait()
                logger.info(f"已清空游戏 {game_id} 的输出队列")
            except:
                pass
        
        return True
    except Exception as e:
        logger.error(f"清理游戏 {game_id} 安装终端日志失败: {str(e)}")
        return False

# 文件管理相关的API路由

@app.route('/api/files', methods=['GET'])
def list_files():
    """列出指定目录下的文件和子目录"""
    try:
        path = request.args.get('path', '/home/steam')
        
        # 安全检查：防止目录遍历攻击
        if '..' in path or not path.startswith('/'):
            # 返回默认目录内容而不是错误
            logger.warning(f"检测到无效路径: {path}，已自动切换到默认路径")
            path = '/home/steam'
        
        # 确保路径存在
        if not os.path.exists(path):
            # 尝试使用父目录
            parent_path = os.path.dirname(path)
            if parent_path == path:  # 如果已经是根目录
                parent_path = '/home/steam'
                
            logger.warning(f"路径不存在: {path}，尝试切换到父目录: {parent_path}")
            
            if os.path.exists(parent_path) and os.path.isdir(parent_path):
                path = parent_path
            else:
                # 如果父目录也不存在，使用默认目录
                path = '/home/steam'
                logger.warning(f"父目录也不存在，切换到默认目录: {path}")
            
        # 确保是目录
        if not os.path.isdir(path):
            # 如果不是目录，使用其所在的目录
            parent_path = os.path.dirname(path)
            logger.warning(f"路径不是目录: {path}，切换到其所在目录: {parent_path}")
            
            if os.path.exists(parent_path) and os.path.isdir(parent_path):
                path = parent_path
            else:
                # 如果父目录不是有效目录，使用默认目录
                path = '/home/steam'
                logger.warning(f"父目录不是有效目录，切换到默认目录: {path}")
            
        # 获取目录内容
        items = []
        for name in os.listdir(path):
            full_path = os.path.join(path, name)
            stat_result = os.stat(full_path)
            
            # 确定类型
            item_type = 'directory' if os.path.isdir(full_path) else 'file'
            
            # 获取修改时间
            mtime = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stat_result.st_mtime))
            
            # 获取文件大小（对于目录，大小为0）
            size = 0 if item_type == 'directory' else stat_result.st_size
            
            items.append({
                'name': name,
                'path': full_path,
                'type': item_type,
                'size': size,
                'modified': mtime
            })
            
        # 按照类型和名称排序，先显示目录，再显示文件
        items.sort(key=lambda x: (0 if x['type'] == 'directory' else 1, x['name']))
        
        return jsonify({'status': 'success', 'files': items, 'path': path})
        
    except Exception as e:
        logger.error(f"列出文件时出错: {str(e)}")
        # 发生错误时，尝试返回默认目录
        try:
            default_path = '/home/steam'
            default_items = []
            for name in os.listdir(default_path):
                full_path = os.path.join(default_path, name)
                stat_result = os.stat(full_path)
                
                item_type = 'directory' if os.path.isdir(full_path) else 'file'
                mtime = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stat_result.st_mtime))
                size = 0 if item_type == 'directory' else stat_result.st_size
                
                default_items.append({
                    'name': name,
                    'path': full_path,
                    'type': item_type,
                    'size': size,
                    'modified': mtime
                })
                
            default_items.sort(key=lambda x: (0 if x['type'] == 'directory' else 1, x['name']))
            
            return jsonify({
                'status': 'success', 
                'files': default_items, 
                'path': default_path,
                'message': f'原路径出错，已切换到默认路径: {str(e)}'
            })
        except Exception as inner_e:
            logger.error(f"尝试使用默认路径也失败: {str(inner_e)}")
            return jsonify({'status': 'error', 'message': f'无法列出文件: {str(e)}'})

@app.route('/api/open_folder', methods=['GET'])
def open_folder():
    """在客户端打开指定的文件夹"""
    try:
        path = request.args.get('path', '/home/steam')
        
        # 安全检查
        if not path or '..' in path or not path.startswith('/'):
            return jsonify({'status': 'error', 'message': '无效的文件夹路径'})
            
        # 确保目录存在
        if not os.path.exists(path):
            return jsonify({'status': 'error', 'message': '文件夹不存在'})
            
        # 确保是目录
        if not os.path.isdir(path):
            return jsonify({'status': 'error', 'message': '路径不是文件夹'})
        
        # 在这里，我们只返回路径信息，因为在Web应用中无法直接打开客户端的文件夹
        # 实际的打开操作将在前端通过专门的功能（例如electron的shell.openPath）完成
        return jsonify({
            'status': 'success', 
            'path': path,
            'message': '请求打开文件夹'
        })
        
    except Exception as e:
        logger.error(f"请求打开文件夹时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'无法打开文件夹: {str(e)}'})

@app.route('/api/file_content', methods=['GET'])
def get_file_content():
    """获取文件内容"""
    try:
        path = request.args.get('path')
        
        # 安全检查
        if not path or '..' in path or not path.startswith('/'):
            return jsonify({'status': 'error', 'message': '无效的文件路径'})
            
        # 确保文件存在且是文件
        if not os.path.exists(path):
            return jsonify({'status': 'error', 'message': '文件不存在'})
            
        if not os.path.isfile(path):
            return jsonify({'status': 'error', 'message': '路径不是文件'})
            
        # 检查文件大小，防止读取过大的文件
        if os.path.getsize(path) > 10 * 1024 * 1024:  # 10MB限制
            return jsonify({'status': 'error', 'message': '文件过大，无法读取'})
            
        # 读取文件内容
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
            
        return jsonify({'status': 'success', 'content': content})
        
    except Exception as e:
        logger.error(f"读取文件内容时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'读取文件失败: {str(e)}'})

@app.route('/api/save_file', methods=['POST'])
def save_file_content():
    """保存文件内容"""
    try:
        data = request.json
        path = data.get('path')
        content = data.get('content', '')
        
        # 安全检查
        if not path or '..' in path or not path.startswith('/'):
            return jsonify({'status': 'error', 'message': '无效的文件路径'})
            
        # 确保目录存在
        dir_path = os.path.dirname(path)
        if not os.path.exists(dir_path):
            os.makedirs(dir_path)
            
        # 写入文件
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
            
        return jsonify({'status': 'success'})
        
    except Exception as e:
        logger.error(f"保存文件内容时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'保存文件失败: {str(e)}'})

@app.route('/api/copy', methods=['POST'])
def copy_item():
    """复制文件或目录"""
    try:
        data = request.json
        source_path = data.get('sourcePath')
        destination_path = data.get('destinationPath')
        
        # 安全检查
        if not source_path or not destination_path or '..' in source_path or '..' in destination_path:
            return jsonify({'status': 'error', 'message': '无效的路径'})
            
        if not source_path.startswith('/') or not destination_path.startswith('/'):
            return jsonify({'status': 'error', 'message': '路径必须是绝对路径'})
            
        # 确保源路径存在
        if not os.path.exists(source_path):
            return jsonify({'status': 'error', 'message': '源路径不存在'})
            
        # 如果目标路径已存在，先删除
        if os.path.exists(destination_path):
            if os.path.isdir(destination_path):
                shutil.rmtree(destination_path)
            else:
                os.remove(destination_path)
                
        # 复制文件或目录
        if os.path.isdir(source_path):
            shutil.copytree(source_path, destination_path)
        else:
            shutil.copy2(source_path, destination_path)
            
        return jsonify({'status': 'success'})
        
    except Exception as e:
        logger.error(f"复制文件/目录时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'复制失败: {str(e)}'})

@app.route('/api/move', methods=['POST'])
def move_item():
    """移动文件或目录"""
    try:
        data = request.json
        source_path = data.get('sourcePath')
        destination_path = data.get('destinationPath')
        
        # 安全检查
        if not source_path or not destination_path or '..' in source_path or '..' in destination_path:
            return jsonify({'status': 'error', 'message': '无效的路径'})
            
        if not source_path.startswith('/') or not destination_path.startswith('/'):
            return jsonify({'status': 'error', 'message': '路径必须是绝对路径'})
            
        # 确保源路径存在
        if not os.path.exists(source_path):
            return jsonify({'status': 'error', 'message': '源路径不存在'})
            
        # 如果目标路径已存在，先删除
        if os.path.exists(destination_path):
            if os.path.isdir(destination_path):
                shutil.rmtree(destination_path)
            else:
                os.remove(destination_path)
                
        # 移动文件或目录
        shutil.move(source_path, destination_path)
            
        return jsonify({'status': 'success'})
        
    except Exception as e:
        logger.error(f"移动文件/目录时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'移动失败: {str(e)}'})

@app.route('/api/delete', methods=['POST'])
def delete_item():
    """删除文件或目录"""
    try:
        data = request.json
        path = data.get('path')
        item_type = data.get('type')
        
        # 安全检查
        if not path or '..' in path or not path.startswith('/'):
            return jsonify({'status': 'error', 'message': '无效的路径'})
            
        # 确保路径存在
        if not os.path.exists(path):
            return jsonify({'status': 'error', 'message': '路径不存在'})
            
        # 删除文件或目录
        if item_type == 'directory' or os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
            
        return jsonify({'status': 'success'})
        
    except Exception as e:
        logger.error(f"删除文件/目录时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'删除失败: {str(e)}'})

@app.route('/api/create_folder', methods=['POST'])
def create_folder():
    """创建文件夹"""
    try:
        data = request.json
        path = data.get('path')
        
        # 安全检查
        if not path or '..' in path or not path.startswith('/'):
            return jsonify({'status': 'error', 'message': '无效的路径'})
            
        # 如果目录已存在，返回错误
        if os.path.exists(path):
            return jsonify({'status': 'error', 'message': '目录已存在'})
            
        # 创建目录
        os.makedirs(path)
            
        return jsonify({'status': 'success'})
        
    except Exception as e:
        logger.error(f"创建文件夹时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'创建文件夹失败: {str(e)}'})

@app.route('/api/rename', methods=['POST'])
def rename_item():
    """重命名文件或目录"""
    try:
        data = request.json
        old_path = data.get('oldPath')
        new_path = data.get('newPath')
        
        # 安全检查
        if not old_path or not new_path or '..' in old_path or '..' in new_path:
            return jsonify({'status': 'error', 'message': '无效的路径'})
            
        if not old_path.startswith('/') or not new_path.startswith('/'):
            return jsonify({'status': 'error', 'message': '路径必须是绝对路径'})
            
        # 确保源路径存在
        if not os.path.exists(old_path):
            return jsonify({'status': 'error', 'message': '源路径不存在'})
            
        # 如果目标路径已存在，返回错误
        if os.path.exists(new_path):
            return jsonify({'status': 'error', 'message': '目标路径已存在'})
            
        # 重命名文件或目录
        os.rename(old_path, new_path)
            
        return jsonify({'status': 'success'})
        
    except Exception as e:
        logger.error(f"重命名文件/目录时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'重命名失败: {str(e)}'})

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """上传文件"""
    try:
        # 获取目标目录
        path = request.args.get('path', '/home/steam')
        
        # 获取认证令牌
        token_param = request.args.get('token')
        auth_header = request.headers.get('Authorization')
        
        # 检查认证
        token = None
        if auth_header:
            parts = auth_header.split()
            if len(parts) == 2 and parts[0].lower() == 'bearer':
                token = parts[1]
                
        if not token and token_param:
            token = token_param
            
        if not token:
            logger.warning(f"上传文件请求缺少认证令牌: {path}")
            return jsonify({'status': 'error', 'message': '未授权的访问，请先登录'}), 401
            
        # 验证令牌
        payload = verify_token(token)
        if not payload:
            logger.warning(f"上传文件请求的令牌无效: {path}")
            return jsonify({'status': 'error', 'message': '令牌无效或已过期，请重新登录'}), 401
            
        # 认证通过，将用户信息保存到g对象
        g.user = payload
            
        # 安全检查
        if not path or '..' in path or not path.startswith('/'):
            return jsonify({'status': 'error', 'message': '无效的目标路径'}), 400
            
        # 确保目录存在
        if not os.path.exists(path):
            return jsonify({'status': 'error', 'message': '目标目录不存在'}), 400
            
        if not os.path.isdir(path):
            return jsonify({'status': 'error', 'message': '目标路径不是目录'}), 400
            
        # 检查是否有文件
        if 'file' not in request.files:
            return jsonify({'status': 'error', 'message': '没有文件'}), 400
            
        file = request.files['file']
        
        # 如果用户没有选择文件
        if file.filename == '':
            return jsonify({'status': 'error', 'message': '没有选择文件'}), 400
            
        # 安全处理文件名
        filename = secure_filename(file.filename)
        
        # 保存文件
        file_path = os.path.join(path, filename)
        file.save(file_path)
        
        logger.info(f"文件已上传: {file_path}, 用户: {payload.get('username')}")
        
        return jsonify({'status': 'success', 'message': '文件上传成功'})
        
    except Exception as e:
        logger.error(f"上传文件时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'上传文件失败: {str(e)}'}), 500

@app.route('/api/download', methods=['GET'])
def download_file():
    """下载文件"""
    try:
        # 从参数中获取文件路径和预览选项
        path = request.args.get('path')
        preview = request.args.get('preview', 'false').lower() == 'true'
        
        # logger.debug(f"下载文件请求: path={path}, preview={preview}, token={request.args.get('token', '')[:5]}...")
        
        # 安全检查
        if not path or '..' in path or not path.startswith('/'):
            return jsonify({'status': 'error', 'message': '无效的文件路径'}), 400
            
        # 确保文件存在
        if not os.path.exists(path):
            return jsonify({'status': 'error', 'message': '文件不存在'}), 404
            
        if not os.path.isfile(path):
            return jsonify({'status': 'error', 'message': '路径不是文件'}), 400
            
        # 获取文件名
        filename = os.path.basename(path)
        
        # 检查是否为图片预览
        if preview:
            # 获取文件MIME类型
            file_ext = os.path.splitext(path)[1].lower()
            mime_type = None
            
            # 设置常见图片文件的MIME类型
            if file_ext in ['.jpg', '.jpeg']:
                mime_type = 'image/jpeg'
            elif file_ext == '.png':
                mime_type = 'image/png'
            elif file_ext == '.gif':
                mime_type = 'image/gif'
            elif file_ext == '.bmp':
                mime_type = 'image/bmp'
            elif file_ext == '.webp':
                mime_type = 'image/webp'
            elif file_ext == '.svg':
                mime_type = 'image/svg+xml'
            
            # 对于图片文件，如果是预览模式，设置合适的Content-Type
            if preview and mime_type.startswith('image/'):
                # logger.debug(f"预览图片: {path}, MIME类型: {mime_type}")
                return send_file(path, mimetype=mime_type)
            else:
                # logger.debug(f"下载文件: {path}, 文件名: {filename}")
                return send_file(path, as_attachment=True, download_name=filename, mimetype=mime_type)
        
        # 发送文件作为附件下载
        # logger.debug(f"下载文件: {path}, 文件名: {filename}")
        return send_file(path, as_attachment=True, download_name=filename)
        
    except Exception as e:
        logger.error(f"下载文件时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'下载文件失败: {str(e)}'}), 500

@app.route('/api/compress', methods=['POST'])
def compress_files():
    """压缩文件，支持多种格式"""
    try:
        data = request.json
        paths = data.get('paths', [])
        current_path = data.get('currentPath', '')
        format = data.get('format', 'zip')  # 默认使用zip格式
        level = data.get('level', 6)  # 默认压缩级别
        
        # 创建临时目录用于存放压缩文件
        temp_dir = tempfile.mkdtemp()
        
        # 根据格式选择文件扩展名
        if format == 'zip':
            ext = '.zip'
        elif format == 'tar':
            ext = '.tar'
        elif format == 'tgz':
            ext = '.tar.gz'
        elif format == 'tbz2':
            ext = '.tar.bz2'
        elif format == 'txz':
            ext = '.tar.xz'
        elif format == 'tzst':
            ext = '.tar.zst'
        else:
            ext = '.zip'
            
        # 生成临时文件名
        temp_file = os.path.join(temp_dir, f'archive_{int(time.time())}{ext}')
        
        # 检查所有路径是否合法
        for path in paths:
            if not path.startswith('/') or '..' in path:
                return jsonify({'status': 'error', 'message': '无效的文件路径'}), 400
            if not os.path.exists(path):
                return jsonify({'status': 'error', 'message': f'文件不存在: {path}'}), 404
                
        # 获取所有文件的共同父目录
        common_path = os.path.commonpath([os.path.abspath(p) for p in paths])
        
        if format == 'zip':
            # 使用ZIP格式压缩
            with zipfile.ZipFile(temp_file, 'w', zipfile.ZIP_DEFLATED, compresslevel=level) as zipf:
                for path in paths:
                    if os.path.isfile(path):
                        # 添加文件
                        arcname = os.path.relpath(path, common_path)
                        zipf.write(path, arcname)
                    elif os.path.isdir(path):
                        # 添加目录及其内容
                        for root, dirs, files in os.walk(path):
                            for file in files:
                                file_path = os.path.join(root, file)
                                arcname = os.path.relpath(file_path, common_path)
                                zipf.write(file_path, arcname)
                                
        elif format in ['tar', 'tgz', 'tbz2', 'txz']:
            # 使用TAR格式压缩
            mode = 'w:'
            if format == 'tgz':
                mode = 'w:gz'
            elif format == 'tbz2':
                mode = 'w:bz2'
            elif format == 'txz':
                mode = 'w:xz'
                
            with tarfile.open(temp_file, mode) as tarf:
                for path in paths:
                    # 添加文件或目录
                    arcname = os.path.relpath(path, common_path)
                    tarf.add(path, arcname=arcname)
                    
        elif format == 'tzst':
            # 使用TAR+ZSTD格式压缩
            # 首先创建tar文件
            tar_temp = os.path.join(temp_dir, 'temp.tar')
            with tarfile.open(tar_temp, 'w') as tarf:
                for path in paths:
                    arcname = os.path.relpath(path, common_path)
                    tarf.add(path, arcname=arcname)
            
            # 然后用zstd压缩tar文件
            cctx = zstd.ZstdCompressor(level=level)
            with open(tar_temp, 'rb') as tar_data:
                with open(temp_file, 'wb') as compressed:
                    cctx.copy_stream(tar_data, compressed)
            
            # 删除临时tar文件
            os.unlink(tar_temp)
            
        return jsonify({
            'status': 'success',
            'message': '文件已压缩',
            'zipPath': temp_file
        })
        
    except Exception as e:
        logger.error(f"压缩文件时出错: {str(e)}")
        # 清理临时文件
        if 'temp_file' in locals() and os.path.exists(temp_file):
            os.unlink(temp_file)
        if 'temp_dir' in locals() and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        return jsonify({'status': 'error', 'message': f'压缩文件失败: {str(e)}'}), 500

@app.route('/api/install_by_appid', methods=['POST'])
def install_by_appid():
    """通过AppID安装游戏"""
    try:
        data = request.json
        app_id = data.get('appid')
        game_name = data.get('name')
        anonymous = data.get('anonymous', True)
        account = data.get('account')
        password = data.get('password')
        
        if not app_id or not game_name:
            logger.error("缺少AppID或游戏名称")
            return jsonify({'status': 'error', 'message': '缺少AppID或游戏名称'}), 400
            
        logger.info(f"请求通过AppID安装游戏: AppID={app_id}, 名称={game_name}, 匿名={anonymous}")
        
        # 创建一个唯一的游戏ID
        game_id = f"app_{app_id}"
        
        # 检查是否已经有正在运行的安装进程
        if game_id in active_installations and active_installations[game_id].get('process') and active_installations[game_id]['process'].poll() is None:
            logger.info(f"游戏 {game_id} 已经在安装中")
            return jsonify({
                'status': 'success', 
                'message': f'游戏 {game_id} 已经在安装中'
            })
            
        # 清理任何旧的安装数据
        if game_id in active_installations:
            logger.info(f"清理游戏 {game_id} 的旧安装数据")
            old_process = active_installations[game_id].get('process')
            if old_process and old_process.poll() is None:
                try:
                    old_process.terminate()
                except:
                    pass
                    
        # 重置输出队列
        if game_id in output_queues:
            try:
                while not output_queues[game_id].empty():
                    output_queues[game_id].get_nowait()
            except:
                output_queues[game_id] = queue.Queue()
        else:
            output_queues[game_id] = queue.Queue()
            
        # 构建安装命令
        cmd = f"su - steam -c 'python3 {os.path.dirname(__file__)}/direct_installer.py {app_id} {game_id}"
        
        if not anonymous and account:
            cmd += f" --account {shlex.quote(account)}"
            if password:
                cmd += f" --password {shlex.quote(password)}"
        
        cmd += " 2>&1'"
        
        logger.info(f"准备执行命令 (将使用PTY): {cmd}")
        
        # 初始化安装状态跟踪
        active_installations[game_id] = {
            'process': None,
            'output': [],
            'started_at': time.time(),
            'complete': False,
            'cmd': cmd
        }
        
        # 在单独的线程中启动安装进程
        install_thread = threading.Thread(
            target=run_installation,
            args=(game_id, cmd),
            daemon=True
        )
        install_thread.start()
        
        # 添加一个确保安装后权限正确的线程
        def check_and_fix_permissions():
            # 等待安装进程完成
            install_thread.join(timeout=3600)  # 最多等待1小时
            # 检查安装是否已完成
            if game_id in active_installations and active_installations[game_id].get('complete'):
                # 安装完成后，确保游戏目录权限正确
                game_dir = os.path.join(GAMES_DIR, game_id)
                if os.path.exists(game_dir):
                    logger.info(f"安装完成，修复游戏目录权限: {game_dir}")
                    ensure_steam_permissions(game_dir)
                    
        # 启动权限修复线程
        permission_thread = threading.Thread(
            target=check_and_fix_permissions,
            daemon=True
        )
        permission_thread.start()
        
        logger.info(f"游戏 {game_id} 安装进程已启动")
        
        return jsonify({
            'status': 'success', 
            'message': f'游戏 {game_id} 安装已开始'
        })
    except Exception as e:
        logger.error(f"启动通过AppID安装进程失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# 添加检查首次使用和注册的API
@app.route('/api/auth/check_first_use', methods=['GET'])
def check_first_use():
    """检查是否为首次使用，是否需要注册"""
    try:
        # 确保游戏目录存在
        if not os.path.exists(GAMES_DIR):
            try:
                os.makedirs(GAMES_DIR, exist_ok=True)
                logger.info(f"已创建游戏目录: {GAMES_DIR}")
                # 设置目录权限
                os.chmod(GAMES_DIR, 0o755)
                # 设置为steam用户所有
                subprocess.run(['chown', '-R', 'steam:steam', GAMES_DIR])
            except Exception as e:
                logger.error(f"创建游戏目录失败: {str(e)}")
                return jsonify({'status': 'error', 'message': f'创建游戏目录失败: {str(e)}'}), 500
        
        logger.info(f"检查是否首次使用，配置文件路径: {USER_CONFIG_PATH}")
        
        # 检查config.json是否存在
        if not os.path.exists(USER_CONFIG_PATH):
            logger.info(f"配置文件不存在，创建新文件: {USER_CONFIG_PATH}")
            # 创建一个空的config.json文件
            with open(USER_CONFIG_PATH, 'w') as f:
                json.dump({"first_use": True, "users": []}, f, indent=4)
            
            # 设置文件权限
            os.chmod(USER_CONFIG_PATH, 0o644)
            # 设置为steam用户所有
            subprocess.run(['chown', 'steam:steam', USER_CONFIG_PATH])
            
            logger.debug("返回首次使用状态: True (文件不存在)")
            return jsonify({
                'status': 'success',
                'first_use': True,
                'message': '首次使用，需要注册账号'
            })
        
        # 读取config.json
        with open(USER_CONFIG_PATH, 'r') as f:
            config = json.load(f)
            logger.info(f"配置文件内容: {config}")
        
        # 检查是否有用户注册
        if not config.get('users') or len(config.get('users', [])) == 0:
            logger.debug("返回首次使用状态: True (无用户)")
            return jsonify({
                'status': 'success',
                'first_use': True,
                'message': '首次使用，需要注册账号'
            })
        
        logger.debug("返回首次使用状态: False (已有用户)")
        return jsonify({
            'status': 'success',
            'first_use': False,
            'message': '系统已完成初始设置'
        })
        
    except Exception as e:
        logger.error(f"检查首次使用状态失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# 添加注册路由
@app.route('/api/auth/register', methods=['POST'])
def register():
    """用户注册路由"""
    try:
        data = request.json
        logger.info(f"收到注册请求: {data}")
        
        if not data:
            logger.warning("注册请求无效: 缺少请求数据")
            return jsonify({
                'status': 'error',
                'message': '无效的请求'
            }), 400
            
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            logger.warning("注册请求无效: 用户名或密码为空")
            return jsonify({
                'status': 'error',
                'message': '用户名和密码不能为空'
            }), 400
            
        # 确保游戏目录存在
        if not os.path.exists(GAMES_DIR):
            try:
                os.makedirs(GAMES_DIR, exist_ok=True)
                logger.info(f"已创建游戏目录: {GAMES_DIR}")
                # 设置目录权限
                os.chmod(GAMES_DIR, 0o755)
                # 设置为steam用户所有
                subprocess.run(['chown', '-R', 'steam:steam', GAMES_DIR])
            except Exception as e:
                logger.error(f"创建游戏目录失败: {str(e)}")
                return jsonify({'status': 'error', 'message': f'创建游戏目录失败: {str(e)}'}), 500
            
        # 检查config.json是否存在，不存在则创建
        if not os.path.exists(USER_CONFIG_PATH):
            logger.info(f"配置文件不存在，创建新文件: {USER_CONFIG_PATH}")
            with open(USER_CONFIG_PATH, 'w') as f:
                json.dump({"first_use": True, "users": []}, f, indent=4)
            # 设置文件权限
            os.chmod(USER_CONFIG_PATH, 0o644)
            # 设置为steam用户所有
            subprocess.run(['chown', 'steam:steam', USER_CONFIG_PATH])
        
        # 读取现有配置
        try:
            with open(USER_CONFIG_PATH, 'r') as f:
                config = json.load(f)
                logger.info(f"读取配置文件成功，内容: {config}")
        except Exception as e:
            logger.warning(f"读取配置文件失败，创建新配置: {str(e)}")
            config = {"first_use": True, "users": []}
        
        # 检查是否已有用户注册，如果有则拒绝新的注册
        users = config.get('users', [])
        if len(users) > 0:
            logger.warning(f"已有用户注册，拒绝新用户注册请求: {username}")
            return jsonify({
                'status': 'error',
                'message': '系统仅允许一个用户注册，已有用户存在'
            }), 403
            
        # 检查用户名是否已存在
        for user in users:
            if user.get('username') == username:
                logger.warning(f"用户名已存在: {username}")
                return jsonify({
                    'status': 'error',
                    'message': '用户名已存在'
                }), 400
        
        # 对密码进行哈希处理
        password_hash, salt = hash_password(password)
        
        # 添加新用户，存储哈希密码和盐值
        new_user = {
            'username': username,
            'password_hash': password_hash,  # 存储哈希后的密码
            'salt': salt,  # 存储盐值
            'role': 'admin' if not users else 'user',  # 第一个注册的用户为管理员
            'created_at': time.time()
        }
        
        logger.info(f"创建新用户: {username}, 角色: {new_user['role']}")
        
        users.append(new_user)
        config['users'] = users
        config['first_use'] = False
        
        # 保存配置
        with open(USER_CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=4)
            logger.info(f"成功保存配置文件，用户数: {len(users)}")
        
        # 设置文件权限
        os.chmod(USER_CONFIG_PATH, 0o644)
        # 设置为steam用户所有
        subprocess.run(['chown', 'steam:steam', USER_CONFIG_PATH])
        
        # 同时也更新用户到auth_middleware中的users.json
        if save_user(new_user):
            logger.info(f"成功保存用户到auth_middleware: {username}")
        else:
            logger.warning(f"保存用户到auth_middleware失败: {username}")
        
        # 生成令牌
        token = generate_token(new_user)
        logger.info(f"生成令牌成功: {username}")
        
        return jsonify({
            'status': 'success',
            'message': '注册成功',
            'token': token,
            'username': username,
            'role': new_user.get('role', 'user')
        })
        
    except Exception as e:
        logger.error(f"注册失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# 修改登录路由，从config.json中验证
@app.route('/api/auth/login', methods=['POST'])
def login():
    """用户登录路由"""
    try:
        data = request.json
        if not data:
            return jsonify({
                'status': 'error',
                'message': '无效的请求'
            }), 400
            
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            return jsonify({
                'status': 'error',
                'message': '用户名和密码不能为空'
            }), 400
            
        # 确保游戏目录存在
        if not os.path.exists(GAMES_DIR):
            try:
                os.makedirs(GAMES_DIR, exist_ok=True)
                logger.info(f"已创建游戏目录: {GAMES_DIR}")
                # 设置目录权限
                os.chmod(GAMES_DIR, 0o755)
                # 设置为steam用户所有
                subprocess.run(['chown', '-R', 'steam:steam', GAMES_DIR])
            except Exception as e:
                logger.error(f"创建游戏目录失败: {str(e)}")
                # 目录创建失败不阻止登录流程
                
        # 检查config.json是否存在，不存在则创建
        is_first_use = False
        if not os.path.exists(USER_CONFIG_PATH):
            with open(USER_CONFIG_PATH, 'w') as f:
                json.dump({"first_use": True, "users": []}, f, indent=4)
            # 设置文件权限
            os.chmod(USER_CONFIG_PATH, 0o644)
            # 设置为steam用户所有
            subprocess.run(['chown', 'steam:steam', USER_CONFIG_PATH])
            is_first_use = True
            
        # 从config.json验证用户
        user = None
        if os.path.exists(USER_CONFIG_PATH):
            try:
                with open(USER_CONFIG_PATH, 'r') as f:
                    config = json.load(f)
                
                # 如果是首次使用，直接返回需要注册的提示
                if is_first_use or not config.get('users'):
                    return jsonify({
                        'status': 'error',
                        'message': '首次使用，请先注册账号',
                        'first_use': True
                    }), 401
                
                users = config.get('users', [])
                for u in users:
                    # 兼容旧版本纯文本密码存储
                    if u.get('username') == username:
                        if 'password_hash' in u and 'salt' in u:
                            # 使用新的哈希验证
                            if verify_password(password, u.get('password_hash'), u.get('salt')):
                                user = u
                                break
                        elif 'password' in u:
                            # 兼容旧的明文密码验证
                            if u.get('password') == password:
                                # 自动升级到哈希存储
                                password_hash, salt = hash_password(password)
                                u['password_hash'] = password_hash
                                u['salt'] = salt
                                del u['password']  # 删除明文密码
                                
                                # 保存更新后的配置
                                with open(USER_CONFIG_PATH, 'w') as fw:
                                    json.dump(config, fw, indent=4)
                                logger.info(f"已升级用户 {username} 的密码存储到哈希格式")
                                
                                user = u
                                break
            except Exception as e:
                logger.error(f"从config.json验证用户失败: {str(e)}")
        
        # 如果没有找到用户或密码不匹配，返回错误
        if not user:
            logger.warning(f"用户名或密码错误: {username}")
            return jsonify({
                'status': 'error',
                'message': '用户名或密码错误'
            }), 401
            
        # 生成令牌
        token = generate_token(user)
        logger.info(f"用户 {username} 登录成功")
        
        return jsonify({
            'status': 'success',
            'token': token,
            'username': username,
            'role': user.get('role', 'user')
        })
    except Exception as e:
        logger.error(f"登录失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/open_game_folder', methods=['GET', 'POST'])
def open_game_folder():
    """在客户端打开指定的文件夹"""
    try:
        # 处理GET请求
        if request.method == 'GET':
            path = request.args.get('path', '/home/steam')
        # 处理POST请求
        else:
            data = request.json
            game_id = data.get('game_id')
            if game_id:
                path = os.path.join(GAMES_DIR, game_id)
            else:
                path = data.get('path', '/home/steam')
        
        # 安全检查
        if not path or '..' in path or not path.startswith('/'):
            return jsonify({'status': 'error', 'message': '无效的文件夹路径'})
            
        # 确保目录存在
        if not os.path.exists(path):
            return jsonify({'status': 'error', 'message': '文件夹不存在'})
            
        # 确保是目录
        if not os.path.isdir(path):
            return jsonify({'status': 'error', 'message': '路径不是文件夹'})
        
        # 在这里，我们只返回路径信息，因为在Web应用中无法直接打开客户端的文件夹
        # 实际的打开操作将在前端通过专门的功能（例如electron的shell.openPath）完成
        return jsonify({
            'status': 'success', 
            'path': path,
            'message': '请求打开文件夹'
        })
        
    except Exception as e:
        logger.error(f"请求打开文件夹时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'无法打开文件夹: {str(e)}'})

# FRP相关API

# 加载FRP配置
def load_frp_configs():
    """加载FRP配置"""
    if not os.path.exists(FRP_CONFIG_FILE):
        return []
    
    try:
        with open(FRP_CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"加载FRP配置失败: {str(e)}")
        return []

# 保存FRP配置
def save_frp_configs(configs):
    """保存FRP配置"""
    try:
        with open(FRP_CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(configs, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"保存FRP配置失败: {str(e)}")
        return False

# 获取FRP状态
def get_frp_status(frp_id):
    """获取FRP状态"""
    if frp_id in running_frp_processes:
        process = running_frp_processes[frp_id]['process']
        if process.poll() is None:  # 进程仍在运行
            return 'running'
    return 'stopped'

# 更新所有FRP状态
def update_all_frp_status():
    """更新所有FRP状态"""
    configs = load_frp_configs()
    updated_configs = []
    
    for config in configs:
        config['status'] = get_frp_status(config['id'])
        updated_configs.append(config)
    
    return updated_configs

# 获取FRP列表
@app.route('/api/frp/list', methods=['GET'])
def list_frp():
    try:
        configs = update_all_frp_status()
        return jsonify({
            'status': 'success',
            'configs': configs
        })
    except Exception as e:
        logger.error(f"获取FRP列表失败: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"获取FRP列表失败: {str(e)}"
        }), 500

# 创建FRP配置
@app.route('/api/frp/create', methods=['POST'])
def create_frp():
    try:
        data = request.json
        name = data.get('name')
        frp_type = data.get('type', 'general')
        command = data.get('command')
        
        if not name or not command:
            return jsonify({
                'status': 'error',
                'message': '配置名称和命令不能为空'
            }), 400
        
        # 生成唯一ID
        frp_id = str(uuid.uuid4())
        
        # 创建新配置
        new_config = {
            'id': frp_id,
            'name': name,
            'type': frp_type,
            'command': command,
            'status': 'stopped',
            'created_at': time.time()
        }
        
        # 加载现有配置并添加新配置
        configs = load_frp_configs()
        configs.append(new_config)
        
        # 保存配置
        if save_frp_configs(configs):
            return jsonify({
                'status': 'success',
                'message': 'FRP配置创建成功',
                'config': new_config
            })
        else:
            return jsonify({
                'status': 'error',
                'message': '保存FRP配置失败'
            }), 500
    except Exception as e:
        logger.error(f"创建FRP配置失败: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"创建FRP配置失败: {str(e)}"
        }), 500

# 启动FRP
@app.route('/api/frp/start', methods=['POST'])
def start_frp():
    try:
        data = request.json
        frp_id = data.get('id')
        
        if not frp_id:
            return jsonify({
                'status': 'error',
                'message': 'FRP ID不能为空'
            }), 400
        
        # 加载配置
        configs = load_frp_configs()
        target_config = None
        
        for config in configs:
            if config['id'] == frp_id:
                target_config = config
                break
        
        if not target_config:
            return jsonify({
                'status': 'error',
                'message': '未找到指定的FRP配置'
            }), 404
        
        # 检查FRP是否已经在运行
        if frp_id in running_frp_processes:
            process = running_frp_processes[frp_id]['process']
            if process.poll() is None:  # 进程仍在运行
                return jsonify({
                    'status': 'success',
                    'message': 'FRP已经在运行中'
                })
        
        # 根据FRP类型选择不同的二进制文件和目录
        frp_binary = FRP_BINARY
        frp_dir = os.path.join(FRP_DIR, "LoCyanFrp")
        
        if target_config['type'] == 'custom':
            frp_binary = CUSTOM_FRP_BINARY
            frp_dir = CUSTOM_FRP_DIR
        elif target_config['type'] == 'mefrp':
            frp_binary = MEFRP_BINARY
            frp_dir = MEFRP_DIR
        elif target_config['type'] == 'sakura':
            frp_binary = SAKURA_BINARY
            frp_dir = SAKURA_DIR
        
        # 确保FRP可执行
        if not os.path.exists(frp_binary):
            return jsonify({
                'status': 'error',
                'message': f'{target_config["type"]}客户端程序不存在'
            }), 500
        
        # 设置可执行权限
        os.chmod(frp_binary, 0o755)
        
        # 创建日志文件
        log_file_path = os.path.join(FRP_LOGS_DIR, f"{frp_id}.log")
        log_file = open(log_file_path, 'w')
        
        # 构建命令
        command = f"{frp_binary} {target_config['command']}"
        
        # 启动FRP进程
        process = subprocess.Popen(
            shlex.split(command),
            stdout=log_file,
            stderr=log_file,
            cwd=frp_dir
        )
        
        # 保存进程信息
        running_frp_processes[frp_id] = {
            'process': process,
            'log_file': log_file_path,
            'started_at': time.time()
        }
        
        # 更新配置状态
        for config in configs:
            if config['id'] == frp_id:
                config['status'] = 'running'
                break
        
        save_frp_configs(configs)
        
        return jsonify({
            'status': 'success',
            'message': 'FRP已启动'
        })
    except Exception as e:
        logger.error(f"启动FRP失败: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"启动FRP失败: {str(e)}"
        }), 500

# 停止FRP
@app.route('/api/frp/stop', methods=['POST'])
def stop_frp():
    try:
        data = request.json
        frp_id = data.get('id')
        
        if not frp_id:
            return jsonify({
                'status': 'error',
                'message': 'FRP ID不能为空'
            }), 400
        
        # 将此FRP标记为人工停止
        manually_stopped_frps.add(frp_id)
        logger.info(f"已将FRP {frp_id} 标记为人工停止")
        
        # 检查FRP是否在运行
        if frp_id not in running_frp_processes:
            return jsonify({
                'status': 'success',
                'message': 'FRP未在运行'
            })
        
        # 获取进程信息
        process_info = running_frp_processes[frp_id]
        process = process_info['process']
        
        # 尝试终止进程
        if process.poll() is None:  # 进程仍在运行
            process.terminate()
            try:
                process.wait(timeout=5)  # 等待进程终止
            except subprocess.TimeoutExpired:
                process.kill()  # 如果超时，强制终止
        
        # 关闭日志文件
        log_file_path = process_info['log_file']
        
        # 从运行列表中移除
        del running_frp_processes[frp_id]
        
        # 更新配置状态
        configs = load_frp_configs()
        for config in configs:
            if config['id'] == frp_id:
                config['status'] = 'stopped'
                break
        
        save_frp_configs(configs)
        
        return jsonify({
            'status': 'success',
            'message': 'FRP已停止'
        })
    except Exception as e:
        logger.error(f"停止FRP失败: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"停止FRP失败: {str(e)}"
        }), 500

# 删除FRP配置
@app.route('/api/frp/delete', methods=['POST'])
def delete_frp():
    try:
        data = request.json
        frp_id = data.get('id')
        
        if not frp_id:
            return jsonify({
                'status': 'error',
                'message': 'FRP ID不能为空'
            }), 400
        
        # 如果FRP正在运行，先停止它
        if frp_id in running_frp_processes:
            process_info = running_frp_processes[frp_id]
            process = process_info['process']
            
            if process.poll() is None:  # 进程仍在运行
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
            
            # 从运行列表中移除
            del running_frp_processes[frp_id]
        
        # 删除日志文件
        log_file_path = os.path.join(FRP_LOGS_DIR, f"{frp_id}.log")
        if os.path.exists(log_file_path):
            os.remove(log_file_path)
        
        # 更新配置
        configs = load_frp_configs()
        configs = [config for config in configs if config['id'] != frp_id]
        save_frp_configs(configs)
        
        return jsonify({
            'status': 'success',
            'message': 'FRP配置已删除'
        })
    except Exception as e:
        logger.error(f"删除FRP配置失败: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"删除FRP配置失败: {str(e)}"
        }), 500

# 获取FRP日志
@app.route('/api/frp/log', methods=['GET'])
def get_frp_log():
    try:
        frp_id = request.args.get('id')
        
        if not frp_id:
            return jsonify({
                'status': 'error',
                'message': 'FRP ID不能为空'
            }), 400
        
        # 获取日志文件路径
        if frp_id in running_frp_processes:
            # 如果FRP正在运行，使用当前日志文件
            log_file_path = running_frp_processes[frp_id]['log_file']
        else:
            # 如果FRP未运行，尝试读取历史日志文件
            log_file_path = os.path.join(FRP_LOGS_DIR, f"{frp_id}.log")
        
        # 检查日志文件是否存在
        if not os.path.exists(log_file_path):
            return jsonify({
                'status': 'success',
                'log': '暂无日志记录'
            })
        
        # 读取日志内容
        with open(log_file_path, 'r', encoding='utf-8', errors='ignore') as f:
            log_content = f.read()
            
        return jsonify({
            'status': 'success',
            'log': log_content
        })
    except Exception as e:
        logger.error(f"获取FRP日志失败: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"获取FRP日志失败: {str(e)}"
        }), 500

# 获取自建FRP配置
@app.route('/api/frp/custom/config', methods=['GET'])
def get_custom_frp_config():
    try:
        if not os.path.exists(CUSTOM_FRP_CONFIG_FILE):
            # 如果配置文件不存在，返回默认配置
            default_config = {
                'serverAddr': '127.0.0.1',
                'serverPort': 7000,
                'token': '',
                'proxies': []
            }
            return jsonify({
                'status': 'success',
                'config': default_config
            })
        
        # 读取配置文件
        with open(CUSTOM_FRP_CONFIG_FILE, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 解析TOML配置
        config = {
            'serverAddr': '',
            'serverPort': 7000,
            'token': '',
            'proxies': []
        }
        
        # 简单解析TOML文件
        lines = content.split('\n')
        current_proxy = None
        
        for line in lines:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            
            if line.startswith('serverAddr'):
                parts = line.split('=', 1)
                if len(parts) == 2:
                    config['serverAddr'] = parts[1].strip().strip('"\'')
            elif line.startswith('serverPort'):
                parts = line.split('=', 1)
                if len(parts) == 2:
                    try:
                        config['serverPort'] = int(parts[1].strip())
                    except ValueError:
                        pass
            elif line.startswith('token'):
                parts = line.split('=', 1)
                if len(parts) == 2:
                    config['token'] = parts[1].strip().strip('"\'')
            elif line.startswith('[[proxies]]'):
                current_proxy = {}
                config['proxies'].append(current_proxy)
            elif current_proxy is not None and '=' in line:
                parts = line.split('=', 1)
                if len(parts) == 2:
                    key = parts[0].strip()
                    value = parts[1].strip().strip('"\'')
                    if key == 'localPort' or key == 'remotePort':
                        try:
                            current_proxy[key] = int(value)
                        except ValueError:
                            current_proxy[key] = value
                    else:
                        current_proxy[key] = value
        
        return jsonify({
            'status': 'success',
            'config': config
        })
    except Exception as e:
        logger.error(f"获取自建FRP配置失败: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"获取自建FRP配置失败: {str(e)}"
        }), 500

# 保存自建FRP配置
@app.route('/api/frp/custom/config', methods=['POST'])
def save_custom_frp_config():
    try:
        data = request.json
        server_addr = data.get('serverAddr')
        server_port = data.get('serverPort')
        token = data.get('token', '')
        proxies = data.get('proxies', [])
        
        if not server_addr:
            return jsonify({
                'status': 'error',
                'message': '服务器地址不能为空'
            }), 400
        
        # 生成TOML配置
        config_content = f'serverAddr = "{server_addr}"\n'
        config_content += f'serverPort = {server_port}\n'
        
        if token:
            config_content += f'token = "{token}"\n'
        
        # 添加代理配置
        for proxy in proxies:
            config_content += '\n[[proxies]]\n'
            for key, value in proxy.items():
                if isinstance(value, str):
                    config_content += f'{key} = "{value}"\n'
                else:
                    config_content += f'{key} = {value}\n'
        
        # 保存配置文件
        with open(CUSTOM_FRP_CONFIG_FILE, 'w', encoding='utf-8') as f:
            f.write(config_content)
        
        return jsonify({
            'status': 'success',
            'message': '自建FRP配置保存成功'
        })
    except Exception as e:
        logger.error(f"保存自建FRP配置失败: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"保存自建FRP配置失败: {str(e)}"
        }), 500

# 启动自建FRP
@app.route('/api/frp/custom/start', methods=['POST'])
def start_custom_frp():
    try:
        # 生成唯一ID
        frp_id = 'custom_frp'
        
        # 检查FRP是否已经在运行
        if frp_id in running_frp_processes:
            process = running_frp_processes[frp_id]['process']
            if process.poll() is None:  # 进程仍在运行
                return jsonify({
                    'status': 'success',
                    'message': '自建FRP已经在运行中'
                })
        
        # 确保FRP可执行
        if not os.path.exists(CUSTOM_FRP_BINARY):
            return jsonify({
                'status': 'error',
                'message': '自建FRP客户端程序不存在'
            }), 500
        
        # 设置可执行权限
        os.chmod(CUSTOM_FRP_BINARY, 0o755)
        
        # 创建日志文件
        log_file_path = os.path.join(FRP_LOGS_DIR, f"{frp_id}.log")
        log_file = open(log_file_path, 'w')
        
        # 构建命令
        command = f"{CUSTOM_FRP_BINARY} -c {CUSTOM_FRP_CONFIG_FILE}"
        
        # 启动FRP进程
        process = subprocess.Popen(
            shlex.split(command),
            stdout=log_file,
            stderr=log_file,
            cwd=CUSTOM_FRP_DIR
        )
        
        # 保存进程信息
        running_frp_processes[frp_id] = {
            'process': process,
            'log_file': log_file_path,
            'started_at': time.time()
        }
        
        # 更新配置状态
        configs = load_frp_configs()
        for config in configs:
            if config['id'] == frp_id:
                config['status'] = 'running'
                break
        
        save_frp_configs(configs)
        
        return jsonify({
            'status': 'success',
            'message': '自建FRP已启动'
        })
    except Exception as e:
        logger.error(f"启动自建FRP失败: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"启动自建FRP失败: {str(e)}"
        }), 500

# 停止自建FRP
@app.route('/api/frp/custom/stop', methods=['POST'])
def stop_custom_frp():
    try:
        frp_id = 'custom_frp'
        
        # 将自建FRP标记为人工停止
        manually_stopped_frps.add(frp_id)
        logger.info(f"已将自建FRP {frp_id} 标记为人工停止")
        
        # 检查FRP是否在运行
        if frp_id not in running_frp_processes:
            return jsonify({
                'status': 'success',
                'message': '自建FRP未在运行'
            })
        
        # 获取进程信息
        process_info = running_frp_processes[frp_id]
        process = process_info['process']
        
        # 尝试终止进程
        if process.poll() is None:  # 进程仍在运行
            process.terminate()
            try:
                process.wait(timeout=5)  # 等待进程终止
            except subprocess.TimeoutExpired:
                process.kill()  # 如果超时，强制终止
        
        # 从运行列表中移除
        del running_frp_processes[frp_id]
        
        return jsonify({
            'status': 'success',
            'message': '自建FRP已停止'
        })
    except Exception as e:
        logger.error(f"停止自建FRP失败: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"停止自建FRP失败: {str(e)}"
        }), 500

# 获取自建FRP状态
@app.route('/api/frp/custom/status', methods=['GET'])
def get_custom_frp_status():
    try:
        frp_id = 'custom_frp'
        status = get_frp_status(frp_id)
        
        return jsonify({
            'status': 'success',
            'frp_status': status
        })
    except Exception as e:
        logger.error(f"获取自建FRP状态失败: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"获取自建FRP状态失败: {str(e)}"
        }), 500

@app.route('/api/extract', methods=['POST'])
def extract_archive():
    """解压缩文件，支持多种格式"""
    try:
        data = request.json
        file_path = data.get('path')
        target_dir = data.get('targetDir')
        
        # 安全检查
        if not file_path or '..' in file_path or not file_path.startswith('/'):
            return jsonify({'status': 'error', 'message': '无效的文件路径'}), 400
            
        if not target_dir or '..' in target_dir or not target_dir.startswith('/'):
            return jsonify({'status': 'error', 'message': '无效的目标目录'}), 400
            
        # 确保文件存在
        if not os.path.exists(file_path):
            return jsonify({'status': 'error', 'message': '文件不存在'}), 404
            
        if not os.path.isfile(file_path):
            return jsonify({'status': 'error', 'message': '路径不是文件'}), 400
            
        # 确保目标目录存在
        if not os.path.exists(target_dir):
            os.makedirs(target_dir)
        elif not os.path.isdir(target_dir):
            return jsonify({'status': 'error', 'message': '目标路径不是目录'}), 400
            
        # 获取文件扩展名
        file_ext = os.path.splitext(file_path)[1].lower()
        file_name = os.path.basename(file_path)
        
        # 特别处理.tar.gz、.tar.xz和.tar.zst格式
        if file_path.endswith('.tar.gz') or file_path.endswith('.tar.xz') or file_path.endswith('.tar.zst'):
            if file_path.endswith('.tar.gz'):
                mode = 'r:gz'
            elif file_path.endswith('.tar.xz'):
                mode = 'r:xz'
            elif file_path.endswith('.tar.zst'):
                # 对于tar.zst，我们需要先解压zst，然后再解压tar
                with open(file_path, 'rb') as compressed:
                    dctx = zstd.ZstdDecompressor()
                    with tempfile.NamedTemporaryFile(delete=False) as tmp:
                        dctx.copy_stream(compressed, tmp)
                        tmp_path = tmp.name
                
                try:
                    with tarfile.open(tmp_path, 'r:') as tarf:
                        tarf.extractall(target_dir)
                finally:
                    os.unlink(tmp_path)
                return jsonify({
                    'status': 'success',
                    'message': '文件已解压',
                    'targetDir': target_dir
                })
                
            with tarfile.open(file_path, mode) as tarf:
                tarf.extractall(target_dir)
            return jsonify({
                'status': 'success',
                'message': '文件已解压',
                'targetDir': target_dir
            })
            
        # 根据文件扩展名选择解压方法
        if file_ext in ['.zip', '.jar', '.apk']:
            # 处理ZIP文件
            with zipfile.ZipFile(file_path, 'r') as zipf:
                zipf.extractall(target_dir)
                
        elif file_ext in ['.tar']:
            # 处理TAR文件
            with tarfile.open(file_path, 'r') as tarf:
                tarf.extractall(target_dir)
                
        elif file_ext in ['.gz', '.tgz']:
            # 处理TAR.GZ文件
            if file_ext == '.tgz' or file_path.endswith('.tar.gz'):
                with tarfile.open(file_path, 'r:gz') as tarf:
                    tarf.extractall(target_dir)
            else:
                # 处理单个gzip文件
                with gzip.open(file_path, 'rb') as f_in:
                    # 提取不带.gz扩展名的原始文件名
                    output_file = os.path.join(target_dir, os.path.splitext(file_name)[0])
                    with open(output_file, 'wb') as f_out:
                        shutil.copyfileobj(f_in, f_out)
                        
        elif file_ext in ['.bz2']:
            # 处理TAR.BZ2或单个BZ2文件
            if file_path.endswith('.tar.bz2'):
                with tarfile.open(file_path, 'r:bz2') as tarf:
                    tarf.extractall(target_dir)
            else:
                # 处理单个bzip2文件
                with bz2.open(file_path, 'rb') as f_in:
                    # 提取不带.bz2扩展名的原始文件名
                    output_file = os.path.join(target_dir, os.path.splitext(file_name)[0])
                    with open(output_file, 'wb') as f_out:
                        shutil.copyfileobj(f_in, f_out)
                        
        elif file_ext in ['.xz']:
            # 处理.xz文件
            if file_path.endswith('.tar.xz'):
                with tarfile.open(file_path, 'r:xz') as tarf:
                    tarf.extractall(target_dir)
            else:
                # 处理单个xz文件
                with lzma.open(file_path, 'rb') as f_in:
                    # 提取不带.xz扩展名的原始文件名
                    output_file = os.path.join(target_dir, os.path.splitext(file_name)[0])
                    with open(output_file, 'wb') as f_out:
                        shutil.copyfileobj(f_in, f_out)
                        
        elif file_ext in ['.zst']:
            # 处理.zst文件
            with open(file_path, 'rb') as compressed:
                dctx = zstd.ZstdDecompressor()
                # 提取不带.zst扩展名的原始文件名
                output_file = os.path.join(target_dir, os.path.splitext(file_name)[0])
                with open(output_file, 'wb') as f_out:
                    dctx.copy_stream(compressed, f_out)
                        
        elif file_ext in ['.rar']:
            # 处理RAR文件，需要安装python-rarfile库
            try:
                with rarfile.RarFile(file_path) as rf:
                    rf.extractall(target_dir)
            except ImportError:
                # 如果没有安装rarfile库，尝试使用unrar命令
                try:
                    subprocess.run(['unrar', 'x', file_path, target_dir], check=True)
                except (subprocess.SubprocessError, FileNotFoundError):
                    return jsonify({
                        'status': 'error', 
                        'message': '解压RAR文件失败，系统未安装rarfile模块或unrar命令'
                    }), 500
                    
        elif file_ext in ['.7z']:
            # 处理7z文件，需要系统安装p7zip
            try:
                subprocess.run(['7z', 'x', file_path, '-o' + target_dir], check=True)
            except (subprocess.SubprocessError, FileNotFoundError):
                return jsonify({
                    'status': 'error', 
                    'message': '解压7Z文件失败，系统未安装7z命令'
                }), 500
                
        else:
            return jsonify({
                'status': 'error', 
                'message': f'不支持的文件格式: {file_ext}'
            }), 400
            
        logger.info(f"文件已解压: {file_path} -> {target_dir}")
        
        return jsonify({
            'status': 'success',
            'message': '文件已解压',
            'targetDir': target_dir
        })
        
    except Exception as e:
        logger.error(f"解压文件时出错: {str(e)}")
        return jsonify({'status': 'error', 'message': f'解压文件失败: {str(e)}'}), 500

@app.route('/api/chmod', methods=['POST'])
def change_permissions():
    """修改文件或目录的权限"""
    try:
        data = request.json
        path = data.get('path')
        mode = data.get('mode')  # 数字形式的权限，如：0o755
        recursive = data.get('recursive', False)  # 是否递归修改子目录和文件
        
        # 安全检查
        if not path or '..' in path or not path.startswith('/'):
            return jsonify({'status': 'error', 'message': '无效的文件路径'}), 400
            
        if not os.path.exists(path):
            return jsonify({'status': 'error', 'message': '文件或目录不存在'}), 404
            
        if not isinstance(mode, int):
            try:
                # 如果传入的是字符串，尝试转换为整数
                mode = int(str(mode), 8)
            except ValueError:
                return jsonify({'status': 'error', 'message': '无效的权限值'}), 400

        if recursive and os.path.isdir(path):
            # 递归修改目录及其内容的权限
            for root, dirs, files in os.walk(path):
                # 修改目录权限
                os.chmod(root, mode)
                # 修改文件权限
                for file in files:
                    os.chmod(os.path.join(root, file), mode)
        else:
            # 仅修改当前文件或目录的权限
            os.chmod(path, mode)
            
        # 获取更新后的权限
        current_mode = stat.S_IMODE(os.stat(path).st_mode)
        
        return jsonify({
            'status': 'success',
            'message': '权限修改成功',
            'path': path,
            'mode': oct(current_mode)
        })
        
    except Exception as e:
        logger.error(f"修改权限失败: {str(e)}")
        return jsonify({'status': 'error', 'message': f'修改权限失败: {str(e)}'}), 500

@app.route('/api/server/start_steamcmd', methods=['POST'])
def start_steamcmd():
    """启动SteamCMD"""
    try:
        logger.info("请求启动SteamCMD")
        
        # SteamCMD目录
        steamcmd_dir = "/home/steam/steamcmd"
        steamcmd_path = os.path.join(steamcmd_dir, "steamcmd.sh")
        
        # 检查steamcmd.sh是否存在
        if not os.path.exists(steamcmd_path):
            logger.error(f"SteamCMD不存在: {steamcmd_path}")
            return jsonify({'status': 'error', 'message': f'SteamCMD不存在，请确保系统中已安装SteamCMD'}), 400
            
        # 确保steamcmd.sh有执行权限
        if not os.access(steamcmd_path, os.X_OK):
            logger.info(f"添加SteamCMD执行权限: {steamcmd_path}")
            os.chmod(steamcmd_path, 0o755)
        
        # 固定的游戏ID用于steamcmd
        game_id = "steamcmd"
        process_id = f"server_{game_id}"
        
        # 首先检查PTY管理器中是否存在该进程ID
        if pty_manager.get_process(process_id):
            logger.info(f"PTY管理器中存在进程ID {process_id}，但可能是残留的记录")
            # 移除PTY管理器中的进程记录
            pty_manager.remove_process(process_id)
            logger.info(f"已从PTY管理器中移除可能残留的进程记录: {process_id}")
        
        # 检查running_servers字典中是否存在steamcmd
        if game_id in running_servers:
            server_data = running_servers[game_id]
            process = server_data.get('process')
            
            # 检查进程是否仍在运行
            if process and process.poll() is None:
                logger.info(f"SteamCMD已经在运行中")
                return jsonify({
                    'status': 'success', 
                    'message': 'SteamCMD已经在运行中',
                    'already_running': True
                })
            else:
                # 进程已结束，但字典中仍有记录，清理旧数据
                logger.info(f"清理SteamCMD的旧运行数据")
                
                # 尝试终止任何可能仍在运行的进程
                try:
                    if process and process.poll() is None:
                        process.terminate()
                        time.sleep(0.5)
                        if process.poll() is None:
                            process.kill()
                except Exception as e:
                    logger.warning(f"终止旧进程时出错: {str(e)}")
                
                # 从字典中移除
                del running_servers[game_id]
        
        # 清理输出队列
        if game_id in server_output_queues:
            try:
                while not server_output_queues[game_id].empty():
                    server_output_queues[game_id].get_nowait()
            except:
                server_output_queues[game_id] = queue.Queue()
        else:
            server_output_queues[game_id] = queue.Queue()
            
        # 构建启动命令，确保以steam用户运行
        cmd = f"su - steam -c 'cd {steamcmd_dir} && ./steamcmd.sh'"
        logger.debug(f"准备执行命令 (将使用PTY): {cmd}")
        
        # 初始化服务器状态跟踪
        running_servers[game_id] = {
            'process': None,
            'output': [],
            'started_at': time.time(),
            'running': True,
            'return_code': None,
            'cmd': cmd,
            'master_fd': None,
            'game_dir': steamcmd_dir,
            'external': False
        }
        
        # 在单独的线程中启动服务器
        server_thread = threading.Thread(
            target=run_game_server,
            args=(game_id, cmd, steamcmd_dir),
            daemon=True
        )
        server_thread.start()
        
        logger.info(f"SteamCMD启动线程已启动")
        time.sleep(0.5)
        server_output_queues[game_id].put("SteamCMD启动中...")
        server_output_queues[game_id].put(f"SteamCMD目录: {steamcmd_dir}")
        server_output_queues[game_id].put(f"启动命令: {cmd}")
        
        # 添加到输出历史
        if 'output' not in running_servers[game_id]:
            running_servers[game_id]['output'] = []
        running_servers[game_id]['output'].append("SteamCMD启动中...")
        running_servers[game_id]['output'].append(f"SteamCMD目录: {steamcmd_dir}")
        running_servers[game_id]['output'].append(f"启动命令: {cmd}")
        
        return jsonify({
            'status': 'success', 
            'message': 'SteamCMD启动已开始'
        })
        
    except Exception as e:
        logger.error(f"启动SteamCMD失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# 密码哈希功能从auth_middleware.py导入

@app.route('/api/network_info', methods=['GET'])
def get_network_info():
    """获取网络状态和公网IP信息"""
    try:
        # 获取网络接口信息
        network_interfaces = {}
        for interface, addrs in psutil.net_if_addrs().items():
            # 过滤掉lo接口
            if interface == 'lo':
                continue
                
            network_interfaces[interface] = {
                'addresses': [],
                'status': 'down'  # 默认为down
            }
            
            # 获取地址信息
            for addr in addrs:
                if addr.family == socket.AF_INET:  # IPv4
                    network_interfaces[interface]['addresses'].append({
                        'type': 'ipv4',
                        'address': addr.address,
                        'netmask': addr.netmask
                    })
                elif addr.family == socket.AF_INET6:  # IPv6
                    network_interfaces[interface]['addresses'].append({
                        'type': 'ipv6',
                        'address': addr.address,
                        'netmask': addr.netmask
                    })
        
        # 获取接口状态
        for interface, stats in psutil.net_if_stats().items():
            if interface in network_interfaces:
                network_interfaces[interface]['status'] = 'up' if stats.isup else 'down'
                network_interfaces[interface]['speed'] = stats.speed  # Mbps
                network_interfaces[interface]['duplex'] = stats.duplex
                network_interfaces[interface]['mtu'] = stats.mtu
        
        # 获取公网IP
        public_ip = {
            'ipv4': None,
            'ipv6': None
        }
        
        try:
            # 获取公网IPv4
            ipv4_response = requests.get('https://ipv4.ip.mir6.com', timeout=5)
            if ipv4_response.status_code == 200:
                public_ip['ipv4'] = ipv4_response.text
        except Exception as e:
            logger.warning(f"获取公网IPv4失败: {str(e)}")
            
        try:
            # 获取公网IPv6
            ipv6_response = requests.get('https://ipv6.ip.mir6.com', timeout=5)
            if ipv6_response.status_code == 200:
                public_ip['ipv6'] = ipv6_response.text
        except Exception as e:
            logger.warning(f"获取公网IPv6失败: {str(e)}")
            
        # 获取网络流量统计
        net_io = psutil.net_io_counters(pernic=True)
        io_stats = {}
        
        for interface, stats in net_io.items():
            if interface in network_interfaces:
                io_stats[interface] = {
                    'bytes_sent': stats.bytes_sent,
                    'bytes_recv': stats.bytes_recv,
                    'packets_sent': stats.packets_sent,
                    'packets_recv': stats.packets_recv,
                    'errin': stats.errin,
                    'errout': stats.errout,
                    'dropin': stats.dropin,
                    'dropout': stats.dropout
                }
        
        return jsonify({
            'status': 'success',
            'network_interfaces': network_interfaces,
            'public_ip': public_ip,
            'io_stats': io_stats
        })
    except Exception as e:
        logger.error(f"获取网络信息失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# 添加自启动相关的常量和函数
CONFIG_FILE = "/home/steam/games/config.json"

def load_config():
    """加载配置文件"""
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}
    except Exception as e:
        logger.error(f"加载配置文件失败: {str(e)}")
        return {}

def save_config(config):
    """保存配置文件"""
    try:
        # 确保目录存在
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=4)
        return True
    except Exception as e:
        logger.error(f"保存配置文件失败: {str(e)}")
        return False

@app.route('/api/server/auto_restart', methods=['GET'])
def get_auto_restart_servers():
    """获取自启动服务器列表"""
    try:
        config = load_config()
        auto_restart_servers = config.get('auto_restart_servers', [])
        
        return jsonify({
            'status': 'success',
            'auto_restart_servers': auto_restart_servers
        })
    except Exception as e:
        logger.error(f"获取自启动服务器列表失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/server/set_auto_restart', methods=['POST'])
def set_auto_restart():
    """设置服务器自启动状态"""
    try:
        data = request.json
        game_id = data.get('game_id')
        auto_restart = data.get('auto_restart', False)
        
        if not game_id:
            return jsonify({'status': 'error', 'message': '缺少游戏ID'}), 400
            
        # 加载配置
        config = load_config()
        auto_restart_servers = config.get('auto_restart_servers', [])
        
        if auto_restart:
            # 添加到自启动列表
            if game_id not in auto_restart_servers:
                auto_restart_servers.append(game_id)
                logger.info(f"添加游戏服务器 {game_id} 到自启动列表")
        else:
            # 从自启动列表移除
            if game_id in auto_restart_servers:
                auto_restart_servers.remove(game_id)
                logger.info(f"从自启动列表移除游戏服务器 {game_id}")
        
        # 更新配置
        config['auto_restart_servers'] = auto_restart_servers
        save_config(config)
        
        return jsonify({
            'status': 'success',
            'message': f"已{'开启' if auto_restart else '关闭'}服务端自启动",
            'auto_restart_servers': auto_restart_servers
        })
    except Exception as e:
        logger.error(f"设置自启动状态失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# 添加重启服务器的函数
def restart_server(game_id, cwd):
    """重启游戏服务器"""
    try:
        logger.info(f"准备重启游戏服务器 {game_id}")
        
        # 确保服务器不在人工停止列表中
        if game_id in manually_stopped_servers:
            manually_stopped_servers.discard(game_id)
            logger.info(f"从人工停止列表中移除游戏服务器 {game_id}")
        
        # 等待一小段时间再重启
        time.sleep(3)
        
        # 构建启动命令
        cmd = f"su - steam -c 'cd {cwd} && ./start.sh'"
        
        # 初始化服务器状态跟踪
        running_servers[game_id] = {
            'process': None,
            'output': [],
            'started_at': time.time(),
            'running': True,
            'return_code': None,
            'cmd': cmd,
            'master_fd': None,
            'game_dir': cwd,
            'external': running_servers[game_id].get('external', False) if game_id in running_servers else False
        }
        
        # 在单独的线程中启动服务器
        server_thread = threading.Thread(
            target=run_game_server,
            args=(game_id, cmd, cwd),
            daemon=True
        )
        server_thread.start()
        
        logger.info(f"游戏服务器 {game_id} 重启线程已启动")
        
        # 添加到输出队列
        if game_id in server_output_queues:
            server_output_queues[game_id].put("服务器自动重启中...")
            server_output_queues[game_id].put(f"游戏目录: {cwd}")
            server_output_queues[game_id].put(f"启动命令: {cmd}")
        
        # 添加到输出历史
        if game_id in running_servers:
            if 'output' not in running_servers[game_id]:
                running_servers[game_id]['output'] = []
            running_servers[game_id]['output'].append("服务器自动重启中...")
            running_servers[game_id]['output'].append(f"游戏目录: {cwd}")
            running_servers[game_id]['output'].append(f"启动命令: {cmd}")
    
    except Exception as e:
        logger.error(f"重启游戏服务器 {game_id} 失败: {str(e)}")
        if game_id in running_servers:
            running_servers[game_id]['error'] = str(e)
            running_servers[game_id]['running'] = False

# 获取FRP自启动列表
@app.route('/api/frp/auto_restart', methods=['GET'])
def get_auto_restart_frps():
    """获取自启动内网穿透列表"""
    try:
        config = load_config()
        auto_restart_frps = config.get('auto_restart_frps', [])
        
        return jsonify({
            'status': 'success',
            'auto_restart_frps': auto_restart_frps
        })
    except Exception as e:
        logger.error(f"获取自启动内网穿透列表失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# 设置FRP自启动状态
@app.route('/api/frp/set_auto_restart', methods=['POST'])
def set_frp_auto_restart():
    """设置内网穿透自启动状态"""
    try:
        data = request.json
        frp_id = data.get('frp_id')
        auto_restart = data.get('auto_restart', False)
        
        if not frp_id:
            return jsonify({'status': 'error', 'message': '缺少FRP ID'}), 400
            
        # 加载配置
        config = load_config()
        auto_restart_frps = config.get('auto_restart_frps', [])
        
        if auto_restart:
            # 添加到自启动列表
            if frp_id not in auto_restart_frps:
                auto_restart_frps.append(frp_id)
                logger.info(f"添加内网穿透 {frp_id} 到自启动列表")
        else:
            # 从自启动列表移除
            if frp_id in auto_restart_frps:
                auto_restart_frps.remove(frp_id)
                logger.info(f"从自启动列表移除内网穿透 {frp_id}")
        
        # 更新配置
        config['auto_restart_frps'] = auto_restart_frps
        save_config(config)
        
        return jsonify({
            'status': 'success',
            'message': f"已{'开启' if auto_restart else '关闭'}内网穿透自启动",
            'auto_restart_frps': auto_restart_frps
        })
    except Exception as e:
        logger.error(f"设置内网穿透自启动状态失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# 添加FRP自动重启函数
def restart_frp(frp_id):
    """重启内网穿透"""
    try:
        logger.info(f"准备重启内网穿透 {frp_id}")
        
        # 确保FRP不在人工停止列表中
        if frp_id in manually_stopped_frps:
            manually_stopped_frps.discard(frp_id)
            logger.info(f"从人工停止列表中移除内网穿透 {frp_id}")
        
        # 等待一小段时间再重启
        time.sleep(3)
        
        # 加载配置
        configs = load_frp_configs()
        target_config = None
        
        for config in configs:
            if config['id'] == frp_id:
                target_config = config
                break
        
        if not target_config:
            logger.error(f"未找到内网穿透 {frp_id} 的配置")
            return
        
        # 根据FRP类型选择不同的二进制文件和目录
        frp_binary = FRP_BINARY
        frp_dir = os.path.join(FRP_DIR, "LoCyanFrp")
        
        if target_config['type'] == 'custom':
            frp_binary = CUSTOM_FRP_BINARY
            frp_dir = CUSTOM_FRP_DIR
        elif target_config['type'] == 'mefrp':
            frp_binary = MEFRP_BINARY
            frp_dir = MEFRP_DIR
        elif target_config['type'] == 'sakura':
            frp_binary = SAKURA_BINARY
            frp_dir = SAKURA_DIR
        
        # 确保FRP可执行
        if not os.path.exists(frp_binary):
            logger.error(f"{target_config['type']}客户端程序不存在")
            return
        
        # 设置可执行权限
        os.chmod(frp_binary, 0o755)
        
        # 创建日志文件
        log_file_path = os.path.join(FRP_LOGS_DIR, f"{frp_id}.log")
        log_file = open(log_file_path, 'w')
        
        # 构建命令
        command = f"{frp_binary} {target_config['command']}"
        
        # 启动FRP进程
        process = subprocess.Popen(
            shlex.split(command),
            stdout=log_file,
            stderr=log_file,
            cwd=frp_dir
        )
        
        # 保存进程信息
        running_frp_processes[frp_id] = {
            'process': process,
            'log_file': log_file_path,
            'started_at': time.time()
        }
        
        # 更新配置状态
        for config in configs:
            if config['id'] == frp_id:
                config['status'] = 'running'
                break
        
        save_frp_configs(configs)
        
        logger.info(f"内网穿透 {frp_id} 重启成功")
        
    except Exception as e:
        logger.error(f"重启内网穿透 {frp_id} 失败: {str(e)}")

# 添加FRP进程监控线程
def monitor_frp_processes():
    """监控内网穿透进程，自动重启异常退出的进程"""
    while True:
        try:
            # 加载配置
            config = load_config()
            auto_restart_frps = config.get('auto_restart_frps', [])
            
            # 检查所有运行中的FRP进程
            for frp_id, process_info in list(running_frp_processes.items()):
                process = process_info['process']
                
                # 检查进程是否仍在运行
                if process.poll() is not None:  # 进程已退出
                    logger.info(f"检测到内网穿透 {frp_id} 已退出，返回码: {process.returncode}")
                    
                    # 如果不是人工停止且配置了自启动，则重启
                    if frp_id not in manually_stopped_frps and frp_id in auto_restart_frps:
                        logger.info(f"内网穿透 {frp_id} 异常退出（非人工停止），自动重启中...")
                        restart_frp(frp_id)
                    else:
                        # 如果是人工停止，从列表中移除
                        if frp_id in manually_stopped_frps:
                            manually_stopped_frps.discard(frp_id)
                            logger.info(f"内网穿透 {frp_id} 人工停止，不进行自动重启")
                        
                        # 从运行列表中移除
                        del running_frp_processes[frp_id]
                        
                        # 更新配置状态
                        configs = load_frp_configs()
                        for config in configs:
                            if config['id'] == frp_id:
                                config['status'] = 'stopped'
                                break
                        save_frp_configs(configs)
            
            # 每5秒检查一次
            time.sleep(5)
        except Exception as e:
            logger.error(f"监控内网穿透进程时出错: {str(e)}")
            time.sleep(10)  # 出错时等待更长时间

# 启动FRP监控线程
frp_monitor_thread = threading.Thread(target=monitor_frp_processes, daemon=True)
frp_monitor_thread.start()

if __name__ == '__main__':
    logger.warning("检测到直接运行api_server.py")
    logger.warning("======================================================")
    logger.warning("警告: 不建议直接运行此文件。请使用Gunicorn启动服务器:")
    logger.warning("gunicorn -w 4 -b 0.0.0.0:5000 api_server:app")
    logger.warning("或者使用start_web.sh脚本")
    logger.warning("======================================================")
    
    # 判断是否真的想直接运行
    should_continue = input("是否仍要使用Flask开发服务器启动? (y/N): ")
    if should_continue.lower() != 'y':
        logger.error("退出程序，请使用Gunicorn启动")
        sys.exit(0)
    
    # 确保游戏目录存在
    if not os.path.exists(GAMES_DIR):
        try:
            os.makedirs(GAMES_DIR, exist_ok=True)
            logger.info(f"已创建游戏目录: {GAMES_DIR}")
            # 设置目录权限
            os.chmod(GAMES_DIR, 0o755)
            # 设置为steam用户所有
            subprocess.run(['chown', '-R', 'steam:steam', GAMES_DIR])
        except Exception as e:
            logger.error(f"创建游戏目录失败: {str(e)}")
    
    # 直接运行时使用Flask内置服务器，而不是通过Gunicorn导入时
    logger.warning("使用Flask开发服务器启动 - 不推荐用于生产环境")
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True) 