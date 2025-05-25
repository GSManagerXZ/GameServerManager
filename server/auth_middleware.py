from functools import wraps
import os
import jwt
import time
import json
from flask import request, jsonify, g

# JWT密钥
JWT_SECRET = os.environ.get('JWT_SECRET', 'your-secret-key')  # 实际应用中应使用环境变量

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

# 认证用户
def authenticate_user(username, password):
    users = load_users()
    
    for user in users:
        if user["username"] == username and user["password"] == password:
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