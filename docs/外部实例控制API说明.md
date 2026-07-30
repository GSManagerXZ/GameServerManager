# 外部实例控制 API 说明

外部实例控制 API 用于让脚本、机器人、监控系统等自动化程序调用 GSM3 的实例生命周期能力。它复用 GSM3 的实例管理器启动、停止、重启实例，因此不会绕过面板直接杀进程，也不会让面板丢失终端会话控制。

## 启用方式

1. 进入面板的「系统设置」。
2. 在「安全配置」中找到「外部自动化 API」。
3. 点击「生成/轮换密钥」生成 API Key。
4. 保存本次返回的明文 API Key。后端只保存哈希，刷新页面后不会再次显示明文。
5. 确认外部自动化 API 处于启用状态。

API Key 拥有实例管理权限，请只在可信环境中使用。公网部署时建议配合 HTTPS、反向代理访问控制或防火墙限制来源。

## 认证方式

支持两种请求头：

```http
Authorization: Bearer <API_KEY>
```

```http
X-GSM-API-Key: <API_KEY>
```

## 接口列表

基础路径：

```text
/api/external
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/instances` | 获取实例列表 |
| GET | `/instances/:id` | 获取实例详情 |
| GET | `/instances/:id/status` | 获取实例状态 |
| POST | `/instances/:id/start` | 启动实例 |
| POST | `/instances/:id/stop` | 停止实例 |
| POST | `/instances/:id/restart` | 重启实例 |
| POST | `/instances/:id/action` | 使用请求体统一执行操作 |

`/instances/:id/action` 请求体示例：

```json
{
  "action": "restart"
}
```

`action` 支持 `start`、`stop`、`restart`。

## 幂等调用

启动和停止接口支持 `idempotent` 参数：

```bash
curl -X POST "http://127.0.0.1:3001/api/external/instances/<实例ID>/start?idempotent=true" \
  -H "Authorization: Bearer <API_KEY>"
```

启用后：

- 启动已运行或正在启动的实例会返回成功。
- 停止已停止或错误状态的实例会返回成功。

## 调用示例

重启实例：

```bash
curl -X POST "http://127.0.0.1:3001/api/external/instances/<实例ID>/restart" \
  -H "Authorization: Bearer <API_KEY>"
```

停止实例：

```bash
curl -X POST "http://127.0.0.1:3001/api/external/instances/<实例ID>/stop" \
  -H "X-GSM-API-Key: <API_KEY>"
```

查询状态：

```bash
curl "http://127.0.0.1:3001/api/external/instances/<实例ID>/status" \
  -H "Authorization: Bearer <API_KEY>"
```

## 常见状态码

| 状态码 | 说明 |
| --- | --- |
| 200 | 调用成功 |
| 400 | 请求参数错误 |
| 401 | 未提供 API Key 或 API Key 无效 |
| 403 | 外部自动化 API 未启用 |
| 404 | 实例不存在 |
| 409 | 当前实例状态不允许执行该操作 |
| 500 | 服务端内部错误 |

