/**
 * Bug 条件探索性测试 — 分片上传进度计算缺陷
 *
 * 目标：在未修复代码上运行，通过反例证明 bug 存在：
 *   1. 进度仅基于已完成分片计算，不包含正在上传中分片的 XHR 已传输字节数
 *   2. 百分比可能回退（新值 < 之前报告的最大值）
 *   3. 速度使用全局平均值而非滑动窗口
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'
import { ChunkUploader, type UploadDetailProgress } from '../chunkUpload'

// ============================================================
// Mock 工具
// ============================================================

/** 存储所有创建的 XHR 实例，方便测试中操控 */
let xhrInstances: MockXHR[] = []

/**
 * 模拟 XMLHttpRequest
 */
class MockXHR {
  private _uploadListeners: Record<string, Function[]> = {}
  private _listeners: Record<string, Function[]> = {}

  status = 200
  statusText = 'OK'
  responseText = JSON.stringify({ success: true })
  timeout = 0
  readyState = 0

  upload = {
    addEventListener: (event: string, handler: Function) => {
      if (!this._uploadListeners[event]) this._uploadListeners[event] = []
      this._uploadListeners[event].push(handler)
    },
  }

  addEventListener(event: string, handler: Function) {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(handler)
  }

  open(_method: string, _url: string) { this.readyState = 1 }
  setRequestHeader(_n: string, _v: string) {}
  send(_body?: any) { this.readyState = 2; xhrInstances.push(this) }
  abort() { (this._listeners['abort'] || []).forEach(fn => fn()) }

  /** 触发 upload progress 事件 */
  fireUploadProgress(loaded: number, total: number) {
    const event = { lengthComputable: true, loaded, total }
    ;(this._uploadListeners['progress'] || []).forEach(fn => fn(event))
  }

  /** 触发 load 事件（分片上传完成） */
  fireLoad(success = true) {
    this.status = 200
    this.responseText = JSON.stringify({ success })
    ;(this._listeners['load'] || []).forEach(fn => fn())
  }
}

/** 创建模拟 File 对象 */
function createMockFile(sizeInBytes: number, name = 'test.zip'): File {
  const buffer = new ArrayBuffer(Math.min(sizeInBytes, 1024))
  const blob = new Blob([buffer])
  const file = new File([blob], name, { type: 'application/octet-stream' })
  Object.defineProperty(file, 'size', { value: sizeInBytes, writable: false })
  Object.defineProperty(file, 'slice', {
    value: (_start?: number, _end?: number) => new Blob([new ArrayBuffer(0)]),
  })
  return file
}

/** 等待条件满足 */
async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`等待条件超时 (${timeoutMs}ms)`)
    await new Promise(r => setTimeout(r, 10))
  }
}

/** 完成所有 XHR 并结束上传流程 */
async function cleanupUpload(uploadPromise: Promise<void>, chunkSize: number): Promise<void> {
  try {
    // 多轮完成，处理批次间的延迟和新 XHR 创建
    for (let round = 0; round < 5; round++) {
      for (const xhr of xhrInstances) {
        try {
          xhr.fireUploadProgress(chunkSize, chunkSize)
          xhr.fireLoad(true)
        } catch { /* 忽略已完成的 */ }
      }
      await new Promise(r => setTimeout(r, 300))
    }
    // Mock merge
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    await Promise.race([
      uploadPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('清理超时')), 8000)),
    ])
  } catch { /* 清理错误不影响测试 */ }
}

// ============================================================
// 测试套件
// ============================================================

describe('Bug 条件探索性测试 — 分片上传进度计算缺陷', () => {
  let originalXHR: typeof XMLHttpRequest
  let originalFormData: typeof FormData
  let originalFetch: typeof fetch
  let originalLocalStorage: Storage
  let originalCrypto: Crypto

  beforeEach(() => {
    xhrInstances = []
    originalXHR = globalThis.XMLHttpRequest
    globalThis.XMLHttpRequest = MockXHR as any

    originalFormData = globalThis.FormData
    globalThis.FormData = class MockFormData {
      private data = new Map<string, any>()
      append(key: string, value: any) { this.data.set(key, value) }
      get(key: string) { return this.data.get(key) }
    } as any

    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ uploadedChunks: [] }),
    }) as any

    originalLocalStorage = globalThis.localStorage
    const store: Record<string, string> = { gsm3_token: 'mock-token' }
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, val: string) => { store[key] = val },
        removeItem: (key: string) => { delete store[key] },
      },
      writable: true, configurable: true,
    })

    originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: { digest: async () => new ArrayBuffer(32) } },
      writable: true, configurable: true,
    })
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR
    globalThis.FormData = originalFormData
    globalThis.fetch = originalFetch
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, writable: true, configurable: true })
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, writable: true, configurable: true })
    vi.restoreAllMocks()
  })

  /**
   * 属性测试 1: 进度应包含在途分片的已传输字节数
   *
   * 在未修复代码上，当分片正在上传但尚未完成时，
   * percentage 应该反映 XHR 已传输的字节数，而不是停留在 0%。
   *
   * **Validates: Requirements 1.1, 1.2, 2.1**
   */
  it('属性1: 在途分片已传输字节数应被计入总进度百分比', async () => {
    const FILE_SIZE = 200 * 1024 * 1024
    const CHUNK_SIZE = 50 * 1024 * 1024

    await fc.assert(
      fc.asyncProperty(
        // 生成 3 个在途分片各自的上传进度比例 (0.1 ~ 0.9)
        fc.tuple(
          fc.double({ min: 0.1, max: 0.9, noNaN: true }),
          fc.double({ min: 0.1, max: 0.9, noNaN: true }),
          fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        ),
        async ([p0, p1, p2]) => {
          xhrInstances = []
          const events: UploadDetailProgress[] = []

          const file = createMockFile(FILE_SIZE)
          const uploader = new ChunkUploader({
            file,
            targetPath: '/test',
            chunkSize: CHUNK_SIZE,
            onDetailProgress: (d) => events.push({ ...d }),
          })

          const uploadPromise = uploader.upload()
          // 等待并发 3 个 XHR 创建
          await waitFor(() => xhrInstances.length >= 3)

          // 模拟各分片上传了一部分数据
          const loaded0 = Math.floor(CHUNK_SIZE * p0)
          const loaded1 = Math.floor(CHUNK_SIZE * p1)
          const loaded2 = Math.floor(CHUNK_SIZE * p2)

          xhrInstances[0].fireUploadProgress(loaded0, CHUNK_SIZE)
          xhrInstances[1].fireUploadProgress(loaded1, CHUNK_SIZE)
          xhrInstances[2].fireUploadProgress(loaded2, CHUNK_SIZE)

          // 计算期望的最低百分比
          const totalInFlight = loaded0 + loaded1 + loaded2
          const expectedMin = Math.floor((totalInFlight / FILE_SIZE) * 100)

          // 获取最后一个 uploading 事件
          const last = events.filter(e => e.phase === 'uploading').pop()

          // 【核心断言】进度百分比应 >= 在途字节数对应的百分比
          // 未修复代码上 percentage = 0%（无分片完成），expectedMin > 0
          expect(last).toBeDefined()
          expect(last!.percentage).toBeGreaterThanOrEqual(expectedMin)

          await cleanupUpload(uploadPromise, CHUNK_SIZE)
        },
      ),
      { numRuns: 5, timeout: 60000 },
    )
  })

  /**
   * 属性测试 2: 当有在途分片已传输字节数时，percentage 不应为 0
   *
   * 在未修复代码上，分片上传过程中 percentage 一直是 0%（因为 uploadedSize 只在分片完成后才增加），
   * 即使 chunksProgressMap 中已记录了大量在途字节数。
   *
   * **Validates: Requirements 1.2, 2.2**
   */
  it('属性2: 有在途字节数时百分比不应为零', async () => {
    const FILE_SIZE = 200 * 1024 * 1024
    const CHUNK_SIZE = 50 * 1024 * 1024
    const events: UploadDetailProgress[] = []

    const file = createMockFile(FILE_SIZE)
    const uploader = new ChunkUploader({
      file,
      targetPath: '/test',
      chunkSize: CHUNK_SIZE,
      onDetailProgress: (d) => events.push({ ...d }),
    })

    const uploadPromise = uploader.upload()
    await waitFor(() => xhrInstances.length >= 3)

    // 3 个分片各上传 80%（共 120MB / 200MB = 60%）
    xhrInstances[0].fireUploadProgress(CHUNK_SIZE * 0.8, CHUNK_SIZE)
    xhrInstances[1].fireUploadProgress(CHUNK_SIZE * 0.8, CHUNK_SIZE)
    xhrInstances[2].fireUploadProgress(CHUNK_SIZE * 0.8, CHUNK_SIZE)

    // 找到有在途字节数的事件
    const eventsWithInFlight = events.filter(e =>
      e.phase === 'uploading' &&
      e.chunksProgress.some(cp => cp.status === 'uploading' && cp.uploadedSize > 0)
    )

    expect(eventsWithInFlight.length).toBeGreaterThan(0)

    // 【核心断言】有在途字节数时 percentage 不应全为 0
    // 未修复代码上这些事件的 percentage 全部是 0
    const allZero = eventsWithInFlight.every(e => e.percentage === 0)
    expect(allZero).toBe(false)

    await cleanupUpload(uploadPromise, CHUNK_SIZE)
  })

  /**
   * 属性测试 3: 速度不应在分片完成瞬间出现不合理跳跃
   *
   * 在未修复代码上，速度使用 (uploadedSize / elapsed) * 1000 计算。
   * 分片上传过程中 uploadedSize = 0，所以 speed = 0。
   * 分片完成瞬间 uploadedSize 突然变为 50MB，speed 从 0 跳到极高值。
   *
   * **Validates: Requirements 1.3, 2.3**
   */
  it('属性3: 速度不应在分片完成瞬间出现不合理跳跃', async () => {
    const FILE_SIZE = 200 * 1024 * 1024
    const CHUNK_SIZE = 50 * 1024 * 1024
    const events: UploadDetailProgress[] = []

    const file = createMockFile(FILE_SIZE)
    const uploader = new ChunkUploader({
      file,
      targetPath: '/test',
      chunkSize: CHUNK_SIZE,
      onDetailProgress: (d) => events.push({ ...d }),
    })

    const uploadPromise = uploader.upload()
    await waitFor(() => xhrInstances.length >= 3)

    // 分片 0 逐步上传
    xhrInstances[0].fireUploadProgress(CHUNK_SIZE * 0.2, CHUNK_SIZE)
    xhrInstances[0].fireUploadProgress(CHUNK_SIZE * 0.5, CHUNK_SIZE)
    xhrInstances[0].fireUploadProgress(CHUNK_SIZE * 0.8, CHUNK_SIZE)

    // 收集分片完成前的速度（在未修复代码上全部为 0，因为 uploadedSize = 0）
    const speedsBeforeComplete = events
      .filter(e => e.phase === 'uploading')
      .map(e => e.speed)

    // 分片 0 完成 — uploadedSize 从 0 跳到 50MB
    xhrInstances[0].fireUploadProgress(CHUNK_SIZE, CHUNK_SIZE)
    xhrInstances[0].fireLoad(true)

    // 等待 load 事件处理
    await new Promise(r => setTimeout(r, 50))

    // 分片 1 触发 progress（此时 sendDetailProgress 会用新的 uploadedSize 计算速度）
    xhrInstances[1].fireUploadProgress(CHUNK_SIZE * 0.1, CHUNK_SIZE)

    const allSpeeds = events
      .filter(e => e.phase === 'uploading')
      .map(e => e.speed)

    // 【核心断言】速度序列中不应出现从 0 到极高值的跳跃
    // 在未修复代码上，速度从 0 跳到 (50MB / 很短时间)，变化极大
    // 修复后使用滑动窗口，速度应该平滑变化
    //
    // 检查：如果之前速度为 0，之后速度突然 > 0，说明速度计算有问题
    // （在途字节数应该让速度在分片完成前就 > 0）
    const hasZeroBeforeComplete = speedsBeforeComplete.some(s => s === 0)
    const hasNonZeroAfterComplete = allSpeeds.slice(speedsBeforeComplete.length).some(s => s > 0)

    // 在未修复代码上：分片完成前速度全为 0，完成后突然 > 0
    // 修复后：分片上传过程中速度就应该 > 0（因为包含在途字节数）
    if (hasZeroBeforeComplete && hasNonZeroAfterComplete) {
      // 速度从 0 跳到非 0 — 这是 bug 行为
      // 修复后，在途字节数应让速度在分片完成前就 > 0
      expect(speedsBeforeComplete.every(s => s === 0)).toBe(false)
    }

    await cleanupUpload(uploadPromise, CHUNK_SIZE)
  })
})
