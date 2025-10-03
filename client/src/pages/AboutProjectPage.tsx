import React, { useState } from 'react'
import { Github, Info, Heart, Star, GitFork, Eye, ExternalLink, BookOpen } from 'lucide-react'

const AboutProjectPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('docs')

  const tabs = [
    { id: 'docs', label: '文档站', icon: BookOpen },
    { id: 'github', label: 'Github', icon: Github },
    { id: 'afdian', label: '爱发电', icon: Heart },
    { id: 'info', label: '项目信息', icon: Info }
  ]

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="glass rounded-lg p-6 border border-white/20 dark:border-gray-700/30">
        <h1 className="text-2xl font-bold text-black dark:text-white mb-2">关于项目</h1>
        <p className="text-gray-600 dark:text-gray-400">
          了解 GSM3 游戏服务器管理器的详细信息
        </p>
      </div>

      {/* 标签页导航 */}
      <div className="glass rounded-lg border border-white/20 dark:border-gray-700/30">
        <div className="border-b border-white/20 dark:border-gray-700/30">
          <nav className="flex space-x-8 px-6">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors
                    ${isActive
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                    }
                  `}
                >
                  <tab.icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* 标签页内容 */}
        <div className="p-6">
          {activeTab === 'docs' && (
            <div className="space-y-4">
              <div className="flex items-center space-x-3 mb-4">
                <BookOpen className="w-6 h-6 text-blue-500" />
                <h2 className="text-xl font-semibold text-black dark:text-white">文档站</h2>
              </div>
              
              {/* 文档站嵌入页面 */}
              <div className="w-full h-[600px] border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                <iframe
                  src="https://docs.gsm.xiaozhuhouses.asia/"
                  className="w-full h-full"
                  title="GSM3 文档站"
                  frameBorder="0"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                />
              </div>
              
              <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>文档说明：</strong> 这里包含了 GSM3 的完整使用文档。
                  <a 
                    href="https://docs.gsm.xiaozhuhouses.asia/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="ml-2 text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    https://docs.gsm.xiaozhuhouses.asia/
                  </a>
                </p>
              </div>
            </div>
          )}

          {activeTab === 'github' && (
            <div className="space-y-6">
              <div className="flex items-center space-x-3 mb-6">
                <Github className="w-6 h-6 text-gray-700 dark:text-gray-300" />
                <h2 className="text-xl font-semibold text-black dark:text-white">GitHub 仓库</h2>
              </div>
              
              {/* GitHub 仓库卡片 */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                      <Github className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-black dark:text-white">
                        GSManagerXZ/GameServerManager
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">公开仓库</p>
                    </div>
                  </div>
                  <a
                    href="https://github.com/GSManagerXZ/GameServerManager"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-2 px-4 py-2 bg-gray-900 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>访问仓库</span>
                  </a>
                </div>
                
                <p className="text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                  GSM3 游戏服务器管理器 - 一个现代化的游戏服务器管理平台，支持多种游戏服务器的部署、管理和监控。
                  提供直观的 Web 界面，实时终端管理，自动化部署等功能。
                </p>
                
                {/* 仓库统计信息 */}
                <div className="flex items-center space-x-6 text-sm text-gray-600 dark:text-gray-400 mb-4">
                  <div className="flex items-center space-x-1">
                    <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                    <span>TypeScript</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Star className="w-4 h-4" />
                    <span>Star</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <GitFork className="w-4 h-4" />
                    <span>Fork</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Eye className="w-4 h-4" />
                    <span>Watch</span>
                  </div>
                </div>
                
                {/* 技术标签 */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-xs rounded-full">
                    React
                  </span>
                  <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-xs rounded-full">
                    Node.js
                  </span>
                  <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 text-xs rounded-full">
                    TypeScript
                  </span>
                  <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 text-xs rounded-full">
                    Express
                  </span>
                  <span className="px-2 py-1 bg-pink-100 dark:bg-pink-900/30 text-pink-800 dark:text-pink-300 text-xs rounded-full">
                    游戏服务器
                  </span>
                </div>
                
                {/* 最近更新 */}
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  最近更新：持续开发中
                </div>
              </div>
              
              {/* 快速链接 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <a
                  href="https://github.com/GSManagerXZ/GameServerManager/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-3 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                >
                  <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                    <ExternalLink className="w-5 h-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <h4 className="font-medium text-black dark:text-white">问题反馈</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">报告 Bug 或提出建议</p>
                  </div>
                </a>
                
                <a
                  href="https://github.com/GSManagerXZ/GameServerManager/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-3 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                >
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                    <ExternalLink className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h4 className="font-medium text-black dark:text-white">版本发布</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">查看最新版本和更新日志</p>
                  </div>
                </a>
              </div>
            </div>
          )}

          {activeTab === 'afdian' && (
            <div className="space-y-4">
              <div className="flex items-center space-x-3 mb-4">
                <Heart className="w-6 h-6 text-red-500" />
                <h2 className="text-xl font-semibold text-black dark:text-white">爱发电支持</h2>
              </div>
              
              {/* 爱发电嵌入页面 */}
              <div className="w-full h-[600px] border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                <iframe
                  src="https://afdian.com/a/xiaozhuhouses"
                  className="w-full h-full"
                  title="爱发电支持页面"
                  frameBorder="0"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                />
              </div>
              
              <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-800 dark:text-red-200">
                  <strong>感谢支持：</strong> 如果您觉得这个项目对您有帮助，欢迎通过爱发电支持开发者！
                  <a 
                    href="https://afdian.com/a/xiaozhuhouses" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="ml-2 text-red-600 dark:text-red-400 hover:underline"
                  >
                    https://afdian.com/a/xiaozhuhouses
                  </a>
                </p>
              </div>
            </div>
          )}

          {activeTab === 'info' && (
            <div className="space-y-6">
              <div className="flex items-center space-x-3 mb-4">
                <Info className="w-6 h-6 text-gray-700 dark:text-gray-300" />
                <h2 className="text-xl font-semibold text-black dark:text-white">项目信息</h2>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 项目基本信息 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-black dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                    基本信息
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">项目名称：</span>
                      <span className="text-black dark:text-white font-medium">GSM3 游戏服务器管理器</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">版本：</span>
                      <span className="text-black dark:text-white font-medium">3.8.6</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">开发者：</span>
                      <span className="text-black dark:text-white font-medium">又菜又爱玩的小朱</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">许可证：</span>
                      <span className="text-black dark:text-white font-medium">GPL-3.0 license</span>
                    </div>
                  </div>
                </div>

                {/* 技术栈 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-black dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                    技术栈
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">前端：</span>
                      <span className="text-black dark:text-white font-medium">React + TypeScript + Vite</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">后端：</span>
                      <span className="text-black dark:text-white font-medium">Node.js + Express + TypeScript</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">样式：</span>
                      <span className="text-black dark:text-white font-medium">Tailwind CSS</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">图标：</span>
                      <span className="text-black dark:text-white font-medium">Lucide React</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">终端PTY:</span>
                      <span className="text-black dark:text-white font-medium">MCSManager/PTY</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 项目描述 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-black dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                  项目描述
                </h3>
                <div className="prose prose-gray dark:prose-invert max-w-none">
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                    GSM3 是一个现代化的游戏服务器管理器，专为简化游戏服务器的部署、管理和监控而设计。
                    它提供了直观的 Web 界面，支持多种游戏服务器的管理，包括但不限于 Minecraft、
                    Counter-Strike 等热门游戏。
                  </p>
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                    主要特性包括：实时终端管理、服务器实例控制、自动化部署、定时任务调度、
                    文件管理。通过现代化的技术栈和优雅的用户界面，
                    让游戏服务器管理变得更加简单高效。
                  </p>
                </div>
              </div>

              {/* 功能特性 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-black dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                  主要功能
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h4 className="font-medium text-black dark:text-white">核心功能</h4>
                    <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                      <li>• 实时终端管理</li>
                      <li>• 服务器实例控制</li>
                      <li>• 游戏服务器部署</li>
                      <li>• 文件管理系统</li>
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium text-black dark:text-white">高级功能</h4>
                    <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                      <li>• 定时任务调度</li>
                      <li>• 系统监控</li>
                      <li>• 主题切换</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AboutProjectPage