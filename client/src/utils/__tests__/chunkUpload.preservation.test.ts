/**
 * 保持行为属性测试 — 分片上传非进度计算行为
 *
 * 目标：在未修复代码上运行并通过，确认以下基线行为不变：
 *   1. shouldUseChunkUpload 的文件大小阈值判断（10MB）
 *   2. calculateChunks 的分片数量和大小计算
 *   3. UploadDetailProgress 回调对象包含所有原有字段且类型不变
 *   4. abort 信号正确中止所有 XHR 请求
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'
import { ChunkUploader, type UploadDetailProgress } from '../chunkUpload'

// ============================================================
// 常量
// ============================================================

const MB = 1024 * 1024
const THRESHOLD = 10 * MB       // shouldUseChunkUpload 阈值
const DEFAULT_CHUNK_SIZE = 50 * MB  // 默认分片大小
const CONCURRENT_UPLOADS = 3        // 并发上传数

// ============================================================
// Mock 工具（复用 fault 测试的模式）
// ============================================================

let xhrInstances: MockXHR[] = []

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
  abort() {
    this._aborted = true
    ;(this._listeners['abort'] || []).forEach(fn => fn())
  }

  _aborted = false

  /** 触发 upload progress 事件 */
  fireUploadProgress(loaded: number, total: number) {
    const event = { lengthComputable: true, loaded, total }
    ;(this._uploadListeners['progress'] || []).forEach(fn => fn(event))
  }

  /** 触发 load 事件 */
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
    // 先设置 merge mock，确保合并阶段不会失败
    ;(globalThis.fetch as any).mockImplementation(async (url: string, options?: any) => {
      // 解析请求体判断是 check 还是 merge
      if (options?.body) {
        try {
          const body = JSON.parse(options.body)
          if (body.uploadId !== undefined && body.totalChunks !== undefined && !body.chunkIndex && body.targetPath) {
            // merge 请求
            return { ok: true, json: async () => ({ success: true }) }
          }
        } catch { /* 非 JSON body */ }
      }
      // 默认返回 check 响应
      return { ok: true, json: async () => ({ uploadedChunks: [] }) }
    })

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
    await Promise.race([
      uploadPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('清理超时')), 8000)),
    ])
  } catch { /* 清理错误不影响测试 */ }
}

// ============================================================
// 测试套件
// ============================================================

describe('保持行为属性测试 — 非进度计算行为不变', () => {
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

  // ============================================================
  // 属性 1: shouldUseChunkUpload 阈值判断保持不变
  // ============================================================

  /**
   * 对任意文件大小，shouldUseChunkUpload 的判断结果与原始代码一致（阈值 10MB）
   * - 文件大小 <= 10MB 返回 false（使用普通上传）
   * - 文件大小 > 10MB 返回 true（使用分片上传）
   *
   * **Validates: Requirements 3.1**
   */
  it('属性1: shouldUseChunkUpload 对任意文件大小的判断结果与 10MB 阈值一致', () => {
    fc.assert(
      fc.property(
        // 生成 0 到 500MB 范围内的文件大小
        fc.integer({ min: 0, max: 500 * MB }),
        (fileSize) => {
          const result = ChunkUploader.shouldUseChunkUpload(fileSize)
          const expected = fileSize > THRESHOLD
          expect(result).toBe(expected)
        },
      ),
      { numRuns: 200 },
    )
  })

  /**
   * 边界值验证：精确测试阈值边界
   *
   * **Validates: Requirements 3.1**
   */
  it('属性1-边界: shouldUseChunkUpload 在阈值边界处行为正确', () => {
    // 恰好 10MB — 不使用分片
    expect(ChunkUploader.shouldUseChunkUpload(THRESHOLD)).toBe(false)
    // 10MB + 1 字节 — 使用分片
    expect(ChunkUploader.shouldUseChunkUpload(THRESHOLD + 1)).toBe(true)
    // 0 字节 — 不使用分片
    expect(ChunkUploader.shouldUseChunkUpload(0)).toBe(false)
    // 5MB — 不使用分片
    expect(ChunkUploader.shouldUseChunkUpload(5 * MB)).toBe(false)
    // 50MB — 使用分片
    expect(ChunkUploader.shouldUseChunkUpload(50 * MB)).toBe(true)
  })

  // ============================================================
  // 属性 2: calculateChunks 分片计算保持不变
  // ============================================================

  /**
   * 对任意文件大小（> 10MB），calculateChunks 产生的分片数量和大小与原始代码一致：
   * - 分片数量 = Math.ceil(fileSize / 50MB)
   * - 每个分片大小 = 50MB（最后一个分片可能更小）
   * - 所有分片大小之和 = 文件总大小
   *
   * 通过启动上传并观察 onDetailProgress 中的 totalChunks 来验证
   *
   * **Validates: Requirements 3.7**
   */
  it('属性2: calculateChunks 对任意文件大小产生正确的分片数量', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成 11MB 到 500MB 范围内的文件大小（确保使用分片上传）
        fc.integer({ min: 11 * MB, max: 500 * MB }),
        async (fileSize) => {
          xhrInstances = []
          const events: UploadDetailProgress[] = []

          const file = createMockFile(fileSize)
          const uploader = new ChunkUploader({
            file,
            targetPath: '/test',
            onDetailProgress: (d) => events.push({ ...d }),
          })

          const uploadPromise = uploader.upload()

          // 等待至少一个 uploading 事件（说明分片计算已完成）
          await waitFor(() => events.some(e => e.phase === 'uploading'), 10000)

          // 验证分片数量
          const expectedChunks = Math.ceil(fileSize / DEFAULT_CHUNK_SIZE)
          const uploadingEvent = events.find(e => e.phase === 'uploading')!
          expect(uploadingEvent.totalChunks).toBe(expectedChunks)
          expect(uploadingEvent.totalSize).toBe(fileSize)

          await cleanupUpload(uploadPromise, DEFAULT_CHUNK_SIZE)
        },
      ),
      { numRuns: 10, timeout: 60000 },
    )
  })

  /**
   * 具体验证：200MB 文件产生 4 个分片，每个 50MB
   *
   * **Validates: Requirements 3.7**
   */
  it('属性2-具体: 200MB 文件产生 4 个 50MB 分片', async () => {
    const FILE_SIZE = 200 * MB
    const events: UploadDetailProgress[] = []

    const file = createMockFile(FILE_SIZE)
    const uploader = new ChunkUploader({
      file,
      targetPath: '/test',
      onDetailProgress: (d) => events.push({ ...d }),
    })

    const uploadPromise = uploader.upload()
    await waitFor(() => events.some(e => e.phase === 'uploading'), 10000)

    const uploadingEvent = events.find(e => e.phase === 'uploading')!
    expect(uploadingEvent.totalChunks).toBe(4)
    expect(uploadingEvent.totalSize).toBe(FILE_SIZE)

    // 验证 chunksProgress 中每个分片的大小
    const chunksProgress = uploadingEvent.chunksProgress
    expect(chunksProgress.length).toBe(4)
    for (const cp of chunksProgress) {
      expect(cp.size).toBe(DEFAULT_CHUNK_SIZE)
    }

    await cleanupUpload(uploadPromise, DEFAULT_CHUNK_SIZE)
  })

  // ============================================================
  // 属性 3: UploadDetailProgress 回调对象字段完整性
  // ============================================================

  /**
   * onDetailProgress 回调对象包含所有原有字段且类型不变
   *
   * **Validates: Requirements 3.6**
   */
  it('属性3: UploadDetailProgress 回调包含所有原有字段且类型正确', async () => {
    const FILE_SIZE = 200 * MB
    const events: UploadDetailProgress[] = []

    const file = createMockFile(FILE_SIZE)
    const uploader = new ChunkUploader({
      file,
      targetPath: '/test',
      onDetailProgress: (d) => events.push({ ...d }),
    })

    const uploadPromise = uploader.upload()
    await waitFor(() => events.some(e => e.phase === 'uploading'), 10000)

    // 验证所有阶段的事件都包含必需字段
    for (const event of events) {
      // 必需字段存在性检查
      expect(event).toHaveProperty('phase')
      expect(event).toHaveProperty('phaseText')
      expect(event).toHaveProperty('currentChunk')
      expect(event).toHaveProperty('totalChunks')
      expect(event).toHaveProperty('uploadedChunks')
      expect(event).toHaveProperty('uploadedSize')
      expect(event).toHaveProperty('totalSize')
      expect(event).toHaveProperty('percentage')
      expect(event).toHaveProperty('speed')
      expect(event).toHaveProperty('speedText')
      expect(event).toHaveProperty('remainingTime')
      expect(event).toHaveProperty('remainingTimeText')
      expect(event).toHaveProperty('currentBatch')
      expect(event).toHaveProperty('totalBatches')
      expect(event).toHaveProperty('chunksProgress')

      // 类型检查
      expect(typeof event.phase).toBe('string')
      expect(['preparing', 'uploading', 'merging', 'completed', 'error']).toContain(event.phase)
      expect(typeof event.phaseText).toBe('string')
      expect(typeof event.currentChunk).toBe('number')
      expect(typeof event.totalChunks).toBe('number')
      expect(typeof event.uploadedChunks).toBe('number')
      expect(typeof event.uploadedSize).toBe('number')
      expect(typeof event.totalSize).toBe('number')
      expect(typeof event.percentage).toBe('number')
      expect(typeof event.speed).toBe('number')
      expect(typeof event.speedText).toBe('string')
      expect(typeof event.remainingTime).toBe('number')
      expect(typeof event.remainingTimeText).toBe('string')
      expect(typeof event.currentBatch).toBe('number')
      expect(typeof event.totalBatches).toBe('number')
      expect(Array.isArray(event.chunksProgress)).toBe(true)

      // 百分比范围检查
      expect(event.percentage).toBeGreaterThanOrEqual(0)
      expect(event.percentage).toBeLessThanOrEqual(100)

      // 速度非负
      expect(event.speed).toBeGreaterThanOrEqual(0)

      // chunksProgress 中每个元素的字段检查
      for (const cp of event.chunksProgress) {
        expect(cp).toHaveProperty('chunkIndex')
        expect(cp).toHaveProperty('status')
        expect(cp).toHaveProperty('progress')
        expect(cp).toHaveProperty('size')
        expect(cp).toHaveProperty('uploadedSize')
        expect(typeof cp.chunkIndex).toBe('number')
        expect(typeof cp.status).toBe('string')
        expect(['pending', 'uploading', 'completed', 'error', 'retrying']).toContain(cp.status)
        expect(typeof cp.progress).toBe('number')
        expect(typeof cp.size).toBe('number')
        expect(typeof cp.uploadedSize).toBe('number')
      }
    }

    await cleanupUpload(uploadPromise, DEFAULT_CHUNK_SIZE)
  })

  // ============================================================
  // 属性 4: abort 信号正确中止上传
  // ============================================================

  /**
   * 取消上传时所有 XHR 请求被正确中止
   *
   * 验证 abort 信号能触发 XHR 的 abort 方法。
   * 不等待上传完成（避免重试延迟导致超时），只验证 abort 行为。
   *
   * **Validates: Requirements 3.3**
   */
  it('属性4: abort 信号正确中止所有 XHR 请求', async () => {
    const FILE_SIZE = 200 * MB
    const controller = new AbortController()

    const file = createMockFile(FILE_SIZE)
    const uploader = new ChunkUploader({
      file,
      targetPath: '/test',
      signal: controller.signal,
    })

    // 启动上传但不等待完成
    const uploadPromise = uploader.upload().catch(() => { /* 忽略错误 */ })

    // 等待并发 XHR 创建
    await waitFor(() => xhrInstances.length >= CONCURRENT_UPLOADS, 10000)

    // 记录 abort 前的 XHR 实例
    const xhrBeforeAbort = [...xhrInstances]

    // 模拟部分上传进度
    for (const xhr of xhrBeforeAbort) {
      xhr.fireUploadProgress(DEFAULT_CHUNK_SIZE * 0.3, DEFAULT_CHUNK_SIZE)
    }

    // 触发取消
    controller.abort()

    // 短暂等待让 abort 事件传播
    await new Promise(r => setTimeout(r, 100))

    // 验证 XHR 实例的 abort 被调用
    const abortedCount = xhrBeforeAbort.filter(xhr => xhr._aborted).length
    expect(abortedCount).toBe(CONCURRENT_UPLOADS)
  })

  // ============================================================
  // 属性 5: 并发数保持为 3
  // ============================================================

  /**
   * 并发上传数保持为 3（CONCURRENT_UPLOADS = 3）
   *
   * **Validates: Requirements 3.7**
   */
  it('属性5: 并发上传数保持为 3', async () => {
    const FILE_SIZE = 300 * MB  // 6 个分片，需要 2 个批次
    const events: UploadDetailProgress[] = []

    const file = createMockFile(FILE_SIZE)
    const uploader = new ChunkUploader({
      file,
      targetPath: '/test',
      onDetailProgress: (d) => events.push({ ...d }),
    })

    const uploadPromise = uploader.upload()

    // 等待第一批 XHR 创建
    await waitFor(() => xhrInstances.length >= CONCURRENT_UPLOADS, 10000)

    // 第一批应该恰好创建 3 个 XHR（并发数为 3）
    // 在第一批完成前不应有更多 XHR
    const firstBatchCount = xhrInstances.length
    expect(firstBatchCount).toBe(CONCURRENT_UPLOADS)

    // 验证 totalBatches 正确
    const uploadingEvent = events.find(e => e.phase === 'uploading')!
    expect(uploadingEvent.totalBatches).toBe(Math.ceil(6 / CONCURRENT_UPLOADS))

    await cleanupUpload(uploadPromise, DEFAULT_CHUNK_SIZE)
  })
})
