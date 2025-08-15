# GameServerManager 3.0

<div align="center">

# ![logo3](https://github.com/user-attachments/assets/8d1a37bd-5955-4dc2-b314-aecb04f985dc)

**新一代游戏服务器管理平台 - 让游戏服务器的部署、管理和维护变得简单高效**

[![GitHub Stars](https://badgen.net/github/stars/yxsj245/GameServerManager)](https://github.com/yxsj245/GameServerManager/stargazers)
[![GitHub Release](https://badgen.net/github/release/yxsj245/GameServerManager)](https://github.com/yxsj245/GameServerManager/releases)
[![Docker Pulls](https://badgen.net/docker/pulls/xiaozhu674/gameservermanager)](https://hub.docker.com/r/xiaozhu674/gameservermanager)
[![License](https://badgen.net/github/license/yxsj245/GameServerManager)](https://github.com/yxsj245/GameServerManager/blob/main/LICENSE)

[📖 文档站](http://docs.gsm.xiaozhuhouses.asia/) • [🌐 官方网站](http://gsm.xiaozhuhouses.asia/) • [💬 QQ群](https://qm.qq.com/q/oNd4HvMj6M)

</div>

---

## 📋 项目简介1231212

GameServerManager 3.0（简称GSM3）是一个基于现代化技术栈的游戏服务器管理平台，采用 **React + TypeScript + Node.js** 架构，专为简化游戏服务器的部署、管理和维护而设计。

## 🎉 GSM3.0 重大更新
<img width="1915" height="1004" alt="GSM3管理界面" src="https://github.com/user-attachments/assets/baccf78e-e580-45bf-ad7b-f2dd106c02ce" />


### ✨ 核心特性

- 🚀 **现代化架构** - 基于 React 18 + TypeScript + Node.js 的全栈解决方案
- 🎯 **一键部署** - 支持 Steam 平台多款热门游戏的快速部署
- 🌐 **Web 管理界面** - 基于 Ant Design 的现代化管理面板，响应式设计
- 🔧 **实时终端** - 集成 Xterm.js 的 Web 终端，支持实时命令执行和日志查看
- 📊 **资源监控** - 实时监控服务器资源使用情况和游戏实例状态
- 🔐 **权限管理** - 基于 JWT 的用户认证和权限控制系统
- 🎮 **多游戏支持** - 支持 40+ 款 Steam 游戏服务端，持续更新
- 💾 **数据持久化** - 游戏数据和配置文件统一管理，安全可靠
- 🔌 **WebSocket 通信** - 实时双向通信，即时状态更新
- 🐍 **Python 集成** - 内置 Python 环境，支持游戏配置文件可视化编辑
- 📦 **Docker 支持** - 完整的容器化部署方案，一键启动
- 🎨 **可视化配置** - 游戏配置文件的图形化编辑界面

---

## 本地开发部署

```bash
# 安装依赖
npm run install:all

# 开发模式运行
npm run dev

# 生产模式构建
npm run build
```
## 🏗️ 技术架构

### 前端技术栈
- **React 18** - 现代化前端框架，支持并发特性
- **TypeScript** - 类型安全的 JavaScript 超集
- **Ant Design 5** - 企业级 UI 组件库
- **Zustand** - 轻量级状态管理库
- **Monaco Editor** - VS Code 同款代码编辑器
- **Xterm.js** - 功能完整的 Web 终端模拟器
- **Socket.IO Client** - 实时双向通信客户端
- **Framer Motion** - 流畅的动画库
- **Vite** - 极速构建工具
- **TailwindCSS** - 原子化 CSS 框架

### 后端技术栈
- **Node.js 18+** - 高性能 JavaScript 运行时
- **TypeScript** - 类型安全的服务端开发
- **Express.js** - 轻量级 Web 框架
- **Socket.IO** - 实时双向通信服务端
- **JWT** - JSON Web Token 认证
- **Winston** - 专业级日志系统
- **Multer** - 文件上传处理
- **Node-cron** - 定时任务调度
- **Axios** - HTTP 客户端
- **Joi** - 数据验证库

### 系统集成
- **Python 3.x** - 游戏配置解析和脚本执行
- **SteamCMD** - Steam 命令行工具
- **Docker** - 容器化部署
- **PTY** - 伪终端支持（跨平台）
- **File System** - 统一文件管理系统

---

## 📁 项目结构

```
GSManager3/
├── client/                     # 前端应用
│   ├── src/                   # React + TypeScript 源码
│   │   ├── components/        # 可复用组件
│   │   ├── pages/            # 页面组件
│   │   ├── stores/           # Zustand 状态管理
│   │   ├── types/            # TypeScript 类型定义
│   │   ├── utils/            # 工具函数
│   │   └── config/           # 配置文件
│   ├── public/               # 静态资源
│   └── package.json          # 前端依赖
├── server/                    # 后端服务
│   ├── src/                  # Node.js + TypeScript 源码
│   │   ├── routes/           # API 路由
│   │   ├── modules/          # 功能模块
│   │   │   └── game/         # 游戏管理模块
│   │   ├── middleware/       # 中间件
│   │   ├── utils/            # 工具函数
│   │   └── Python/           # Python 脚本
│   ├── data/                 # 数据存储目录
│   │   ├── games/            # 游戏数据
│   │   └── plugins/          # 插件数据
│   ├── PTY/                  # 伪终端程序
│   └── package.json          # 后端依赖
├── scripts/                   # 构建脚本
├── docker-compose.yml         # Docker 编排文件
├── Dockerfile                # Docker 镜像构建文件
└── package.json              # 项目根依赖
```

## 🤝 贡献指南

我们欢迎所有形式的贡献！

1. **Fork** 本项目
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开一个 **Pull Request**

---

## 📞 支持与反馈

- 🐛 **问题反馈**：[GitHub Issues](https://github.com/yxsj245/GameServerManager/issues)
- 💬 **QQ交流群**：1040201322
- 📖 **详细文档**：[GSM3 文档站](http://docs.gsm.xiaozhuhouses.asia/)
- 🌐 **官方网站**：[GSM3 官网](http://gsm.xiaozhuhouses.asia/)
- 💝 **赞助支持**：[爱发电](https://afdian.net/a/xiaozhu674)

---

## 📄 开源协议

本项目采用 [GPL-3.0 license](LICENSE) 开源协议。

---

## 👨‍💻 关于作者

此项目由 **又菜又爱玩的小朱** 独立开发维护。

如果这个项目对你有帮助，请给个 ⭐ Star 支持一下！

---

## 🔄 版本说明

- **GSM3.0** - 全新架构，基于 React + TypeScript + Node.js
- **GSM2.0** - 基于 Python + Flask 的经典版本 [查看源码](https://github.com/GSManagerXZ/GameServerManager2)
- **GSM1.0** - 游戏容器 [查看源码](https://github.com/GSManagerXZ/Game_container)

### 主要更新

- ✅ 全新的现代化 Web 界面
- ✅ TypeScript 全栈开发，类型安全
- ✅ 实时 WebSocket 通信
- ✅ 游戏配置可视化编辑
- ✅ 更好的性能和稳定性
- ✅ 完整的 Docker 支持
- ✅ 跨平台兼容性

---

## 📈 项目统计

![Star History](https://api.star-history.com/svg?repos=yxsj245/GameServerManager&type=Date)

---

<div align="center">

**🎮 让游戏服务器管理变得简单有趣！**

**GSM3.0 - 新一代游戏服务器管理平台**

[🌐 官网](http://gsm.xiaozhuhouses.asia/) | [📖 文档](http://docs.gsm.xiaozhuhouses.asia/) | [💬 交流群](https://qm.qq.com/q/oNd4HvMj6M)

</div>
