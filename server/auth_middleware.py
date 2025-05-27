from functools import wraps
import os
import jwt
import time
import json
import hashlib
import secrets
from flask import request, jsonify, g
from config import JWT_SECRET, JWT_EXPIRATION

# 读取用户信息配置文件
def load_users():
    try:
        config_path = os.path.join(os.path.dirname(__file__), "users.json")
        
        # 如果配置文件不存在，返回空列表
        if not os.path.exists(config_path):
            return []
            
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
            return config.get("users", [])
    except Exception as e:
        print(f"加载用户配置失败: {str(e)}")
        # 不再返回默认admin用户
        return []

# 哈希密码函数
def hash_password(password, salt=None):
    """
    使用SHA-256算法对密码进行哈希处理
    如果没有提供salt，会生成一个新的salt
    返回 (hashed_password, salt)
    """
    if salt is None:
        salt = secrets.token_hex(16)  # 生成一个32字符的随机salt
    
    # 将密码和salt组合并进行哈希
    password_hash = hashlib.sha256((password + salt).encode()).hexdigest()
    
    return password_hash, salt

def verify_password(password, stored_hash, salt):
    """
    验证密码是否正确
    """
    calculated_hash, _ = hash_password(password, salt)
    return calculated_hash == stored_hash

# 认证用户
def authenticate_user(username, password):
    users = load_users()
    
    for user in users:
        if user["username"] == username:
            # 支持两种密码验证方式：哈希和明文
            if "password_hash" in user and "salt" in user:
                # 使用哈希验证
                if verify_password(password, user["password_hash"], user["salt"]):
                    return user
            elif "password" in user:
                # 兼容旧的明文密码验证
                if user["password"] == password:
                    # 自动升级到哈希存储
                    password_hash, salt = hash_password(password)
                    user["password_hash"] = password_hash
                    user["salt"] = salt
                    del user["password"]  # 删除明文密码
                    
                    # 保存更新后的用户信息
                    save_user(user)
                    
                    return user
    
    return None

# 生成JWT令牌
def generate_token(user):
    payload = {
        "username": user["username"],
        "role": user.get("role", "user"),
        "exp": int(time.time()) + 24 * 60 * 60  # 24小时过期
    }
    
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    return token

# 验证JWT令牌
def verify_token(token):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# 认证中间件
def auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        # 从请求头获取令牌
        auth_header = request.headers.get('Authorization')
        # 从URL参数中获取令牌（用于EventSource）
        token_param = request.args.get('token')
        
        token = None
        
        # 从请求头解析令牌
        if auth_header:
            parts = auth_header.split()
            if len(parts) == 2 and parts[0].lower() == 'bearer':
                token = parts[1]
        
        # 如果请求头没有令牌，尝试从URL参数获取
        if not token and token_param:
            token = token_param
            
        # 如果没有令牌，返回未授权错误
        if not token:
            return jsonify({
                'status': 'error',
                'message': '未授权的访问，请先登录'
            }), 401
            
        # 验证令牌
        payload = verify_token(token)
        if not payload:
            return jsonify({
                'status': 'error',
                'message': '无效或过期的令牌，请重新登录'
            }), 401
            
        # 将用户信息存储在g对象中，以便在路由处理程序中使用
        g.user = payload
        
        return f(*args, **kwargs)
    
    return decorated

# 允许某些路由无需认证
PUBLIC_ROUTES = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/check_first_use',
    '/',
    '/index.html',
    '/login',
    '/register',
    '/assets/',
    '/favicon.ico'
]

# 保存用户到users.json
def save_user(user):
    try:
        config_path = os.path.join(os.path.dirname(__file__), "users.json")
        
        # 如果配置文件不存在，创建一个空的配置文件
        if not os.path.exists(config_path):
            default_users = {
                "users": []
            }
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(default_users, f, indent=4)
            current_users = default_users
        else:
            # 读取现有配置
            with open(config_path, 'r', encoding='utf-8') as f:
                current_users = json.load(f)
                
        # 检查用户是否已存在
        users = current_users.get("users", [])
        for i, existing_user in enumerate(users):
            if existing_user.get("username") == user.get("username"):
                # 更新现有用户
                users[i] = user
                break
        else:
            # 用户不存在，添加新用户
            users.append(user)
            
        current_users["users"] = users
        
        # 保存配置
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(current_users, f, indent=4)
            
        return True
    except Exception as e:
        print(f"保存用户配置失败: {str(e)}")
        return False

def is_public_route(path):
    # 静态资源不需要认证
    if path.startswith('/assets/') or path.endswith('.js') or path.endswith('.css') or path.endswith('.png') or path.endswith('.jpg') or path.endswith('.svg') or path.endswith('.ico'):
        return True
    
    # 登录相关路由不需要认证    
    if path == '/login' or path.startswith('/login/') or path == '/register' or path.startswith('/register/'):
        return True
        
    return path in PUBLIC_ROUTES 