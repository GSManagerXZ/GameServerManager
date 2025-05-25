import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const { Title, Paragraph } = Typography;

interface RegisterProps {
  onRegisterSuccess?: (token: string, username: string, role: string) => void;
}

const Register: React.FC<RegisterProps> = ({ onRegisterSuccess }) => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuthenticated } = useAuth();
  
  // 组件挂载时记录日志
  useEffect(() => {
    return () => {
    };
  }, []);

  const onFinish = async (values: { username: string; password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error('两次输入的密码不一致');
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post('/api/auth/register', {
        username: values.username,
        password: values.password
      });

      if (response.data.status === 'success') {
        message.success('注册成功');
        
        // 保存认证信息
        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('username', values.username);
        
        // 设置axios默认请求头
        axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
        
        // 更新认证状态
        setAuthenticated(response.data.token, values.username, response.data.role || 'user');
        
        // 调用成功回调（如果提供）
        if (onRegisterSuccess) {
          onRegisterSuccess(response.data.token, values.username, response.data.role || 'user');
        } else {
          navigate('/');
        }
      } else {
        message.error(response.data.message || '注册失败');
      }
    } catch (error: any) {
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh', 
      width: '100%',
      background: '#f0f2f5',
      position: 'absolute',
      top: 0,
      left: 0,
      zIndex: 1000
    }}>
      <Card style={{ width: 400, boxShadow: '0 4px 8px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={2}>欢迎使用游戏容器</Title>
          <Paragraph>首次使用，请注册管理员账号</Paragraph>
        </div>
        
        <Form
          name="register_form"
          initialValues={{ remember: true }}
          onFinish={onFinish}
          layout="vertical"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名!' }]}
          >
            <Input 
              prefix={<UserOutlined />} 
              placeholder="用户名" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码!' }]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="密码" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item
            name="confirmPassword"
            rules={[{ required: true, message: '请确认密码!' }]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="确认密码" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              style={{ width: '100%' }} 
              size="large"
              loading={loading}
            >
              注册
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default Register; 