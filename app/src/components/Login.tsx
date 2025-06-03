import React, { useState, useEffect } from 'react';
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