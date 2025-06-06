import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.tsx'
import Login from './components/Login.tsx'
import Register from './components/Register.tsx'
import NotFound from './components/NotFound.tsx'
import ProtectedRoute from './components/ProtectedRoute.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import BetaNotice from './components/BetaNotice.tsx'
import './monaco-config.ts'
import './index.css'

// 创建根元素
const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          {/* 欢迎弹窗在所有页面显示 */}
          <BetaNotice />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={
              <Register onRegisterSuccess={() => {
                window.location.href = '/';
              }} />
            } />
            <Route path="/" element={
              <ProtectedRoute>
                <App />
              </ProtectedRoute>
            } />
            {/* 捕获 App 内部的路由 */}
            <Route path="/app/*" element={
              <ProtectedRoute>
                <App />
              </ProtectedRoute>
            } />
            {/* 捕获所有不匹配的路由 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>,
  );
}