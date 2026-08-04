import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import type { IDisposable, Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { TerminalErrorEvent } from '@/types'
import socketClient from '@/utils/socket'
import apiClient from '@/utils/api'
import { createTerminalView } from '@/utils/terminalFactory'
import { useNotificationStore } from '@/stores/notificationStore'
import {
  Plus,
  X,
  Maximize2,
  Minimize2,
  RotateCcw,
  Settings,
  Terminal as TerminalIcon,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Check,
  Folder,
  FileText,
  FolderOpen,
  HelpCircle
} from 'lucide-react'
import '@xterm/xterm/css/xterm.css'

interface TerminalTabMeta {
  id: string
  name: string
}

type TerminalState =
  | 'creating'
  | 'ready'
  | 'disconnected'
  | 'reconnecting'
  | 'closing'
  | 'exited'
  | 'disposed'

interface TerminalSize {
  cols: number
  rows: number
}

interface TerminalRuntime {
  terminal: Terminal
  fitAddon: FitAddon
  state: TerminalState
  createSize?: TerminalSize
  pendingSize?: TerminalSize
  lastWrittenSize?: TerminalSize
  lastReportedSize?: TerminalSize
  resizeTimer?: ReturnType<typeof setTimeout>
  closeRequestInFlight: boolean
  cleanupRequired: boolean
  disposables: IDisposable[]
}

interface PendingTerminalCreate {
  name: string
  cwd?: string
  enableStreamForward?: boolean
  programPath?: string
}

function isValidTerminalSize(
  size: TerminalSize | null | undefined
): size is TerminalSize {
  return Boolean(
    size &&
    Number.isSafeInteger(size.cols) &&
    Number.isSafeInteger(size.rows) &&
    size.cols >= 2 &&
    size.cols <= 1000 &&
    size.rows >= 1 &&
    size.rows <= 1000
  )
}

function isSameTerminalSize(
  left: TerminalSize | null | undefined,
  right: TerminalSize | null | undefined
): boolean {
  return Boolean(
    left &&
    right &&
    left.cols === right.cols &&
    left.rows === right.rows
  )
}

function clearPendingResize(runtime: TerminalRuntime): void {
  if (runtime.resizeTimer !== undefined) {
    clearTimeout(runtime.resizeTimer)
    runtime.resizeTimer = undefined
  }
  runtime.pendingSize = undefined
}

const TerminalPage: React.FC = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<TerminalTabMeta[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalAnimating, setCreateModalAnimating] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [helpModalAnimating, setHelpModalAnimating] = useState(false)
  const [createModalData, setCreateModalData] = useState({
    name: '',
    workingDirectory: '',
    enableStreamForward: false,
    programPath: ''
  })

  const runtimesRef = useRef(new Map<string, TerminalRuntime>())
  const activeSessionIdRef = useRef<string | null>(null)
  const terminalContainerRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const fitFrameRef = useRef<number | null>(null)
  const sessionsRef = useRef<TerminalTabMeta[]>([])
  const isMobileRef = useRef(false)
  const isUnmountingRef = useRef(false)
  const sessionSequenceRef = useRef(0)
  const pendingCreatesRef = useRef(new Map<string, PendingTerminalCreate>())
  const componentTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>())
  const processedUrlParamKey = useRef<string | null>(null)
  const { addNotification } = useNotificationStore()

  // 检测移动端设备
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768
      isMobileRef.current = mobile
      setIsMobile(mobile)
      // 在移动端默认折叠侧边栏
      if (mobile) {
        setSidebarCollapsed(true)
      }
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)

    return () => {
      window.removeEventListener('resize', checkMobile)
    }
  }, [])
  
  const setSessionTabs = useCallback((nextSessions: TerminalTabMeta[]) => {
    sessionsRef.current = nextSessions
    setSessions(nextSessions)
  }, [])

  const requestCloseIfIdle = useCallback((sessionId: string): void => {
    const runtime = runtimesRef.current.get(sessionId)
    if (!runtime || runtime.closeRequestInFlight) {
      return
    }

    // N2-I2：socket 断开时不静默丢弃——closeTerminal 会排队并在重连后重发，
    // 避免"服务端 retained 且客户端永久丢失"组合。
    runtime.closeRequestInFlight = true
    socketClient.closeTerminal(sessionId)
  }, [])

  const scheduleComponentTimeout = useCallback((callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      componentTimersRef.current.delete(timer)
      callback()
    }, delay)
    componentTimersRef.current.add(timer)
    return timer
  }, [])

  const flushResizeReporter = useCallback((sessionId: string) => {
    const runtime = runtimesRef.current.get(sessionId)
    if (!runtime) {
      return
    }

    runtime.resizeTimer = undefined
    const size = runtime.pendingSize
    if (
      activeSessionIdRef.current !== sessionId ||
      runtime.state !== 'ready' ||
      !socketClient.isConnected() ||
      !isValidTerminalSize(size) ||
      isSameTerminalSize(size, runtime.lastWrittenSize)
    ) {
      clearPendingResize(runtime)
      return
    }

    socketClient.resizeTerminal(sessionId, size.cols, size.rows)
    runtime.lastWrittenSize = { cols: size.cols, rows: size.rows }
    clearPendingResize(runtime)
  }, [])

  const scheduleResizeReporter = useCallback((sessionId: string) => {
    const runtime = runtimesRef.current.get(sessionId)
    if (!runtime) {
      return
    }

    const size = runtime.pendingSize
    if (
      activeSessionIdRef.current !== sessionId ||
      runtime.state !== 'ready' ||
      !socketClient.isConnected() ||
      !isValidTerminalSize(size) ||
      isSameTerminalSize(size, runtime.lastWrittenSize)
    ) {
      clearPendingResize(runtime)
      return
    }

    if (runtime.resizeTimer !== undefined) {
      clearTimeout(runtime.resizeTimer)
    }
    runtime.resizeTimer = setTimeout(() => flushResizeReporter(sessionId), 50)
  }, [flushResizeReporter])

  const seedResize = useCallback((sessionId: string) => {
    const runtime = runtimesRef.current.get(sessionId)
    if (!runtime) {
      return
    }

    const size = {
      cols: runtime.terminal.cols,
      rows: runtime.terminal.rows
    }
    if (!isValidTerminalSize(size)) {
      return
    }

    runtime.pendingSize = size
    scheduleResizeReporter(sessionId)
  }, [scheduleResizeReporter])

  const createRuntime = useCallback((sessionId: string, state: TerminalState): TerminalRuntime => {
    const existingRuntime = runtimesRef.current.get(sessionId)
    if (existingRuntime) {
      return existingRuntime
    }

    const { terminal, fitAddon } = createTerminalView({ isMobile: isMobileRef.current })
    const runtime: TerminalRuntime = {
      terminal,
      fitAddon,
      state,
      closeRequestInFlight: false,
      cleanupRequired: false,
      disposables: []
    }
    runtimesRef.current.set(sessionId, runtime)

    runtime.disposables.push(
      terminal.onData((data) => {
        const currentRuntime = runtimesRef.current.get(sessionId)
        if (
          currentRuntime === runtime &&
          activeSessionIdRef.current === sessionId &&
          currentRuntime.state === 'ready' &&
          socketClient.isConnected()
        ) {
          socketClient.sendTerminalInput(sessionId, data)
        }
      }),
      terminal.onResize(({ cols, rows }) => {
        const currentRuntime = runtimesRef.current.get(sessionId)
        const size = { cols, rows }
        if (currentRuntime !== runtime) {
          return
        }
        if (
          activeSessionIdRef.current !== sessionId ||
          currentRuntime.state !== 'ready' ||
          !socketClient.isConnected() ||
          !isValidTerminalSize(size) ||
          isSameTerminalSize(size, currentRuntime.lastWrittenSize)
        ) {
          clearPendingResize(currentRuntime)
          return
        }

        currentRuntime.pendingSize = size
        scheduleResizeReporter(sessionId)
      })
    )

    return runtime
  }, [scheduleResizeReporter])

  const attachTerminal = useCallback((sessionId: string, container: HTMLDivElement) => {
    const runtime = runtimesRef.current.get(sessionId)
    if (!runtime) {
      return
    }

    try {
      const terminalElement = runtime.terminal.element
      if (terminalElement?.parentElement !== container) {
        while (container.firstChild) {
          container.removeChild(container.firstChild)
        }

        if (terminalElement) {
          container.appendChild(terminalElement)
        } else {
          runtime.terminal.open(container)
        }
      }
      runtime.terminal.focus()
    } catch (error) {
      console.error('挂载终端失败:', error)
    }
  }, [])

  const scheduleFit = useCallback(() => {
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current)
    }

    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null

      const sessionId = activeSessionIdRef.current
      const container = terminalContainerRef.current
      const runtime = sessionId ? runtimesRef.current.get(sessionId) : undefined
      if (
        !sessionId ||
        !container ||
        !runtime ||
        (runtime.state !== 'creating' && runtime.state !== 'ready') ||
        container.clientWidth <= 0 ||
        container.clientHeight <= 0
      ) {
        return
      }

      try {
        const proposal = runtime.fitAddon.proposeDimensions()
        const proposedSize = proposal
          ? { cols: proposal.cols, rows: proposal.rows }
          : undefined
        if (!isValidTerminalSize(proposedSize)) {
          return
        }

        runtime.fitAddon.fit()

        const fittedSize = {
          cols: runtime.terminal.cols,
          rows: runtime.terminal.rows
        }
        if (!isValidTerminalSize(fittedSize)) {
          return
        }

        if (runtime.state === 'creating' && !runtime.createSize) {
          const pendingCreate = pendingCreatesRef.current.get(sessionId)
          if (!pendingCreate) {
            return
          }
          if (!socketClient.isConnected()) {
            pendingCreatesRef.current.delete(sessionId)
            runtime.state = 'exited'
            addNotification({
              type: 'error',
              title: '创建失败',
              message: 'Socket 连接已断开，终端创建已取消，请连接后重试。'
            })
            return
          }

          runtime.createSize = fittedSize
          pendingCreatesRef.current.delete(sessionId)
          socketClient.createTerminal({
            sessionId,
            name: pendingCreate.name,
            cols: fittedSize.cols,
            rows: fittedSize.rows,
            cwd: pendingCreate.cwd,
            enableStreamForward: pendingCreate.enableStreamForward,
            programPath: pendingCreate.programPath
          })
        }

        if (runtime.state === 'ready') {
          seedResize(sessionId)
        }
      } catch (error) {
        console.error('调整终端大小失败:', error)
      }
    })
  }, [addNotification, seedResize])

  const ensureObserver = useCallback(() => {
    if (!observerRef.current) {
      observerRef.current = new ResizeObserver(() => {
        scheduleFit()
      })
    }
  }, [scheduleFit])

  const setTerminalContainer = useCallback((node: HTMLDivElement | null) => {
    const previousNode = terminalContainerRef.current
    if (previousNode) {
      observerRef.current?.unobserve(previousNode)
    }

    terminalContainerRef.current = node
    if (node === null) {
      return
    }

    ensureObserver()
    const sessionId = activeSessionIdRef.current
    if (sessionId) {
      attachTerminal(sessionId, node)
    }
    observerRef.current?.observe(node)
    scheduleFit()
  }, [attachTerminal, ensureObserver, scheduleFit])

  const activateTerminal = useCallback((sessionId: string) => {
    if (!runtimesRef.current.has(sessionId)) {
      return
    }

    const previousSessionId = activeSessionIdRef.current
    if (previousSessionId && previousSessionId !== sessionId) {
      const previousRuntime = runtimesRef.current.get(previousSessionId)
      if (previousRuntime) {
        clearPendingResize(previousRuntime)
      }
    }

    activeSessionIdRef.current = sessionId
    setActiveSessionId(sessionId)

    const container = terminalContainerRef.current
    if (container) {
      attachTerminal(sessionId, container)
    }
    scheduleFit()
  }, [attachTerminal, scheduleFit])

  const disposeRuntime = useCallback((sessionId: string): void => {
    const runtime = runtimesRef.current.get(sessionId)
    if (!runtime || runtime.state === 'disposed') {
      return
    }

    const nextSessions = sessionsRef.current.filter(session => session.id !== sessionId)
    const wasActive = activeSessionIdRef.current === sessionId

    runtime.state = 'disposed'
    clearPendingResize(runtime)
    runtime.disposables.forEach(disposable => {
      try {
        disposable.dispose()
      } catch (error) {
        console.error(`释放终端监听器失败: ${sessionId}`, error)
      }
    })
    runtime.disposables = []
    try {
      runtime.terminal.dispose()
    } catch (error) {
      console.error(`释放终端失败: ${sessionId}`, error)
    }
    runtimesRef.current.delete(sessionId)
    pendingCreatesRef.current.delete(sessionId)
    setSessionTabs(nextSessions)

    if (!wasActive) {
      return
    }

    if (isUnmountingRef.current) {
      activeSessionIdRef.current = null
      setActiveSessionId(null)
      return
    }

    const nextSession = nextSessions[nextSessions.length - 1]
    if (nextSession && runtimesRef.current.has(nextSession.id)) {
      activateTerminal(nextSession.id)
      return
    }

    activeSessionIdRef.current = null
    setActiveSessionId(null)
  }, [activateTerminal, setSessionTabs])

  useEffect(() => {
    isUnmountingRef.current = false

    return () => {
      isUnmountingRef.current = true

      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current)
        fitFrameRef.current = null
      }

      observerRef.current?.disconnect()
      observerRef.current = null
      terminalContainerRef.current = null

      componentTimersRef.current.forEach(timer => clearTimeout(timer))
      componentTimersRef.current.clear()

      // N2-I2：cleanupRequired（failed-create/input/resize 或 close retained）、
      // closeRequestInFlight（close 已发出但未确认）与 creating（create in-flight 断线后
      // 服务端可能已把 attempt 关闭为 close-retained）一律先 enqueue/emit guarded close，
      // 再 dispose。socketClient.closeTerminal 幂等：已在本连接飞行则不重复发送（ACK-owned
      // 队列跟踪），断线时进入待发送队列、重连后自动重发——不再静默丢弃唯一 cleanup handle。
      for (const [sessionId, runtime] of runtimesRef.current.entries()) {
        if (runtime.state === 'disposed') {
          continue
        }
        const needsGuardedClose =
          runtime.cleanupRequired ||
          runtime.closeRequestInFlight ||
          runtime.state === 'creating'
        if (!needsGuardedClose) {
          continue
        }
        if (runtime.state !== 'closing') {
          runtime.state = 'closing'
        }
        socketClient.closeTerminal(sessionId)
      }

      Array.from(runtimesRef.current.keys()).forEach(disposeRuntime)
      pendingCreatesRef.current.clear()
    }
  }, [disposeRuntime, requestCloseIfIdle])
  
  // 打开创建终端模态框
  const openCreateModal = useCallback((cwd?: string) => {
    setCreateModalData({
      name: cwd && typeof cwd === 'string'
        ? `终端 - ${cwd.split(/[/\\]/).pop()}`
        : `终端 ${sessionsRef.current.length + 1}`,
      workingDirectory: cwd || '',
      enableStreamForward: false,
      programPath: ''
    })
    setShowCreateModal(true)
    // 延迟设置动画状态，确保DOM已渲染
    scheduleComponentTimeout(() => setCreateModalAnimating(true), 10)
  }, [scheduleComponentTimeout])

  // 关闭创建终端模态框
  const closeCreateModal = useCallback(() => {
    setCreateModalAnimating(false)
    // 等待淡出动画完成后再隐藏模态框
    scheduleComponentTimeout(() => {
      setShowCreateModal(false)
      setCreateModalData({
        name: '',
        workingDirectory: '',
        enableStreamForward: false,
        programPath: ''
      })
    }, 300) // 300ms 动画时长
  }, [scheduleComponentTimeout])

  // 打开帮助模态框
  const openHelpModal = useCallback(() => {
    setShowHelpModal(true)
    // 延迟设置动画状态，确保DOM已渲染
    scheduleComponentTimeout(() => setHelpModalAnimating(true), 10)
  }, [scheduleComponentTimeout])

  // 关闭帮助模态框
  const closeHelpModal = useCallback(() => {
    setHelpModalAnimating(false)
    // 等待淡出动画完成后再隐藏模态框
    scheduleComponentTimeout(() => {
      setShowHelpModal(false)
    }, 300) // 300ms 动画时长
  }, [scheduleComponentTimeout])

  // 创建新的终端会话
  const createTerminalSession = useCallback((options?: {
    name?: string
    cwd?: string
    enableStreamForward?: boolean
    programPath?: string
  }) => {
    if (!socketClient.isConnected()) {
      addNotification({
        type: 'error',
        title: '创建失败',
        message: 'Socket 未连接，无法创建终端，请连接后重试。'
      })
      return
    }

    let sessionId: string
    do {
      sessionSequenceRef.current += 1
      sessionId = `terminal-${Date.now()}-${sessionSequenceRef.current}`
    } while (runtimesRef.current.has(sessionId))

    const sessionName = options?.name || `终端 ${sessionsRef.current.length + 1}`

    pendingCreatesRef.current.set(sessionId, {
      name: sessionName,
      cwd: options?.cwd,
      enableStreamForward: options?.enableStreamForward,
      programPath: options?.programPath
    })
    createRuntime(sessionId, 'creating')
    setSessionTabs([...sessionsRef.current, { id: sessionId, name: sessionName }])
    activateTerminal(sessionId)
  }, [activateTerminal, addNotification, createRuntime, setSessionTabs])

  // 处理创建终端表单提交
  const handleCreateTerminal = useCallback(() => {
    // 验证输入
    if (!createModalData.name.trim()) {
      addNotification({
        type: 'error',
        title: '创建失败',
        message: '请输入终端名称'
      })
      return
    }

    // 如果启用了输出流转发，验证程序路径
    if (createModalData.enableStreamForward) {
      if (!createModalData.programPath.trim()) {
        addNotification({
          type: 'error',
          title: '创建失败',
          message: '启用输出流转发时必须填写程序启动路径'
        })
        return
      }

      // 检查可执行文件路径是否为绝对路径
      const commandLine = createModalData.programPath.trim()
      let executablePath: string
      
      if (commandLine.startsWith('"')) {
        // 处理带引号的可执行文件路径
        const endQuoteIndex = commandLine.indexOf('"', 1)
        if (endQuoteIndex === -1) {
          addNotification({
            type: 'error',
            title: '创建失败',
            message: '未找到匹配的引号'
          })
          return
        }
        executablePath = commandLine.substring(1, endQuoteIndex)
      } else {
        // 处理不带引号的路径
        const parts = commandLine.split(/\s+/)
        executablePath = parts[0]
      }
      
      const isAbsolutePath = /^[a-zA-Z]:\\/.test(executablePath) || executablePath.startsWith('/')
      if (!isAbsolutePath) {
        addNotification({
          type: 'error',
          title: '创建失败',
          message: '可执行文件路径必须是绝对路径'
        })
        return
      }
    }

    // 创建终端
    createTerminalSession({
      name: createModalData.name.trim(),
      cwd: createModalData.workingDirectory.trim() || undefined,
      enableStreamForward: createModalData.enableStreamForward,
      programPath: createModalData.programPath.trim() || undefined
    })

    // 关闭模态框
    closeCreateModal()
  }, [createModalData, addNotification, createTerminalSession, closeCreateModal])
  
  // 关闭终端会话
  const closeTerminalSession = useCallback((sessionId: string) => {
    const runtime = runtimesRef.current.get(sessionId)
    if (!runtime) {
      return
    }

    switch (runtime.state) {
      case 'creating':
      case 'ready':
        runtime.state = 'closing'
        clearPendingResize(runtime)
        requestCloseIfIdle(sessionId)
        return
      case 'disconnected':
      case 'reconnecting':
        runtime.state = 'closing'
        clearPendingResize(runtime)
        requestCloseIfIdle(sessionId)
        return
      case 'closing':
        requestCloseIfIdle(sessionId)
        return
      case 'exited':
        if (runtime.cleanupRequired) {
          runtime.state = 'closing'
          requestCloseIfIdle(sessionId)
        } else {
          disposeRuntime(sessionId)
        }
        return
      case 'disposed':
        return
    }
  }, [disposeRuntime, requestCloseIfIdle])

  // 切换终端会话
  const switchTerminalSession = useCallback((sessionId: string) => {
    activateTerminal(sessionId)
  }, [activateTerminal])

  const createAttachedTerminalSession = useCallback((sessionId: string, name: string): TerminalTabMeta => {
    createRuntime(sessionId, 'disconnected')
    return { id: sessionId, name }
  }, [createRuntime])

  const ensureTerminalSessionVisible = useCallback((sessionId: string, name: string) => {
    const existingSession = sessionsRef.current.find(s => s.id === sessionId)
    if (!existingSession) {
      const attachedSession = createAttachedTerminalSession(sessionId, name)
      setSessionTabs([...sessionsRef.current, attachedSession])
    } else if (!runtimesRef.current.has(sessionId)) {
      createRuntime(sessionId, 'disconnected')
    }

    activateTerminal(sessionId)
  }, [activateTerminal, createAttachedTerminalSession, createRuntime, setSessionTabs])

  const reconnectTerminalSession = useCallback((sessionId: string) => {
    const runtime = runtimesRef.current.get(sessionId)
    if (
      !runtime ||
      !socketClient.isConnected() ||
      (runtime.state !== 'disconnected' && runtime.state !== 'closing')
    ) {
      return
    }

    if (runtime.state === 'disconnected') {
      runtime.state = 'reconnecting'
    }
    socketClient.reconnectTerminal(sessionId)
  }, [])
  
  // 重命名终端会话
  const startRenaming = (sessionId: string, currentName: string) => {
    setEditingSessionId(sessionId)
    setEditingName(currentName)
  }
  
  const finishRenaming = async () => {
    if (editingSessionId && editingName.trim()) {
      const newName = editingName.trim()

      // 更新本地状态
      setSessionTabs(sessionsRef.current.map(session =>
        session.id === editingSessionId
          ? { ...session, name: newName }
          : session
      ))

      // 调用后端API持久化保存
      try {
        const response = await apiClient.updateTerminalSessionName(editingSessionId, newName)
        if (response.success) {
          addNotification({
            type: 'success',
            title: '重命名成功',
            message: `终端会话已重命名为 "${newName}"`
          })
        } else {
          throw new Error(response.error || '重命名失败')
        }
      } catch (error) {
        console.error('保存会话名称失败:', error)
        addNotification({
          type: 'error',
          title: '保存失败',
          message: '会话名称保存失败，但本地显示已更新'
        })
      }
    }
    setEditingSessionId(null)
    setEditingName('')
  }

  const cancelRenaming = () => {
    setEditingSessionId(null)
    setEditingName('')
  }

  // 重置终端
  const resetTerminal = () => {
    const sessionId = activeSessionIdRef.current
    const runtime = sessionId ? runtimesRef.current.get(sessionId) : undefined
    if (runtime) {
      runtime.terminal.reset()
      addNotification({
        type: 'info',
        title: '终端已重置',
        message: '终端内容已清空'
      })
    }
  }

  // 切换全屏模式
  const toggleFullscreen = async () => {
    try {
      if (!isFullscreen) {
        // 进入全屏模式
        await document.documentElement.requestFullscreen()
        setIsFullscreen(true)
        addNotification({
          type: 'info',
          title: '已进入全屏模式',
          message: '按 ESC 键或点击全屏按钮退出全屏'
        })
      } else {
        // 退出全屏模式
        await document.exitFullscreen()
        setIsFullscreen(false)
        addNotification({
          type: 'info',
          title: '已退出全屏模式',
          message: '全屏模式已关闭'
        })
      }
    } catch (error) {
      console.error('全屏切换失败:', error)
      addNotification({
        type: 'error',
        title: '全屏切换失败',
        message: '浏览器不支持全屏模式或操作被阻止'
      })
    }
  }
  
  // 页面加载时获取现有终端会话
  useEffect(() => {
    let cancelled = false

    const loadExistingSessions = async () => {
      try {
        const response = await apiClient.getTerminalSessions()
        if (cancelled || !response.success || !response.data) {
          return
        }

        // 获取活跃会话和保存的会话
        const activeSessions = response.data.activeSessions || []
        const savedSessions = response.data.savedSessions || []

        // 创建活跃会话ID的Set，用于去重
        const activeSessionIds = new Set(activeSessions.map((session: any) => session.id))

        // 过滤掉已经在活跃会话中的保存会话，避免重复
        const uniqueSavedSessions = savedSessions.filter((session: any) => !activeSessionIds.has(session.id))

        // 合并去重后的会话列表，优先使用活跃会话
        const sessionData = [...activeSessions, ...uniqueSavedSessions]
        if (sessionData.length === 0) {
          return
        }

        // 在设置初始会话之前，检查URL参数
        const params = new URLSearchParams(window.location.search)
        const sessionIdFromUrl = params.get('sessionId')
        const initialActiveId = sessionIdFromUrl && sessionData.some((session: any) => session.id === sessionIdFromUrl)
          ? sessionIdFromUrl
          : sessionData[0].id

        const newSessions: TerminalTabMeta[] = sessionData.map((session: any, index: number) => {
          createRuntime(session.id, 'disconnected')
          return {
            id: session.id,
            name: session.name || `终端 ${index + 1}`
          }
        })

        if (cancelled) {
          return
        }

        setSessionTabs(newSessions)
        activateTerminal(initialActiveId)

        addNotification({
          type: 'info',
          title: '发现现有会话',
          message: `找到 ${sessionData.length} 个现有终端会话，正在恢复...`
        })

        newSessions.forEach(session => reconnectTerminalSession(session.id))
      } catch (error) {
        if (!cancelled) {
          console.error('获取现有终端会话失败:', error)
          addNotification({
            type: 'error',
            title: '加载会话失败',
            message: '无法从服务器获取现有的终端会话。'
          })
        }
      } finally {
        if (!cancelled) {
          setSessionsLoaded(true)
        }
      }
    }

    void loadExistingSessions()
    return () => {
      cancelled = true
    }
  }, [activateTerminal, addNotification, createRuntime, reconnectTerminalSession, setSessionTabs])
  
  useEffect(() => {
    const fitAndSeedActiveRuntime = (sessionId: string) => {
      if (activeSessionIdRef.current !== sessionId) {
        return
      }

      const container = terminalContainerRef.current
      if (container) {
        attachTerminal(sessionId, container)
      }
      scheduleFit()
    }

    const handlePtyCreated = ({ sessionId }: { sessionId: string; workingDirectory: string }) => {
      const runtime = runtimesRef.current.get(sessionId)
      if (!runtime) {
        return
      }

      if (runtime.state === 'creating' || runtime.state === 'reconnecting') {
        runtime.state = 'ready'
        // N6-I3：creating 断线置的 cleanupRequired 只在确认成功恢复 ready 时清除——
        // 否则离开页面会误关已确认健康的 live session
        runtime.cleanupRequired = false
        fitAndSeedActiveRuntime(sessionId)

        const sessionName = sessionsRef.current.find(session => session.id === sessionId)?.name || sessionId
        addNotification({
          type: 'success',
          title: '终端创建成功',
          message: `已创建新的终端会话: ${sessionName}`
        })
        return
      }

      if (runtime.state === 'closing') {
        requestCloseIfIdle(sessionId)
      }
    }

    const handlePtyClosed = ({ sessionId }: { sessionId: string }) => {
      const runtime = runtimesRef.current.get(sessionId)
      if (!runtime) {
        return
      }

      runtime.closeRequestInFlight = false
      runtime.cleanupRequired = false
      if (runtime.state === 'disposed') {
        return
      }

      const sessionName = sessionsRef.current.find(session => session.id === sessionId)?.name || sessionId
      disposeRuntime(sessionId)
      addNotification({
        type: 'info',
        title: '终端已关闭',
        message: `终端会话 ${sessionName} 已关闭`
      })
    }

    const handleTerminalOutput = ({ sessionId, data, isHistorical }: { sessionId: string; data: string; isHistorical?: boolean }) => {
      const runtime = runtimesRef.current.get(sessionId)
      if (!runtime || runtime.state === 'disposed') {
        return
      }

      if (isHistorical) {
        runtime.terminal.clear()
      }
      runtime.terminal.write(data)
    }

    const handleTerminalResized = ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      const runtime = runtimesRef.current.get(sessionId)
      const size = { cols, rows }
      if (runtime?.state === 'ready' && isValidTerminalSize(size)) {
        runtime.lastReportedSize = size
      }
    }

    const handleTerminalError = ({
      sessionId,
      operation,
      error,
      retained
    }: TerminalErrorEvent) => {
      console.error(`终端操作失败 (${operation}):`, error)
      const runtime = runtimesRef.current.get(sessionId)
      if (!runtime) {
        return
      }

      if (operation === 'close') {
        const closeRequestWasInFlight = runtime.closeRequestInFlight
        runtime.closeRequestInFlight = false
        if (retained) {
          runtime.cleanupRequired = true
          runtime.state = 'closing'
          clearPendingResize(runtime)
          addNotification({
            type: 'error',
            title: '终端仍在关闭',
            message: '终端进程仍在运行，请再次点击关闭重试。'
          })
        } else if (runtime.state === 'closing' && closeRequestWasInFlight) {
          addNotification({
            type: 'error',
            title: '终端关闭失败',
            message: '终端关闭失败，请再次点击关闭重试。'
          })
        }
        return
      }

      if (
        operation === 'create' &&
        (runtime.state === 'creating' || runtime.state === 'reconnecting')
      ) {
        runtime.state = 'exited'
        // 服务端的 bounded close 可能仍在进行或最终保留 target：
        // 从错误时刻起即假定 cleanup 可能未完成，关闭 tab 时走 guarded close，
        // 避免 server retained 信号到达前关闭标签页而丢失 cleanup retry 入口。
        runtime.cleanupRequired = true
        addNotification({
          type: 'error',
          title: '终端创建失败',
          message: '终端创建失败，请关闭该会话后重试。'
        })
        return
      }

      if (operation === 'input' && runtime.state === 'ready') {
        runtime.state = 'exited'
        runtime.cleanupRequired = true
        clearPendingResize(runtime)
        addNotification({
          type: 'error',
          title: '终端输入失败',
          message: '终端输入失败，请关闭该会话后重新创建。'
        })
        return
      }

      if (operation === 'resize' && runtime.state === 'ready') {
        runtime.state = 'exited'
        runtime.cleanupRequired = true
        clearPendingResize(runtime)
        addNotification({
          type: 'error',
          title: '终端尺寸同步失败',
          message: '终端尺寸同步失败，请关闭该会话后重新创建。'
        })
      }
    }

    const handleTerminalExit = ({ sessionId }: { sessionId: string; code: number | null; signal: string | null }) => {
      const runtime = runtimesRef.current.get(sessionId)
      if (!runtime || runtime.state === 'disposed') {
        return
      }

      runtime.cleanupRequired = false
      runtime.closeRequestInFlight = false
      if (runtime.state !== 'exited') {
        runtime.state = 'exited'
        clearPendingResize(runtime)
      }
    }

    const handleSessionReconnected = ({
      sessionId,
      state
    }: {
      sessionId: string
      state: 'ready' | 'closing'
    }) => {
      const runtime = runtimesRef.current.get(sessionId)
      if (!runtime) {
        return
      }

      if (runtime.state === 'closing') {
        requestCloseIfIdle(sessionId)
        return
      }

      if (runtime.state !== 'reconnecting') {
        return
      }
      if (state === 'closing') {
        runtime.state = 'closing'
        requestCloseIfIdle(sessionId)
        return
      }

      runtime.state = 'ready'
      // N6-I3：确认成功恢复 ready 时清除断线遗留的 cleanupRequired（仅此分支）
      runtime.cleanupRequired = false
      fitAndSeedActiveRuntime(sessionId)
    }

    const handleSessionReconnectFailed = ({ sessionId }: { sessionId: string }) => {
      const runtime = runtimesRef.current.get(sessionId)
      if (!runtime || (runtime.state !== 'reconnecting' && runtime.state !== 'closing')) {
        return
      }

      if (runtime.state === 'reconnecting') {
        runtime.state = 'exited'
        clearPendingResize(runtime)
      } else {
        runtime.closeRequestInFlight = false
        disposeRuntime(sessionId)
      }

      addNotification({
        type: 'error',
        title: '会话重连失败',
        message: '终端会话重连失败，请关闭该会话后重新创建。'
      })
    }

    const handleConnectionStatus = ({ connected }: { connected: boolean; reason?: string }) => {
      if (!connected) {
        runtimesRef.current.forEach(runtime => {
          if (runtime.state === 'disposed' || runtime.state === 'exited') {
            return
          }

          const wasCreating = runtime.state === 'creating'
          if (runtime.state !== 'closing') {
            runtime.state = 'disconnected'
          }
          runtime.closeRequestInFlight = false
          // N2-I2：create in-flight 断线——服务端 handleDisconnect 会对 starting/fallback
          // attempt 执行有界关闭并可能转为 close-retained；置 cleanupRequired，unmount
          // 时才会 enqueue guarded close，避免该 attempt 的唯一 ID 永久丢失
          //（createAttempts 不在可重连的 active session 列表中）。
          if (wasCreating) {
            runtime.cleanupRequired = true
          }
          clearPendingResize(runtime)
          runtime.lastWrittenSize = undefined
          runtime.lastReportedSize = undefined
        })
        return
      }

      runtimesRef.current.forEach((runtime, sessionId) => {
        if (runtime.state === 'disconnected') {
          runtime.state = 'reconnecting'
          socketClient.reconnectTerminal(sessionId)
        } else if (runtime.state === 'closing') {
          socketClient.reconnectTerminal(sessionId)
        }
      })
    }

    socketClient.on('pty-created', handlePtyCreated)
    socketClient.on('pty-closed', handlePtyClosed)
    socketClient.on('terminal-output', handleTerminalOutput)
    socketClient.on('terminal-resized', handleTerminalResized)
    socketClient.on('terminal-error', handleTerminalError)
    socketClient.on('terminal-exit', handleTerminalExit)
    socketClient.on('session-reconnected', handleSessionReconnected)
    socketClient.on('session-reconnect-failed', handleSessionReconnectFailed)
    socketClient.on('connection-status', handleConnectionStatus)

    return () => {
      socketClient.off('pty-created', handlePtyCreated)
      socketClient.off('pty-closed', handlePtyClosed)
      socketClient.off('terminal-output', handleTerminalOutput)
      socketClient.off('terminal-resized', handleTerminalResized)
      socketClient.off('terminal-error', handleTerminalError)
      socketClient.off('terminal-exit', handleTerminalExit)
      socketClient.off('session-reconnected', handleSessionReconnected)
      socketClient.off('session-reconnect-failed', handleSessionReconnectFailed)
      socketClient.off('connection-status', handleConnectionStatus)
    }
  }, [
    addNotification,
    attachTerminal,
    disposeRuntime,
    requestCloseIfIdle,
    scheduleFit
  ])
  
  useEffect(() => {
    // 处理URL参数：cwd和instance
    if (!sessionsLoaded) {
      return
    }

    const cwd = searchParams.get('cwd')
    const instanceId = searchParams.get('instance')
    const sessionId = searchParams.get('sessionId')
    const urlParamKey = sessionId
      ? `session:${sessionId}`
      : instanceId
        ? `instance:${instanceId}`
        : cwd
          ? `cwd:${cwd}`
          : null

    if (!urlParamKey) {
      processedUrlParamKey.current = null
      return
    }

    if (processedUrlParamKey.current === urlParamKey) {
      return
    }

    if (sessionId) {
      // 如果有sessionId参数，直接查找对应的终端会话
      const targetSession = sessionsRef.current.find(session => session.id === sessionId)

      if (targetSession) {
        // 如果找到对应的会话，切换到该会话
        switchTerminalSession(targetSession.id)
        reconnectTerminalSession(targetSession.id)
      } else {
        // 启动实例后，HTTP会话列表可能还没刷新到新会话。
        // 先创建同ID的前端标签并重连，避免停留在旧的活动终端。
        ensureTerminalSessionVisible(
          sessionId,
          instanceId ? `实例: ${instanceId}` : `终端 ${sessionId.slice(-8)}`
        )
        reconnectTerminalSession(sessionId)
        addNotification({
          type: 'info',
          title: '正在连接实例终端',
          message: `正在连接终端会话 ${sessionId}`
        })
      }
    } else if (instanceId) {
      // 如果有instance参数，查找对应的终端会话
      const instanceSession = sessionsRef.current.find(session =>
        session.name.includes(instanceId) || session.id.includes(instanceId)
      )

      if (instanceSession) {
        // 如果找到对应的会话，切换到该会话
        switchTerminalSession(instanceSession.id)
        addNotification({
          type: 'success',
          title: '已连接到实例终端',
          message: `已切换到实例 ${instanceId} 的终端会话`
        })
      } else {
        // 如果没有找到对应的会话，等待一段时间后再次查找
        scheduleComponentTimeout(() => {
          const delayedSession = sessionsRef.current.find(session =>
            session.name.includes(instanceId) || session.id.includes(instanceId)
          )
          if (delayedSession) {
            switchTerminalSession(delayedSession.id)
            addNotification({
              type: 'success',
              title: '已连接到实例终端',
              message: `已切换到实例 ${instanceId} 的终端会话`
            })
          } else {
            addNotification({
              type: 'info',
              title: '未找到实例终端',
              message: `实例 ${instanceId} 的终端会话可能还在启动中`
            })
          }
        }, 2000)
      }
    } else if (cwd) {
      // 延迟创建新终端，确保现有会话加载完成
      scheduleComponentTimeout(() => {
        createTerminalSession({ cwd })
      }, 100)
    }

    processedUrlParamKey.current = urlParamKey
    navigate('/terminal', { replace: true })
  }, [
    sessionsLoaded,
    navigate,
    createTerminalSession,
    searchParams,
    switchTerminalSession,
    ensureTerminalSessionVisible,
    reconnectTerminalSession,
    scheduleComponentTimeout,
    addNotification
  ])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!document.fullscreenElement
      if (isCurrentlyFullscreen !== isFullscreen) {
        setIsFullscreen(isCurrentlyFullscreen)
        if (!isCurrentlyFullscreen) {
          addNotification({
            type: 'info',
            title: '已退出全屏模式',
            message: '全屏模式已关闭'
          })
        }
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [addNotification, isFullscreen])
  
  // 计算是否应该显示侧边栏内容
  const shouldShowSidebar = (!sidebarCollapsed || sidebarHovered) && !isMobile
  
  // 全屏模式下的渲染
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900 flex">
         {/* 移动端全屏时隐藏侧边栏，桌面端保持原有逻辑 */}
         {!isMobile && (
           <div className={`
             ${sidebarCollapsed && !sidebarHovered ? 'w-16' : 'w-80'}
             transition-all duration-300 ease-in-out
             bg-gray-800/50 backdrop-blur-sm border-r border-gray-700/50
             flex flex-col
           `}
           onMouseEnter={() => setSidebarHovered(true)}
           onMouseLeave={() => setSidebarHovered(false)}
           >
            {/* 侧边栏头部 */}
            <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
              {shouldShowSidebar && (
                <>
                  <div className="flex items-center space-x-2">
                    <TerminalIcon className="w-5 h-5 text-blue-400" />
                    <h2 className="text-lg font-semibold text-white font-display">
                      终端管理
                    </h2>
                  </div>
                  
                  <button
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="折叠侧边栏"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </>
              )}
              
              {!shouldShowSidebar && (
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors mx-auto"
                  title="展开侧边栏"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
            
            {/* 新建终端按钮 */}
            {shouldShowSidebar && (
              <div className="p-4 border-b border-gray-700/50">
                <button
                  onClick={() => openCreateModal()}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center justify-center space-x-2 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>新建终端</span>
                </button>
              </div>
            )}
            
            {/* 终端会话列表 */}
            <div className="flex-1 overflow-y-auto">
              {shouldShowSidebar ? (
                <div className="p-2 space-y-1">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`
                        group relative p-3 rounded-lg cursor-pointer transition-all
                        ${session.id === activeSessionId
                          ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                          : 'text-gray-300 hover:bg-white/5 hover:text-white'
                        }
                      `}
                      onClick={() => switchTerminalSession(session.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 flex-1 min-w-0">
                          <Folder className="w-4 h-4 flex-shrink-0" />
                          
                          {editingSessionId === session.id ? (
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onBlur={finishRenaming}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') finishRenaming()
                                if (e.key === 'Escape') cancelRenaming()
                              }}
                              className="bg-gray-700 text-white px-2 py-1 rounded text-sm flex-1 min-w-0"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span className="text-sm font-medium truncate flex-1">
                              {session.name}
                            </span>
                          )}
                        </div>
                        
                        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {editingSessionId === session.id ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                finishRenaming()
                              }}
                              className="p-1 text-green-400 hover:text-green-300 transition-colors"
                              title="确认重命名"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                startRenaming(session.id, session.name)
                              }}
                              className="p-1 text-gray-400 hover:text-white transition-colors"
                              title="重命名"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          )}
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              closeTerminalSession(session.id)
                            }}
                            className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                            title="关闭终端"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="text-xs text-gray-500 mt-1 truncate">
                        {session.id}
                      </div>
                    </div>
                  ))}
                  
                  {sessions.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <TerminalIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">暂无终端会话</p>
                    </div>
                  )}
                </div>
              ) : (
                // 折叠状态下的简化显示
                <div className="p-1 space-y-1">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`
                        w-10 h-10 rounded-lg cursor-pointer transition-all flex items-center justify-center
                        ${session.id === activeSessionId
                          ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                          : 'text-gray-400 hover:bg-white/5 hover:text-white'
                        }
                      `}
                      onClick={() => switchTerminalSession(session.id)}
                      title={session.name}
                    >
                      <Folder className="w-4 h-4" />
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* 侧边栏底部工具栏 */}
            {shouldShowSidebar && activeSessionId && (
              <div className="p-4 border-t border-gray-700/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={resetTerminal}
                      className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                      title="重置终端"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    
                    <button
                      className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                      title="终端设置"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <button
                    onClick={toggleFullscreen}
                    className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title={isFullscreen ? '退出全屏' : '全屏模式'}
                  >
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
             )}
           </div>
        )}
        
        {/* 移动端浮动控制按钮 */}
        {isMobile && (
          <div className="absolute top-20 left-4 z-10 flex space-x-2">
            <button
              onClick={() => openCreateModal()}
              className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full shadow-lg transition-colors"
              title="新建终端"
            >
              <Plus className="w-5 h-5" />
            </button>
            {activeSessionId && (
              <button
                onClick={toggleFullscreen}
                className="bg-gray-600 hover:bg-gray-700 text-white p-3 rounded-full shadow-lg transition-colors"
                title="退出全屏"
              >
                <Minimize2 className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        
        {/* 右侧终端显示区域 */}
        <div className="flex-1 flex flex-col min-w-0">
          {sessions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center bg-gray-900">
              <div className="text-center">
                <TerminalIcon className="w-16 h-16 text-gray-500 mx-auto mb-4" />
                <p className="text-gray-400 mb-4">暂无终端会话</p>
                <button
                  onClick={() => createTerminalSession()}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors"
                >
                  创建第一个终端
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* 终端头部 */}
              <div className="flex-shrink-0 bg-gray-800/50 backdrop-blur-sm border-b border-gray-700/50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="flex space-x-2">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    </div>
                    <div className="text-sm font-medium text-white">
                      {sessions.find(session => session.id === activeSessionId)?.name || '终端'}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={toggleFullscreen}
                      className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                      title="退出全屏"
                    >
                      <Minimize2 className="w-4 h-4" />
                    </button>
                    <div className="text-xs text-gray-400 font-mono">
                      {activeSessionId}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* 终端内容 */}
              <div
                ref={setTerminalContainer}
                className="flex-1 bg-gray-900 min-h-0 w-full h-full"
              />
            </>
          )}
        </div>
      </div>
    )
  }

  // 普通模式下的渲染
  return (
    <div className="h-screen flex relative">
      {/* 移动端浮动菜单按钮 */}
      {isMobile && (
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="fixed top-20 left-4 z-50 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full shadow-lg transition-colors"
          title="菜单"
        >
          {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      )}
      
      {/* 左侧终端标签页侧边栏 */}
      {(!isMobile || !sidebarCollapsed) && (
        <div 
          className={`
            ${isMobile ? 'fixed inset-y-0 left-0 z-40 w-80' : 'relative'}
            ${!isMobile && shouldShowSidebar ? 'w-80' : !isMobile ? 'w-12' : ''}
            bg-gray-800/50 backdrop-blur-sm border-r border-gray-700/50 transition-all duration-300 ease-in-out
            ${sidebarHovered ? 'shadow-xl' : ''}
            ${isMobile ? 'shadow-2xl' : ''}
            flex flex-col
          `}
          onMouseEnter={() => setSidebarHovered(true)}
          onMouseLeave={() => setSidebarHovered(false)}
        >
        {/* 侧边栏头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
          {shouldShowSidebar && (
            <>
              <div className="flex items-center space-x-2">
                <TerminalIcon className="w-5 h-5 text-blue-400" />
                <h2 className="text-lg font-semibold text-white font-display">
                  终端管理
                </h2>
              </div>
              
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="折叠侧边栏"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </>
          )}
          
          {!shouldShowSidebar && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors mx-auto"
              title="展开侧边栏"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
        
        {/* 新建终端按钮 */}
        {shouldShowSidebar && (
          <div className="p-4 border-b border-gray-700/50">
            <button
              onClick={() => openCreateModal()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center justify-center space-x-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>新建终端</span>
            </button>
          </div>
        )}
        
        {/* 终端会话列表 */}
        <div className="flex-1 overflow-y-auto">
          {shouldShowSidebar ? (
            <div className="p-2 space-y-1">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`
                    group relative p-3 rounded-lg cursor-pointer transition-all
                    ${session.id === activeSessionId
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                      : 'text-gray-300 hover:bg-white/5 hover:text-white'
                    }
                  `}
                  onClick={() => switchTerminalSession(session.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <Folder className="w-4 h-4 flex-shrink-0" />
                      
                      {editingSessionId === session.id ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={finishRenaming}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') finishRenaming()
                            if (e.key === 'Escape') cancelRenaming()
                          }}
                          className="bg-gray-700 text-white px-2 py-1 rounded text-sm flex-1 min-w-0"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-sm font-medium truncate flex-1">
                          {session.name}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {editingSessionId === session.id ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            finishRenaming()
                          }}
                          className="p-1 text-green-400 hover:text-green-300 transition-colors"
                          title="确认重命名"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            startRenaming(session.id, session.name)
                          }}
                          className="p-1 text-gray-400 hover:text-white transition-colors"
                          title="重命名"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                      )}
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTerminalSession(session.id)
                        }}
                        className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                        title="关闭终端"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="text-xs text-gray-500 mt-1 truncate">
                    {session.id}
                  </div>
                </div>
              ))}
              
              {sessions.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <TerminalIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无终端会话</p>
                </div>
              )}
            </div>
          ) : (
            // 折叠状态下的简化显示
            <div className="p-1 space-y-1">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`
                    w-10 h-10 rounded-lg cursor-pointer transition-all flex items-center justify-center
                    ${session.id === activeSessionId
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                    }
                  `}
                  onClick={() => switchTerminalSession(session.id)}
                  title={session.name}
                >
                  <Folder className="w-4 h-4" />
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* 侧边栏底部工具栏 */}
        {shouldShowSidebar && activeSessionId && (
          <div className="p-4 border-t border-gray-700/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={resetTerminal}
                  className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  title="重置终端"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                
                <button
                  className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  title="终端设置"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
              
              <button
                onClick={toggleFullscreen}
                className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title={isFullscreen ? '退出全屏' : '全屏模式'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}
        </div>
      )}
      
      {/* 移动端遮罩层 */}
      {isMobile && !sidebarCollapsed && (
        <div 
          className="fixed inset-0 bg-black/50 z-30"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}
      
      {/* 右侧终端显示区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {sessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center bg-gray-900">
            <div className="text-center">
              <TerminalIcon className="w-16 h-16 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400 mb-4">暂无终端会话</p>
              <button
                onClick={() => openCreateModal()}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors"
              >
                创建第一个终端
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 终端头部 */}
            <div className="flex-shrink-0 bg-gray-800/50 backdrop-blur-sm border-b border-gray-700/50 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="flex space-x-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  </div>
                  <div className="text-sm font-medium text-white truncate">
                    {sessions.find(session => session.id === activeSessionId)?.name || '终端'}
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <button
                    onClick={openHelpModal}
                    className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="命令帮助"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                  {!isMobile && (
                    <div className="text-xs text-gray-400 font-mono">
                      {activeSessionId}
                    </div>
                  )}
                  {isMobile && (
                    <button
                      onClick={toggleFullscreen}
                      className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                      title="全屏模式"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            
            {/* 终端内容 */}
            <div
              ref={setTerminalContainer}
              className={`flex-1 bg-gray-900 min-h-0 ${isMobile ? 'touch-manipulation' : ''}`}
              style={{
                // 移动端优化触摸滚动
                WebkitOverflowScrolling: 'touch',
                // 防止移动端缩放
                touchAction: 'manipulation'
              }}
            />
          </>
        )}
      </div>
      
      {/* 创建终端模态框 */}
      {showCreateModal && (
        <div 
          className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 transition-opacity duration-300 ${
            createModalAnimating ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div 
            className={`bg-gray-800 rounded-lg shadow-xl w-full max-w-md transform transition-all duration-300 ${
              createModalAnimating 
                ? 'opacity-100 scale-100 translate-y-0' 
                : 'opacity-0 scale-95 translate-y-4'
            }`}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-white">创建新终端</h3>
                <button
                  onClick={closeCreateModal}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-4">
                {/* 终端名称 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    终端名称
                  </label>
                  <input
                    type="text"
                    value={createModalData.name}
                    onChange={(e) => setCreateModalData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="输入终端名称"
                  />
                </div>
                
                {/* 工作目录 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    工作目录 (可选)
                  </label>
                  <div className="relative">
                    <FolderOpen className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={createModalData.workingDirectory}
                      onChange={(e) => setCreateModalData(prev => ({ ...prev, workingDirectory: e.target.value }))}
                      className="w-full pl-10 pr-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="留空使用默认目录"
                    />
                  </div>
                </div>
                
                {/* Windows平台输出流转发选项 */}
                {navigator.platform.toLowerCase().includes('win') && (
                  <>
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="enableStreamForward"
                        checked={createModalData.enableStreamForward}
                        onChange={(e) => setCreateModalData(prev => ({ ...prev, enableStreamForward: e.target.checked }))}
                        className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
                      />
                      <label htmlFor="enableStreamForward" className="text-sm font-medium text-gray-300">
                        启用输出流转发 (仅Windows)
                      </label>
                    </div>
                    
                    {createModalData.enableStreamForward && (
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          程序启动命令 <span className="text-red-400">*</span>
                        </label>
                        <div className="relative">
                          <FileText className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={createModalData.programPath}
                            onChange={(e) => setCreateModalData(prev => ({ ...prev, programPath: e.target.value }))}
                            className="w-full pl-10 pr-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder='例如: "C:\\Program Files\\MyApp\\app.exe" arg1 arg2'
                          />
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          输入完整的程序启动命令（包含参数），可执行文件路径必须是绝对路径，终端将捕获该程序的输出并转发到当前终端
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
              
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={closeCreateModal}
                  className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateTerminal}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  创建终端
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* 帮助模态框 */}
      {showHelpModal && (
        <div 
          className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 transition-opacity duration-300 ${
            helpModalAnimating ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div 
            className={`bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] overflow-hidden transform transition-all duration-300 ${
              helpModalAnimating 
                ? 'opacity-100 scale-100 translate-y-0' 
                : 'opacity-0 scale-95 translate-y-4'
            }`}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-white">终端命令帮助</h3>
                <button
                  onClick={closeHelpModal}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="overflow-y-auto max-h-[60vh] space-y-6">
                {/* 基础命令 */}
                <div>
                  <h4 className="text-md font-semibold text-blue-400 mb-3">基础命令</h4>
                  <div className="space-y-2">
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">ls / dir</code>
                        <span className="text-gray-300 text-sm">列出当前目录下的文件和文件夹</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">cd [目录]</code>
                        <span className="text-gray-300 text-sm">切换到指定目录</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">pwd</code>
                        <span className="text-gray-300 text-sm">显示当前工作目录的完整路径</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">clear / cls</code>
                        <span className="text-gray-300 text-sm">清空终端屏幕</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 文件操作 */}
                <div>
                  <h4 className="text-md font-semibold text-blue-400 mb-3">文件操作</h4>
                  <div className="space-y-2">
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">cat [文件]</code>
                        <span className="text-gray-300 text-sm">显示文件内容</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">cp / copy [源] [目标]</code>
                        <span className="text-gray-300 text-sm">复制文件或目录</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">mv / move [源] [目标]</code>
                        <span className="text-gray-300 text-sm">移动或重命名文件</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">rm / del [文件]</code>
                        <span className="text-gray-300 text-sm">删除文件</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">mkdir [目录名]</code>
                        <span className="text-gray-300 text-sm">创建新目录</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 系统信息 */}
                <div>
                  <h4 className="text-md font-semibold text-blue-400 mb-3">系统信息</h4>
                  <div className="space-y-2">
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">ps / tasklist</code>
                        <span className="text-gray-300 text-sm">显示正在运行的进程</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">top / htop</code>
                        <span className="text-gray-300 text-sm">实时显示系统进程和资源使用情况</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">df / fsutil</code>
                        <span className="text-gray-300 text-sm">显示磁盘空间使用情况</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">whoami</code>
                        <span className="text-gray-300 text-sm">显示当前用户名</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 网络命令 */}
                <div>
                  <h4 className="text-md font-semibold text-blue-400 mb-3">网络命令</h4>
                  <div className="space-y-2">
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">ping [主机]</code>
                        <span className="text-gray-300 text-sm">测试网络连接</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">curl [URL]</code>
                        <span className="text-gray-300 text-sm">发送HTTP请求</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">wget [URL]</code>
                        <span className="text-gray-300 text-sm">下载文件</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-green-400 font-mono text-sm min-w-0 flex-shrink-0">netstat</code>
                        <span className="text-gray-300 text-sm">显示网络连接状态</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 快捷键 */}
                <div>
                  <h4 className="text-md font-semibold text-blue-400 mb-3">常用快捷键</h4>
                  <div className="space-y-2">
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-yellow-400 font-mono text-sm min-w-0 flex-shrink-0">Ctrl + C</code>
                        <span className="text-gray-300 text-sm">中断当前运行的命令</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-yellow-400 font-mono text-sm min-w-0 flex-shrink-0">Ctrl + Z</code>
                        <span className="text-gray-300 text-sm">暂停当前进程</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-yellow-400 font-mono text-sm min-w-0 flex-shrink-0">Ctrl + L</code>
                        <span className="text-gray-300 text-sm">清空屏幕（等同于clear命令）</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-yellow-400 font-mono text-sm min-w-0 flex-shrink-0">↑ / ↓</code>
                        <span className="text-gray-300 text-sm">浏览命令历史</span>
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <code className="text-yellow-400 font-mono text-sm min-w-0 flex-shrink-0">Tab</code>
                        <span className="text-gray-300 text-sm">自动补全命令或文件名</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 提示 */}
                <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-4">
                  <h4 className="text-md font-semibold text-blue-400 mb-2">💡 提示</h4>
                  <ul className="text-gray-300 text-sm space-y-1">
                    <li>• 使用 <code className="text-green-400 bg-gray-700 px-1 rounded">命令 --help</code> 或 <code className="text-green-400 bg-gray-700 px-1 rounded">man 命令</code> 查看命令的详细帮助</li>
                    <li>• 在Windows系统中，列出文件使用 <code className="text-green-400 bg-gray-700 px-1 rounded">dir</code> 执行文件使用反斜杠 <code className="text-green-400 bg-gray-700 px-1 rounded">.\ </code>Linux中使用 <code className="text-green-400 bg-gray-700 px-1 rounded">./</code></li>
                    <li>• 可以使用 <code className="text-green-400 bg-gray-700 px-1 rounded">history</code> 命令查看命令历史</li>
                    <li>• 使用 <code className="text-green-400 bg-gray-700 px-1 rounded">alias</code> 命令创建命令别名</li>
                  </ul>
                </div>
              </div>
              
              <div className="flex justify-end mt-6">
                <button
                  onClick={closeHelpModal}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TerminalPage
