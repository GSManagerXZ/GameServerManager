1. 将服务端所有需要保存的数据统一保存在server\data 目录下
2. 前端使用的token存储键是'gsm3_token'
3. 路由文件的导入语句需要添加.js扩展名。
4. 需要安装的库直接写进package.json文件中
5. 切记所有涉及/api接口必须要加认证中间件import { authenticateToken } from '../middleware/auth.js'前端的6. 实例管理 API 调用都通过 `api.ts` 中的 ApiClient 类进行
7. 涉及实时通信相关需要使用websocket
8. 操作config.json可以使用ConfigManager
9. 改动目前已有的代码时要遵循当前设计逻辑，比如注释掉的代码非必要不要取消，部分功能没限制非必要不要限制
10. 所有涉及弹窗的需要加淡入淡出动画
11. 新增页面除文件管理外，不要使用Ant Design 要确保于面板其它地方样式风格保持一致
12. 通知要使用面板的消息组件
13. 涉及路径需要使用多个路径尝试
```typescript
const baseDir = process.cwd()
const possiblePaths = [
    path.join(baseDir, 'data', 'games', 'installgame.json'),           // 打包后的路径
    path.join(baseDir, 'server', 'data', 'games', 'installgame.json'), // 开发环境路径
]
```