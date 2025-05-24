// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  },
  build: {
    // 输出目录
    outDir: 'dist',
    // 资源文件目录
    assetsDir: 'assets',
    // 确保静态资源的路径是相对路径
    base: './',
    // 为了更好的兼容性
    target: 'es2015'
  }
}) 