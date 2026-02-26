# 分片上传进度条修复说明

## 修复概述

修复了 `ChunkUploader` 类中进度计算的三个核心缺陷：进度不含在途分片字节数、百分比回退、速度跳跃。

## 修改文件

`client/src/utils/chunkUpload.ts`

## 修复内容

### 1. 进度包含在途分片字节数

新增 `getEffectiveUploadedSize()` 方法，将已完成分片大小与正在上传中分片的 XHR 已传输字节数合并计算，使进度条在大分片上传过程中平滑递增。

### 2. 百分比单调递增保证

新增 `maxPercentage` 成员变量，`sendDetailProgress` 和 `updateProgress` 中计算的百分比始终取当前值与历史最大值中的较大者，杜绝进度回退。

### 3. 滑动窗口速度计算

新增 `speedSamples` 数组和 `SPEED_WINDOW_MS`（5秒）常量，速度改用最近 5 秒内的传输量样本计算瞬时速度，替代原来的全局平均值，使速度显示更平滑。

## 影响范围

仅修改了进度百分比、速度、剩余时间的计算逻辑。以下行为不受影响：
- 分片计算、Hash 计算
- 断点续传、重试逻辑
- 合并逻辑、取消上传
- 并发数（3）和默认分片大小（50MB）
- 所有接口定义

## 测试

运行分片上传相关测试：

```bash
cd client
npx vitest --run
```

- `chunkUpload.fault.test.ts` — 3 个 Bug 条件测试（验证修复有效）
- `chunkUpload.preservation.test.ts` — 7 个保持行为测试（验证无回归）
