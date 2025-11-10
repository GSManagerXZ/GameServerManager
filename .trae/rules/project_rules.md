1. 将服务端所有需要保存的数据统一保存在server\data 目录下
2. 前端使用的token存储键是'gsm3_token'
4. 需要安装的库直接写进package.json文件中
5. 切记所有涉及/api接口必须要加认证中间件import { authenticateToken } from '../middleware/auth.js'前端的6. 实例管理 API 调用都通过 `api.ts` 中的 ApiClient 类进行
7. 涉及实时通信相关需要使用websocket
8. 操作config.json可以使用ConfigManager
9. 改动目前已有的代码时要遵循当前设计逻辑，比如注释掉的代码非必要不要取消，部分功能没限制非必要不要限制
10. 所有涉及弹窗的需要加淡入淡出动画
11. 新增页面不要使用Ant Design 要确保于面板其它地方样式风格保持一致
12. 通知要使用面板的消息组件
13. 涉及路径需要使用多个路径尝试
```typescript
const baseDir = process.cwd()
const possiblePaths = [
    path.join(baseDir, 'data', 'games', 'installgame.json'),           // 打包后的路径
    path.join(baseDir, 'server', 'data', 'games', 'installgame.json'), // 开发环境路径
]
```
14. 涉及交互弹窗的，不要使用浏览器的对话框 使用符合面板风格的弹窗组件
15. 如果需要识别操作系统平台有专门的函数，你需要查找不需要单独写
16. 项目分为前端和后端 浏览器和后端访问的不一定在同一环境和平台，所以请不要使用浏览器侧相关检测等。应当使用后端方法。