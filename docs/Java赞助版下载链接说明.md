# Java赞助版下载链接说明

环境管理页面的 Java 8、11、17、21、25 下载地址已切换为国内高速短链，Windows、Linux x64 和 Linux ARM64 会根据服务端系统信息自动选择对应链接。

服务端会按照 Java 版本、操作系统和架构保留压缩包文件名。短链末尾不是压缩包扩展名，安装流程会使用对应的 `.zip` 或 `.tar.gz` 文件名进行解压。

下载式 Java 安装只适用于已有明确压缩包产物的架构。RISC-V64、macOS 和未列出的 Linux 架构不会回退到 Linux x64 包，前端会禁用安装按钮，服务端也会拒绝安装请求并提示改用系统 OpenJDK。

RISC-V64 等特殊架构推荐使用发行版包管理器安装 Java，例如：

```bash
sudo apt-get update
sudo apt-get install -y default-jre-headless
# 或按发行版可用版本安装 openjdk-17-jre-headless / openjdk-21-jre-headless
```

实例未指定面板内 Java 版本时，会使用系统 `PATH` 中的 `java`。因此系统 OpenJDK 安装完成后，可以在实例中保持 Java 版本为空，或让启动命令直接使用 `java -jar ...`。

本次更新的链接配置位于：

- `client/src/pages/EnvironmentManagerPage.tsx`：页面 Java 环境下载配置。
- `server/src/routes/environment.ts`：赞助者专用下载地址和压缩包文件名映射。
- `server/src/utils/javaDownloadArtifacts.ts`：下载式 Java 支持架构、赞助链接和压缩包文件名映射。
- `server/src/modules/environment/javaManager.ts`：使用映射后的文件名保存并解压下载文件。

Node.js ARM64 下载链接不属于 Java 环境管理页面，本次未纳入 Java 下载配置。
