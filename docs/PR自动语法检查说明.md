# PR 自动检查说明

## 说明

`.github/workflows/ci.yml` 负责 PR 和 `main` 分支的常规持续集成检查。该流程只做只读校验，不评论 PR、不自动合并，也不修改目标分支。

发布构建仍由 `.github/workflows/build.yml` 负责，避免把 PR 校验和 Release 打包推送混在一起。

## 触发时机

- PR 打开、重新打开、推送新提交或从 Draft 标记为可审阅时触发。
- 推送到 `main` 分支时触发。
- 维护者也可以通过 `workflow_dispatch` 手动触发。

同一 PR 或同一分支的旧运行会被自动取消，减少重复排队。

## 检查范围

当前 CI 包含三个 job：

1. `Server test and build`
   - `cd server && npm ci`
   - `cd server && npm test`
   - `cd server && npm run build`
2. `Client test and build`
   - `cd client && npm ci`
   - `cd client && npm test`
   - `cd client && npm run build`
3. `Project scripts`
   - `npm ci`
   - `node --check scripts/package.js`
   - `node --check scripts/resolve-build-version.js`
   - `node scripts/resolve-build-version.js`

## 维护建议

- CI 中优先使用 `npm ci`，确保 lockfile 和实际安装一致。
- 新增必须通过的检查前，先确认当前 `upstream/main` 基线能稳定通过。
- Release 打包、Docker 推送和上传 GitHub Release 资产应继续放在 `build.yml`，并只在标签推送或手动触发时执行。
