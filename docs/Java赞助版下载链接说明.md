# Java赞助版下载链接说明

环境管理页面的 Java 8、11、17、21、25 下载地址已切换为国内高速短链，Windows、Linux x64 和 Linux ARM64 会根据服务端系统信息自动选择对应链接。

服务端会按照 Java 版本、操作系统和架构保留压缩包文件名。短链末尾不是压缩包扩展名，安装流程会使用对应的 `.zip` 或 `.tar.gz` 文件名进行解压。

本次更新的链接配置位于：

- `client/src/pages/EnvironmentManagerPage.tsx`：页面 Java 环境下载配置。
- `server/src/routes/environment.ts`：赞助者专用下载地址和压缩包文件名映射。
- `server/src/modules/environment/javaManager.ts`：使用映射后的文件名保存并解压下载文件。

Node.js ARM64 下载链接不属于 Java 环境管理页面，本次未纳入 Java 下载配置。
