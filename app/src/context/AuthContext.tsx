import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import axios from 'axios';
import { setGlobalLogoutCallback } from '../api';

// 认证上下文接口
interface AuthContextType {
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  register: (username: string, password: string) => Promise<boolean>;
  token: string | null;
  username: string | null;
  loading: boolean;
  isFirstUse: boolean;
  checkFirstUse: () => Promise<boolean>;
  setAuthenticated: (token: string, username: string, role: string) => void;
}

// 创建上下文
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// 认证提供者属性接口
interface AuthProviderProps {
  children: ReactNode;
}

// 认证提供者组件
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isFirstUse, setIsFirstUse] = useState<boolean>(false);

  // 登出函数
  const logout = async (): Promise<void> => {
    return new Promise((resolve) => {
      // 在移除令牌前，先添加登出动画类
      const userInfoElement = document.querySelector('.user-info');
      if (userInfoElement) {
        userInfoElement.classList.add('logout-animation');
      }
      
      // 延迟执行，等待动画完成
      setTimeout(() => {
        // 清除本地存储
        localStorage.removeItem('auth_token');
        localStorage.removeItem('username');
        localStorage.removeItem('role');
        
        // 更新状态
        setToken(null);
        setUsername(null);
        setRole(null);
        setIsAuthenticated(false);
        
        // 移除axios请求头
        delete axios.defaults.headers.common['Authorization'];
        
        // 跳转到登录页面
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
        
        resolve();
      }, 500); // 动画持续时间
    });
  };

  // 初始化时检查本地存储的认证信息
  useEffect(() => {
    const initializeAuth = async () => {
      setLoading(true);
      
      // 设置全局logout回调，用于401自动退出登录
      setGlobalLogoutCallback(() => {
        logout();
      });
      
      // 首先检查是否首次使用
      try {
        const isFirstTimeUse = await checkFirstUse();
        
        // 如果是首次使用，直接设置状态并返回
        if (isFirstTimeUse) {
          setIsFirstUse(true);
          setLoading(false);
          return;
        }
        
        // 否则检查本地存储的令牌
        const storedToken = localStorage.getItem('auth_token');
        const storedUsername = localStorage.getItem('username');
        const storedRole = localStorage.getItem('role');
        
        if (storedToken) {
          setToken(storedToken);
          setUsername(storedUsername);
          setRole(storedRole);
          setIsAuthenticated(true);
          
          // 设置axios默认请求头
          axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
        }
      } catch (error) {
        // 处理错误但不输出日志
      } finally {
        setLoading(false);
      }
    };
    
    initializeAuth();
  }, []);

  // 检查是否为首次使用
  const checkFirstUse = async (): Promise<boolean> => {
    try {
      const response = await axios.get('/api/auth/check_first_use');
      
      if (response.data.status === 'success') {
        const isFirst = response.data.first_use === true;
        setIsFirstUse(isFirst);
        return isFirst;
      }
      return false;
    } catch (error) {
      return false;
    }
  };

  // 设置已认证状态
  const setAuthenticated = (token: string, username: string, role: string) => {
    // 存储到localStorage
    localStorage.setItem('auth_token', token);
    localStorage.setItem('username', username);
    localStorage.setItem('role', role);
    
    // 更新状态
    setToken(token);
    setUsername(username);
    setRole(role);
    setIsAuthenticated(true);
    setIsFirstUse(false);
    
    // 设置axios默认请求头
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  };

  // 登录函数
  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      setLoading(true);
      
      // 向服务器发送登录请求
      const response = await axios.post('/api/auth/login', { username, password });
      
      if (response.data.status === 'success' && response.data.token) {
        // 存储认证信息
        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('username', username);
        localStorage.setItem('role', response.data.role || 'user');
        
        // 更新状态
        setToken(response.data.token);
        setUsername(username);
        setRole(response.data.role || 'user');
        setIsAuthenticated(true);
        setIsFirstUse(false);
        
        // 设置axios默认请求头
        axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
        
        return true;
      } else {
        return false;
      }
    } catch (error: any) {
      // 检查是否是首次使用的错误
      if (error.response && error.response.data && error.response.data.first_use === true) {
        setIsFirstUse(true);
      } else {
        // 确保在其他错误情况下不设置首次使用状态
        setIsFirstUse(false);
      }
      
      return false;
    } finally {
      setLoading(false);
    }
  };

  // 注册函数
  const register = async (username: string, password: string): Promise<boolean> => {
    try {
      setLoading(true);
      
      // 向服务器发送注册请求
      const response = await axios.post('/api/auth/register', { username, password });
      
      if (response.data.status === 'success' && response.data.token) {
        // 存储认证信息
        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('username', username);
        localStorage.setItem('role', response.data.role || 'user');
        
        // 更新状态
        setToken(response.data.token);
        setUsername(username);
        setRole(response.data.role || 'user');
        setIsAuthenticated(true);
        setIsFirstUse(false);
        
        // 设置axios默认请求头
        axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
        
        return true;
      } else {
        return false;
      }
    } catch (error) {
      return false;
    } finally {
      setLoading(false);
    }
  };



  return (
    <AuthContext.Provider 
      value={{ 
        isAuthenticated, 
        login,
        register,
        logout,
        token,
        username,
        loading,
        isFirstUse,
        checkFirstUse,
        setAuthenticated
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// 自定义钩子，用于在组件中使用认证上下文
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error('useAuth必须在AuthProvider内使用');
  }
  
  return context;
};