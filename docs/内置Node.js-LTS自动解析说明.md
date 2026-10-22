# 内置 Node.js 使用最新 LTS 说明

本文档说明发布包内置 Node.js 运行时的版本来源、覆盖方式和验证方法。

## 背景

- 此前 `scripts/package.js` 把内置版本写死为 `22.17.0`，Windows 分支却单独走 `latest-v22.x`，两端可能装到不同小版本，且不会随上游 LTS 换代。
- 现在改为**打包时从 nodejs.org 官方清单解析当前最新 LTS**，代码里不再出现具体版本号；包内 README、日志里的版本号都是解析后动态写入。

## 改动概览

| 文件 | 改动 |
| --- | --- |
| `scripts/package.js` | 新增 `resolveLatestLtsNodeVersion()`：读取 `https://nodejs.org/dist/index.json`，过滤 `lts` 字段为真的版本，按 `X.Y.Z` 语义比较取最高；Linux 与 Windows 使用同一个已解析版本；删除 `latest-v22.x` 链接；解压目录由版本推断，并支持「根目录唯一候选目录」兜底 |
| `Dockerfile` | NodeSource 通道由 `setup_22.x` 改为 `setup_lts.x`（始终装当前最新 LTS）；删除未被引用的 `NODE_VERSION=22.17.0` |
| `.github/workflows/build.yml`、`ci.yml` | `actions/setup-node` 的 `node-version` 由 `22.16.0` 改为 `lts/*` |
| `docs/多架构支持说明.md`、`docs/Docker构建说明.md`、`docs/Docker-NodeSource-npm构建修复说明.md` | 同步去除固定版本描述 |

## 版本解析规则

1. 若设置了环境变量 `GSM3_NODE_VERSION`（形如 `24.22.1`，可带前缀 `v`），直接使用该版本，用于**复现历史构建**或离线/内网打包。
2. 否则请求 `https://nodejs.org/dist/index.json`，只保留 `lts` 字段为真的条目（排除 Current 版本），再按语义版本号取最大值。
3. 打包日志会打印解析结果与来源，例如：

   ```text
   🟢 内置 Node.js 版本: v24.22.1（Krypton LTS，2026-10-20 发布），版本来源: https://nodejs.org/dist/index.json
   ```

4. 清单请求失败、返回内容异常或找不到 LTS 条目时，直接以中文报错终止，并提示改用 `GSM3_NODE_VERSION`；解析发生在打包最开始，不会先跑完一大半流程再失败。

## 各平台内置方式

| 目标平台 | 内置内容 | 说明 |
| --- | --- | --- |
| `linux-x64` | `node-v<版本>-linux-x64.tar.xz` 完整发行包，解压到包内 `node/` | 含 `npm`，启动脚本用 `node/bin/node` |
| `linux-arm64` | `node-v<版本>-linux-arm64.tar.xz` 完整发行包 | 同上 |
| `windows` | `node.exe` 单文件，放到包根目录 | 与 Linux 使用同一 LTS 版本，启动脚本直接用包内 `node.exe` |
| `linux-riscv64` | 不内置 | Node.js 官方没有 riscv64 预编译包，运行时使用系统 Node.js（>= 18） |

## 验证方式

```powershell
# 1. 真实打包（会解析版本、下载并落盘 node.exe）
node scripts/package.js --target=windows --no-zip

# 2. 确认包内运行时版本与清单一致
cd dist\package; .\node.exe -v

# 3. 确认说明文件已写入解析结果
Select-String -Path dist\package\README.md -Pattern 'Node.js'
```

本次实测结果（2026-10-22）：

- 解析到 `v24.22.1`（Krypton LTS，2026-10-20 发布），来源 `https://nodejs.org/dist/index.json`；
- 包内 `node.exe -v` 输出 `v24.22.1`，与解析结果一致；
- `dist/package/README.md` 自动写入「本包已内置 Node.js v24.22.1（打包时取官方最新 LTS 版本）」；
- `linux-x64`、`linux-arm64` 的 `tar.xz` 与 `win-x64/node.exe` 三个下载地址均返回 HTTP 200；
- `node-v24.22.1-linux-arm64.tar.xz` 顶层目录确认为 `node-v24.22.1-linux-arm64/`，与脚本推断一致；
- 传入非法 `GSM3_NODE_VERSION=abc` 时立即以中文报错退出，未改动任何打包产物。

## 注意事项

- **打包机需要能访问 `nodejs.org`**：版本清单和下载都走该域名；完全离线或内网环境请先设置 `GSM3_NODE_VERSION` 并保证能访问官方下载地址（脚本目前不支持自定义下载源）。
- **构建可复现性**：不传 `GSM3_NODE_VERSION` 时，包内 Node.js 版本会随上游 LTS 发布而前进；需要发布说明里锁定版本时，可在 CI 显式传入该变量，并把实际版本写进 release note。
- **LTS 换代**：Node.js 每年 10 月左右产生新的大版本 LTS，届时无需改代码即可自动跟进；若新 LTS 与服务端依赖出现兼容问题，可临时用 `GSM3_NODE_VERSION` 固定到上一个大版本。
- **服务端要求**：`server/package.json` 的 `engines.node` 仍是 `>= 18`，内置最新 LTS 满足该约束；`linux-riscv64` 包依赖系统 Node.js，仍按 `>= 18` 校验。
