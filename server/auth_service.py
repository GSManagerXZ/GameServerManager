#!/usr/bin/env python3
import datetime
import jwt
import logging
from flask import request, jsonify, g
from config import JWT_SECRET, JWT_EXPIRATION

logger = logging.getLogger("auth_service")

def generate_token(user):
    """生成JWT令牌"""
    payload = {
        'username': user.get('username'),
        'role': user.get('role', 'user'),
        'exp': datetime.datetime.utcnow() + datetime.timedelta(seconds=JWT_EXPIRATION)
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm='HS256')
    return token

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

def is_public_route(path):
    """检查路径是否为公共路由"""
    public_routes = [
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/check_first_use'
    ]
    return path in public_routes

def check_auth():
    """认证检查中间件"""
    # 前端资源路由不需要认证
    if request.path == '/' or not request.path.startswith('/api/') or is_public_route(request.path):
        return None
        
    # 所有API路由需要认证
    if request.path.startswith('/api/'):
        if is_public_route(request.path):
            return None
            
        auth_header = request.headers.get('Authorization')
        token_param = request.args.get('token')
        
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
                
        if not token and token_param:
            token = token_param
            
        if token:
            payload = verify_token(token)
            if not payload:
                logger.warning(f"无效令牌: {request.path}")
                return jsonify({
                    'status': 'error',
                    'message': '令牌无效或已过期，请重新登录'
                }), 401
            # 令牌有效，保存用户信息到g对象
            g.user = payload
            return None