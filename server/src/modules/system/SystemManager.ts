import { Server as SocketIOServer, Socket } from 'socket.io'
import winston from 'winston'
import os from 'os'
import fs from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { EventEmitter } from 'events'

const execAsync = promisify(exec)

interface SystemInfo {
  platform: string
  arch: string
  hostname: string
  ipv4: string[]
  ipv6: string[]
  uptime: number
  totalMemory: number
  freeMemory: number
  cpuCount: number
  cpuModel: string
  nodeVersion: string
  serverVersion: string
  serverUptime: number
}

interface SystemStats {
  timestamp: Date
  cpu: {
    usage: number
    cores: number
    model: string
    speed: number
    coreUsages: number[] // 每个核心的使用率
  }
  memory: {
    total: number
    used: number
    free: number
    usage: number
    // Windows特有字段
    committed?: number
    commitLimit?: number
    // Linux特有字段
    swap?: {
      total: number
      used: number
      free: number
      usage: number
    }
    // 通用详细信息
    available?: number
    buffers?: number
    cached?: number
  }
  disk: {
    total: number
    used: number
    free: number
    usage: number
    readBytes: number
    writeBytes: number
    readOps: number
    writeOps: number
  }
  network: {
    rx: number
    tx: number
  }
  processes: {
    total: number
    running: number
    sleeping: number
  }
  load: {
    avg1: number
    avg5: number
    avg15: number
  }
}

interface ProcessInfo {
  pid: number
  name: string
  cpu: number
  memory: number
  status: string
  startTime: Date
  command: string
}

interface ProcessInfoResponse {
  id: string
  pid: number
  name: string
  cpu: number
  memory: number
  status: string
  startTime: string
  command: string
}

interface DiskInfo {
  filesystem: string
  size: number
  used: number
  available: number
  usage: number
  mountpoint: string
}

interface NetworkInterface {
  name: string
  address: string
  netmask: string
  family: string
  mac: string
  internal: boolean
  cidr: string
}

interface ActivePort {
  port: number
  protocol: 'tcp' | 'udp'
  state: string
  process?: string
  pid?: number
  address: string
}

interface SystemAlert {
  id: string
  type: 'cpu' | 'memory' | 'disk' | 'network' | 'process'
  level: 'info' | 'warning' | 'critical'
  message: string
  value: number
  threshold: number
  timestamp: Date
  resolved: boolean
}

interface AlertThresholds {
  cpu: { warning: number; critical: number }
  memory: { warning: number; critical: number }
  disk: { warning: number; critical: number }
  network: { warning: number; critical: number }
}

export class SystemManager extends EventEmitter {
  private io: SocketIOServer
  private logger: winston.Logger
  private serverStartTime: Date
  private statsHistory: SystemStats[] = []
  private alerts: Map<string, SystemAlert> = new Map()
  private alertThresholds: AlertThresholds
  private monitoringInterval?: NodeJS.Timeout
  private portsMonitoringInterval?: NodeJS.Timeout
  private processesMonitoringInterval?: NodeJS.Timeout
  private lastNetworkStats: any = null
  private lastDiskStats: any = null
  private selectedDisk: string = '' // 当前选择的磁盘，空字符串表示总计
  private selectedNetworkInterface: string = '' // 当前选择的网络接口，空字符串表示总计

  // 资源检测方案缓存
  private resourceMethods = {
    diskInfo: 'unknown' as 'powershell' | 'wmic' | 'fallback' | 'unknown',
    memoryInfo: 'unknown' as 'powershell' | 'wmic' | 'fallback' | 'unknown',
    processInfo: 'unknown' as 'powershell' | 'wmic' | 'fallback' | 'unknown'
  }

  constructor(io: SocketIOServer, logger: winston.Logger) {
    super()
    this.io = io
    this.logger = logger
    this.serverStartTime = new Date()
    
    // 默认告警阈值
    this.alertThresholds = {
      cpu: { warning: 100, critical: 100 }, // 禁用CPU告警
      memory: { warning: 80, critical: 90 },
      disk: { warning: 70, critical: 80 },
      network: { warning: 100 * 1024 * 1024, critical: 500 * 1024 * 1024 } // MB/s
    }
    
    this.logger.info('系统监控管理器初始化完成')
    
    // 清理现有的CPU告警（因为已禁用CPU告警）
    setTimeout(() => {
      const cpuAlert = this.alerts.get('cpu-alert')
      if (cpuAlert && !cpuAlert.resolved) {
        cpuAlert.resolved = true
        this.io.emit('system-alert-resolved', cpuAlert)
        this.logger.info('CPU告警已禁用，现有CPU告警已解除')
      }
    }, 1000)
    
    // 检测并输出当前系统的资源获取方法
    this.detectResourceMethods()
    
    // 开始监控
    this.startMonitoring()
  }

  /**
   * 检测当前系统的资源获取方法
   */
  private async detectResourceMethods(): Promise<void> {
    const platform = os.platform()

    if (platform === 'win32') {
      this.logger.info('系统平台: Windows')

      // 检测磁盘信息获取方法
      try {
        await execAsync('powershell "Get-WmiObject -Class Win32_LogicalDisk | Select-Object Size,FreeSpace,DeviceID | ConvertTo-Json"', { timeout: 8000 })
        this.resourceMethods.diskInfo = 'powershell'
        this.logger.info('磁盘信息获取方法: PowerShell WMI')
      } catch (psError) {
        try {
          await execAsync('wmic logicaldisk get size,freespace,caption', { timeout: 5000 })
          this.resourceMethods.diskInfo = 'wmic'
          this.logger.info('磁盘信息获取方法: WMIC命令 (PowerShell不可用)')
        } catch (wmicError) {
          this.resourceMethods.diskInfo = 'fallback'
          this.logger.warn('磁盘信息获取方法: 备用方案 (PowerShell和WMIC均不可用)')
        }
      }

      // 检测内存信息获取方法
      try {
        await execAsync('powershell "Get-Counter \'\\Memory\\Committed Bytes\',\'\\Memory\\Commit Limit\' | Select-Object -ExpandProperty CounterSamples | Select-Object Path,CookedValue | ConvertTo-Json"', { timeout: 8000 })
        this.resourceMethods.memoryInfo = 'powershell'
        this.logger.info('内存信息获取方法: PowerShell 性能计数器')
      } catch (psError) {
        try {
          await execAsync('wmic OS get TotalVirtualMemorySize,TotalVisibleMemorySize,FreeVirtualMemory,FreePhysicalMemory /format:csv', { timeout: 5000 })
          this.resourceMethods.memoryInfo = 'wmic'
          this.logger.info('内存信息获取方法: WMIC命令 (PowerShell不可用)')
        } catch (wmicError) {
          this.resourceMethods.memoryInfo = 'fallback'
          this.logger.warn('内存信息获取方法: 备用方案 (PowerShell和WMIC均不可用)')
        }
      }

      // 检测进程信息获取方法
      try {
        await execAsync('powershell "Get-Process | Select-Object Name,Id,CPU,WorkingSet,StartTime | Sort-Object CPU -Descending | Select-Object -First 5 | ConvertTo-Json"', { timeout: 8000 })
        this.resourceMethods.processInfo = 'powershell'
        this.logger.info('进程信息获取方法: PowerShell Get-Process')
      } catch (psError) {
        try {
          await execAsync('wmic process get Name,ProcessId,PageFileUsage,UserModeTime,KernelModeTime,CreationDate /format:csv', { timeout: 5000 })
          this.resourceMethods.processInfo = 'wmic'
          this.logger.info('进程信息获取方法: WMIC命令 (PowerShell不可用)')
        } catch (wmicError) {
          this.resourceMethods.processInfo = 'fallback'
          this.logger.warn('进程信息获取方法: 备用方案 (PowerShell和WMIC均不可用)')
        }
      }
    } else {
      this.logger.info(`系统平台: ${platform}`)
      this.logger.info('磁盘信息获取方法: Linux df命令')
      this.resourceMethods.diskInfo = 'powershell' // 在Linux上使用默认方法
      this.resourceMethods.memoryInfo = 'powershell'
      this.resourceMethods.processInfo = 'powershell'
    }
  }

  /**
   * 开始系统监控
   */
  private startMonitoring(): void {
    // 每3秒收集一次系统统计信息
    this.monitoringInterval = setInterval(async () => {
      try {
        // 检查是否有客户端订阅系统状态
        if (!this.hasSubscribers('system-stats')) {
          return
        }
        
        const stats = await this.collectSystemStats()
        this.statsHistory.push(stats)
        
        // 保持最近1小时的数据 (1200个数据点，3秒间隔)
        if (this.statsHistory.length > 1200) {
          this.statsHistory = this.statsHistory.slice(-1200)
        }
        
        // 检查告警
        this.checkAlerts(stats)
        
        // 发送统计信息到客户端
        this.io.to('system-stats').emit('system-stats', stats)
        
      } catch (error) {
        this.logger.error('收集系统统计信息失败:', error)
      }
    }, 3000)

    // 每10秒收集一次端口信息
    this.portsMonitoringInterval = setInterval(async () => {
      try {
        // 检查是否有客户端订阅端口信息
        if (!this.hasSubscribers('system-ports')) {
          return
        }
        
        const ports = await this.getActivePorts()
        this.io.to('system-ports').emit('system-ports', ports)
      } catch (error) {
        this.logger.error('收集端口信息失败:', error)
      }
    }, 10000)

    // 每8秒收集一次进程信息
    this.processesMonitoringInterval = setInterval(async () => {
      try {
        // 检查是否有客户端订阅进程信息
        if (!this.hasSubscribers('system-processes')) {
          return
        }
        
        const processes = await this.getProcessList()
        this.io.to('system-processes').emit('system-processes', processes)
      } catch (error) {
        this.logger.error('收集进程信息失败:', error)
      }
    }, 8000)
  }

  /**
   * 检查是否有客户端订阅指定房间
   */
  private hasSubscribers(roomName: string): boolean {
    const room = this.io.sockets.adapter.rooms.get(roomName)
    return room ? room.size > 0 : false
  }

  /**
   * 停止系统监控
   */
  private stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = undefined
    }
    if (this.portsMonitoringInterval) {
      clearInterval(this.portsMonitoringInterval)
      this.portsMonitoringInterval = undefined
    }
    if (this.processesMonitoringInterval) {
      clearInterval(this.processesMonitoringInterval)
      this.processesMonitoringInterval = undefined
    }
  }

  /**
   * 获取本地IP地址
   */
  private getLocalIpAddresses(): { ipv4: string[], ipv6: string[] } {
    const interfaces = os.networkInterfaces()
    const ipv4: string[] = []
    const ipv6: string[] = []
    
    for (const name of Object.keys(interfaces)) {
      const networkInterface = interfaces[name]
      if (!networkInterface) continue
      
      for (const net of networkInterface) {
        // 跳过内部地址和非活跃接口
        if (net.internal || !net.address) continue
        
        if (net.family === 'IPv4') {
          ipv4.push(net.address)
        } else if (net.family === 'IPv6') {
          // 过滤掉链路本地地址
          if (!net.address.startsWith('fe80:')) {
            ipv6.push(net.address)
          }
        }
      }
    }
    
    return { ipv4, ipv6 }
  }

  /**
   * 获取系统基本信息
   */
  public async getSystemInfo(): Promise<SystemInfo> {
    const cpus = os.cpus()
    let platformName: string = os.platform()
    
    // 如果是Windows系统，获取具体版本信息
    if (os.platform() === 'win32') {
      try {
        // 使用PowerShell获取Windows版本信息，避免中文编码问题
        const { stdout } = await execAsync('powershell "(Get-WmiObject -Class Win32_OperatingSystem).Caption"', { encoding: 'utf8' })
        const versionName = stdout.trim()
        if (versionName && versionName !== '') {
          // 简化版本名称显示
          if (versionName.includes('Windows 11')) {
            platformName = 'Windows 11'
          } else if (versionName.includes('Windows 10')) {
            platformName = 'Windows 10'
          } else if (versionName.includes('Windows Server 2022')) {
            platformName = 'Windows Server 2022'
          } else if (versionName.includes('Windows Server 2019')) {
            platformName = 'Windows Server 2019'
          } else if (versionName.includes('Windows Server 2016')) {
            platformName = 'Windows Server 2016'
          } else if (versionName.includes('Windows Server')) {
            platformName = 'Windows Server'
          } else {
            platformName = 'Windows'
          }
        } else {
          platformName = 'Windows'
        }
      } catch (error) {
        this.logger.warn('获取Windows版本信息失败:', error)
        platformName = 'Windows'
      }
    }
    
    // 获取本地IP地址
    const { ipv4, ipv6 } = this.getLocalIpAddresses()
    
    return {
      platform: platformName,
      arch: os.arch(),
      hostname: os.hostname(),
      ipv4,
      ipv6,
      uptime: os.uptime(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Unknown',
      nodeVersion: process.version,
      serverVersion: process.env.npm_package_version || '1.0.0',
      serverUptime: Date.now() - this.serverStartTime.getTime()
    }
  }

  /**
   * 收集系统统计信息
   */
  private async collectSystemStats(): Promise<SystemStats> {
    const cpuUsage = await this.getCpuUsage()
    const memoryInfo = await this.getMemoryInfo()
    const diskInfo = await this.getDiskInfo()
    const networkInfo = await this.getNetworkInfo()
    const processInfo = await this.getProcessInfo()
    const loadInfo = this.getLoadInfo()
    
    return {
      timestamp: new Date(),
      cpu: cpuUsage,
      memory: memoryInfo,
      disk: diskInfo,
      network: networkInfo,
      processes: processInfo,
      load: loadInfo
    }
  }

  /**
   * 获取CPU使用率
   */
  private async getCpuUsage(): Promise<SystemStats['cpu']> {
    return new Promise((resolve) => {
      const cpus = os.cpus()
      const startMeasure = cpus.map(cpu => {
        const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0)
        const idle = cpu.times.idle
        return { total, idle }
      })
      
      setTimeout(() => {
        const endMeasure = os.cpus().map(cpu => {
          const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0)
          const idle = cpu.times.idle
          return { total, idle }
        })
        
        let totalUsage = 0
        const coreUsages: number[] = []
        
        for (let i = 0; i < startMeasure.length; i++) {
          const totalDiff = endMeasure[i].total - startMeasure[i].total
          const idleDiff = endMeasure[i].idle - startMeasure[i].idle
          const usage = totalDiff > 0 ? 100 - (100 * idleDiff / totalDiff) : 0
          const roundedUsage = Math.round(usage * 100) / 100
          coreUsages.push(roundedUsage)
          totalUsage += usage
        }
        
        const avgUsage = totalUsage / cpus.length
        
        resolve({
          usage: Math.round(avgUsage * 100) / 100,
          cores: cpus.length,
          model: cpus[0]?.model || 'Unknown',
          speed: cpus[0]?.speed || 0,
          coreUsages
        })
      }, 100)
    })
  }

  /**
   * 获取内存信息
   */
  private async getMemoryInfo(): Promise<SystemStats['memory']> {
    const platform = os.platform()
    
    if (platform === 'win32') {
      return await this.getWindowsMemoryInfo()
    } else {
      return await this.getLinuxMemoryInfo()
    }
  }

  /**
   * 获取Windows内存信息
   */
  private async getWindowsMemoryInfo(): Promise<SystemStats['memory']> {
    // 根据检测到的方案选择对应的方法
    if (this.resourceMethods.memoryInfo === 'powershell') {
      return await this.getWindowsMemoryInfoByPowerShell()
    } else if (this.resourceMethods.memoryInfo === 'wmic') {
      return await this.getWindowsMemoryInfoByWmic()
    } else {
      return await this.getWindowsMemoryInfoFallback()
    }
  }

  /**
   * 使用PowerShell获取Windows内存信息
   */
  private async getWindowsMemoryInfoByPowerShell(): Promise<SystemStats['memory']> {
    const total = os.totalmem()
    const free = os.freemem()
    const used = total - free
    const usage = (used / total) * 100

    let committed = 0
    let commitLimit = 0

    try {
      // 使用PowerShell获取内存性能计数器，这样更准确
      const psCommand = `powershell "Get-Counter '\\Memory\\Committed Bytes','\\Memory\\Commit Limit' | Select-Object -ExpandProperty CounterSamples | Select-Object Path,CookedValue | ConvertTo-Json"`
      const { stdout } = await execAsync(psCommand, { timeout: 10000 })

      if (stdout.trim()) {
        const counters = JSON.parse(stdout)
        const counterArray = Array.isArray(counters) ? counters : [counters]

        for (const counter of counterArray) {
          const path = counter.Path.toLowerCase()
          const value = parseFloat(counter.CookedValue) || 0

          if (path.includes('committed bytes')) {
            committed = value
          } else if (path.includes('commit limit')) {
            commitLimit = value
          }
        }
      }
    } catch (error) {
      this.logger.error('PowerShell获取内存信息失败:', error)
      throw error
    }

    return {
      total,
      used,
      free,
      usage: Math.round(usage * 100) / 100,
      committed,
      commitLimit
    }
  }

  /**
   * 使用WMIC获取Windows内存信息
   */
  private async getWindowsMemoryInfoByWmic(): Promise<SystemStats['memory']> {
    const total = os.totalmem()
    const free = os.freemem()
    const used = total - free
    const usage = (used / total) * 100

    let committed = 0
    let commitLimit = 0

    try {
      // 使用wmic获取操作系统信息
      const command = 'wmic OS get TotalVirtualMemorySize,TotalVisibleMemorySize,FreeVirtualMemory,FreePhysicalMemory /format:csv'
      const { stdout } = await execAsync(command, { timeout: 10000 })

      const lines = stdout.trim().split('\n').filter(line => line.trim() && !line.startsWith('Node'))
      if (lines.length > 0) {
        const parts = lines[0].split(',')
        if (parts.length >= 5) {
          const freePhysical = parseInt(parts[1]) * 1024 || 0 // KB to bytes
          const freeVirtual = parseInt(parts[2]) * 1024 || 0
          const totalPhysical = parseInt(parts[3]) * 1024 || 0
          const totalVirtual = parseInt(parts[4]) * 1024 || 0

          commitLimit = totalVirtual
          committed = totalVirtual - freeVirtual
        }
      }
    } catch (error) {
      this.logger.error('WMIC获取内存信息失败:', error)
      throw error
    }

    return {
      total,
      used,
      free,
      usage: Math.round(usage * 100) / 100,
      committed,
      commitLimit
    }
  }

  /**
   * 内存信息获取备用方案
   */
  private async getWindowsMemoryInfoFallback(): Promise<SystemStats['memory']> {
    const total = os.totalmem()
    const free = os.freemem()
    const used = total - free
    const usage = (used / total) * 100

    this.logger.warn('使用内存信息获取备用方案')
    return {
      total,
      used,
      free,
      usage: Math.round(usage * 100) / 100,
      committed: 0,
      commitLimit: 0
    }
  }

  /**
   * 获取Linux内存信息
   */
  private async getLinuxMemoryInfo(): Promise<SystemStats['memory']> {
    const total = os.totalmem()
    const free = os.freemem()
    const used = total - free
    const usage = (used / total) * 100

    let available = 0
    let buffers = 0
    let cached = 0
    let swapTotal = 0
    let swapFree = 0
    let swapUsed = 0
    let swapUsage = 0

    try {
      // 读取 /proc/meminfo 获取详细内存信息
      const { stdout } = await execAsync('cat /proc/meminfo', { timeout: 5000 })
      
      const lines = stdout.split('\n')
      for (const line of lines) {
        const parts = line.split(':')
        if (parts.length >= 2) {
          const key = parts[0].trim()
          const value = parseInt(parts[1].trim().split(' ')[0]) * 1024 || 0 // KB to bytes
          
          switch (key) {
            case 'MemAvailable':
              available = value
              break
            case 'Buffers':
              buffers = value
              break
            case 'Cached':
              cached = value
              break
            case 'SwapTotal':
              swapTotal = value
              break
            case 'SwapFree':
              swapFree = value
              break
          }
        }
      }
      
      swapUsed = swapTotal - swapFree
      swapUsage = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0
      
    } catch (error) {
      this.logger.warn('获取Linux详细内存信息失败:', error)
    }

    return {
      total,
      used,
      free,
      usage: Math.round(usage * 100) / 100,
      available,
      buffers,
      cached,
      swap: {
        total: swapTotal,
        used: swapUsed,
        free: swapFree,
        usage: Math.round(swapUsage * 100) / 100
      }
    }
  }

  /**
   * 获取磁盘信息
   */
  private async getDiskInfo(): Promise<SystemStats['disk']> {
    try {
      if (os.platform() === 'win32') {
        return await this.getWindowsDiskInfo()
      } else {
        return await this.getLinuxDiskInfo()
      }
    } catch (error) {
      this.logger.error('获取磁盘信息失败:', error)
      return {
        total: 0,
        used: 0,
        free: 0,
        usage: 0,
        readBytes: 0,
        writeBytes: 0,
        readOps: 0,
        writeOps: 0
      }
    }
  }

  /**
   * 获取Windows磁盘信息
   */
  private async getWindowsDiskInfo(): Promise<SystemStats['disk']> {
    // 根据检测到的方案选择对应的方法
    if (this.resourceMethods.diskInfo === 'powershell') {
      return await this.getWindowsDiskInfoByPowerShell()
    } else if (this.resourceMethods.diskInfo === 'wmic') {
      return await this.getWindowsDiskInfoByWmic()
    } else {
      return await this.getWindowsDiskInfoFallback()
    }
  }

  /**
   * 使用PowerShell获取Windows磁盘信息
   */
  private async getWindowsDiskInfoByPowerShell(): Promise<SystemStats['disk']> {
    try {
      // 使用PowerShell获取磁盘空间信息
      let psCommand: string
      if (this.selectedDisk) {
        // 监控指定磁盘
        psCommand = `powershell "Get-WmiObject -Class Win32_LogicalDisk | Where-Object {$_.DeviceID -eq '${this.selectedDisk}'} | Select-Object Size,FreeSpace,DeviceID | ConvertTo-Json"`
      } else {
        // 监控所有磁盘总计
        psCommand = 'powershell "Get-WmiObject -Class Win32_LogicalDisk | Select-Object Size,FreeSpace,DeviceID | ConvertTo-Json"'
      }

      const { stdout: spaceOutput } = await execAsync(psCommand, { timeout: 15000 })

      const disks = JSON.parse(spaceOutput)
      const diskArray = Array.isArray(disks) ? disks : [disks]

      let totalSize = 0
      let totalFree = 0

      for (const disk of diskArray) {
        if (disk.Size && disk.FreeSpace) {
          totalSize += parseInt(disk.Size) || 0
          totalFree += parseInt(disk.FreeSpace) || 0
        }
      }

      const used = totalSize - totalFree
      const usage = totalSize > 0 ? (used / totalSize) * 100 : 0

      // 获取磁盘读写信息
      let readBytes = 0, writeBytes = 0, readOps = 0, writeOps = 0

      try {
        // 使用PowerShell获取磁盘性能计数器
        let diskIOCommand: string
        if (this.selectedDisk) {
          // 监控指定磁盘的IO
          const diskIndex = this.selectedDisk.replace(':', '')
          diskIOCommand = `powershell "Get-Counter '\\LogicalDisk(${diskIndex}:)\\Disk Read Bytes/sec','\\LogicalDisk(${diskIndex}:)\\Disk Write Bytes/sec','\\LogicalDisk(${diskIndex}:)\\Disk Reads/sec','\\LogicalDisk(${diskIndex}:)\\Disk Writes/sec' | Select-Object -ExpandProperty CounterSamples | Select-Object Path,CookedValue | ConvertTo-Json"`
        } else {
          // 监控所有磁盘总计
          diskIOCommand = `powershell "Get-Counter '\\PhysicalDisk(_Total)\\Disk Read Bytes/sec','\\PhysicalDisk(_Total)\\Disk Write Bytes/sec','\\PhysicalDisk(_Total)\\Disk Reads/sec','\\PhysicalDisk(_Total)\\Disk Writes/sec' | Select-Object -ExpandProperty CounterSamples | Select-Object Path,CookedValue | ConvertTo-Json"`
        }

        const { stdout: ioOutput } = await execAsync(diskIOCommand, { timeout: 10000 })

        if (ioOutput.trim()) {
          const counters = JSON.parse(ioOutput)
          const counterArray = Array.isArray(counters) ? counters : [counters]

          // 累计当前的总IO数据
          let totalReadBytes = 0, totalWriteBytes = 0, totalReadOps = 0, totalWriteOps = 0

          for (const counter of counterArray) {
            const path = counter.Path.toLowerCase()
            const value = parseFloat(counter.CookedValue) || 0

            if (path.includes('disk read bytes/sec')) {
              totalReadBytes += value
            } else if (path.includes('disk write bytes/sec')) {
              totalWriteBytes += value
            } else if (path.includes('disk reads/sec')) {
              totalReadOps += value
            } else if (path.includes('disk writes/sec')) {
              totalWriteOps += value
            }
          }

          // 计算当前速率（如果有上次的数据）
          const currentStats = {
            readBytes: totalReadBytes,
            writeBytes: totalWriteBytes,
            readOps: totalReadOps,
            writeOps: totalWriteOps,
            timestamp: Date.now()
          }

          if (this.lastDiskStats) {
            const timeDiff = (currentStats.timestamp - this.lastDiskStats.timestamp) / 1000 // 秒
            if (timeDiff > 0) {
              // Windows的性能计数器已经是每秒的值，直接使用
              readBytes = currentStats.readBytes
              writeBytes = currentStats.writeBytes
              readOps = currentStats.readOps
              writeOps = currentStats.writeOps
            }
          }

          this.lastDiskStats = currentStats
        }
      } catch (ioError) {
        // IO信息获取失败时，只记录调试日志，不影响主要功能
        this.logger.debug('获取Windows磁盘IO信息失败:', ioError)
      }

      return {
        total: totalSize,
        used,
        free: totalFree,
        usage: Math.round(usage * 100) / 100,
        readBytes: Math.round(readBytes),
        writeBytes: Math.round(writeBytes),
        readOps: Math.round(readOps),
        writeOps: Math.round(writeOps)
      }
    } catch (error) {
      this.logger.error('PowerShell获取磁盘信息失败:', error)
      throw error
    }
  }

  /**
   * 使用WMIC获取Windows磁盘信息
   */
  private async getWindowsDiskInfoByWmic(): Promise<SystemStats['disk']> {
    try {
      // 使用wmic获取磁盘空间信息
      let spaceCommand: string
      if (this.selectedDisk) {
        // 监控指定磁盘
        spaceCommand = `wmic logicaldisk where "caption='${this.selectedDisk}'" get size,freespace,caption`
      } else {
        // 监控所有磁盘总计
        spaceCommand = 'wmic logicaldisk get size,freespace,caption'
      }

      const { stdout: spaceOutput } = await execAsync(spaceCommand, { timeout: 10000 })

      const lines = spaceOutput.trim().split('\n').slice(1)
      let totalSize = 0
      let totalFree = 0

      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 3) {
          const size = parseInt(parts[2]) || 0
          const free = parseInt(parts[1]) || 0
          totalSize += size
          totalFree += free
        }
      }

      const used = totalSize - totalFree
      const usage = totalSize > 0 ? (used / totalSize) * 100 : 0

      return {
        total: totalSize,
        used,
        free: totalFree,
        usage: Math.round(usage * 100) / 100,
        readBytes: 0,
        writeBytes: 0,
        readOps: 0,
        writeOps: 0
      }
    } catch (error) {
      this.logger.error('WMIC获取磁盘信息失败:', error)
      throw error
    }
  }

  /**
   * 磁盘信息获取备用方案
   */
  private async getWindowsDiskInfoFallback(): Promise<SystemStats['disk']> {
    this.logger.warn('使用磁盘信息获取备用方案')
    return {
      total: 0,
      used: 0,
      free: 0,
      usage: 0,
      readBytes: 0,
      writeBytes: 0,
      readOps: 0,
      writeOps: 0
    }
  }

  /**
   * 获取Linux磁盘信息
   */
  private async getLinuxDiskInfo(): Promise<SystemStats['disk']> {
    // 获取磁盘空间信息
    let spaceCommand: string
    if (this.selectedDisk) {
      // 监控指定分区
      spaceCommand = `df -h ${this.selectedDisk}`
    } else {
      // 监控根分区
      spaceCommand = 'df -h /'
    }
    
    const { stdout: spaceOutput } = await execAsync(spaceCommand, { timeout: 10000 })
    
    const lines = spaceOutput.trim().split('\n')
    const dataLine = lines[1]
    const parts = dataLine.split(/\s+/)
    
    const total = this.parseSize(parts[1])
    const used = this.parseSize(parts[2])
    const free = this.parseSize(parts[3])
    const usage = parseFloat(parts[4].replace('%', ''))
    
    // 获取磁盘读写信息
    let readBytes = 0, writeBytes = 0, readOps = 0, writeOps = 0
    
    try {
      // 从/proc/diskstats获取磁盘IO信息
      const ioCommand = 'cat /proc/diskstats'
      const { stdout: ioOutput } = await execAsync(ioCommand, { timeout: 10000 })
      
      const ioLines = ioOutput.trim().split('\n')
      let totalReadSectors = 0, totalWriteSectors = 0, totalReadOps = 0, totalWriteOps = 0
      
      if (this.selectedDisk) {
        // 监控指定设备的IO
        // 需要从挂载点获取设备名
        const mountCommand = `df ${this.selectedDisk} | tail -1 | awk '{print $1}'`
        const { stdout: deviceOutput } = await execAsync(mountCommand, { timeout: 5000 })
        const devicePath = deviceOutput.trim()
        const deviceName = devicePath.replace(/^\/dev\//, '').replace(/\d+$/, '') // 移除分区号
        
        for (const line of ioLines) {
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 14 && parts[2] === deviceName) {
            totalReadOps += parseInt(parts[3]) || 0      // 读操作次数
            totalReadSectors += parseInt(parts[5]) || 0  // 读扇区数
            totalWriteOps += parseInt(parts[7]) || 0     // 写操作次数
            totalWriteSectors += parseInt(parts[9]) || 0 // 写扇区数
          }
        }
      } else {
        // 监控所有主设备的IO总计
        for (const line of ioLines) {
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 14) {
            // 跳过分区，只统计主设备
            const deviceName = parts[2]
            if (deviceName.match(/^(sd[a-z]|nvme\d+n\d+|hd[a-z]|vd[a-z])$/)) {
              totalReadOps += parseInt(parts[3]) || 0      // 读操作次数
              totalReadSectors += parseInt(parts[5]) || 0  // 读扇区数
              totalWriteOps += parseInt(parts[7]) || 0     // 写操作次数
              totalWriteSectors += parseInt(parts[9]) || 0 // 写扇区数
            }
          }
        }
      }
      
      // 计算当前速率（如果有上次的数据）
      const currentStats = {
        readBytes: totalReadSectors * 512, // 扇区大小通常是512字节
        writeBytes: totalWriteSectors * 512,
        readOps: totalReadOps,
        writeOps: totalWriteOps,
        timestamp: Date.now()
      }
      
      if (this.lastDiskStats) {
        const timeDiff = (currentStats.timestamp - this.lastDiskStats.timestamp) / 1000 // 秒
        if (timeDiff > 0) {
          readBytes = Math.max(0, (currentStats.readBytes - this.lastDiskStats.readBytes) / timeDiff)
          writeBytes = Math.max(0, (currentStats.writeBytes - this.lastDiskStats.writeBytes) / timeDiff)
          readOps = Math.max(0, (currentStats.readOps - this.lastDiskStats.readOps) / timeDiff)
          writeOps = Math.max(0, (currentStats.writeOps - this.lastDiskStats.writeOps) / timeDiff)
        }
      }
      
      this.lastDiskStats = currentStats
      
    } catch (ioError) {
      this.logger.warn('获取Linux磁盘IO信息失败:', ioError)
    }
    
    return {
      total,
      used,
      free,
      usage,
      readBytes: Math.round(readBytes),
      writeBytes: Math.round(writeBytes),
      readOps: Math.round(readOps),
      writeOps: Math.round(writeOps)
    }
  }

  /**
   * 获取网络信息
   */
  private async getNetworkInfo(): Promise<SystemStats['network']> {
    try {
      let bytesIn = 0
      let bytesOut = 0
      let packetsIn = 0
      let packetsOut = 0

      if (os.platform() === 'win32') {
        // Windows: 使用 typeperf 获取网络统计
        const currentStats = await this.getWindowsNetworkStats()
        
        if (this.lastNetworkStats) {
          const timeDiff = (currentStats.timestamp - this.lastNetworkStats.timestamp) / 1000
          if (timeDiff > 0) {
            bytesIn = Math.max(0, (currentStats.bytesIn - this.lastNetworkStats.bytesIn) / timeDiff)
            bytesOut = Math.max(0, (currentStats.bytesOut - this.lastNetworkStats.bytesOut) / timeDiff)
            packetsIn = Math.max(0, (currentStats.packetsIn - this.lastNetworkStats.packetsIn) / timeDiff)
            packetsOut = Math.max(0, (currentStats.packetsOut - this.lastNetworkStats.packetsOut) / timeDiff)
          }
        }
        
        this.lastNetworkStats = currentStats
      } else {
        // Linux: 使用 /proc/net/dev 获取网络统计
        const currentStats = await this.getLinuxNetworkStats()
        
        if (this.lastNetworkStats) {
          const timeDiff = (currentStats.timestamp - this.lastNetworkStats.timestamp) / 1000
          if (timeDiff > 0) {
            bytesIn = Math.max(0, (currentStats.bytesIn - this.lastNetworkStats.bytesIn) / timeDiff)
            bytesOut = Math.max(0, (currentStats.bytesOut - this.lastNetworkStats.bytesOut) / timeDiff)
            packetsIn = Math.max(0, (currentStats.packetsIn - this.lastNetworkStats.packetsIn) / timeDiff)
            packetsOut = Math.max(0, (currentStats.packetsOut - this.lastNetworkStats.packetsOut) / timeDiff)
          }
        }
        
        this.lastNetworkStats = currentStats
      }

      return {
        rx: Math.round(bytesIn),
        tx: Math.round(bytesOut)
      }
    } catch (error) {
      this.logger.warn('获取网络信息失败:', error)
      return {
        rx: 0,
        tx: 0
      }
    }
  }

  /**
   * 获取Windows网络统计
   */
  private async getWindowsNetworkStats(): Promise<any> {
    try {
      let bytesIn = 0
      let bytesOut = 0
      let packetsIn = 0
      let packetsOut = 0

      if (this.selectedNetworkInterface) {
        // 获取指定网络接口的统计
        const escapedInterface = this.selectedNetworkInterface.replace(/[()]/g, '\\$&')
        const commands = [
          `typeperf "\\Network Interface(${escapedInterface})\\Bytes Received/sec" -sc 1`,
          `typeperf "\\Network Interface(${escapedInterface})\\Bytes Sent/sec" -sc 1`,
          `typeperf "\\Network Interface(${escapedInterface})\\Packets Received/sec" -sc 1`,
          `typeperf "\\Network Interface(${escapedInterface})\\Packets Sent/sec" -sc 1`
        ]

        for (let i = 0; i < commands.length; i++) {
          try {
            const { stdout } = await execAsync(commands[i], { timeout: 5000 })
            const lines = stdout.trim().split('\n')
            const dataLine = lines.find(line => line.includes(','))
            if (dataLine) {
              const parts = dataLine.split(',')
              const value = parseFloat(parts[1]?.replace(/"/g, '')) || 0
              switch (i) {
                case 0: bytesIn = value; break
                case 1: bytesOut = value; break
                case 2: packetsIn = value; break
                case 3: packetsOut = value; break
              }
            }
          } catch (error) {
            // 忽略单个命令的错误
          }
        }
      } else {
        // 获取所有网络接口的总计
        try {
          const { stdout } = await execAsync('typeperf "\\Network Interface(*)\\Bytes Total/sec" -sc 1', { timeout: 5000 })
          const lines = stdout.trim().split('\n')
          
          for (const line of lines) {
            if (line.includes(',') && !line.includes('_Total') && !line.includes('Loopback')) {
              const parts = line.split(',')
              const value = parseFloat(parts[1]?.replace(/"/g, '')) || 0
              bytesIn += value / 2 // 假设总流量的一半是入站
              bytesOut += value / 2 // 假设总流量的一半是出站
            }
          }
        } catch (error) {
          // 降级方案
        }
      }

      return {
        bytesIn,
        bytesOut,
        packetsIn,
        packetsOut,
        timestamp: Date.now()
      }
    } catch (error) {
      return {
        bytesIn: 0,
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0,
        timestamp: Date.now()
      }
    }
  }

  /**
   * 获取Linux网络统计
   */
  private async getLinuxNetworkStats(): Promise<any> {
    try {
      const { stdout } = await execAsync('cat /proc/net/dev')
      const lines = stdout.trim().split('\n').slice(2) // 跳过头部
      
      let totalBytesIn = 0
      let totalBytesOut = 0
      let totalPacketsIn = 0
      let totalPacketsOut = 0

      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 17) {
          const interfaceName = parts[0].replace(':', '')
          
          // 跳过回环接口
          if (interfaceName === 'lo') continue
          
          const rxBytes = parseInt(parts[1]) || 0
          const rxPackets = parseInt(parts[2]) || 0
          const txBytes = parseInt(parts[9]) || 0
          const txPackets = parseInt(parts[10]) || 0

          if (this.selectedNetworkInterface) {
            // 如果选择了特定接口
            if (interfaceName === this.selectedNetworkInterface) {
              return {
                bytesIn: rxBytes,
                bytesOut: txBytes,
                packetsIn: rxPackets,
                packetsOut: txPackets,
                timestamp: Date.now()
              }
            }
          } else {
            // 累计所有接口
            totalBytesIn += rxBytes
            totalBytesOut += txBytes
            totalPacketsIn += rxPackets
            totalPacketsOut += txPackets
          }
        }
      }

      return {
        bytesIn: totalBytesIn,
        bytesOut: totalBytesOut,
        packetsIn: totalPacketsIn,
        packetsOut: totalPacketsOut,
        timestamp: Date.now()
      }
    } catch (error) {
      return {
        bytesIn: 0,
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0,
        timestamp: Date.now()
      }
    }
  }

  /**
   * 获取进程信息
   */
  private async getProcessInfo(): Promise<SystemStats['processes']> {
    try {
      let command: string
      
      if (os.platform() === 'win32') {
        command = 'tasklist /fo csv | find /c /v ""'
      } else {
        command = 'ps aux | wc -l'
      }
      
      const { stdout } = await execAsync(command)
      const total = parseInt(stdout.trim()) || 0
      
      return {
        total,
        running: Math.floor(total * 0.1), // 估算
        sleeping: Math.floor(total * 0.9) // 估算
      }
    } catch (error) {
      return {
        total: 0,
        running: 0,
        sleeping: 0
      }
    }
  }

  /**
   * 获取系统负载信息
   */
  private getLoadInfo(): SystemStats['load'] {
    try {
      const loadavg = os.loadavg()
      return {
        avg1: Math.round(loadavg[0] * 100) / 100,
        avg5: Math.round(loadavg[1] * 100) / 100,
        avg15: Math.round(loadavg[2] * 100) / 100
      }
    } catch (error) {
      return {
        avg1: 0,
        avg5: 0,
        avg15: 0
      }
    }
  }

  /**
   * 获取网络接口信息
   */
  public getNetworkInterfaces(): NetworkInterface[] {
    const interfaces = os.networkInterfaces()
    const result: NetworkInterface[] = []
    
    for (const [name, addresses] of Object.entries(interfaces)) {
      if (addresses) {
        for (const addr of addresses) {
          result.push({
            name,
            address: addr.address,
            netmask: addr.netmask,
            family: addr.family,
            mac: addr.mac,
            internal: addr.internal,
            cidr: addr.cidr || ''
          })
        }
      }
    }
    
    return result
  }

  /**
   * 获取磁盘信息列表
   */
  public async getDiskList(): Promise<DiskInfo[]> {
    try {
      if (os.platform() === 'win32') {
        return await this.getWindowsDiskList()
      } else {
        return await this.getLinuxDiskList()
      }
    } catch (error) {
      this.logger.error('获取磁盘列表失败:', error)
      return []
    }
  }

  /**
   * 获取Windows磁盘列表
   */
  private async getWindowsDiskList(): Promise<DiskInfo[]> {
    try {
      // 优先使用PowerShell获取磁盘信息
      const psCommand = 'powershell "Get-WmiObject -Class Win32_LogicalDisk | Select-Object Size,FreeSpace,DeviceID | ConvertTo-Json"'
      const { stdout } = await execAsync(psCommand, { timeout: 15000 })
      
      const diskData = JSON.parse(stdout)
      const diskArray = Array.isArray(diskData) ? diskData : [diskData]
      const disks: DiskInfo[] = []
      
      for (const disk of diskArray) {
        if (disk.Size && disk.FreeSpace) {
          const size = parseInt(disk.Size) || 0
          const freeSpace = parseInt(disk.FreeSpace) || 0
          const used = size - freeSpace
          const usage = size > 0 ? (used / size) * 100 : 0
          
          disks.push({
            filesystem: disk.DeviceID,
            size,
            used,
            available: freeSpace,
            usage: Math.round(usage * 100) / 100,
            mountpoint: disk.DeviceID
          })
        }
      }
      
      return disks
    } catch (psError) {
      this.logger.warn('PowerShell命令执行失败，尝试使用wmic备用方案:', psError)
      
      try {
        // 备用方案: 使用wmic命令
        const command = 'wmic logicaldisk get size,freespace,caption'
        const { stdout } = await execAsync(command, { timeout: 10000 })
        
        const lines = stdout.trim().split('\n').slice(1)
        const disks: DiskInfo[] = []
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 3) {
            const caption = parts[0]
            const freeSpace = parseInt(parts[1]) || 0
            const size = parseInt(parts[2]) || 0
            const used = size - freeSpace
            const usage = size > 0 ? (used / size) * 100 : 0
            
            disks.push({
              filesystem: caption,
              size,
              used,
              available: freeSpace,
              usage: Math.round(usage * 100) / 100,
              mountpoint: caption
            })
          }
        }
        
        return disks
      } catch (wmicError) {
        this.logger.error('wmic备用方案也执行失败:', wmicError)
        throw wmicError
      }
    }
  }

  /**
   * 获取Linux磁盘列表
   */
  private async getLinuxDiskList(): Promise<DiskInfo[]> {
    const command = 'df -h'
    const { stdout } = await execAsync(command, { timeout: 10000 })
    
    const result: DiskInfo[] = []
    const lines = stdout.trim().split('\n').slice(1)
    
    for (const line of lines) {
      const parts = line.split(/\s+/)
      if (parts.length >= 6) {
        const filesystem = parts[0]
        
        // 过滤掉tmpfs、devtmpfs、proc、sysfs等虚拟文件系统
        if (filesystem === 'tmpfs' || 
            filesystem === 'devtmpfs' || 
            filesystem === 'proc' || 
            filesystem === 'sysfs' || 
            filesystem === 'devpts' || 
            filesystem === 'cgroup' || 
            filesystem === 'pstore' || 
            filesystem === 'bpf' || 
            filesystem === 'cgroup2' || 
            filesystem === 'configfs' || 
            filesystem === 'debugfs' || 
            filesystem === 'mqueue' || 
            filesystem === 'hugetlbfs' || 
            filesystem === 'tracefs' || 
            filesystem === 'fusectl' || 
            filesystem === 'securityfs' || 
            filesystem.startsWith('overlay') ||
            filesystem.startsWith('shm') ||
            parts[5] === '/dev' ||
            parts[5] === '/dev/shm' ||
            parts[5] === '/run' ||
            parts[5] === '/sys' ||
            parts[5] === '/proc') {
          continue
        }
        
        result.push({
          filesystem: filesystem,
          size: this.parseSize(parts[1]),
          used: this.parseSize(parts[2]),
          available: this.parseSize(parts[3]),
          usage: parseFloat(parts[4].replace('%', '')),
          mountpoint: parts[5]
        })
      }
    }
    
    return result
  }

  /**
   * 获取进程列表
   */
  public async getProcessList(): Promise<ProcessInfoResponse[]> {
    try {
      let processes: ProcessInfo[]
      if (os.platform() === 'win32') {
        processes = await this.getWindowsProcessList()
      } else {
        processes = await this.getLinuxProcessList()
      }
      
      // 转换数据格式以匹配客户端期望的格式
      return processes.map(process => {
        // 确保startTime是有效的Date对象
        let startTimeStr = new Date().toISOString()
        try {
          if (process.startTime && !isNaN(process.startTime.getTime())) {
            startTimeStr = process.startTime.toISOString()
          }
        } catch (e) {
          this.logger.warn(`进程 ${process.pid} 的启动时间无效，使用当前时间代替`)
        }
        
        return {
          id: `${process.pid}`, // 添加 id 字段
          pid: process.pid,
          name: process.name,
          cpu: process.cpu,
          memory: process.memory,
          status: process.status,
          startTime: startTimeStr, // 转换为 ISO 字符串
          command: process.command
        }
      })
    } catch (error) {
      this.logger.error('获取进程列表失败:', error)
      return []
    }
  }

  /**
   * 获取Windows进程列表
   */
  private async getWindowsProcessList(): Promise<ProcessInfo[]> {
    // 根据检测到的方案选择对应的方法
    if (this.resourceMethods.processInfo === 'powershell') {
      return await this.getWindowsProcessListByPowerShell()
    } else if (this.resourceMethods.processInfo === 'wmic') {
      return await this.getWindowsProcessListByWmic()
    } else {
      return await this.getWindowsProcessListFallback()
    }
  }

  /**
   * 使用PowerShell获取Windows进程列表
   */
  private async getWindowsProcessListByPowerShell(): Promise<ProcessInfo[]> {
    try {
      // 使用PowerShell获取进程信息
      const psCommand = 'powershell "Get-Process | Select-Object Name,Id,CPU,WorkingSet,StartTime | Sort-Object CPU -Descending | Select-Object -First 50 | ConvertTo-Json"'
      const { stdout } = await execAsync(psCommand, { timeout: 15000 })

      if (!stdout.trim()) {
        return []
      }

      const processes = JSON.parse(stdout)
      const processArray = Array.isArray(processes) ? processes : [processes]
      const result: ProcessInfo[] = []

      for (const proc of processArray) {
        if (proc.Id && proc.Id > 0) {
          // 内存使用 (字节转MB)
          const memoryMB = proc.WorkingSet ? (proc.WorkingSet / 1024 / 1024) : 0

          // CPU使用率 (PowerShell返回的是总CPU时间，需要简化处理)
          const cpu = proc.CPU ? Math.min(proc.CPU / 1000, 100) : 0

          // 解析启动时间
          let startTime = new Date()
          if (proc.StartTime) {
            try {
              startTime = new Date(proc.StartTime)
              if (isNaN(startTime.getTime())) {
                startTime = new Date()
              }
            } catch (e) {
              startTime = new Date()
            }
          }

          result.push({
            pid: proc.Id,
            name: proc.Name || 'Unknown',
            cpu: Math.round(cpu * 100) / 100,
            memory: Math.round(memoryMB * 100) / 100,
            status: 'Running',
            startTime: startTime,
            command: proc.Name || 'Unknown'
          })
        }
      }

      return result.sort((a, b) => b.cpu - a.cpu).slice(0, 50)
    } catch (error) {
      this.logger.error('PowerShell获取进程列表失败:', error)
      throw error
    }
  }

  /**
   * 使用WMIC获取Windows进程列表
   */
  private async getWindowsProcessListByWmic(): Promise<ProcessInfo[]> {
    try {
      // wmic方案
      const command = 'wmic process get Name,ProcessId,PageFileUsage,UserModeTime,KernelModeTime,CreationDate /format:csv'
      const { stdout } = await execAsync(command, { timeout: 15000 })

      const result: ProcessInfo[] = []
      const lines = stdout.trim().split('\n').filter(line => line.trim() && !line.startsWith('Node'))

      for (let i = 0; i < Math.min(lines.length, 100); i++) {
        const line = lines[i].trim()
        if (!line) continue

        const parts = line.split(',')
        if (parts.length >= 6) {
          const creationDate = parts[1]
          const kernelModeTime = parts[2] || '0'
          const name = parts[3] || 'Unknown'
          const pageFileUsage = parts[4] || '0'
          const processId = parts[5] || '0'
          const userModeTime = parts[6] || '0'

          const pid = parseInt(processId)
          if (pid && pid > 0 && name !== 'Unknown') {
            // 计算CPU使用率 (简化计算)
            const totalTime = parseInt(kernelModeTime) + parseInt(userModeTime)
            const cpu = totalTime > 0 ? Math.min(totalTime / 10000000, 100) : 0

            // 内存使用 (KB转MB)
            const memoryKB = parseInt(pageFileUsage) || 0
            const memoryMB = memoryKB / 1024

            // 解析创建时间
            let startTime = new Date()
            if (creationDate && creationDate.length >= 14) {
              try {
                const year = parseInt(creationDate.substring(0, 4))
                const month = parseInt(creationDate.substring(4, 6)) - 1
                const day = parseInt(creationDate.substring(6, 8))
                const hour = parseInt(creationDate.substring(8, 10))
                const minute = parseInt(creationDate.substring(10, 12))
                const second = parseInt(creationDate.substring(12, 14))
                startTime = new Date(year, month, day, hour, minute, second)

                // 验证日期是否有效
                if (isNaN(startTime.getTime())) {
                  startTime = new Date()
                }
              } catch (e) {
                startTime = new Date()
              }
            }

            result.push({
              pid,
              name: name.replace('.exe', ''),
              cpu: Math.round(cpu * 100) / 100,
              memory: Math.round(memoryMB * 100) / 100,
              status: 'Running',
              startTime: startTime,
              command: name
            })
          }
        }
      }

      // 按CPU使用率排序
      return result.sort((a, b) => b.cpu - a.cpu).slice(0, 50)
    } catch (error) {
      this.logger.error('WMIC获取进程列表失败:', error)
      throw error
    }
  }

  /**
   * 进程列表获取备用方案
   */
  private async getWindowsProcessListFallback(): Promise<ProcessInfo[]> {
    this.logger.warn('使用进程列表获取备用方案')
    return []
  }


  /**
   * 获取Linux进程列表
   */
  private async getLinuxProcessList(): Promise<ProcessInfo[]> {
    const command = 'ps aux --sort=-%cpu | head -51'
    const { stdout } = await execAsync(command, { timeout: 10000 })
    
    const result: ProcessInfo[] = []
    const lines = stdout.trim().split('\n').slice(1) // 跳过标题行
    
    for (const line of lines) {
      if (!line.trim()) continue
      
      // ps aux 输出格式: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 11) {
        const user = parts[0]
        const pid = parseInt(parts[1])
        const cpu = parseFloat(parts[2]) || 0
        const memPercent = parseFloat(parts[3]) || 0
        const vsz = parseInt(parts[4]) || 0
        const rss = parseInt(parts[5]) || 0
        const tty = parts[6]
        const stat = parts[7]
        const start = parts[8]
        const time = parts[9]
        const command = parts.slice(10).join(' ')
        
        if (pid && pid > 0) {
          // 内存使用 (KB转MB)
          const memoryMB = rss / 1024
          
          // 获取进程名 (从命令中提取)
          let processName = command.split(' ')[0]
          if (processName.includes('/')) {
            processName = processName.split('/').pop() || processName
          }
          
          // 状态映射
          let status = 'Running'
          if (stat.includes('Z')) status = 'Zombie'
          else if (stat.includes('T')) status = 'Stopped'
          else if (stat.includes('S')) status = 'Sleeping'
          
          // 解析启动时间
          let startTime = new Date()
          if (start && start !== '?') {
            try {
              // 如果是今天的时间格式 (HH:MM)
              if (start.includes(':')) {
                const [hour, minute] = start.split(':').map(Number)
                const today = new Date()
                startTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute)
              } else {
                // 如果是日期格式 (MMM DD 或 YYYY)
                const today = new Date()
                if (start.length === 4 && !isNaN(Number(start))) {
                  // 年份格式
                  startTime = new Date(Number(start), 0, 1)
                } else {
                  // 月日格式，假设是今年
                  startTime = new Date(`${start} ${today.getFullYear()}`)
                }
              }
              
              // 验证日期是否有效
              if (isNaN(startTime.getTime())) {
                // 如果日期无效，使用当前时间
                startTime = new Date()
              }
            } catch (e) {
              // 解析失败，使用当前时间
              startTime = new Date()
            }
          }
          
          result.push({
            pid,
            name: processName,
            cpu: Math.round(cpu * 100) / 100,
            memory: Math.round(memoryMB * 100) / 100, // 数字类型，单位MB
            status,
            startTime: startTime, // Date 对象
            command: command.length > 50 ? command.substring(0, 50) + '...' : command
          })
        }
      }
    }
    
    return result.slice(0, 50)
  }

  /**
   * 终止进程
   */
  public async killProcess(pid: number, force: boolean = false): Promise<{ success: boolean; message: string }> {
    try {
      if (!pid || pid <= 0) {
        return { success: false, message: '无效的进程ID' }
      }

      // 检查进程是否存在
      const processExists = await this.checkProcessExists(pid)
      if (!processExists) {
        return { success: false, message: '进程不存在或已经结束' }
      }

      let command: string
      
      if (os.platform() === 'win32') {
        // Windows: 使用 taskkill 命令
        if (force) {
          command = `taskkill /F /PID ${pid}`
        } else {
          command = `taskkill /PID ${pid}`
        }
      } else {
        // Linux/Unix: 使用 kill 命令
        if (force) {
          command = `kill -9 ${pid}`
        } else {
          command = `kill -15 ${pid}`
        }
      }
      
      this.logger.info(`尝试终止进程 PID: ${pid}, 强制: ${force}, 命令: ${command}`)
      
      const { stdout, stderr } = await execAsync(command)
      
      // 等待一小段时间后检查进程是否真的被终止
      await new Promise(resolve => setTimeout(resolve, 1000))
      const stillExists = await this.checkProcessExists(pid)
      
      if (stillExists) {
        if (!force) {
          // 如果普通终止失败，尝试强制终止
          this.logger.warn(`进程 ${pid} 普通终止失败，尝试强制终止`)
          return await this.killProcess(pid, true)
        } else {
          return { success: false, message: '进程终止失败，可能权限不足或进程受保护' }
        }
      }
      
      this.logger.info(`进程 ${pid} 已成功终止`)
      return { success: true, message: '进程已成功终止' }
      
    } catch (error: any) {
      this.logger.error(`终止进程 ${pid} 失败:`, error)
      
      // 解析错误信息
      let errorMessage = '终止进程失败'
      if (error.message) {
        if (error.message.includes('Access is denied') || error.message.includes('权限不足')) {
          errorMessage = '权限不足，无法终止该进程'
        } else if (error.message.includes('not found') || error.message.includes('No such process')) {
          errorMessage = '进程不存在'
        } else {
          errorMessage = `终止进程失败: ${error.message}`
        }
      }
      
      return { success: false, message: errorMessage }
    }
  }

  /**
   * 检查进程是否存在
   */
  private async checkProcessExists(pid: number): Promise<boolean> {
    try {
      let command: string
      
      if (os.platform() === 'win32') {
        command = `tasklist /FI "PID eq ${pid}" /FO CSV`
      } else {
        command = `ps -p ${pid}`
      }
      
      const { stdout } = await execAsync(command)
      
      if (os.platform() === 'win32') {
        // Windows: 检查输出是否包含进程信息
        const lines = stdout.trim().split('\n')
        return lines.length > 1 // 第一行是标题，如果有第二行说明进程存在
      } else {
        // Linux: ps 命令如果进程存在会返回进程信息
        return stdout.trim().split('\n').length > 1
      }
    } catch (error) {
      // 如果命令执行失败，通常说明进程不存在
      return false
    }
  }

  /**
   * 检查告警
   */
  private checkAlerts(stats: SystemStats): void {
    // CPU告警已禁用
    // this.checkAlert('cpu', stats.cpu.usage, this.alertThresholds.cpu, 'CPU使用率')
    
    // 内存告警
    this.checkAlert('memory', stats.memory.usage, this.alertThresholds.memory, '内存使用率')
    
    // 磁盘告警
    this.checkAlert('disk', stats.disk.usage, this.alertThresholds.disk, '磁盘使用率')
  }

  /**
   * 检查单个指标告警
   */
  private checkAlert(
    type: SystemAlert['type'],
    value: number,
    thresholds: { warning: number; critical: number },
    description: string
  ): void {
    const alertId = `${type}-alert`
    const existingAlert = this.alerts.get(alertId)
    
    let level: SystemAlert['level'] | null = null
    
    if (value >= thresholds.critical) {
      level = 'critical'
    } else if (value >= thresholds.warning) {
      level = 'warning'
    }
    
    if (level) {
      if (!existingAlert || existingAlert.level !== level) {
        const alert: SystemAlert = {
          id: alertId,
          type,
          level,
          message: `${description}达到${level === 'critical' ? '严重' : '警告'}阈值`,
          value,
          threshold: level === 'critical' ? thresholds.critical : thresholds.warning,
          timestamp: new Date(),
          resolved: false
        }
        
        this.alerts.set(alertId, alert)
        this.io.emit('system-alert', alert)
        this.logger.warn(`系统告警: ${alert.message}, 当前值: ${value}%`)
      }
    } else if (existingAlert && !existingAlert.resolved) {
      // 告警解除
      existingAlert.resolved = true
      this.io.emit('system-alert-resolved', existingAlert)
      this.logger.info(`系统告警解除: ${existingAlert.message}`)
    }
  }

  /**
   * 获取统计历史
   */
  public getStatsHistory(minutes: number = 60): SystemStats[] {
    const pointsNeeded = Math.floor(minutes * 60 / 5) // 每5秒一个数据点
    return this.statsHistory.slice(-pointsNeeded)
  }

  /**
   * 获取活跃告警
   */
  public getActiveAlerts(): SystemAlert[] {
    return Array.from(this.alerts.values()).filter(alert => !alert.resolved)
  }

  /**
   * 设置告警阈值
   */
  public setAlertThresholds(thresholds: Partial<AlertThresholds>): void {
    this.alertThresholds = { ...this.alertThresholds, ...thresholds }
    
    // 如果禁用了CPU告警（阈值设为100%），则解除现有的CPU告警
    if (thresholds.cpu && thresholds.cpu.warning >= 100 && thresholds.cpu.critical >= 100) {
      const cpuAlert = this.alerts.get('cpu-alert')
      if (cpuAlert && !cpuAlert.resolved) {
        cpuAlert.resolved = true
        this.io.emit('system-alert-resolved', cpuAlert)
        this.logger.info('CPU告警已禁用，现有CPU告警已解除')
      }
    }
    
    this.logger.info('告警阈值已更新:', this.alertThresholds)
  }

  /**
   * 解析大小字符串（如 "1.5G" -> 字节数）
   */
  private parseSize(sizeStr: string): number {
    const units: { [key: string]: number } = {
      'K': 1024,
      'M': 1024 * 1024,
      'G': 1024 * 1024 * 1024,
      'T': 1024 * 1024 * 1024 * 1024
    }
    
    const match = sizeStr.match(/^([0-9.]+)([KMGT]?)$/)
    if (!match) return 0
    
    const value = parseFloat(match[1])
    const unit = match[2] || ''
    
    return Math.floor(value * (units[unit] || 1))
  }

  /**
   * 获取活跃端口列表
   */
  public async getActivePorts(): Promise<ActivePort[]> {
    try {
      let command: string
      
      if (os.platform() === 'win32') {
        // Windows: 使用 netstat 命令
        command = 'netstat -ano'
      } else {
        // Linux/Unix: 使用 netstat 或 ss 命令
        command = 'netstat -tulpn 2>/dev/null || ss -tulpn'
      }
      
      const { stdout } = await execAsync(command)
      const result: ActivePort[] = []
      const lines = stdout.trim().split('\n')
      
      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine || trimmedLine.includes('Proto') || trimmedLine.includes('Active')) {
          continue
        }
        
        if (os.platform() === 'win32') {
          // Windows netstat 输出格式解析
          const parts = trimmedLine.split(/\s+/)
          if (parts.length >= 4) {
            const protocol = parts[0].toLowerCase()
            const localAddress = parts[1]
            const state = parts[3] || 'UNKNOWN'
            const pid = parts[4] ? parseInt(parts[4]) : undefined
            
            // 解析地址和端口
            const addressMatch = localAddress.match(/^(.+):(\d+)$/)
            if (addressMatch) {
              const address = addressMatch[1] === '0.0.0.0' ? '所有接口' : addressMatch[1]
              const port = parseInt(addressMatch[2])
              
              if (port > 0 && (protocol === 'tcp' || protocol === 'udp')) {
                result.push({
                  port,
                  protocol: protocol as 'tcp' | 'udp',
                  state: state === 'LISTENING' ? '监听中' : state,
                  pid,
                  address
                })
              }
            }
          }
        } else {
          // Linux/Unix netstat/ss 输出格式解析
          const parts = trimmedLine.split(/\s+/)
          if (parts.length >= 4) {
            const protocol = parts[0].toLowerCase()
            const localAddress = parts[3] || parts[4] // netstat vs ss 格式差异
            const state = parts[5] || 'UNKNOWN'
            
            // 解析进程信息 (如果有)
            let processInfo = ''
            let pid: number | undefined
            const processMatch = trimmedLine.match(/(\d+)\/([^\s]+)/)
            if (processMatch) {
              pid = parseInt(processMatch[1])
              processInfo = processMatch[2]
            }
            
            // 解析地址和端口
            const addressMatch = localAddress.match(/^(.+?):(\d+)$/)
            if (addressMatch) {
              let address = addressMatch[1]
              if (address === '0.0.0.0' || address === '::') {
                address = '所有接口'
              } else if (address === '127.0.0.1' || address === '::1') {
                address = '本地回环'
              }
              
              const port = parseInt(addressMatch[2])
              
              if (port > 0 && (protocol.includes('tcp') || protocol.includes('udp'))) {
                const protocolType = protocol.includes('tcp') ? 'tcp' : 'udp'
                result.push({
                  port,
                  protocol: protocolType,
                  state: state === 'LISTEN' ? '监听中' : state,
                  process: processInfo || undefined,
                  pid,
                  address
                })
              }
            }
          }
        }
      }
      
      // 按端口号排序并去重
      const uniquePorts = new Map<string, ActivePort>()
      for (const port of result) {
        const key = `${port.protocol}-${port.port}-${port.address}`
        if (!uniquePorts.has(key)) {
          uniquePorts.set(key, port)
        }
      }
      
      return Array.from(uniquePorts.values()).sort((a, b) => a.port - b.port)
      
    } catch (error) {
      this.logger.error('获取活跃端口失败:', error)
      return []
    }
  }

  /**
   * 设置当前监控的磁盘
   */
  public setSelectedDisk(disk: string): void {
    this.selectedDisk = disk
    // 重置磁盘统计数据，避免切换磁盘时的数据混乱
    this.lastDiskStats = null
    this.logger.info(`切换磁盘监控目标: ${disk || '总计'}`)
  }

  /**
   * 获取当前选择的磁盘
   */
  public getSelectedDisk(): string {
    return this.selectedDisk
  }

  /**
   * 设置当前监控的网络接口
   */
  public setSelectedNetworkInterface(interfaceName: string): void {
    this.selectedNetworkInterface = interfaceName
    // 重置网络统计数据，避免切换接口时的数据混乱
    this.lastNetworkStats = null
    this.logger.info(`切换网络接口监控目标: ${interfaceName || '总计'}`)
  }

  /**
   * 获取当前选择的网络接口
   */
  public getSelectedNetworkInterface(): string {
    return this.selectedNetworkInterface
  }

  /**
   * 获取可用的网络接口列表（用于下拉选择）
   */
  public getAvailableNetworkInterfaces(): { name: string; displayName: string; type: string }[] {
    const interfaces = os.networkInterfaces()
    const result: { name: string; displayName: string; type: string }[] = []
    const seenInterfaces = new Set<string>()
    
    for (const [name, addresses] of Object.entries(interfaces)) {
      if (addresses && !seenInterfaces.has(name)) {
        seenInterfaces.add(name)
        
        // 跳过回环接口
        if (name.toLowerCase().includes('loopback') || name === 'lo') {
          continue
        }
        
        // 获取接口类型
        let type = '未知'
        let hasIPv4 = false
        
        for (const addr of addresses) {
          if (addr.family === 'IPv4' && !addr.internal) {
            hasIPv4 = true
            break
          }
        }
        
        if (hasIPv4) {
          if (name.toLowerCase().includes('ethernet') || name.toLowerCase().includes('eth')) {
            type = '以太网'
          } else if (name.toLowerCase().includes('wifi') || name.toLowerCase().includes('wlan') || name.toLowerCase().includes('wireless')) {
            type = '无线网络'
          } else if (name.toLowerCase().includes('vmware') || name.toLowerCase().includes('virtualbox') || name.toLowerCase().includes('hyper-v')) {
            type = '虚拟网络'
          } else {
            type = '网络接口'
          }
          
          result.push({
            name,
            displayName: `${name} (${type})`,
            type
          })
        }
      }
    }
    
    return result.sort((a, b) => {
      // 优先显示以太网，然后是无线网络，最后是其他
      const order = { '以太网': 1, '无线网络': 2, '网络接口': 3, '虚拟网络': 4, '未知': 5 }
      return (order[a.type as keyof typeof order] || 5) - (order[b.type as keyof typeof order] || 5)
    })
  }

  /**
   * 处理客户端断开连接
   * 当客户端断开连接时，检查是否还有其他客户端在订阅，如果没有则可以优化资源使用
   */
  public handleClientDisconnect(): void {
    // 延迟检查，给socket.leave()一些时间完成
    setTimeout(() => {
      const hasStatsSubscribers = this.hasSubscribers('system-stats')
      const hasPortsSubscribers = this.hasSubscribers('system-ports')
      const hasProcessesSubscribers = this.hasSubscribers('system-processes')
      
      if (!hasStatsSubscribers && !hasPortsSubscribers && !hasProcessesSubscribers) {
        this.logger.info('所有客户端已断开连接，系统监控将在下次有订阅者时恢复资源收集')
      } else {
        this.logger.debug(`当前订阅状态 - 系统状态: ${hasStatsSubscribers}, 端口信息: ${hasPortsSubscribers}, 进程信息: ${hasProcessesSubscribers}`)
      }
    }, 100)
  }

  /**
   * 清理资源
   */
  public cleanup(): void {
    this.logger.info('开始清理系统监控资源...')
    this.stopMonitoring()
    this.alerts.clear()
    this.statsHistory = []
    this.logger.info('系统监控资源已清理完成')
  }
}