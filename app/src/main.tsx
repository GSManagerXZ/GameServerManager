import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 创建根元素
const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} 