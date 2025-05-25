#!/usr/bin/env python3
import os
import sys
import json
import subprocess

# 禁用Flask开发服务器警告
# os.environ['WERKZEUG_RUN_MAIN'] = 'true'

from flask import Flask, request, jsonify, send_from_directory, render_template_string, Response, stream_with_context, send_file, g
from flask_cors import CORS
import threading
import time
import logging
import tempfile
import io
import select
import queue
import fcntl
import shlex
import pty  # 导入PTY模块
import shutil
import psutil  # 添加psutil库用于获取系统信息
import stat  # 用于文件权限管理
import zipfile  # 用于压缩文件
import uuid  # 用于生成唯一文件名
from werkzeug.utils import secure_filename  # 用于安全处理文件名
from auth_middleware import auth_required, authenticate_user, generate_token, is_public_route, verify_token, save_user

# 错误页面模板
ERROR_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>游戏服务器部署系统</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        h1 { color: #1890ff; }
        .error { color: #ff4d4f; }
    </style>
</head>
<body>
    <h1>游戏服务器部署系统</h1>
    <p class="error">{{ error_message }}</p>
    <p><a href="/">返回首页</a></p>
</body>
</html>
"""

# 配置日志
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('game_server')

app = Flask(__name__, static_folder='../app/dist')
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0  # 禁用缓存，确保始终获取最新文件

# 允许跨域请求
CORS(app, resources={r"/*": {"origins": "*"}})  # 允许所有来源的跨域请求

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

# 新增：用于存储每个游戏的pty主端fd和等待输入的event
pty_fds = {}  # game_id: master_fd
pty_input_events = {}  # game_id: threading.Event
pty_input_values = {}  # game_id: str

# 新增：用于存储每个游戏的运行中服务器进程和输出
running_servers = {}  # game_id: {'process': process, 'output': [], 'master_fd': fd, 'started_at': time.time()}
server_output_queues = {}  # game_id: queue.Queue()

# 加载游戏配置
def load_games_config():
    with open(GAMES_CONFIG, 'r', encoding='utf-8') as f:
        return json.load(f)

# 读取PTY主端输出的函数
def read_pty_output(master_fd, game_id):
    """从PTY主端读取输出并将其添加到队列中"""
    logger.info(f"启动游戏 {game_id} 的PTY输出读取线程")
    
    installation_data = active_installations.get(game_id)
    if not installation_data:
        logger.error(f"无法找到游戏 {game_id} 的安装数据")
        return
        
    output_queue = output_queues.get(game_id)
    if not output_queue:
        logger.error(f"无法找到游戏 {game_id} 的输出队列")
        return
    
    # 创建临时日志文件
    output_log = tempfile.NamedTemporaryFile(mode='w+', delete=False, prefix=f"game_install_{game_id}_", suffix=".log")
    output_log_path = output_log.name
    logger.debug(f"安装日志将写入: {output_log_path}")
    installation_data['output_file'] = output_log_path
    
    # 设置非阻塞模式
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    
    buffer = ""
    pty_fds[game_id] = master_fd
    pty_input_events[game_id] = threading.Event()
    pty_input_values[game_id] = None
    try:
        while True:
            try:
                # 读取PTY输出
                r, w, e = select.select([master_fd], [], [], 0.5)
                if master_fd in r:
                    data = os.read(master_fd, 1024).decode('utf-8', errors='replace')
                    if not data:  # EOF
                        break
                    
                    # 处理数据，按行分割
                    buffer += data
                    lines = buffer.split('\n')
                    buffer = lines.pop()  # 最后一个可能是不完整的行
                    
                    for line in lines:
                        line = line.rstrip()
                        if line:
                            # 减少debug级别日志输出
                            # logger.debug(f"PTY输出[{game_id}]: {line}")
                            
                            # 写入日志文件
                            output_log.write(line + "\n")
                            output_log.flush()
                            
                            # 添加到内存中的输出历史
                            installation_data['output'].append(line)
                            
                            # 添加到队列以供实时传输
                            output_queue.put(line)
                            # 检测验证码/令牌提示
                            if any(key in line for key in ["Steam Guard", "令牌", "验证码", "code", "Code"]):
                                # 推送prompt消息
                                output_queue.put({'prompt': '请输入Steam令牌/验证码'})
                                # 等待前端输入
                                logger.info(f"等待前端输入验证码: {game_id}")
                                pty_input_events[game_id].clear()
                                pty_input_events[game_id].wait(timeout=300)  # 最多等5分钟
                                input_value = pty_input_values[game_id]
                                if input_value:
                                    # 先发送回车进入命令模式
                                    logger.info(f"先发送回车进入命令模式")
                                    os.write(master_fd, '\n'.encode('utf-8'))
                                    time.sleep(0.5)  # 短暂等待
                                    # 再发送验证码命令
                                    send_str = f"set_steam_guard_code {input_value}\n"
                                    os.write(master_fd, send_str.encode('utf-8'))
                                    logger.info(f"收到前端输入，已写入pty: {repr(send_str)}")
                                    pty_input_values[game_id] = None
                                else:
                                    logger.warning(f"验证码输入超时或为空: {game_id}")
                                    output_queue.put({'line': '验证码输入超时或未输入，安装可能失败'})
                
                # 检查进程是否结束
                if installation_data.get('process') and installation_data['process'].poll() is not None:
                    # 处理剩余的buffer
                    if buffer:
                        # logger.debug(f"PTY最终输出[{game_id}]: {buffer}")
                        output_log.write(buffer + "\n")
                        installation_data['output'].append(buffer)
                        output_queue.put(buffer)
                    break
                    
            except (IOError, OSError) as e:
                if e.errno != 11:  # EAGAIN, 表示当前没有数据可读
                    logger.error(f"读取PTY输出时出错: {str(e)}")
                    break
                time.sleep(0.1)
                
        # 进程结束，检查返回码
        return_code = installation_data.get('process', {}).poll()
        logger.info(f"游戏 {game_id} 安装进程已结束，返回码: {return_code}")
        
        if return_code is not None:
            installation_data['return_code'] = return_code
            installation_data['complete'] = True
            
            # 发送完成消息
            status = 'success' if return_code == 0 else 'error'
            message = f'游戏 {game_id} 安装' + ('成功' if return_code == 0 else f'失败，返回码: {return_code}')
            installation_data['final_message'] = message
            
            # 向队列添加完成消息
            output_queue.put({'complete': True, 'status': status, 'message': message})
            
    except Exception as e:
        logger.error(f"读取PTY输出线程出错: {str(e)}")
        
        # 向队列添加错误消息
        output_queue.put({'complete': True, 'status': 'error', 'message': f'读取输出错误: {str(e)}'})
        
        # 更新安装状态
        if game_id in active_installations:
            active_installations[game_id]['error'] = str(e)
            active_installations[game_id]['complete'] = True
    finally:
        # 关闭PTY主端
        try:
            os.close(master_fd)
        except:
            pass
            
        # 关闭日志文件
        try:
            output_log.close()
        except:
            pass
            
        logger.info(f"游戏 {game_id} 的PTY输出读取线程结束")
        pty_fds.pop(game_id, None)
        pty_input_events.pop(game_id, None)
        pty_input_values.pop(game_id, None)

# 在单独线程中使用PTY运行安装任务
def run_installation(game_id, cmd):
    logger.info(f"开始使用PTY运行游戏 {game_id} 的安装进程")
    
    try:
        # 准备命令字符串
        logger.info(f"执行命令: {cmd}")
        
        # 创建PTY
        master_fd, slave_fd = pty.openpty()
        logger.info(f"创建PTY: master={master_fd}, slave={slave_fd}")
        
        # 启动进程，将输出连接到PTY从端
        process = subprocess.Popen(
            cmd,
            shell=True,  # 必须使用shell执行su命令
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            close_fds=True
        )
        
        # 关闭PTY从端，主进程只需要主端
        os.close(slave_fd)
        
        # 设置进程对象
        if game_id in active_installations:
            active_installations[game_id]['process'] = process
            logger.info(f"进程已启动，PID: {process.pid}")
        else:
            logger.error(f"找不到游戏 {game_id} 的安装数据")
            os.close(master_fd)
            return
            
        # 创建一个单独的线程来读取PTY输出
        output_thread = threading.Thread(
            target=read_pty_output,
            args=(master_fd, game_id),
            daemon=True
        )
        output_thread.start()
        
        # 主安装线程等待进程完成
        return_code = process.wait()
        logger.info(f"游戏 {game_id} 安装主进程已结束，返回码: {return_code}")
        
        # 确保读取线程有时间完成
        output_thread.join(timeout=5)
        
        # 确保安装状态已更新
        if game_id in active_installations:
            active_installations[game_id]['return_code'] = return_code
            active_installations[game_id]['complete'] = True
            
    except Exception as e:
        logger.error(f"运行安装进程时出错: {str(e)}")
        if game_id in active_installations:
            active_installations[game_id]['error'] = str(e)
            active_installations[game_id]['complete'] = True
            
        # 向队列添加错误消息
        if game_id in output_queues:
            output_queues[game_id].put({'complete': True, 'status': 'error', 'message': f'安装错误: {str(e)}'})

# 读取PTY输出的函数
def read_server_pty_output(master_fd, game_id):
    """从PTY主端读取服务器输出并将其添加到队列中"""
    logger.info(f"启动游戏服务器 {game_id} 的PTY输出读取线程")
    
    server_data = running_servers.get(game_id)
    if not server_data:
        logger.error(f"无法找到游戏服务器 {game_id} 的运行数据")
        return
        
    output_queue = server_output_queues.get(game_id)
    if not output_queue:
        logger.error(f"无法找到游戏服务器 {game_id} 的输出队列")
        return
    
    # 创建临时日志文件
    output_log = tempfile.NamedTemporaryFile(mode='w+', delete=False, prefix=f"game_server_{game_id}_", suffix=".log")
    output_log_path = output_log.name
    logger.debug(f"服务器日志将写入: {output_log_path}")
    server_data['output_file'] = output_log_path
    
    # 设置非阻塞模式
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    
    buffer = ""
    try:
        while True:
            try:
                # 读取PTY输出
                r, w, e = select.select([master_fd], [], [], 0.5)
                if master_fd in r:
                    data = os.read(master_fd, 1024).decode('utf-8', errors='replace')
                    if not data:  # EOF
                        break
                    
                    # 处理数据，按行分割
                    buffer += data
                    lines = buffer.split('\n')
                    buffer = lines.pop()  # 最后一个可能是不完整的行
                    
                    for line in lines:
                        line = line.rstrip()
                        if line:
                            # 减少debug级别日志输出
                            # logger.debug(f"服务器PTY输出[{game_id}]: {line}")
                            
                            # 写入日志文件
                            output_log.write(line + "\n")
                            output_log.flush()
                            
                            # 添加到内存中的输出历史
                            server_data['output'].append(line)
                            
                            # 添加到队列以供实时传输
                            output_queue.put(line)
                
                # 检查进程是否结束
                if server_data.get('process') and server_data['process'].poll() is not None:
                    # 处理剩余的buffer
                    if buffer:
                        # logger.debug(f"服务器PTY最终输出[{game_id}]: {buffer}")
                        output_log.write(buffer + "\n")
                        server_data['output'].append(buffer)
                        output_queue.put(buffer)
                    break
                    
            except (IOError, OSError) as e:
                if e.errno != 11:  # EAGAIN, 表示当前没有数据可读
                    logger.error(f"读取服务器PTY输出时出错: {str(e)}")
                    break
                time.sleep(0.1)
                
        # 进程结束，检查返回码
        return_code = server_data.get('process', {}).poll()
        logger.info(f"游戏服务器 {game_id} 进程已结束，返回码: {return_code}")
        
        if return_code is not None:
            server_data['return_code'] = return_code
            server_data['running'] = False
            
            # 发送完成消息
            status = 'success' if return_code == 0 else 'error'
            message = f'游戏服务器 {game_id} ' + ('正常关闭' if return_code == 0 else f'异常退出，返回码: {return_code}')
            server_data['final_message'] = message
            
            # 向队列添加完成消息
            output_queue.put({'complete': True, 'status': status, 'message': message})
            
    except Exception as e:
        logger.error(f"读取服务器PTY输出线程出错: {str(e)}")
        
        # 向队列添加错误消息
        output_queue.put({'complete': True, 'status': 'error', 'message': f'读取输出错误: {str(e)}'})
        
        # 更新服务器状态
        if game_id in running_servers:
            running_servers[game_id]['error'] = str(e)
            running_servers[game_id]['running'] = False
    finally:
        # 关闭PTY主端
        try:
            os.close(master_fd)
        except:
            pass
            
        # 关闭日志文件
        try:
            output_log.close()
        except:
            pass
            
        logger.info(f"游戏服务器 {game_id} 的PTY输出读取线程结束")

# 在单独线程中使用PTY运行服务器
def run_game_server(game_id, cmd, cwd):
    logger.info(f"开始使用PTY运行游戏服务器 {game_id}")
    
    try:
        # 准备命令字符串
        logger.info(f"执行命令: {cmd}, 工作目录: {cwd}")
        
        # 创建PTY
        master_fd, slave_fd = pty.openpty()
        logger.info(f"创建PTY: master={master_fd}, slave={slave_fd}")
        
        # 启动进程，将输出连接到PTY从端
        process = subprocess.Popen(
            cmd,
            shell=True,  # 使用shell执行命令
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            close_fds=True,
            cwd=cwd,  # 设置工作目录
            env=dict(os.environ, TERM="xterm")  # 确保终端类型设置正确
        )
        
        # 关闭PTY从端，主进程只需要主端
        os.close(slave_fd)
        
        # 设置进程对象
        if game_id in running_servers:
            running_servers[game_id]['process'] = process
            running_servers[game_id]['master_fd'] = master_fd
            logger.info(f"服务器进程已启动，PID: {process.pid}")
        else:
            logger.error(f"找不到游戏服务器 {game_id} 的运行数据")
            os.close(master_fd)
            return
            
        # 创建一个单独的线程来读取PTY输出
        output_thread = threading.Thread(
            target=read_server_pty_output,
            args=(master_fd, game_id),
            daemon=True
        )
        output_thread.start()
        
        # 主线程等待进程完成
        return_code = process.wait()
        logger.info(f"游戏服务器 {game_id} 主进程已结束，返回码: {return_code}")
        
        # 确保读取线程有时间完成
        output_thread.join(timeout=5)
        
        # 确保服务器状态已更新
        if game_id in running_servers:
            running_servers[game_id]['return_code'] = return_code
            running_servers[game_id]['running'] = False
            
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
        # 构建安装命令 (确保以steam用户运行)
        cmd = f"su - steam -c 'python3 {INSTALLER_SCRIPT} {game_id}"
        if account:
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
                            # logger.debug("发送心跳包")
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
    if game_id not in pty_input_events:
        return jsonify({'status': 'error', 'message': '无等待输入的进程'}), 404
    pty_input_values[game_id] = value
    pty_input_events[game_id].set()
    return jsonify({'status': 'success'})

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
            
        # 如果已经有正在运行的服务器进程，则返回
        if game_id in running_servers and running_servers[game_id].get('process') and running_servers[game_id]['process'].poll() is None:
            logger.info(f"游戏服务器 {game_id} 已经在运行中")
            return jsonify({
                'status': 'success', 
                'message': f'游戏服务器 {game_id} 已经在运行中',
                'already_running': True
            })
            
        # 清理任何旧的服务器数据
        if game_id in running_servers:
            logger.info(f"清理游戏服务器 {game_id} 的旧运行数据")
            old_process = running_servers[game_id].get('process')
            if old_process and old_process.poll() is None:
                try:
                    old_process.terminate()
                except:
                    pass
                    
        # 重置输出队列
        if game_id in server_output_queues:
            try:
                while not server_output_queues[game_id].empty():
                    server_output_queues[game_id].get_nowait()
            except:
                server_output_queues[game_id] = queue.Queue()
        else:
            server_output_queues[game_id] = queue.Queue()
            
        # 构建启动命令，确保以steam用户运行
        cmd = f"su - steam -c 'cd {game_dir} && ./start.sh'"
        logger.info(f"准备执行命令 (将使用PTY): {cmd}")
        
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
        
        return jsonify({
            'status': 'success', 
            'message': f'游戏服务器 {game_id} 启动已开始'
        })
        
    except Exception as e:
        logger.error(f"启动游戏服务器失败: {str(e)}")
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
        
        # 检查游戏服务器是否在运行
        if game_id not in running_servers or not running_servers[game_id].get('process'):
            logger.error(f"游戏服务器 {game_id} 未运行")
            return jsonify({'status': 'error', 'message': f'游戏服务器 {game_id} 未运行'}), 400
            
        process = running_servers[game_id]['process']
        
        # 检查进程是否已结束
        if process.poll() is not None:
            logger.info(f"游戏服务器 {game_id} 已经停止，返回码: {process.poll()}")
            running_servers[game_id]['running'] = False
            # 清理终端日志
            clean_server_output(game_id)
            return jsonify({'status': 'success', 'message': f'游戏服务器 {game_id} 已经停止'})
        
        master_fd = running_servers[game_id].get('master_fd')
            
        # 尝试停止进程
        try:
            if force:
                # 强制模式：直接使用SIGKILL终止进程和所有子进程
                logger.info(f"强制终止游戏服务器 {game_id}")
                
                # 获取当前进程的PID
                pid = process.pid
                logger.info(f"服务器主进程PID: {pid}")
                
                try:
                    # 找到所有子进程
                    parent = psutil.Process(pid)
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
                    
                    logger.info(f"已杀死服务器进程及其子进程")
                except psutil.NoSuchProcess:
                    logger.warning(f"进程 {pid} 已不存在")
                except Exception as e:
                    logger.error(f"使用psutil杀死进程失败: {str(e)}")
                    # 如果上面失败，使用原始方法
                    process.kill()
            else:
                # 标准模式：发送Ctrl+C到PTY终端
                logger.info(f"向游戏服务器 {game_id} 发送Ctrl+C")
                if master_fd:
                    # Ctrl+C对应ASCII码为3
                    os.write(master_fd, b'\x03')
                    logger.info(f"已发送Ctrl+C到游戏服务器 {game_id}")
                else:
                    # 如果找不到PTY主端，退回到发送SIGTERM
                    logger.warning(f"找不到游戏服务器 {game_id} 的PTY主端，使用SIGTERM")
                    process.terminate()  # SIGTERM
                
            # 等待进程结束，最多等待5秒
            for _ in range(10):
                if process.poll() is not None:
                    break
                time.sleep(0.5)
                
            # 如果仍未结束
            if process.poll() is None:
                if force:
                    logger.warning(f"游戏服务器 {game_id} 未响应SIGKILL，再次尝试")
                    try:
                        # 使用系统命令强制杀死进程树
                        os.system(f"pkill -9 -P {process.pid}")
                        time.sleep(0.5)
                        if process.poll() is None:
                            process.kill()  # 再次尝试杀死主进程
                    except:
                        pass
                else:
                    logger.warning(f"游戏服务器 {game_id} 未响应Ctrl+C，建议使用强制模式")
                    # 此时不自动切换到强制模式，而是返回一个建议
                    return jsonify({
                        'status': 'warning', 
                        'message': f'游戏服务器 {game_id} 未响应标准停止，请尝试强制停止'
                    })
            
            # 再次检查进程状态
            time.sleep(0.5)  # 短暂等待确保状态更新
            return_code = process.poll()
            
            if return_code is not None:
                logger.info(f"游戏服务器 {game_id} 已停止，返回码: {return_code}")
                running_servers[game_id]['running'] = False
                # 关闭PTY主端
                if master_fd:
                    try:
                        os.close(master_fd)
                        running_servers[game_id]['master_fd'] = None
                    except:
                        pass
                # 确保队列中添加终止消息
                if game_id in server_output_queues:
                    server_output_queues[game_id].put({'complete': True, 'status': 'success', 'message': f'游戏服务器已停止，返回码: {return_code}'})
                
                # 清理终端日志
                clean_server_output(game_id)
                
                return jsonify({'status': 'success', 'message': f'游戏服务器 {game_id} 已停止'})
            else:
                # 如果是强制模式但仍然没有停止，使用最后的手段
                if force:
                    logger.warning(f"游戏服务器 {game_id} 仍未停止，使用最终方法")
                    # 使用killall命令，这是最后的手段
                    os.system(f"killall -9 -g $(ps -o sess= -p {process.pid})")
                    time.sleep(1)
                    
                    # 即使进程没有响应，也将其标记为已停止
                    running_servers[game_id]['running'] = False
                    if master_fd:
                        try:
                            os.close(master_fd)
                            running_servers[game_id]['master_fd'] = None
                        except:
                            pass
                    
                    # 清理终端日志
                    clean_server_output(game_id)
                    
                    return jsonify({'status': 'success', 'message': f'游戏服务器 {game_id} 已强制停止'})
                else:
                    return jsonify({'status': 'warning', 'message': f'游戏服务器 {game_id} 可能未完全停止，请尝试强制停止'})
            
        except Exception as e:
            logger.error(f"停止游戏服务器 {game_id} 时出错: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500
            
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
            
        # 检查服务器是否在运行
        if game_id not in running_servers or not running_servers[game_id].get('process'):
            logger.error(f"游戏服务器 {game_id} 未运行")
            return jsonify({'status': 'error', 'message': f'游戏服务器 {game_id} 未运行'}), 400
            
        # 检查进程是否已结束
        process = running_servers[game_id]['process']
        if process.poll() is not None:
            logger.error(f"游戏服务器 {game_id} 已经停止")
            return jsonify({'status': 'error', 'message': f'游戏服务器 {game_id} 已经停止'}), 400
            
        # 获取PTY主端
        master_fd = running_servers[game_id].get('master_fd')
        if not master_fd:
            logger.error(f"找不到游戏服务器 {game_id} 的PTY主端")
            return jsonify({'status': 'error', 'message': f'找不到游戏服务器 {game_id} 的PTY主端'}), 500
            
        # 发送输入
        send_str = value + '\n'
        os.write(master_fd, send_str.encode('utf-8'))
        logger.info(f"向游戏服务器 {game_id} 发送输入: {repr(send_str)}")
        
        return jsonify({'status': 'success', 'message': '输入已发送'})
        
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
                
            process = running_servers[game_id].get('process')
            if not process or process.poll() is not None:
                return jsonify({'status': 'success', 'server_status': 'stopped'})
                
            return jsonify({
                'status': 'success',
                'server_status': 'running',
                'pid': process.pid,
                'started_at': running_servers[game_id].get('started_at'),
                'uptime': time.time() - running_servers[game_id].get('started_at', time.time())
            })
        else:
            # 获取所有游戏服务器的状态
            servers = {}
            for game_id, server_data in running_servers.items():
                process = server_data.get('process')
                if process and process.poll() is None:
                    servers[game_id] = {
                        'status': 'running',
                        'pid': process.pid,
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
    """以流式方式获取游戏服务器输出"""
    try:
        game_id = request.args.get('game_id')
        
        if not game_id:
            logger.error("流式获取服务器输出时缺少游戏ID")
            return jsonify({'status': 'error', 'message': '缺少游戏ID'}), 400
            
        logger.info(f"开始流式获取游戏服务器 {game_id} 的输出")
        
        # 检查游戏是否存在于配置中，但允许外部游戏
        games = load_games_config()
        is_external = False
        
        if game_id not in games:
            logger.info(f"游戏 {game_id} 不在配置列表中，作为外部游戏处理")
            is_external = True
            
        # 如果服务器不在运行中，但请求了流
        if game_id not in running_servers:
            logger.warning(f"游戏服务器 {game_id} 未运行，但请求了输出流")
            return jsonify({'status': 'error', 'message': f'游戏服务器 {game_id} 未运行'}), 404
            
        # 确保有队列
        if game_id not in server_output_queues:
            server_output_queues[game_id] = queue.Queue()
            
            # 如果有历史输出，添加到队列
            server_data = running_servers[game_id]
            for line in server_data.get('output', []):
                server_output_queues[game_id].put(line)
                
            # 如果服务器已停止，添加停止消息
            process = server_data.get('process')
            if process and process.poll() is not None:
                status = 'success' if process.poll() == 0 else 'error'
                message = f'游戏服务器 {game_id} ' + ('正常关闭' if process.poll() == 0 else f'异常退出，返回码: {process.poll()}')
                server_output_queues[game_id].put({'complete': True, 'status': status, 'message': message})
                
        # 使用队列传输数据
        def generate():
            server_data = running_servers[game_id]
            output_queue = server_output_queues[game_id]
            
            # 发送所有已有的输出
            # logger.info(f"准备发送游戏服务器 {game_id} 的输出")
            
            # 马上发送一条测试消息，验证流正常工作
            if is_external:
                yield f"data: {json.dumps({'line': '建立连接成功，正在启动外部游戏服务器...'})}\n\n"
            else:
                yield f"data: {json.dumps({'line': '建立连接成功，开始接收实时服务器输出...'})}\n\n"
            
            # 超时设置
            timeout_seconds = 3600  # 1小时无输出则超时
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
                            logger.debug(f"发送服务器完成消息: {item.get('message', '')}")
                            yield f"data: {json.dumps(item)}\n\n"
                            break
                            
                        # 处理普通输出
                        if isinstance(item, str):
                            # logger.debug(f"发送服务器输出: {item}")
                            yield f"data: {json.dumps({'line': item})}\n\n"
                            
                    except queue.Empty:
                        # 心跳检查
                        current_time = time.time()
                        if current_time >= next_heartbeat:
                            # logger.debug("发送心跳包")
                            yield f"data: {json.dumps({'heartbeat': True, 'timestamp': current_time})}\n\n"
                            next_heartbeat = current_time + heartbeat_interval
                            
                        # 检查是否超时
                        if time.time() - last_output_time > timeout_seconds:
                            logger.warning(f"游戏服务器 {game_id} 的输出流超过 {timeout_seconds}秒 无输出，结束连接")
                            yield f"data: {json.dumps({'line': '输出流超时，请刷新页面查看最新状态'})}\n\n"
                            yield f"data: {json.dumps({'timeout': True, 'message': '输出流超时'})}\n\n"
                            break
                            
                        # 检查进程是否结束但未发送完成消息
                        process = server_data.get('process')
                        if process and process.poll() is not None and not server_data.get('sent_complete', False):
                            logger.warn(f"进程已结束但未发送完成消息，发送完成状态")
                            status = 'success' if process.poll() == 0 else 'error'
                            message = f'游戏服务器 {game_id} ' + ('正常关闭' if process.poll() == 0 else f'异常退出，返回码: {process.poll()}')
                            yield f"data: {json.dumps({'complete': True, 'status': status, 'message': message})}\n\n"
                            server_data['sent_complete'] = True
                            break
                            
                        continue
                        
                except Exception as e:
                    logger.error(f"生成服务器流数据时出错: {str(e)}")
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"
                    break
                    
        return Response(stream_with_context(generate()), 
                       mimetype='text/event-stream',
                       headers={
                           'Cache-Control': 'no-cache',
                           'X-Accel-Buffering': 'no'  # 禁用Nginx缓冲
                       })
                       
    except Exception as e:
        logger.error(f"服务器输出流处理错误: {str(e)}")
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

@app.route('/api/terminate_install', methods=['POST'])
def terminate_install():
    """终止游戏安装进程"""
    try:
        data = request.json
        game_id = data.get('game_id')
        
        if not game_id:
            logger.error("缺少游戏ID")
            return jsonify({'status': 'error', 'message': '缺少游戏ID'}), 400
            
        logger.info(f"请求终止游戏 {game_id} 的安装")
        
        # 检查游戏安装是否在进行中
        if game_id not in active_installations or not active_installations[game_id].get('process'):
            logger.error(f"游戏 {game_id} 没有活跃的安装任务")
            return jsonify({'status': 'error', 'message': f'游戏 {game_id} 没有活跃的安装任务'}), 400
            
        process = active_installations[game_id]['process']
        
        # 检查进程是否已结束
        if process.poll() is not None:
            logger.info(f"游戏 {game_id} 安装进程已经结束，返回码: {process.poll()}")
            active_installations[game_id]['complete'] = True
            # 清理安装日志
            clean_installation_output(game_id)
            return jsonify({'status': 'success', 'message': f'游戏 {game_id} 安装已结束'})
        
        # 尝试终止进程和所有子进程
        try:
            # 获取当前进程的PID
            pid = process.pid
            logger.info(f"安装主进程PID: {pid}")
            
            try:
                # 找到所有子进程
                parent = psutil.Process(pid)
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
                
                logger.info(f"已杀死安装进程及其子进程")
            except psutil.NoSuchProcess:
                logger.warning(f"进程 {pid} 已不存在")
            except Exception as e:
                logger.error(f"使用psutil杀死进程失败: {str(e)}")
                # 如果上面失败，使用原始方法
                process.kill()
            
            # 等待进程结束，最多等待3秒
            for _ in range(6):
                if process.poll() is not None:
                    break
                time.sleep(0.5)
            
            # 如果仍未结束，使用最后的手段
            if process.poll() is None:
                logger.warning(f"游戏 {game_id} 安装进程未响应SIGKILL，再次尝试")
                try:
                    # 使用系统命令强制杀死进程树
                    os.system(f"pkill -9 -P {process.pid}")
                    time.sleep(0.5)
                    if process.poll() is None:
                        os.system(f"killall -9 -g $(ps -o sess= -p {process.pid})")
                except:
                    pass
            
            # 再次检查进程状态
            time.sleep(0.5)  # 短暂等待确保状态更新
            return_code = process.poll()
            
            # 设置安装状态为已完成
            active_installations[game_id]['complete'] = True
            active_installations[game_id]['return_code'] = return_code if return_code is not None else -1
            active_installations[game_id]['error'] = "安装已被用户终止"
            
            # 关闭PTY端口
            master_fd = pty_fds.get(game_id)
            if master_fd:
                try:
                    os.close(master_fd)
                    pty_fds.pop(game_id, None)
                except:
                    pass
            
            # 清理安装日志
            clean_installation_output(game_id)
            
            # 确保队列中添加终止消息
            if game_id in output_queues:
                output_queues[game_id].put({'complete': True, 'status': 'terminated', 'message': '安装已被用户终止'})
            
            logger.info(f"游戏 {game_id} 安装已终止")
            return jsonify({'status': 'success', 'message': f'游戏 {game_id} 安装已终止'})
            
        except Exception as e:
            logger.error(f"终止游戏 {game_id} 安装时出错: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500
            
    except Exception as e:
        logger.error(f"终止游戏安装失败: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

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
    """压缩文件和目录"""
    try:
        data = request.json
        paths = data.get('paths', [])
        current_path = data.get('currentPath', '')
        
        # 安全检查
        if not paths:
            return jsonify({'status': 'error', 'message': '没有指定要压缩的文件'}), 400
            
        for path in paths:
            if '..' in path or not path.startswith('/'):
                return jsonify({'status': 'error', 'message': f'无效的路径: {path}'}), 400
                
            if not os.path.exists(path):
                return jsonify({'status': 'error', 'message': f'路径不存在: {path}'}), 404
        
        # 创建临时目录用于存放压缩文件
        temp_dir = tempfile.gettempdir()
        
        # 生成唯一的文件名
        zip_filename = f"files_{uuid.uuid4().hex}.zip"
        zip_path = os.path.join(temp_dir, zip_filename)
        
        # 创建压缩文件
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # 处理每个路径
            for path in paths:
                if os.path.isdir(path):
                    # 如果是目录，递归添加所有文件
                    dir_name = os.path.basename(path)
                    for root, dirs, files in os.walk(path):
                        # 计算在压缩文件中的相对路径
                        archive_root = os.path.join(dir_name, os.path.relpath(root, path))
                        for file in files:
                            file_path = os.path.join(root, file)
                            archive_name = os.path.join(archive_root, file)
                            zipf.write(file_path, archive_name)
                else:
                    # 如果是文件，直接添加
                    file_name = os.path.basename(path)
                    zipf.write(path, file_name)
                    
        logger.info(f"压缩文件已创建: {zip_path}")
        
        return jsonify({
            'status': 'success',
            'message': '文件已压缩',
            'zipPath': zip_path
        })
        
    except Exception as e:
        logger.error(f"压缩文件时出错: {str(e)}")
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
        
        # 添加新用户
        new_user = {
            'username': username,
            'password': password,
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
                    if u.get('username') == username and u.get('password') == password:
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

if __name__ == '__main__':
    logger.info("检测到直接运行api_server.py")
    logger.warning("======================================================")
    logger.warning("警告: 不建议直接运行此文件。请使用Gunicorn启动服务器:")
    logger.warning("gunicorn -w 4 -b 0.0.0.0:5000 api_server:app")
    logger.warning("或者使用start_web.sh脚本")
    logger.warning("======================================================")
    
    # 判断是否真的想直接运行
    should_continue = input("是否仍要使用Flask开发服务器启动? (y/N): ")
    if should_continue.lower() != 'y':
        logger.info("退出程序，请使用Gunicorn启动")
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