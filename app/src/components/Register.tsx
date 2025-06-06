import React, { useState, useEffect, useCallback } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../App.css';

const { Title, Paragraph } = Typography;

interface RegisterProps {
  onRegisterSuccess?: (token: string, username: string, role: string) => void;
}

const Register: React.FC<RegisterProps> = ({ onRegisterSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [registerError, setRegisterError] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const navigate = useNavigate();
  const { setAuthenticated } = useAuth();
  
  // 新增：当前背景图片URL
  const [currentBackgroundUrl, setCurrentBackgroundUrl] = useState<string>('https://t.alcy.cc/ycy');
  
  // 新增：背景图片API列表
  const backgroundApis = [
    'https://t.alcy.cc/ycy',
    'https://random-image-api.bakacookie520.top/pc-dark'
  ];
  
  // 新增：竞速加载背景图片
  const loadRandomBackground = useCallback(() => {
    // 创建Promise数组，每个API一个Promise
    const imagePromises = backgroundApis.map((apiUrl, index) => {
      return new Promise<{url: string, index: number}>((resolve, reject) => {
        const img = new Image();
        const timestamp = Date.now();
        const urlWithTimestamp = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}t=${timestamp}`;
        
        img.onload = () => {
          resolve({ url: urlWithTimestamp, index });
        };
        
        img.onerror = () => {
          reject(new Error(`Failed to load image from API ${index + 1}`));
        };
        
        // 设置超时时间为5秒
        setTimeout(() => {
          reject(new Error(`Timeout loading image from API ${index + 1}`));
        }, 5000);
        
        img.src = urlWithTimestamp;
      });
    });
    
    // 使用Promise.race来获取最快加载完成的图片
    Promise.race(imagePromises)
      .then(({ url }) => {
        setCurrentBackgroundUrl(url);
        console.log('注册页面背景图片加载成功:', url);
      })
      .catch((error) => {
        console.warn('注册页面所有背景图片API加载失败，使用默认图片:', error);
        // 如果所有API都失败，使用第一个API作为备用
        setCurrentBackgroundUrl(backgroundApis[0]);
      });
  }, []);

  // 新增：在组件挂载时加载随机背景
  useEffect(() => {
    loadRandomBackground();
  }, [loadRandomBackground]);
  
  // 新增：动态设置CSS变量来更新背景图片
  useEffect(() => {
    if (currentBackgroundUrl) {
      document.documentElement.style.setProperty('--dynamic-bg-url', `url('${currentBackgroundUrl}')`);
    }
    
    // 组件卸载时清理CSS变量
    return () => {
      document.documentElement.style.removeProperty('--dynamic-bg-url');
    };
  }, [currentBackgroundUrl]);

  const onFinish = async (values: { username: string; password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error('两次输入的密码不一致');
      return;
    }

    try {
      setLoading(true);
      setRegisterError(false);
      const response = await axios.post('/api/auth/register', {
        username: values.username,
        password: values.password
      });

      if (response.data.status === 'success') {
        // 注册成功动画
        setRegisterSuccess(true);
        message.success('注册成功');
        
        // 保存认证信息
        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('username', values.username);
        
        // 设置axios默认请求头
        axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
        
        // 更新认证状态
        setAuthenticated(response.data.token, values.username, response.data.role || 'user');
        
        // 延迟导航，等待动画完成
        setTimeout(() => {
          // 调用成功回调（如果提供）
          if (onRegisterSuccess) {
            onRegisterSuccess(response.data.token, values.username, response.data.role || 'user');
          } else {
            navigate('/');
          }
        }, 500);
      } else {
        setRegisterError(true);
        message.error(response.data.message || '注册失败');
        
        // 重置错误状态以便再次尝试
        setTimeout(() => {
          setRegisterError(false);
        }, 500);
      }
    } catch (error: any) {
      setRegisterError(true);
      // 特殊处理已有用户的情况
      if (error.response?.status === 403 && 
          error.response?.data?.message?.includes('仅允许一个用户')) {
        message.error('系统仅允许一个管理员账户，已有账户存在，请使用登录功能');
        // 延迟跳转到登录页
        setTimeout(() => {
          navigate('/login');
        }, 2000);
      } else {
        message.error(error.response?.data?.message || '注册失败，请稍后重试');
      }
      
      // 重置错误状态以便再次尝试
      setTimeout(() => {
        setRegisterError(false);
      }, 500);
    } finally {
      setLoading(false);
    }
  };

  // 处理表单项获得焦点的函数
  const handleFocus = () => {
    setHasFocus(true);
  };

  // 处理表单项失去焦点的函数
  const handleBlur = () => {
    // 延迟设置失去焦点，以防止在切换表单项时闪烁
    setTimeout(() => {
      const activeElement = document.activeElement;
      const formElement = document.querySelector('.register-card');
      if (formElement && !formElement.contains(activeElement)) {
        setHasFocus(false);
      }
    }, 100);
  };

  // 处理按钮鼠标移动事件，创建跟随鼠标的光影效果
  const handleButtonMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    const rect = button.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // 计算鼠标相对于按钮中心的位置
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const deltaX = (x - centerX) / centerX;
    const deltaY = (y - centerY) / centerY;
    
    // 增强3D效果的计算
    const enhancedDeltaX = deltaX * 2; // 增加倾斜幅度
    const enhancedDeltaY = deltaY * 2;
    
    // 设置CSS变量来控制光影位置
    button.style.setProperty('--mouse-x', `${x}px`);
    button.style.setProperty('--mouse-y', `${y}px`);
    button.style.setProperty('--delta-x', enhancedDeltaX.toString());
    button.style.setProperty('--delta-y', enhancedDeltaY.toString());
  };

  // 处理按钮鼠标离开事件
  const handleButtonMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    button.style.removeProperty('--mouse-x');
    button.style.removeProperty('--mouse-y');
    button.style.removeProperty('--delta-x');
    button.style.removeProperty('--delta-y');
  };

  return (
    <div className={`register-container ${registerSuccess ? 'register-success' : ''}`}>
      <Card 
        title="欢迎使用GameServerManager"
        className={`register-card ${hasFocus ? 'focused' : ''}`}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Paragraph style={{ color: '#666', fontSize: '14px' }}>首次使用，请注册管理员账号</Paragraph>
        </div>
        
        <Form
          name="register_form"
          initialValues={{ remember: true }}
          onFinish={onFinish}
          size="large"
          className={registerError ? 'register-error' : ''}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名!' }]}
          >
            <Input 
              prefix={<UserOutlined />} 
              placeholder="用户名" 
              onFocus={handleFocus}
              onBlur={handleBlur}
            />
          </Form.Item>
          
          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码!' }]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="密码" 
              onFocus={handleFocus}
              onBlur={handleBlur}
            />
          </Form.Item>
          
          <Form.Item
            name="confirmPassword"
            rules={[{ required: true, message: '请确认密码!' }]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="确认密码" 
              onFocus={handleFocus}
              onBlur={handleBlur}
            />
          </Form.Item>
          
          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              block
              className="register-form-button"
              onMouseMove={handleButtonMouseMove}
              onMouseLeave={handleButtonMouseLeave}
            >
              注册
            </Button>
          </Form.Item>
          
          <div style={{ textAlign: 'center' }}>
            <Typography.Text type="secondary">
              已有账户? <Link to="/login">立即登录</Link>
            </Typography.Text>
          </div>
        </Form>
      </Card>
    </div>
  );
};

export default Register;