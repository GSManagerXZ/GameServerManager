import React, { useState, useEffect, useCallback } from 'react';
import { Form, Input, Button, Card, message, Typography, Modal } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import '../App.css';
import axios from 'axios';

const { Text } = Typography;

interface LoginFormValues {
  username: string;
  password: string;
}

const Login: React.FC = () => {
  const { login, isFirstUse, checkFirstUse } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [forgotPasswordVisible, setForgotPasswordVisible] = useState(false);
  const navigate = useNavigate();
  
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
        
        // 移除跨域属性以避免CORS错误
        // img.crossOrigin = 'anonymous';
        
        const timeoutId = setTimeout(() => {
          reject(new Error(`Timeout loading image from API ${index + 1}: ${apiUrl}`));
        }, 8000); // 增加超时时间到8秒
        
        img.onload = () => {
          clearTimeout(timeoutId);
          resolve({ url: urlWithTimestamp, index });
        };
        
        img.onerror = (event) => {
          clearTimeout(timeoutId);
          console.warn(`API ${index + 1} (${apiUrl}) 加载失败:`, event);
          reject(new Error(`Failed to load image from API ${index + 1}: ${apiUrl}`));
        };
        
        img.src = urlWithTimestamp;
      });
    });
    
    // 使用Promise.race来获取最快加载完成的图片
    Promise.race(imagePromises)
      .then(({ url, index }) => {
        setCurrentBackgroundUrl(url);
        console.log(`登录页面背景图片加载成功 (API ${index + 1}):`, url);
      })
      .catch((error) => {
        console.warn('登录页面竞速加载失败，尝试逐个加载:', error);
        
        // 如果竞速失败，尝试逐个加载
        Promise.allSettled(imagePromises)
          .then((results) => {
            const successResult = results.find(result => result.status === 'fulfilled');
            if (successResult && successResult.status === 'fulfilled') {
              setCurrentBackgroundUrl(successResult.value.url);
              console.log(`登录页面背景图片备用加载成功 (API ${successResult.value.index + 1}):`, successResult.value.url);
            } else {
              console.warn('登录页面所有背景图片API都加载失败，使用默认图片');
              // 如果所有API都失败，直接使用第一个API URL（不带时间戳）
              setCurrentBackgroundUrl(backgroundApis[0]);
            }
          });
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

  // 组件加载时检查是否首次使用
  useEffect(() => {
    const check = async () => {
      const isFirst = await checkFirstUse();
      
      if (isFirst) {
        // 检查后端是否真的允许注册（即是否有现有用户）
        try {
          const response = await axios.get('/api/auth/check_first_use');
          
          if (response.data.status === 'success' && response.data.first_use === true) {
            navigate('/register');
          } else {
            // 不进行重定向，留在登录页面
          }
        } catch (error) {
          // 出错时不进行重定向，留在登录页面
        }
      }
    };
    
    check();
  }, [checkFirstUse, navigate]);

  // 如果检测到首次使用，重定向到注册页面
  useEffect(() => {
    if (isFirstUse) {
      // 检查后端是否真的允许注册（即是否有现有用户）
      const verifyFirstUse = async () => {
        try {
          const response = await axios.get('/api/auth/check_first_use');
          if (response.data.status === 'success' && response.data.first_use === true) {
            navigate('/register');
          } else {
            // 不重定向，留在登录页面
          }
        } catch (error) {
          // 出错时不重定向
        }
      };
      
      verifyFirstUse();
    }
  }, [isFirstUse, navigate]);

  const onFinish = async (values: LoginFormValues) => {
    try {
      setLoading(true);
      setLoginError(false);
      const success = await login(values.username, values.password);
      
      if (success) {
        // 登录成功动画
        setLoginSuccess(true);
        message.success('登录成功');
        
        // 延迟导航，等待动画完成
        setTimeout(() => {
          navigate('/');
        }, 500);
      } else {
        setLoginError(true);
        message.error('登录失败：用户名或密码错误');
        
        // 重置错误状态以便再次尝试
        setTimeout(() => {
          setLoginError(false);
        }, 500);
      }
    } catch (error) {
      setLoginError(true);
      message.error('登录过程中发生错误，请稍后重试');
      
      // 重置错误状态以便再次尝试
      setTimeout(() => {
        setLoginError(false);
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
      const formElement = document.querySelector('.login-card');
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

  // 处理忘记密码点击
  const handleForgotPassword = () => {
    setForgotPasswordVisible(true);
  };

  // 关闭忘记密码弹窗
  const handleForgotPasswordClose = () => {
    setForgotPasswordVisible(false);
  };

  return (
    <div className={`login-container ${loginSuccess ? 'login-success' : ''}`}>
      <Card 
        title="GameServerManager"
        className={`login-card ${hasFocus ? 'focused' : ''}`}
      >
        <Form
          name="login"
          initialValues={{ remember: true }}
          onFinish={onFinish}
          size="large"
          className={loginError ? 'login-error' : ''}
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

          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              block
              className="login-form-button"
              onMouseMove={handleButtonMouseMove}
              onMouseLeave={handleButtonMouseLeave}
            >
              登录
            </Button>
          </Form.Item>
          
          <div style={{ textAlign: 'center', display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">
              <a onClick={handleForgotPassword} style={{ cursor: 'pointer' }}>
                忘记密码?
              </a>
            </Text>
            <Text type="secondary">
              首次使用? <Link to="/register">注册账户</Link>
            </Text>
          </div>
        </Form>
      </Card>
      
      <Modal
        title="忘记密码"
        open={forgotPasswordVisible}
        onCancel={handleForgotPasswordClose}
        footer={[
          <Button key="ok" type="primary" onClick={handleForgotPasswordClose}>
            我知道了
          </Button>
        ]}
        width={500}
      >
        <div style={{ padding: '16px 0' }}>
          <Text>
            请手动前往删除/home/steam/games映射的宿主路径下的config.json文件后刷新网页即可
          </Text>
        </div>
      </Modal>
    </div>
  );
};

export default Login;