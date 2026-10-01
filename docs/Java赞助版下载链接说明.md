# Java环境下载链接与赞助者下载通道说明

## 1. 下载链接

环境管理 → Java 环境的下载地址已统一替换为 `https://download.xiaozhuhouses.asia/d/<文件ID>/<文件名>` 直链，按系统平台与架构自动选择（Java 8 / 11 / 17 / 21 / 25 / 27）：

| 版本 | Windows x64 | Linux x64 | Linux ARM64 |
| --- | --- | --- | --- |
| Java 8 | `/d/e2fb4833ba415b8c500aed2d9b88d401/openjdk-8u44-windows-i586.zip` | `/d/eba19d9b0eb2f5ee0af4aa1410e7e8ea/openjdk-8u44-linux-x64.tar.gz` | 未提供 |
| Java 11 | `/d/09844c5699181cace0c50838a01b3afa/openjdk-11.0.0.2_windows-x64.zip` | `/d/1ad2d19275d387bf474186213159971b/openjdk-11.0.0.2_linux-x64.tar.gz` | 未提供 |
| Java 17 | `/d/7dc046a7855530363fac794781bdf767/openjdk-17.0.0.1+2_windows-x64_bin.zip` | `/d/25b171ae761d3222bd0f91ddca373d32/openjdk-17.0.0.1+2_linux-x64_bin.tar.gz` | `/d/8868121de8e1a36192abfe4034ec3a7b/openjdk-17.0.2_linux-aarch64_bin.tar.gz` |
| Java 21 | `/d/a436ba580cf68550b0a14408105eb8d5/openjdk-21+35_windows-x64_bin.zip` | `/d/521a8c9551a8cd0923825789e3be5054/openjdk-21+35_linux-x64_bin.tar.gz` | `/d/4c5d060a6186d630f4c0cb64cac7c075/openjdk-21_linux-aarch64_bin.tar.gz` |
| Java 25 | `/d/1e1b2424fef706eb9f13851ad9081aff/openjdk-25+36_windows-x64_bin.zip` | `/d/59e59a84f693481bb7a29802a2ef5253/openjdk-25+36_linux-x64_bin.tar.gz` | `/d/a6f7a6c56d31bcb9c47927fb55386343/openjdk-25.0.2_linux-aarch64_bin.tar.gz` |
| Java 27 | `/d/b1b2ce98fd714e8202a6d0cd8893237e/openjdk-27+35_windows-x64_bin.zip` | `/d/57849c8d615de1b355d88ba2fa2d6bf2/openjdk-27+35_linux-x64_bin.tar.gz` | 未提供 |

表内链接需补上域名前缀 `https://download.xiaozhuhouses.asia`。

- 链接配置位置：`client/src/pages/EnvironmentManagerPage.tsx` 中的 `javaVersions`。
- 旧的 `https://download.xiaozhuhouses.asia/download/v1/links/...` 短链已全部替换。
- **ARM64 缺口**：上游只提供了 Java 17 / 21 / 25 的 ARM64 安装包，Java 8、Java 11、Java 27 没有 ARM64 链接，因此在 ARM64 系统上这几项会显示「该版本暂未提供当前架构的安装包」并禁用安装按钮，避免误下 x64 包导致安装后无法运行。
- 压缩包文件名映射保留在 `server/src/routes/environment.ts` 的 `getJavaArchiveFileName()`，Java 11 ARM64 条目已删除；未配置的平台会退化为按下载地址末段推断文件名，不再直接抛错。

## 2. 赞助者下载通道

`POST /api/environment/java/install` 会先读取本地记录的赞助者密钥（`server/src/utils/sponsorStatus.ts` 的 `getSponsorKey()`）：

- **未记录密钥**：使用普通通道，直接请求上表直链，由公网节点（`r1.files.xiaozhuhouses.asia`）提供下载。
- **已记录密钥**：使用赞助者通道，流程与官方赞助者下载脚本一致。

  1. `POST https://download.xiaozhuhouses.asia/api/v1/download-auth/session`，请求体 `{ "activation_code": "<本地记录的密钥>" }`；
     成功返回 `HTTP 200` 与 `{"status":"ok","audience":"sponsor","expires_at":"...","sponsor_expires_at":"..."}`，并下发 `__Host-dl_session` 会话 Cookie。
  2. 带上会话 Cookie 请求**同一个文件直链**，下载服务返回 307 跳转到赞助者节点（`files.cn-nb1.rains3.com` 预签名地址），随后正常下载。

说明：

- 赞助者通道与普通通道使用同一个文件直链，区别只在于是否携带会话 Cookie，因此不需要单独维护一份赞助者链接表。
- 会话 Cookie 仅在目标地址域名等于 `download.xiaozhuhouses.asia` 时携带（`isSponsorDownloadUrl()` 校验），避免把会话泄露到第三方地址。
- 会话有效期 1 小时，每次安装都会重新建立会话。
- 官方脚本中的 `"$base/"`（站点根路径）不能直接照抄：根路径现在会跳转到后台管理页，必须使用具体文件直链。
- **失败自动降级**：密钥未记录、密钥无效（`503` + `赞助码不正确或服务不可用`）、会话服务不可用，或该版本在当前平台没有链接时，都会回退普通通道，不会中断安装。
- 实测上游会话接口偶尔会返回 `503`（同一客户端已有大文件下载进行中时更容易出现）。面板固定在开始下载前建立会话，正常安装流程不受影响；如果仍失败，只会表现为这一次按普通通道下载。

### 代码入口

| 位置 | 说明 |
| --- | --- |
| `server/src/utils/sponsorDownload.ts` | `createSponsorDownloadSession()` 建立会话、`isSponsorDownloadUrl()` 域名校验 |
| `server/src/utils/sponsorStatus.ts` | `getSponsorKey()` / `hasSponsorKey()` 读取本地密钥；`isSponsorUnlocked()` 仍表示「身份未确认」 |
| `server/src/modules/environment/javaManager.ts` | `JavaDownloadOptions` 支持传入会话 Cookie，`downloadFile()` / `installJava()` 透传 |
| `server/src/routes/environment.ts` | `POST /java/install` 组装下载通道并决定提示文案 |
| `client/src/pages/EnvironmentManagerPage.tsx` | 链接配置、架构判断、赞助者状态提示 |
| `client/src/utils/sponsor.ts` | `hasSponsorKey()` 前端判定入口 |

## 3. 界面表现

- 已记录密钥：绿色提示「已记录赞助者密钥，Java环境将通过赞助者专用通道下载（密钥无效时自动回退普通通道）」。
- 未记录密钥：黄色提示 + 爱发电赞助入口。
- 安装开始与安装完成的消息会在走赞助者通道时带上「（赞助者专用通道）」后缀；安装日志中也会输出 `（赞助者专用通道）`。

## 4. 验证结论

以 Java 17 Windows x64 链接为例（`/d/7dc046a7855530363fac794781bdf767/openjdk-17.0.0.1+2_windows-x64_bin.zip`）：

| 场景 | 结果 |
| --- | --- |
| 普通通道（不带 Cookie） | 307 → `r1.files.xiaozhuhouses.asia`，`200 application/zip`，`Content-Length: 186223043` |
| 赞助者通道（带会话 Cookie） | 307 → `files.cn-nb1.rains3.com` 预签名地址，`206 application/zip`，文件头 `504b`（PK，ZIP 包） |
| 无效激活码 | `503` + `{"error_code":"sponsor_unavailable","message":"赞助码不正确或服务不可用"}` → 服务端抛出中文错误并回退普通通道 |
| 面板自身下载方法（`JavaManager.downloadFile`） | 普通通道与赞助者通道均能落盘真实字节、进度回调正常；同一时间片内赞助者通道约 12MB、普通通道约 4MB |

验证方式：临时脚本调用编译产物中的 `createSponsorDownloadSession()` / `isSponsorDownloadUrl()` 完成上述请求，验证后已删除。

## 5. 相关说明

- Node.js ARM64 下载链接不属于 Java 环境管理页面，本次未纳入。
- 需要重新编译：`cd server && npm run build`、`cd client && npm run build`；若面板以打包产物运行，需要重启服务。