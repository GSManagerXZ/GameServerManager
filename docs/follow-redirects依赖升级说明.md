# follow-redirects 依赖升级说明

本文档记录本次 `follow-redirects` 依赖升级的背景、处理方式和验证结果，便于后续排查与继续升级。

## 升级背景

- `client` 和 `server` 当前都通过 `axios@1.15.0` 间接依赖 `follow-redirects`。
- 升级前两侧锁定版本均为 `1.15.11`。
- 本次目标是在不调整现有业务调用方式的前提下，升级到同主线兼容版本，降低安全与维护风险。

## 处理方式

- 在 `client/package.json` 和 `server/package.json` 的 `overrides` 中显式指定 `follow-redirects` 为 `1.16.0`。
- 保持 `axios` 版本不变，避免同时引入请求层接口或运行时行为变化。
- 同步刷新 `client/package-lock.json` 和 `server/package-lock.json`，确保安装结果稳定可复现。

## 兼容性评估

- `axios@1.15.0` 对 `follow-redirects` 的依赖范围为 `^1.15.11`，可兼容解析到 `1.16.0`。
- 本次升级未改动前后端业务代码、请求封装或拦截器逻辑，影响面仅限依赖解析结果。
- 因为属于补丁级别兼容升级，优先采用覆盖版本而不是联动升级 `axios`，降低回归风险。

## 验证结果

建议按以下顺序验证：

```powershell
cd client
npm ls follow-redirects
npx tsc --noEmit

cd ..\server
npm ls follow-redirects
npx tsc --noEmit
```

本次已完成：

- `npm ls follow-redirects`，确认解析结果为 `1.16.0`
- `client` 目录 `npx tsc --noEmit`，类型检查通过
- `server` 目录 `npx tsc --noEmit`，类型检查通过

## 说明

- 如果后续继续升级请求链路相关依赖，建议先评估 `axios` 版本变动，再决定是否移除该覆盖配置。
- 若未来上游已自然解析到安全版本，可根据实际情况简化 `overrides` 配置。
