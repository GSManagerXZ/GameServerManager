# API 对接使用指南

## 当前云构建开放接口

当前云构建部署已切换到“我的世界 Java 核心开服包”开放接口模式，面板后端代理前缀如下：

```bash
/api/cloud-build
```

上游服务地址固定为：

```bash
https://tools.xiaozhuhouses.asia/
```

## 1. 查询目录

```bash
GET http://localhost:3000/api/cloud-build/catalog
GET http://localhost:3000/api/cloud-build/catalog?coreType=paper
```

响应中的关键字段：

```json
{
  "success": true,
  "data": {
    "coreTypes": ["paper", "purpur"]
  }
}
```

或：

```json
{
  "success": true,
  "data": {
    "versions": ["1.20.4", "1.20.6", "1.21.1"]
  }
}
```

## 2. 提交构建任务

```bash
POST http://localhost:3000/api/cloud-build/build
```

请求体：

```json
{
  "coreType": "paper",
  "version": "1.20.4",
  "mcVersion": "1.20.4"
}
```

响应示例：

```json
{
  "success": true,
  "message": "云构建任务已提交",
  "data": {
    "requestId": "request-id",
    "accessToken": "access-token",
    "message": "任务已创建"
  }
}
```

说明：

- 后续轮询必须同时使用 `requestId` 和 `accessToken`
- `mcVersion` 默认可以与 `version` 相同，也允许分开传

## 3. 轮询任务状态

```bash
GET http://localhost:3000/api/cloud-build/build/{requestId}?accessToken={accessToken}
```

响应示例：

```json
{
  "success": true,
  "data": {
    "requestId": "request-id",
    "status": "SUCCESS",
    "message": "构建完成",
    "data": {
      "downloadUrl": "/files/archives/paper-1.20.4.zip",
      "archiveFileName": "paper-1.20.4.zip",
      "coreType": "paper",
      "version": "1.20.4",
      "mcVersion": "1.20.4"
    }
  }
}
```

终态主要包括：

- `SUCCESS`
- `FAILED`
- `CANCELLED`

## 4. 下载并解压

```bash
POST http://localhost:3000/api/cloud-build/download
```

请求体：

```json
{
  "downloadUrl": "/files/archives/paper-1.20.4.zip",
  "targetPath": "D:\\Games\\paper-1.20.4",
  "archiveFileName": "paper-1.20.4.zip"
}
```

响应示例：

```json
{
  "success": true,
  "message": "下载并解压成功",
  "data": {
    "targetPath": "D:\\Games\\paper-1.20.4",
    "startCommand": ".\\run.bat",
    "files": 12
  }
}
```

## 关键变化

- 旧的 Modrinth 云构建请求体已废弃
- 旧的 `taskId/fileName` 模式已废弃
- 现在统一使用：
  - `coreType`
  - `version`
  - `mcVersion`
  - `requestId`
  - `accessToken`
  - `downloadUrl`
