# Java 环境下载链接与赞助者下载通道说明

环境管理页面的 Java 下载入口由服务端目录统一驱动，配置位于 `server/src/utils/javaDownloadArtifacts.ts`。前端只展示服务端返回的版本、提供商、通道和平台可用性，不再维护独立下载链接表。

## 下载源

当前目录包含以下提供商：

| 提供商 | 说明 |
| --- | --- |
| 赞助高速源 | 项目维护的 `download.xiaozhuhouses.asia` 直链。未配置密钥时也可走普通通道下载；本地记录赞助者密钥后，会在安装时尝试建立专用下载会话。 |
| Eclipse Temurin | 通过 Adoptium latest JDK API 解析 GA / EA 包。 |
| Azul Zulu | 通过 Azul Metadata API 在安装时解析最新匹配的 Zulu JDK 包。 |
| 系统包管理器 | Linux 上的 OpenJDK headless 包预设，适合 riscv64 等特殊架构。 |

赞助高速源、Temurin 和 Azul 都由服务端按当前系统平台与架构判断是否可用。没有明确产物的组合不会回退到其它架构的包。

## 版本与通道

内置稳定版本包括 Java 8、11、17、21、25、27。自定义 Java 版本支持手动选择主版本、GA / EA 通道和下载提供商；默认使用 Java 25 GA，EA 预览版只在高级自定义入口中主动选择。

RISC-V64 等特殊架构推荐优先使用发行版包管理器安装 Java，例如：

```bash
sudo apt-get update
sudo apt-get install -y default-jre-headless
# 或按发行版可用版本安装 openjdk-17-jre-headless / openjdk-21-jre-headless
```

实例未指定面板内 Java 版本时，会使用系统 `PATH` 中的 `java`。因此系统 OpenJDK 安装完成后，可以在实例中保持 Java 版本为空，或让启动命令直接使用 `java -jar ...`。

## 赞助者下载通道

赞助者通道与普通通道使用同一个文件直链，区别只在于是否携带由本地赞助者密钥换取的会话 Cookie。

安装流程如下：

1. 服务端解析 Java 版本、提供商、通道、操作系统和架构，得到最终下载地址与压缩包文件名。
2. 如果下载地址属于 `download.xiaozhuhouses.asia`，且本地记录了赞助者密钥，则调用 `createSponsorDownloadSession()` 建立会话。
3. 会话建立成功时，下载请求携带 Cookie，下载服务会调度到赞助者专用节点。
4. 未记录密钥、密钥无效、会话服务不可用或会话建立失败时，安装会自动回退到同一直链的普通下载通道，不会中断安装。

会话 Cookie 只会在 `isSponsorDownloadUrl()` 确认目标域名为 `download.xiaozhuhouses.asia` 时携带，避免泄露到第三方下载源。

## 代码入口

| 位置 | 说明 |
| --- | --- |
| `server/src/utils/javaDownloadArtifacts.ts` | Java 版本目录、提供商、平台架构可用性、赞助源链接和文件名映射。 |
| `server/src/utils/sponsorDownload.ts` | 赞助者会话建立、下载域名校验。 |
| `server/src/utils/sponsorStatus.ts` | 读取本地记录的赞助者密钥。 |
| `server/src/routes/environment.ts` | `/java/catalog` 返回下载目录；`/java/install` 解析 provider/version/channel 并组装下载选项。 |
| `server/src/modules/environment/javaManager.ts` | 下载、保存、解压 Java 安装包，并支持透传会话 Cookie。 |
| `client/src/pages/EnvironmentManagerPage.tsx` | 展示服务端目录、预设卡片、自定义版本入口和安装进度。 |

## 验证重点

- 无赞助者密钥时，赞助高速源在支持的平台上仍应可安装。
- 有赞助者密钥时，同一直链会尝试携带会话 Cookie；失败时应自动回退普通通道。
- riscv64 不应误用 Linux x64 包；没有赞助源产物时，应落到 Temurin 或系统包管理器等可用选项。
- EA 预览版不应作为新手默认路径，只能通过高级自定义入口主动选择。
