# EasyTier Manager

EasyTier Manager 是 GSM3 内置的 EasyTier Profile 管理插件。它负责二进制能力检测、配置生成、实例生命周期、实时状态、运行时操作，以及 EasyTier Secure Mode 管理。

## 数据位置

所有持久化数据统一保存在 GSM3 的 `data/easytier` 目录中；开发环境会自动尝试 `server/data/easytier`。每个 Profile 使用独立目录：

```text
data/easytier/
├── .secret-key
├── migration.json
├── bin/
│   ├── current.json
│   └── v2.6.4/
├── web/
│   ├── settings.json
│   ├── et.db
│   └── logs/
└── profiles/<profile-id>/
    ├── profile.json
    ├── easytier.toml
    ├── secrets.enc.json
    ├── credential.toml
    └── logs/
```

- `profile.json`：版本化 Profile 元数据，不保存明文网络密钥或私钥。
- `easytier.toml`：由 Profile 自动生成，不包含明文网络密钥或本地私钥。
- `secrets.enc.json`：使用 AES-256-GCM 加密的网络密钥、静态私钥和凭据文件内容。
- `.secret-key`：本机 AES-256-GCM 主密钥，权限会尽量限制为仅当前用户可读。
- `credential.toml`：EasyTier 运行时凭据状态；服务端会在实例退出后加密回收。

## 官方版本与 Web 控制台

插件可按当前操作系统和 CPU 架构下载官方 EasyTier CLI 包。推荐版本固定为经过 GSM3 能力检测验证的 `v2.6.4`，安装时会校验 GitHub Release 元数据、下载大小、SHA-256（上游提供时）以及 `easytier-core` / `easytier-web-embed --version`。压缩包只提取四个预期可执行文件，避免写入任意归档路径。

`easytier-web-embed` 作为独立 GSM3 托管实例运行，默认使用官方端口：

- Web 前端与 API：`11211/TCP`
- Core 配置下发：`22020/UDP`
- 数据库：`data/easytier/web/et.db`
- 日志：`data/easytier/web/logs/`

首次启动后通过“打开管理页面”注册账户，再将 Core 连接 URI 中的 `<用户名>` 替换为该账户用户名。若监听 `0.0.0.0` 或 `::`，必须通过防火墙、反向代理或可信网络限制访问；完成首个账户注册后建议关闭新用户注册。

为避免新安装直接暴露到公网，API 默认只监听 `127.0.0.1`。需要从其他设备访问时，请显式修改监听地址与 API Host，并先配置访问控制。

## 迁移

首次启动时，管理器会扫描 `data/tunnel-helper/configs` 和 `server/data/tunnel-helper/configs` 中的 EasyTier 配置：

1. 识别 `tool: "EasyTier"` 的旧配置；
2. 解析旧命令参数并创建版本化 Profile；
3. 将网络密钥加密后写入新 Profile；
4. 在列表中将条目标记为“已迁移”；
5. 记录迁移结果，避免重复导入。

迁移是**非破坏性的**：不会删除旧配置，也不会自动删除旧 GSM3 实例。确认新 Profile 工作正常后，可由管理员手动清理旧实例。内网穿透助手中的 EasyTier 命令生成功能仅用于兼容和底层排障；日常管理应使用本插件。

旧版 Profile 会在读取时自动升级到当前 schema。升级失败时原文件会保留，管理器不会静默覆盖无法识别的数据。

## Secure Mode

Secure Mode 只有在检测到当前 EasyTier 二进制支持对应能力时才会开放：

- 静态 X25519 身份生成与导入；
- Peer 公钥固定；
- ACL 规则及运行时命中统计；
- 临时凭据生成、列表与撤销。

网络密钥和本地私钥使用 AES-256-GCM 加密保存。启动 EasyTier 时，密钥通过受控启动器的环境变量注入，不拼接到 GSM3 的实例命令、日志或 `easytier.toml` 中。

备份与恢复时必须整体保留 `server/data/easytier`，尤其是 `.secret-key`；仅恢复 `profiles/` 会导致已加密密钥无法解密。旧版配置迁移产生的回滚密钥包同样使用该密钥加密，并保存为 `migration-backups/**/rollback-secrets.enc.json`。部署平台也可以通过 32 字节 Base64 或 64 位十六进制的 `EASYTIER_SECRET_KEY` 提供外部主密钥。

临时凭据私钥只在生成响应中显示一次。关闭弹窗后，面板不会再次提供该私钥；请立即复制到安全的密钥存储中。撤销凭据后，相关节点需要重新授权。

## 兼容性

EasyTier 不同版本的 CLI 参数可能变化。插件先执行 `--help` / `--version` 能力检测，再启用对应功能。若 Secure Mode、ACL、凭据或 JSON 输出不受支持，界面会明确禁用功能，而不是猜测参数或静默降级。
