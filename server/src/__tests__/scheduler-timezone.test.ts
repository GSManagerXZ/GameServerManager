// 调度时区一致性回归测试。
//
// SchedulerManager.getNextRunTime 用 cron-parser 以 tz:'Asia/Shanghai' 计算并展示
// 下次执行时间（nextRun）；而 scheduleTask 此前创建 node-cron job 时未传 timezone，
// job 按系统时区触发。在系统时区不是 Asia/Shanghai 的主机上（例如默认 UTC 的
// Docker 容器），任务实际触发时间与界面展示不一致：「每天 00:00」会在北京时间
// 08:00 触发而非 00:00。
//
// 修复：scheduleTask 创建 cron job 时传入与展示一致的 timezone。
// 本测试通过 createTask 调用的参数契约（不依赖测试进程时区，任何机器上都可判别），
// 并锚定 job 实际触发时间与展示 nextRun 一致这一行为不变量。
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import cron from 'node-cron'

jest.mock('node-cron', () => {
  const actual = jest.requireActual<typeof import('node-cron')>('node-cron')
  const createTask = jest.fn(actual.default.createTask)
  return {
    ...actual,
    default: { ...actual.default, createTask },
    createTask
  }
})

import { SchedulerManager } from '../modules/scheduler/SchedulerManager.js'

const silentLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
} as any

const createTaskMock = jest.mocked(cron.createTask)

async function waitForSystemTaskReady(manager: SchedulerManager): Promise<void> {
  // 构造函数异步加载任务并初始化系统任务；等系统任务的 cron job 也注册完成，
  // 之后的注册表快照才不会混入系统任务的 job。
  for (let attempt = 0; attempt < 100; attempt++) {
    const systemTaskReady = manager.getTasks().some(task => task.id === 'system-steam-update')
    if (systemTaskReady && cron.getTasks().size >= 1) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('系统任务初始化超时')
}

describe('SchedulerManager 调度时区一致性', () => {
  let dataDir: string
  let manager: SchedulerManager

  beforeEach(async () => {
    createTaskMock.mockClear()
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gsm3-scheduler-test-'))
    manager = new SchedulerManager(dataDir, silentLogger)
    await waitForSystemTaskReady(manager)
  })

  afterEach(async () => {
    await manager.destroy()
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  test('创建 cron job 时传入与展示一致的时区（Asia/Shanghai）', async () => {
    const callsBefore = createTaskMock.mock.calls.length

    await manager.createTask({
      name: '每日零点重启',
      type: 'power',
      instanceId: 'instance-1',
      action: 'restart',
      schedule: '0 0 * * *',
      enabled: true
    })

    const newCalls = createTaskMock.mock.calls.slice(callsBefore)
    expect(newCalls).toHaveLength(1)
    const [, , options] = newCalls[0]
    expect(options).toMatchObject({ timezone: 'Asia/Shanghai' })
  })

  test('cron job 实际触发时间与界面展示的 nextRun 一致', async () => {
    const registeredBefore = new Set(cron.getTasks().keys())

    const task = await manager.createTask({
      name: '每日零点重启',
      type: 'power',
      instanceId: 'instance-1',
      action: 'restart',
      schedule: '0 0 * * *',
      enabled: true
    })

    const createdJobs = [...cron.getTasks().entries()].filter(([id]) => !registeredBefore.has(id))
    expect(createdJobs).toHaveLength(1)
    const [, job] = createdJobs[0]

    // 展示给用户的下次执行时间（getNextRunTime 按 Asia/Shanghai 计算）
    expect(task.nextRun).toBeDefined()
    const displayedNextRun = new Date(task.nextRun!).getTime()

    // cron job 自身的下次触发时间
    const actualNextRun = job.getNextRun()
    expect(actualNextRun).not.toBeNull()

    expect(actualNextRun!.getTime()).toBe(displayedNextRun)
  })

  test('nextRun 语义锚定：每天 00:00 指北京时间 00:00（UTC 16:00）', async () => {
    const task = await manager.createTask({
      name: '锚定展示语义',
      type: 'power',
      instanceId: 'instance-1',
      action: 'restart',
      schedule: '0 0 * * *',
      enabled: false
    })

    // Asia/Shanghai 无夏令时，恒为 UTC+8：北京时间 00:00 即 UTC 前一日 16:00。
    expect(task.nextRun).toBeDefined()
    expect(task.nextRun!.endsWith('T16:00:00.000Z')).toBe(true)
  })
})
