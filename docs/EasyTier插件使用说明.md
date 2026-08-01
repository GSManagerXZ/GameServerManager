# EasyTier 插件使用说明

> 适用范围：GSM3 内置 EasyTier 管理插件。本文面向需要创建点对点游戏网络、共享节点、子网网关、出口节点或 VPN Portal 的面板管理员。

## 1. 功能定位

GSM3 将 EasyTier 作为独立的二层/三层虚拟网络编排能力管理，不替代已有的 frp 隧道功能：

- **frp**：适合把单个服务端口发布到公网。
- **EasyTier**：适合把多个节点组织进同一个虚拟网络，并管理路由、代理网段、出口节点、VPN Portal、Secure Mode、ACL 和临时凭据。

插件通过 GSM3 的实例管理器启动 EasyTier，所有插件接口均复用面板认证。插件页面本身不会把面板 token 写入 `localStorage` 或 URL，而是通过 GSM3 插件桥接协议按需获取短期内存凭据。

## 2. 安装与首次检查

1. 使用管理员账户登录 GSM3。
2. 打开 EasyTier 插件。
3. 在“概览”中检查安装状态。
4. 若当前平台受支持，可点击安装推荐版本；也可以在 Profile 中填写已有的 `easytier-core` 与 `easytier-cli` 路径。
5. 创建 Profile 前确认“兼容性”区域没有阻断性警告。

面板托管要求所选二进制至少具备：

- `easytier-core --config-file`；
- 可用的 `easytier-cli`；
- CLI JSON 输出能力；
- `rpc-portal` 与 `rpc-portal-whitelist` 管理参数。

Secure Mode、临时凭据和 ACL 会继续根据当前二进制能力单独启用或禁用。若按钮显示不可用，请先升级 EasyTier，而不是手工修改生成的配置绕过检查。

## 3. 数据目录与备份

EasyTier 的持久化数据统一保存在：

```text
server/data/easytier/
├── .secret-key
├── profiles/<profile-id>/
│   ├── profile.json
│   ├── easytier.toml
│   ├── secrets.enc.json
│   └── credential.toml       # 仅实例运行期间可能存在
├── backups/<profile-id>/
├── migration-backups/<profile-id>/
└── deleted/<profile-id>/
```

注意事项：

- `secrets.enc.json` 使用 AES-256-GCM 加密，网络密钥、静态身份私钥和已签发凭据不会明文写入 `profile.json`。
- 默认主密钥保存在 `server/data/easytier/.secret-key`，也可通过 32 字节的 `EASYTIER_SECRET_KEY` 环境变量提供。
- 备份或迁移时必须同时保存加密数据和对应主密钥；丢失或错误轮换主密钥后，原有密文无法恢复。
- `credential.toml` 是 EasyTier 运行时需要的明文凭据文件。GSM3 会在启动时短暂恢复，在正常停止、删除和启动失败回滚时重新捕获到加密存储并清理明文文件。
- 不要把 `server/data/easytier/` 提交到 Git 仓库，也不要通过聊天、工单或截图发送其中的密钥文件。

## 4. 创建 Profile

点击“新建 Profile”，选择最接近目标用途的预设：

| 预设 | 典型用途 |
| --- | --- |
| 游戏节点 | 多台游戏服务器或玩家节点加入同一虚拟网 |
| 共享节点 | 普通成员节点或共享服务节点 |
| 子网网关 | 把本地 LAN 网段代理到 EasyTier 网络 |
| 出口节点 | 为其他节点提供默认出口 |
| VPN Portal | 为外部 VPN 客户端提供入口 |
| 自定义 | 需要手工组合监听、路由、映射和高级参数 |

建议按以下顺序配置：

1. 填写 Profile 名称、网络名称和节点主机名。
2. 选择 EasyTier 二进制路径。
3. 配置监听地址和至少一个已知对等节点。
4. 根据用途填写代理网段、静态路由、出口节点、端口转发或 VPN Portal。
5. 如网络需要口令，填写网络密钥。该字段为仅写字段，保存后不会再次回显。
6. 保存后查看兼容性警告和生成配置摘要。

路径和列表字段支持插件表单中的多值格式。保存时后端会重新校验 CIDR、端口、协议、路径边界和能力要求，不能依赖前端校验替代服务端校验。

## 5. 生命周期管理

每个托管 Profile 对应一个 GSM3 实例，可在概览页执行：

- **启动**：恢复运行时凭据、校验配置和二进制，再通过实例管理器启动。
- **停止**：停止实例，捕获当前凭据状态并删除运行时明文凭据。
- **重启**：按停止与启动顺序完成同样的凭据协调。
- **刷新**：重新读取 Profile、实例状态、安装状态和 Web 控制台状态。

为了避免运行中配置漂移，下列静态配置通常只能在实例停止时修改：

- Profile 基础设置；
- Secure Mode 开关与静态身份；
- 对等节点公钥固定；
- ACL 默认策略和 ACL 规则。

运行中仍可读取拓扑、路由、节点、ACL 命中统计，并可签发或吊销临时凭据。若页面提示“需要重启”，请先安排连接中断窗口，再停止并重新启动实例。

## 6. Web 控制台

“Web 控制台”页面用于管理 EasyTier Web Embed：

1. 配置 Web Embed 二进制路径、API 监听地址与端口。
2. 填写浏览器实际可访问的 API Host。
3. 配置下发协议和端口。
4. 默认保持“关闭新用户注册”；只有在受控初始化窗口内才临时开放，并在首个管理员创建后立即关闭。按需决定是否允许 Core 自动创建本地用户。
5. 保存后启动 Web 实例，再使用“打开管理页面”。

建议仅监听受信地址，并通过防火墙或反向代理限制管理端口。不要把开放注册的 Web 控制台直接暴露到公网。

## 7. Secure Mode

### 7.1 启用静态身份

1. 停止目标 Profile。
2. 打开“Secure Mode”。
3. 启用 Secure Mode 并保存。
4. GSM3 会在服务端生成 X25519 静态身份。
5. 页面只显示本地公钥；私钥为仅写秘密，不会回显。

如需导入已有身份，可在创建或更新 API 中提供私钥；公钥必须与私钥匹配。正常面板操作不需要复制私钥。

### 7.2 固定对等节点公钥

Secure Mode 页面会列出当前 Profile 中的对等节点 URI。为高价值中继或网关填写其 EasyTier 公钥后保存，可把目标身份固定到该连接：

- 先通过可信渠道核对对方公钥指纹；
- URI 必须与 Profile 中已有 peer 完全匹配；
- 更换对方身份时，先核实变更来源，再更新固定公钥；
- 不要因为连接失败就直接删除公钥固定，这会削弱身份校验。

### 7.3 临时凭据

临时凭据只能在实例运行且当前 EasyTier 支持 credential 命令时签发。可设置：

- 有效期；
- ACL 分组；
- 允许代理的 CIDR；
- 是否允许参与中继；
- 是否允许重复使用。

签发后，私密凭据只在弹窗中显示一次。请立即保存到受保护的密码管理器或通过安全渠道发送给目标节点。关闭弹窗后，页面只保留凭据 ID、范围、有效期和状态摘要，无法再次读取原始私钥。

吊销操作需要确认。凭据吊销后会从运行时 credential 文件移除；过期或已吊销记录也会在后续列表刷新或签发时清理。

安全建议：

- 默认使用最短可接受有效期；
- 默认关闭“允许参与中继”和“允许重复使用”；
- 只授予实际需要的 ACL 分组与代理 CIDR；
- 人员离场、设备丢失或用途结束后立即吊销。

## 8. ACL 策略

### 8.1 默认动作

- **默认允许**：未匹配规则的入站流量继续允许，适合逐步增加拒绝规则。
- **默认拒绝（白名单模式）**：未匹配规则的入站流量全部拒绝，安全性更高，但保存前必须确认管理链路和游戏服务端口已有允许规则。

切换为默认拒绝前，建议先创建并复核以下允许项：

- 管理节点到 EasyTier RPC/运维端口的访问；
- 玩家或游戏节点分组到目标游戏端口的访问；
- DNS、监控、备份等必要基础服务；
- 子网网关或出口节点所需的明确网段。

### 8.2 规则字段

每条规则可组合：

- 动作：允许或拒绝；
- 协议：任意、TCP、UDP 或 ICMP；
- 源 ACL 分组；
- 目标 ACL 分组；
- 源 CIDR；
- 目标 CIDR；
- 目标端口；
- 说明。

分组来自临时凭据中的 ACL 分组。多个条件会共同限制匹配范围。规则 ID 应保持稳定且具有含义，例如 `guest-to-game-25565`。

规则按配置顺序生成到 EasyTier ACL。修改规则后需要在实例停止状态保存，再重新启动使静态配置生效。实例运行时可点击“查看命中统计”确认规则是否实际匹配流量。

## 9. 实时状态与诊断

插件通过 Socket.IO 订阅目标 Profile，并从 EasyTier CLI/RPC 获取实时快照。诊断时依次检查：

1. **实例状态**：是否为 running，是否频繁进入 error/stopped。
2. **插件桥接状态**：左下角是否显示已连接 GSM3 面板。
3. **能力检测**：核心与 CLI 路径、版本、JSON 输出和 RPC 参数是否可用。
4. **节点与路由**：目标 peer 是否出现，代理网段和路由是否符合预期。
5. **Secure Mode**：双方身份、公钥固定和凭据是否有效。
6. **ACL 统计**：必要允许规则是否有命中，是否被前置拒绝规则覆盖。
7. **日志**：在运行时操作中调整日志级别后，查看实例终端或日志输出。

常见问题：

| 现象 | 建议检查 |
| --- | --- |
| 无法创建托管 Profile | `--config-file`、CLI JSON、RPC 参数兼容性 |
| 启动后立即停止 | 二进制路径、生成的 TOML、端口占用、凭据恢复错误 |
| peer 一直离线 | peer URI、防火墙、网络密钥、Secure Mode 身份与固定公钥 |
| 默认拒绝后业务中断 | ACL 分组、目标端口、CIDR 和规则顺序 |
| 无法签发凭据 | 实例是否运行、Secure Mode 是否启用、credential 能力是否存在 |
| Web 控制台打不开 | Web 实例状态、API Host 可达性、监听地址、防火墙 |
| 页面状态不刷新 | 插件桥接、Socket.IO 连接、面板认证和浏览器控制台错误 |

## 10. 迁移、删除与恢复

旧版隧道助手中的 EasyTier 配置会在启动时迁移到新 Profile 模型：

- 旧清单会被去密并写入迁移标记；
- 回滚秘密会加密保存到 `migration-backups/`；
- 迁移后的 Profile 会保留来源、旧路径和备份目录元数据；
- 同一清单重复扫描不会重复迁移。

删除 Profile 时，数据会先移动到 `deleted/<profile-id>/`，实例和数据清理失败时服务端会尝试回滚。界面可选择是否同时删除托管实例。

恢复建议：

1. 先停止 GSM3，避免运行中同时写入目录。
2. 备份整个 `server/data/easytier/`。
3. 确认 `.secret-key` 或 `EASYTIER_SECRET_KEY` 与归档密文匹配。
4. 优先恢复最近的 `backups/<profile-id>/` 或由管理员核验后的 `deleted/<profile-id>/` 归档。
5. 启动 GSM3 后先检查 Profile 和生成配置，不要立即开启自动启动。
6. 手动启动并验证节点、路由、Secure Mode、ACL 和临时凭据状态。

不要直接编辑 `secrets.enc.json`。如密钥已丢失，应重新创建 Profile、重新生成身份并轮换所有相关凭据，而不是尝试绕过加密。

## 11. API 与权限

EasyTier API 位于 `/api/easytier`，所有路由都要求 GSM3 Bearer Token 认证。前端实例管理调用统一通过插件内的 `ApiClient` 完成。

重要端点包括：

- `GET /installation`：安装状态；
- `GET|POST /profiles`：列出或创建 Profile；
- `GET|PUT|DELETE /profiles/:id`：读取、更新或删除；
- `POST /profiles/:id/start|stop|restart`：生命周期；
- `GET|PUT /profiles/:id/security`：Secure Mode、peer pinning 与 ACL；
- `GET|POST /profiles/:id/security/credentials`：凭据列表与签发；
- `DELETE /profiles/:id/security/credentials/:credentialId`：吊销；
- `GET /profiles/:id/security/acl/stats`：ACL 命中统计；
- `GET /profiles/:id/snapshot`：实时快照；
- `GET|PUT /web` 与 `/web/start|stop|restart`：Web Embed 管理。

不要绕过面板直接把这些接口开放到公网。自动化客户端也应使用最小权限账户，并妥善保护 token。

## 12. 上线前检查清单

- [ ] EasyTier 二进制来自可信来源，版本和平台匹配。
- [ ] core、CLI JSON、RPC 参数能力检测通过。
- [ ] Profile 网络名称、监听地址和 peer URI 已复核。
- [ ] 网络密钥、静态身份私钥未出现在日志或截图中。
- [ ] 高价值 peer 已固定可信公钥。
- [ ] 默认拒绝场景已先创建管理链路和游戏端口允许规则。
- [ ] 临时凭据使用最短有效期与最小分组/CIDR 范围。
- [ ] Web 管理端口未无保护暴露到公网。
- [ ] `server/data/easytier/` 与主密钥已有受控备份。
- [ ] 手工启动、停止、重启和异常恢复均已演练。
- [ ] 节点、路由、ACL 命中统计和实例日志均符合预期。
