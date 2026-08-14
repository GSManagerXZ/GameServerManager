# Release 重复触发 CI 修复说明

## 问题现象

每次创建 tag 并发布 Release 时，`Build Package` 工作流会**同时启动两个运行（Run）**：
一个由 `push`（标签推送）事件触发，另一个由 `release`（发布）事件触发。
两个构建并发执行，偶发报错，例如 `build_docker` 推送镜像失败。

以仓库实际运行记录为例（每个版本都有成对出现的 push/release 运行）：

| 版本 | push 运行 | release 运行 | 结果 |
|------|-----------|--------------|------|
| v3.13.24 | 构建中 | ❌ build_docker 失败 | 重复构建，其一失败 |
| v3.13.23 | ✅ 成功 | ✅ 成功 | 重复构建，浪费资源 |
| v3.13.22 | ✅ 成功 | ✅ 成功 | 重复构建，浪费资源 |
| v3.13.2 | ❌ 失败 | ❌ 失败 | 重复构建，双双失败 |
| v3.13.1 | ✅ 成功 | ❌ create_release 失败 | 重复构建，其一失败 |

## 根因分析

原 `build.yml` 同时订阅了两个触发器：

```yaml
on:
  push:
    tags:
      - 'v*'
  release:
    types: [published]
```

在 GitHub 网页上"创建并直接发布 Release"时，GitHub 会**同时产生两个事件**：

1. 新标签的 `push` 事件；
2. `release` 的 `published` 事件。

两个触发器都命中，于是同一版本启动两次完整构建。两个运行的 `build_docker`
会把镜像并发推送到同一个 Docker Hub 标签（并竞争同一份 GitHub Actions 缓存），
从而随机出现推送冲突、缓存占用等失败；历史上 `create_release` 也在两个运行中
重复执行过，造成发布冲突失败。

## 修复方案

只保留 `push.tags` 触发器，移除 `release: [published]` 订阅：

- **命令行推送标签发版**：`git push` 标签 → 触发一次构建 → 构建完成后由
  `create_release` 自动创建 Release 并上传各平台安装包。
- **网页发布 Release**：无论"新建标签并发布"还是"基于已有标签发布"，
  网页操作都会产生标签推送事件，因此同样只触发一次构建；随后 `create_release`
  会把各平台安装包上传到已存在的 Release 中。
- **手动构建**：`workflow_dispatch` 手动触发不受影响。

同步清理了仅对 release 事件有意义的配置：

- 移除 `resolve_version` 中的 `RELEASE_TAG` / `RELEASE_PRERELEASE` 环境变量
  （版本号统一由脚本按标签名 `GITHUB_REF` 解析，行为与原 push 触发时一致）；
- 移除各构建 job 条件中的 `github.event_name == 'release'` 分支。

## 发布流程说明（修复后）

1. 方式一（推荐，全自动）：在本地打标签并推送
   `git tag v3.x.y && git push origin v3.x.y`，
   CI 自动完成构建并创建带安装包的 Release。
2. 方式二：在 GitHub 网页上直接创建/发布 Release，
   CI 自动构建并把安装包补充上传到该 Release。
3. 两种情况下都只会启动**一次**构建，不会再出现重复运行与并发推送冲突。
