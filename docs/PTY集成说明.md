# PTY 集成说明

## 固定发布契约

项目使用 [MCSManager/PTY](https://github.com/MCSManager/PTY) 提供真实伪终端能力。所有运行时、离线打包、Docker 构建和常规安装都复用 `server/src/utils/ptyAssets.ts` 中的固定清单，不使用可变发布地址，也不在分发脚本中重复维护资产信息。

- Release ID：`297277624`
- 上游构建 commit：`09fc369dfa278504831260de2771d7cbd98d01c4`

| 资产键 | 平台 / 架构 | Asset ID | 文件名 | 大小（字节） | SHA-256 |
|---|---|---:|---|---:|---|
| `linux-x64` | Linux x64 | `374651721` | `pty_linux_x64` | `2654360` | `bbdfc8a5d0f57493e78c64bca56d370524c068c1d4d31cac653458a843d47f72` |
| `linux-arm64` | Linux ARM64 | `374651727` | `pty_linux_arm64` | `2752664` | `48d8496997053b60eb84d2b02f4ec751298c7f214c615b08aca43309739ebf83` |
| `win32-x64` | Windows x64 | `374651714` | `pty_win32_x64.exe` | `3627520` | `fe35c154e623707d0dd2b728f41fd200bd3ead0a8cda8eb216b1e5e3e3ab2d40` |

## 固定资产获取流程

`ptyAssetCli.js ensure` 会先校验目标目录中的现有资产；现有资产通过固定清单校验和本机能力探测时直接复用，不发起网络请求。仅在需要下载或替换资产时执行两步 GitHub API 请求：

1. 请求 `GET https://api.github.com/repos/MCSManager/PTY/releases/297277624`，使用 `Accept: application/vnd.github+json`。响应中的 release ID 必须等于 `297277624`，并且必须恰好有一个资产同时匹配固定的 Asset ID、文件名和大小。
2. 请求 `GET https://api.github.com/repos/MCSManager/PTY/releases/assets/<asset-id>`，使用 `Accept: application/octet-stream` 下载匹配资产。允许跟随 GitHub 下载重定向，但离开 `api.github.com` 时不会转发 `Authorization`。

如设置 `GITHUB_TOKEN`，CLI 会仅向 GitHub API 请求发送令牌。任一步元数据验证、下载、完整性校验或本机能力探测失败，`ensure` 都以非零状态退出。

## 完整性校验与本机能力探测

已有文件和新下载文件都必须通过同一套校验：

1. 资产来自上表对应的固定清单，最终文件名必须精确匹配。
2. 文件必须是普通文件，字节数必须与清单中的大小完全一致；下载过程中一旦超过固定大小会立即失败。
3. 对完整文件计算 SHA-256，结果必须与清单值完全一致。
4. 仅对当前操作系统和 CPU 架构对应的原生资产执行能力探测：运行 `<pty-binary> -h`，要求在 3 秒内以状态 `0` 退出、输出严格少于 64 KiB，并且帮助文本包含必需参数 `-fifo`。
5. 非本机架构资产只做大小和 SHA-256 校验，绝不执行。POSIX 使用旧目标的同目录硬链接作为备份，再以单次原子 `rename` 覆盖目标；Windows 保留可恢复的重命名与回滚路径。`ensure` 会在校验前恢复可信的遗留备份并清理其余备份，校验或探测失败的文件不会被当作可用 PTY。

因此，仅判断文件存在、可执行或为 ELF/PE 文件并不足以通过校验。

## 分发路径

### 离线打包

`scripts/package.js` 会先复制编译后的服务端并安装其生产依赖，再按明确目标调用打包产物中的 CLI：

```text
npm run package:linux:x64    # ensure --asset linux-x64
npm run package:linux:arm64  # ensure --asset linux-arm64
npm run package:windows      # ensure --asset win32-x64
```

每个 Linux 包只包含对应架构的 Node.js、PTY、Zip-Tools 和 7z：x64 发布归档为 `gsm3-management-panel-linux-x64.tar.gz`，ARM64 发布归档为 `gsm3-management-panel-linux-arm64.tar.gz`。Windows 包包含 `win32-x64` PTY；未指定目标时的通用开发入口仍可包含全部资产。任何 PTY 资产无法校验、下载或进行适用的本机探测时，打包操作失败，不生成声称已包含 PTY 的产物。

### Docker 镜像

最终镜像根据 `TARGETARCH` 只选择当前镜像的原生资产：`amd64` 对应 `linux-x64`，`arm64` 对应 `linux-arm64`。镜像调用：

```text
node /root/server/utils/ptyAssetCli.js ensure --asset <asset-key> --target-dir /root/server/builtin/data/lib
```

不支持的架构或校验、下载、原生 `-fifo` 探测失败都会使镜像构建失败。

### 常规安装脚本

`install-gsm3.sh` 在下载前读取 `uname -m`：`x86_64/amd64` 选择 `gsm3-management-panel-linux-x64.tar.gz` 与 `linux-x64`，`aarch64/arm64` 选择 `gsm3-management-panel-linux-arm64.tar.gz` 与 `linux-arm64`；其他架构直接退出。解压并启用包内 Node.js 后调用：

```text
<install-path>/node/bin/node <install-path>/server/utils/ptyAssetCli.js ensure --asset <asset-key> --target-dir <install-path>/data/lib
```

若安装阶段无法完成固定资产校验或按需下载，脚本会明确提示：在运行时校验成功前，终端创建功能保持不可用。

## 运行时路径

`PtyManager` 按顺序尝试：

1. `{项目根目录}/data/lib/` — 打包后环境
2. `{项目根目录}/server/data/lib/` — 开发环境

运行时只返回通过固定清单校验和本机 `-fifo` 探测的 PTY 路径。缺失、损坏或能力不满足的文件会通过同一固定 CLI 底层逻辑替换。

## 离线环境与禁止自定义二进制

离线部署可以预先把上表中的官方固定资产放入 `data/lib/` 或 `server/data/lib/`，但文件名、字节数和 SHA-256 必须全部精确匹配；Linux 文件还需具备执行权限。随后仍应运行对应的 `ptyAssetCli.js ensure`，让本机资产完成 `-fifo` 探测。

项目不接受自定义下载 URL、重命名资产、不同版本 PTY 或仅凭文件格式判断可信的二进制，也不得绕过大小、SHA-256 和原生能力探测。需要更新 PTY 时，应统一更新固定 release/asset manifest 及其验证资料，而不是在打包、Docker、安装脚本或运行时加入独立回退地址。

## 相关模块

- `server/src/utils/ptyAssets.ts`：固定 release/asset manifest、GitHub API 下载、完整性校验、原生探测和原子替换。
- `server/src/utils/ptyAssetCli.ts`：供打包、Docker 和安装脚本调用的机器可读入口。
- `server/src/utils/ptyManager.ts`：运行时路径选择和固定资产确保逻辑。
- `server/src/modules/terminal/TerminalManager.ts`：使用已验证 PTY 创建终端会话。
