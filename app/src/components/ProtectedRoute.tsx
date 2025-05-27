import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, loading, isFirstUse, checkFirstUse } = useAuth();
  const [verifyingFirstUse, setVerifyingFirstUse] = useState(false);
  const [shouldRedirectToRegister, setShouldRedirectToRegister] = useState(false);
  const [verificationComplete, setVerificationComplete] = useState(false);

  // 记录状态变化，帮助调试
  useEffect(() => {
  }, [isAuthenticated, loading, isFirstUse]);

  // 验证首次使用状态
  useEffect(() => {
    const verifyFirstUse = async () => {
      if (isFirstUse) {
        setVerifyingFirstUse(true);
        try {
          // 调用后端API检查是否真的是首次使用
          const response = await axios.get('/api/auth/check_first_use');
          
          if (response.data.status === 'success' && response.data.first_use === true) {
            setShouldRedirectToRegister(true);
          } else {
            setShouldRedirectToRegister(false);
          }
        } catch (error) {
          setShouldRedirectToRegister(false);
        } finally {
          setVerifyingFirstUse(false);
          setVerificationComplete(true);
        }
      } else {
        // 不是首次使用
        setShouldRedirectToRegister(false);
        setVerificationComplete(true);
      }
    };
    
    verifyFirstUse();
  }, [isFirstUse]);

  // 等待加载或验证过程
  if (loading || verifyingFirstUse) {
    return (
      <div className="loading-container" style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  // 验证完成后判断是否重定向到注册页面
  if (verificationComplete && shouldRedirectToRegister) {
    return <Navigate to="/register" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute; 