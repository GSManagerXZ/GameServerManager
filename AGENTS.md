# AI 开发规范

1. 服务端所有需要持久保存的数据统一放在 `server/data` 目录下。涉及打包后运行的路径时，必须同时兼容 `data/...` 和 `server/data/...` 等开发/打包路径。
2. 前端登录 token 的本地存储键是 `gsm3_token`。
3. 需要安装的库直接写进对应 `package.json`，不要只依赖本地临时安装状态。
4. 所有涉及 `/api` 的接口默认必须加认证中间件，通常使用 `import { authenticateToken } from '../middleware/auth.js'`。如确实需要公开接口，必须在代码注释或文档中说明公开理由和可暴露的数据范围。
5. 前端实例管理 API 调用通过 `client/src/utils/api.ts` 中的 `ApiClient` 类进行，避免散落手写请求。
6. 涉及实时通信的功能使用 WebSocket。
7. 操作 `config.json` 优先使用 `ConfigManager`。
8. 改动已有代码时遵循当前设计逻辑。注释掉的代码非必要不要恢复；已有功能没有明确限制时，非必要不要新增限制。
9. 涉及弹窗、确认框、交互对话框时，不使用浏览器原生对话框，使用符合面板风格的组件，并保留淡入淡出动画。
10. 新增页面不要使用 Ant Design，确保与面板其它页面的样式风格保持一致。
11. 通知使用面板现有消息组件。
12. 路径读取需要尝试多个可能位置，例如：

```typescript
const baseDir = process.cwd()
const possiblePaths = [
  path.join(baseDir, 'data', 'games', 'installgame.json'),           // 打包后的路径
  path.join(baseDir, 'server', 'data', 'games', 'installgame.json'), // 开发环境路径
]
```

13. 如果需要识别操作系统平台，先查找项目中已有的工具函数，不要重复实现。
14. 如果需要使用 `tar` 库进行解压缩操作，必须使用 `server/src/utils/tarSecurityFilter.ts` 模块的安全拦截器，缓解路径穿越漏洞。
15. 升级依赖时注意兼容性，不做不必要的大版本升级，优先修复安全漏洞和明确的构建问题。
16. 提交前至少运行与改动相关的 TypeScript/build 检查。常用命令：
    - 服务端改动：`cd server && npm run build`
    - 前端改动：`cd client && npm run build`
    - 全量构建：`npm run build`
17. 如果改动触及已有测试覆盖的模块，应运行对应测试。当前服务端已有 Jest 测试，可运行 `npm run test`；客户端已有 Vitest 测试入口，可按改动范围运行 `cd client && npm run test` 或更小的测试脚本。
18. `npm run lint` 只有在仓库存在可用 ESLint 配置时才作为交付检查；如果脚本存在但配置缺失，需要在交付说明中明确说明。
19. 临时诊断脚本、一次性测试文件和调试产物在验证完成后删除；正式测试代码可以保留，但应与现有测试组织方式一致。
20. 开源贡献前确认目标上游和分支基准。当前上游仓库为 `https://github.com/GSManagerXZ/GameServerManager` ，不要仅用个人 fork 的 `origin/main` 判断 PR 是否同步。
