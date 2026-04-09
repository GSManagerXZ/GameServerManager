# Docker NodeSource npm 构建修复说明

## 问题现象

在 Docker 构建 `tools` 阶段执行以下命令时失败：

```bash
npm install -g npm@latest
```

报错关键信息：

- `npm error code MODULE_NOT_FOUND`
- `Cannot find module 'promise-retry'`

该问题出现在 Node.js 已安装成功后，npm 自升级阶段。

## 根因分析

- NodeSource 安装的 Node.js 已经自带 npm，可直接满足项目构建需求。
- 在镜像构建阶段再执行 `npm@latest` 全局升级，会引入额外的网络与依赖解析不稳定因素。
- 当 npm 自升级过程不完整或依赖拉取异常时，会出现内部模块缺失（如 `promise-retry`）并导致整个镜像构建失败。

## 修复方案

将 Dockerfile 的 Node 安装步骤从“安装 Node.js + 升级 npm latest”改为“安装 Node.js + 校验 npm 版本”：

```dockerfile
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm config set registry https://registry.npmmirror.com \
    && npm --version \
    && rm -rf /var/lib/apt/lists/*
```

## 影响说明

- 不再依赖 `npm@latest`，构建稳定性更高。
- 不影响项目原有的 `npm run install:all` 与打包流程。
- 避免了不必要的大版本浮动，符合依赖升级尽量保持兼容的原则。

## 已完成验证

- `client` 目录执行 `npx tsc --noEmit`：通过。
- `server` 目录执行 `npx tsc --noEmit`：通过。

