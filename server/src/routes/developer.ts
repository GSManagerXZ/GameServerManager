// 重新导入模块化的开发者路由
export { setupDeveloperRoutes, createDeveloperRoutes } from '../modules/developer/routes/developerRoutes.js'

// 向后兼容的导出
export { DeveloperAuthMiddleware } from '../modules/developer/middleware/developerAuth.js'
