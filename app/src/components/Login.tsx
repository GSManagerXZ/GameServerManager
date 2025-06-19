import React, { useState, useEffect, useCallback } from 'react';
import { Form, Input, Button, Card, message, Typography, Modal, Tooltip } from 'antd';
import { UserOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
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
  const { login, isFirstUse, checkFirstUse, setAuthenticated } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [forgotPasswordVisible, setForgotPasswordVisible] = useState(false);
  const navigate = useNavigate();
  
  // 检查Web Authentication API支持
  useEffect(() => {
    const checkBiometricSupport = () => {
      try {
        console.log('开始检查Web Authentication API支持...');
        console.log('window.PublicKeyCredential:', !!window.PublicKeyCredential);
        console.log('navigator.credentials:', !!navigator.credentials);
        console.log('location.protocol:', location.protocol);
        console.log('location.hostname:', location.hostname);
        console.log('window.isSecureContext:', window.isSecureContext);
        
        // 检查浏览器是否支持Web Authentication API
        if (typeof window.PublicKeyCredential !== 'undefined' && 
            navigator.credentials && 
            typeof navigator.credentials.create === 'function' &&
            typeof navigator.credentials.get === 'function') {
          
          console.log('Web Authentication API基础支持检查通过');
          
          // 简化安全上下文检查，允许更多环境
          const isLocalhost = location.hostname === 'localhost' || 
                             location.hostname === '127.0.0.1' ||
                             location.hostname === '0.0.0.0';
          const isHttps = location.protocol === 'https:';
          const isHttp = location.protocol === 'http:';
          
          // 在开发环境或本地环境下放宽限制
          if (isHttps || isLocalhost || isHttp) {
            setBiometricSupported(true);
            console.log('Web Authentication API支持已启用');
            
            if (isHttp && !isLocalhost) {
              console.warn('注意：在HTTP环境下使用生物识别可能存在安全风险，建议使用HTTPS');
            }
          } else {
            console.warn('Web Authentication API需要安全上下文或本地环境');
            setBiometricSupported(false);
          }
        } else {
          console.warn('浏览器不支持Web Authentication API');
          console.log('缺少的API:', {
            PublicKeyCredential: !window.PublicKeyCredential,
            credentials: !navigator.credentials,
            create: !navigator.credentials?.create,
            get: !navigator.credentials?.get
          });
          setBiometricSupported(false);
        }
      } catch (error) {
        console.error('检查Web Authentication API支持时出错:', error);
        setBiometricSupported(false);
      }
    };
    
    checkBiometricSupport();
  }, []);
  
  // 生成随机挑战值
  const generateChallenge = (): Uint8Array => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return array;
  };
  
  // 将ArrayBuffer转换为Base64
  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };
  
  // 将Base64转换为ArrayBuffer
  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  };
  
  // 注册生物识别认证
  const registerBiometric = async (username: string) => {
    if (!biometricSupported) {
      message.error('当前环境不支持生物识别认证');
      return;
    }
    
    try {
      setBiometricLoading(true);
      
      // 生成注册选项
      const challenge = generateChallenge();
      const userId = new TextEncoder().encode(username);
      
      const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
        challenge,
        rp: {
          name: 'GameServerManager',
          id: location.hostname,
        },
        user: {
          id: userId,
          name: username,
          displayName: username,
        },
        pubKeyCredParams: [
          {
            alg: -7, // ES256
            type: 'public-key',
          },
          {
            alg: -257, // RS256
            type: 'public-key',
          },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        timeout: 60000,
        attestation: 'direct',
      };
      
      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
      }) as PublicKeyCredential;
      
      if (credential) {
        const response = credential.response as AuthenticatorAttestationResponse;
        
        // 将凭据信息发送到后端保存
        const credentialData = {
          id: credential.id,
          rawId: arrayBufferToBase64(credential.rawId),
          type: credential.type,
          response: {
            attestationObject: arrayBufferToBase64(response.attestationObject),
            clientDataJSON: arrayBufferToBase64(response.clientDataJSON),
          },
          username,
        };
        
        await axios.post('/api/auth/register_biometric', credentialData);
        message.success('生物识别认证注册成功！');
      }
    } catch (error: any) {
      console.error('生物识别注册失败:', error);
      if (error.name === 'NotAllowedError') {
        message.error('用户取消了生物识别注册');
      } else if (error.name === 'NotSupportedError') {
        message.error('设备不支持生物识别认证');
      } else {
        message.error('生物识别注册失败，请稍后重试');
      }
    } finally {
      setBiometricLoading(false);
    }
  };
  
  // 检查生物识别支持并显示详细错误信息
  const checkBiometricSupportWithDetails = () => {
    const reasons = [];
    
    if (typeof window.PublicKeyCredential === 'undefined') {
      reasons.push('浏览器不支持Web Authentication API');
    }
    
    if (!navigator.credentials) {
      reasons.push('浏览器不支持Credentials API');
    }
    
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      reasons.push('需要HTTPS安全连接或本地环境');
    }
    
    return {
      supported: reasons.length === 0,
      reasons
    };
  };
  
  // 处理生物识别按钮点击
  const handleBiometricClick = () => {
    if (!biometricSupported) {
      const { reasons } = checkBiometricSupportWithDetails();
      
      Modal.warning({
        title: '生物识别不可用',
        content: (
          <div>
            <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f0f8ff', borderRadius: '6px', border: '1px solid #d1ecf1' }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#0c5460', fontSize: '14px' }}>💡 什么是生物识别？</h4>
              <p style={{ margin: 0, fontSize: '13px', color: '#0c5460', lineHeight: '1.5' }}>
                生物识别是一种基于Web Authentication API技术实现的安全认证方式。它允许网站使用设备内置的生物识别功能（如指纹识别、面部识别等）进行身份验证，无需输入密码。这种方式不仅方便快捷，而且更加安全，因为生物特征数据始终存储在设备的安全区域内，不会传输到网站服务器。Web Authentication API（也称为WebAuthn）是W3C和FIDO联盟共同制定的网络标准，已被主流浏览器广泛支持
              </p>
            </div>
            <p>您的浏览器或环境不支持生物识别登录，原因如下：</p>
            <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
              {reasons.map((reason, index) => (
                <li key={index} style={{ marginBottom: '4px' }}>{reason}</li>
              ))}
            </ul>
            <p style={{ marginTop: '12px', color: '#666' }}>
              建议：使用支持WebAuthn的现代浏览器（如Chrome、Edge、Firefox、Safari等）并确保在HTTPS环境下访问。
            </p>
          </div>
        ),
        okText: '我知道了',
        width: 600
      });
      return;
    }
    
    loginWithBiometric();
  };

  // 使用生物识别登录
  const loginWithBiometric = async () => {
    
    try {
      setBiometricLoading(true);
      setLoginError(false);
      
      // 从后端获取认证选项
      const challengeResponse = await axios.get('/api/auth/biometric_challenge');
      const { challenge, allowCredentials } = challengeResponse.data;
      
      const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
        challenge: base64ToArrayBuffer(challenge),
        allowCredentials: allowCredentials.map((cred: any) => ({
          id: base64ToArrayBuffer(cred.id),
          type: 'public-key',
        })),
        userVerification: 'required',
        timeout: 60000,
      };
      
      const assertion = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions,
      }) as PublicKeyCredential;
      
      if (assertion) {
        const response = assertion.response as AuthenticatorAssertionResponse;
        
        // 将认证信息发送到后端验证
        const assertionData = {
          id: assertion.id,
          rawId: arrayBufferToBase64(assertion.rawId),
          type: assertion.type,
          response: {
            authenticatorData: arrayBufferToBase64(response.authenticatorData),
            clientDataJSON: arrayBufferToBase64(response.clientDataJSON),
            signature: arrayBufferToBase64(response.signature),
            userHandle: response.userHandle ? arrayBufferToBase64(response.userHandle) : null,
          },
        };
        
        const verifyResponse = await axios.post('/api/auth/verify_biometric', assertionData);
        
        if (verifyResponse.data.status === 'success') {
          // 登录成功
          setLoginSuccess(true);
          message.success('生物识别登录成功！');
          
          // 设置认证状态
          setAuthenticated(verifyResponse.data.token, verifyResponse.data.username, verifyResponse.data.role || 'user');
          
          // 延迟导航，等待动画完成
          setTimeout(() => {
            navigate('/');
          }, 500);
        } else {
          setLoginError(true);
          message.error('生物识别验证失败');
        }
      }
    } catch (error: any) {
      console.error('生物识别登录失败:', error);
      setLoginError(true);
      
      if (error.name === 'NotAllowedError') {
        message.error('用户取消了生物识别认证');
      } else if (error.name === 'NotSupportedError') {
        message.error('设备不支持生物识别认证');
      } else if (error.response?.status === 404) {
        message.error('未找到已注册的生物识别信息，请先注册');
      } else {
        message.error('生物识别登录失败，请稍后重试');
      }
      
      // 重置错误状态
      setTimeout(() => {
        setLoginError(false);
      }, 500);
    } finally {
      setBiometricLoading(false);
    }
  };
  
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
        
        // 如果支持生物识别且用户还未注册，询问是否注册
        if (biometricSupported) {
          // 检查用户是否已经选择永久跳过
          const skipBiometric = localStorage.getItem(`skipBiometric_${values.username}`);
          if (skipBiometric !== 'true') {
            setTimeout(() => {
              Modal.confirm({
                title: '生物识别认证',
                content: (
                  <div>
                    <p>是否要为您的账户注册生物识别认证（如指纹、面部识别等）？这将让您下次登录更加便捷和安全。</p>
                    <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                      <button 
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #d9d9d9',
                          borderRadius: '4px',
                          background: '#fff',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                        onClick={() => {
                          registerBiometric(values.username);
                          Modal.destroyAll();
                        }}
                      >
                        注册
                      </button>
                      <button 
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #d9d9d9',
                          borderRadius: '4px',
                          background: '#fff',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                        onClick={() => {
                          Modal.destroyAll();
                        }}
                      >
                        取消
                      </button>
                      <button 
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #ff4d4f',
                          borderRadius: '4px',
                          background: '#fff',
                          color: '#ff4d4f',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                        onClick={() => {
                          localStorage.setItem(`skipBiometric_${values.username}`, 'true');
                          Modal.destroyAll();
                          message.info('已永久跳过生物识别注册');
                        }}
                      >
                        永久跳过
                      </button>
                    </div>
                  </div>
                ),
                footer: null, // 隐藏默认按钮
                width: 500
              });
            }, 1000);
          }
        }
        
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
          
          <Form.Item>
            <Tooltip 
              title={!biometricSupported ? "您的浏览器不支持生物识别，点击查看详情" : ""}
              placement="top"
            >
              <Button 
                type="default" 
                icon={<SafetyCertificateOutlined />}
                loading={biometricLoading}
                block
                className="biometric-login-button"
                onClick={handleBiometricClick}
                style={{
                  marginTop: '8px',
                  background: biometricSupported 
                    ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' 
                    : '#f5f5f5',
                  border: 'none',
                  color: biometricSupported ? 'white' : '#bfbfbf',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                生物识别登录
              </Button>
            </Tooltip>
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