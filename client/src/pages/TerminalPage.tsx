import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import socketClient from '@/utils/socket'
import apiClient from '@/utils/api'
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

interface TerminalSession {
  id: string
  name: string
  terminal: Terminal
  fitAddon: FitAddon
  active: boolean
}

const TerminalPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<TerminalSession[]>([])
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
  
  const terminalContainerRef = useRef<HTMLDivElement>(null)
  // 使用useRef来保存最新的sessions状态，避免重复注册事件监听器
  const sessionsRef = useRef<TerminalSession[]>([])
  const processedUrlParamKey = useRef<string | null>(null)
  const { addNotification } = useNotificationStore()
  
  // 检测移动端设备
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
      // 在移动端默认折叠侧边栏
      if (window.innerWidth < 768) {
        setSidebarCollapsed(true)
      }
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    return () => {
      window.removeEventListener('resize', checkMobile)
    }
  }, [])
  
  // 计算合适的终端大小
  const calculateTerminalSize = useCallback(() => {
    if (terminalContainerRef.current) {
      const container = terminalContainerRef.current
      const containerWidth = container.clientWidth || (isMobile ? 360 : 800)
      const containerHeight = container.clientHeight || (isMobile ? 400 : 600)
      
      // 基于实际字体大小计算字符尺寸
      // 移动端使用较小的字体
      const fontSize = isMobile ? 12 : 14
      const lineHeight = 1.2
      const charWidth = fontSize * 0.6
      const charHeight = fontSize * lineHeight
      
      const cols = Math.floor(containerWidth / charWidth)
      const rows = Math.floor(containerHeight / charHeight)
      
      console.log(`容器大小: ${containerWidth}x${containerHeight}, 计算终端大小: ${cols}x${rows}`)
      
      // 移动端使用更小的最小值
      const minCols = isMobile ? 40 : 80
      const minRows = isMobile ? 20 : 24
      
      return { cols: Math.max(cols, minCols), rows: Math.max(rows, minRows) }
    }
    return { cols: isMobile ? 50 : 100, rows: isMobile ? 25 : 30 }
  }, [isMobile])
  
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
    setTimeout(() => setCreateModalAnimating(true), 10)
  }, [])

  // 关闭创建终端模态框
  const closeCreateModal = useCallback(() => {
    setCreateModalAnimating(false)
    // 等待淡出动画完成后再隐藏模态框
    setTimeout(() => {
      setShowCreateModal(false)
      setCreateModalData({
        name: '',
        workingDirectory: '',
        enableStreamForward: false,
        programPath: ''
      })
    }, 300) // 300ms 动画时长
  }, [])

  // 打开帮助模态框
  const openHelpModal = useCallback(() => {
    setShowHelpModal(true)
    // 延迟设置动画状态，确保DOM已渲染
    setTimeout(() => setHelpModalAnimating(true), 10)
  }, [])

  // 关闭帮助模态框
  const closeHelpModal = useCallback(() => {
    setHelpModalAnimating(false)
    // 等待淡出动画完成后再隐藏模态框
    setTimeout(() => {
      setShowHelpModal(false)
    }, 300) // 300ms 动画时长
  }, [])

  // 创建新的终端会话
  const createTerminalSession = useCallback((options?: {
    name?: string
    cwd?: string
    enableStreamForward?: boolean
    programPath?: string
  }) => {
    const sessionId = `terminal-${Date.now()}`
    const sessionName = options?.name || `终端 ${sessionsRef.current.length + 1}`
    
    // 计算初始终端大小
    const { cols, rows } = calculateTerminalSize()
    
    const terminal = new Terminal({
      cols: cols,
      rows: rows,
      theme: {
        background: '#1a1a1a',
        foreground: '#ffffff',
        cursor: '#ffffff',
        selectionBackground: '#ffffff30',
        black: '#000000',
        red: '#ff6b6b',
        green: '#51cf66',
        yellow: '#ffd43b',
        blue: '#74c0fc',
        magenta: '#f06292',
        cyan: '#4dd0e1',
        white: '#ffffff',
        brightBlack: '#666666',
        brightRed: '#ff8a80',
        brightGreen: '#69f0ae',
        brightYellow: '#ffff8d',
        brightBlue: '#82b1ff',
        brightMagenta: '#ff80ab',
        brightCyan: '#84ffff',
        brightWhite: '#ffffff'
      },
      fontFamily: 'JetBrains Mono, Fira Code, Consolas, Monaco, monospace',
      fontSize: isMobile ? 12 : 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: isMobile ? 500 : 1000,
      tabStopWidth: 4,
      allowTransparency: true,
      // 移动端优化
      disableStdin: false,
      convertEol: true
    })
    
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    
    // 监听终端输入
    terminal.onData((data) => {
      socketClient.sendTerminalInput(sessionId, data)
    })
    
    // 监听终端大小变化
    terminal.onResize(({ cols, rows }) => {
      if (socketClient.isConnected()) {
        socketClient.resizeTerminal(sessionId, cols, rows)
      }
    })
    
    const newSession: TerminalSession = {
      id: sessionId,
      name: sessionName,
      terminal,
      fitAddon,
      active: true
    }
    
    setSessions(prev => {
      const updated = prev.map(s => ({ ...s, active: false }))
      return [...updated, newSession]
    })

    setActiveSessionId(sessionId)

    // 延迟挂载终端到DOM，确保状态更新完成
    setTimeout(() => {
      if (terminalContainerRef.current && !newSession.terminal.element) {
        try {
          newSession.terminal.open(terminalContainerRef.current)
          // 确保终端获得焦点
          newSession.terminal.focus()
          // 调整终端大小
          setTimeout(() => {
            newSession.fitAddon.fit()
            // 再次确保焦点，防止在调整大小过程中丢失焦点
            newSession.terminal.focus()
          }, 50)
        } catch (error) {
          console.error('挂载新终端失败:', error)
        }
      }
    }, 100)
    
    // 请求创建PTY
    socketClient.createTerminal({
      sessionId: sessionId,
      name: sessionName,
      cols: cols,
      rows: rows,
      cwd: options?.cwd,
      enableStreamForward: options?.enableStreamForward,
      programPath: options?.programPath
    })

    addNotification({
      type: 'success',
      title: '终端创建成功',
      message: `已创建新的终端会话: ${sessionName}`
    })
  }, [addNotification])

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
  const closeTerminalSession = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId)
    if (!session) return
    
    // 清理终端
    session.terminal.dispose()
    
    // 通知后端关闭PTY
    socketClient.closeTerminal(sessionId)
    
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== sessionId)
      
      // 如果关闭的是当前活动会话，切换到其他会话
      if (sessionId === activeSessionId) {
        if (filtered.length > 0) {
          const newActive = filtered[filtered.length - 1]
          newActive.active = true
          setActiveSessionId(newActive.id)
        } else {
          setActiveSessionId(null)
        }
      }
      
      return filtered
    })
    
    addNotification({
      type: 'info',
      title: '终端已关闭',
      message: `终端会话 ${session.name} 已关闭`
    })
  }
  
  // 切换终端会话
  const switchTerminalSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const updated = prev.map(s => ({
        ...s,
        active: s.id === sessionId
      }))
      sessionsRef.current = updated
      return updated
    })
    setActiveSessionId(sessionId)
    
    // 延迟聚焦到切换的终端并调整大小
    setTimeout(() => {
      const session = sessionsRef.current.find(s => s.id === sessionId)
      if (session && session.terminal.element) {
        session.terminal.focus()
        
        // 在全屏模式下或容器大小可能变化时，调整终端大小
        if (terminalContainerRef.current) {
          try {
            // 重新计算理想的终端大小
            const { cols: targetCols, rows: targetRows } = calculateTerminalSize()
            
            // 先设置终端的目标大小
            session.terminal.resize(targetCols, targetRows)
            
            // 调整终端大小以适应容器
            session.fitAddon.fit()
            
            // 获取调整后的实际大小
            const { cols, rows } = session.terminal
            
            // 通知服务端新的大小
            if (cols && rows && socketClient.isConnected()) {
              console.log(`切换终端会话，终端 ${session.id} 大小调整为: ${cols}x${rows} (目标: ${targetCols}x${targetRows})`)
              socketClient.resizeTerminal(session.id, cols, rows)
            }
          } catch (error) {
            console.error(`切换终端会话时调整大小失败:`, error)
          }
        }
      }
    }, 100)
  }, [])

  const createAttachedTerminalSession = useCallback((sessionId: string, name: string): TerminalSession => {
    const { cols, rows } = calculateTerminalSize()
    const terminal = new Terminal({
      cols,
      rows,
      theme: {
        background: '#1a1a1a',
        foreground: '#ffffff',
        cursor: '#ffffff',
        selectionBackground: '#ffffff30',
        black: '#000000',
        red: '#ff6b6b',
        green: '#51cf66',
        yellow: '#ffd43b',
        blue: '#74c0fc',
        magenta: '#f06292',
        cyan: '#4dd0e1',
        white: '#ffffff',
        brightBlack: '#666666',
        brightRed: '#ff8a80',
        brightGreen: '#69f0ae',
        brightYellow: '#ffff8d',
        brightBlue: '#82b1ff',
        brightMagenta: '#ff80ab',
        brightCyan: '#84ffff',
        brightWhite: '#ffffff'
      },
      fontFamily: 'JetBrains Mono, Fira Code, Consolas, Monaco, monospace',
      fontSize: isMobile ? 12 : 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: isMobile ? 500 : 1000,
      tabStopWidth: 4,
      allowTransparency: true,
      disableStdin: false,
      convertEol: true
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)

    terminal.onData((data) => {
      socketClient.sendTerminalInput(sessionId, data)
    })

    terminal.onResize(({ cols, rows }) => {
      if (socketClient.isConnected()) {
        socketClient.resizeTerminal(sessionId, cols, rows)
      }
    })

    return {
      id: sessionId,
      name,
      terminal,
      fitAddon,
      active: true
    }
  }, [calculateTerminalSize, isMobile])

  const ensureTerminalSessionVisible = useCallback((sessionId: string, name: string) => {
    const existingSession = sessionsRef.current.find(s => s.id === sessionId)
    if (existingSession) {
      switchTerminalSession(sessionId)
      return
    }

    const attachedSession = createAttachedTerminalSession(sessionId, name)
    setSessions(prev => {
      const existingInState = prev.find(s => s.id === sessionId)
      const updated = existingInState
        ? prev.map(s => ({ ...s, active: s.id === sessionId }))
        : [...prev.map(s => ({ ...s, active: false })), attachedSession]
      sessionsRef.current = updated
      return updated
    })
    setActiveSessionId(sessionId)
  }, [createAttachedTerminalSession, switchTerminalSession])

  const reconnectTerminalSession = useCallback((sessionId: string) => {
    const reconnect = () => {
      socketClient.emit('reconnect-session', { sessionId })

      setTimeout(() => {
        const { cols, rows } = calculateTerminalSize()
        if (socketClient.isConnected()) {
          socketClient.resizeTerminal(sessionId, cols, rows)
        }
      }, 300)
    }

    if (socketClient.isConnected()) {
      reconnect()
    } else {
      socketClient.once('connect', reconnect)
    }
  }, [calculateTerminalSize])
  
  // 重命名终端会话
  const startRenaming = (sessionId: string, currentName: string) => {
    setEditingSessionId(sessionId)
    setEditingName(currentName)
  }
  
  const finishRenaming = async () => {
    if (editingSessionId && editingName.trim()) {
      const newName = editingName.trim()
      
      // 更新本地状态
      setSessions(prev => prev.map(s => 
        s.id === editingSessionId 
          ? { ...s, name: newName }
          : s
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
    const activeSession = sessions.find(s => s.id === activeSessionId)
    if (activeSession) {
      activeSession.terminal.reset()
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
      
      // 调整终端大小 - 增加延迟确保DOM完全更新
        setTimeout(() => {
          if (terminalContainerRef.current) {
            try {
              // 强制重新计算容器大小
              const container = terminalContainerRef.current
              
              // 强制浏览器重新计算布局
              container.offsetHeight
               
              const containerWidth = container.clientWidth || 800
              const containerHeight = container.clientHeight || 600
               
              console.log(`全屏切换后容器大小: ${containerWidth}x${containerHeight}, 全屏状态: ${!isFullscreen}`)
              
              // 重新计算理想的终端大小
              const { cols: targetCols, rows: targetRows } = calculateTerminalSize()
              
              // 遍历所有终端会话并调整大小
              sessions.forEach(session => {
                try {
                  // 先设置终端的目标大小
                  session.terminal.resize(targetCols, targetRows)
                  
                  // 然后调整终端大小以适应容器
                  session.fitAddon.fit()
                  
                  // 获取调整后的实际大小
                  const { cols, rows } = session.terminal
                  
                  // 通知服务端新的大小
                  if (cols && rows && socketClient.isConnected()) {
                    console.log(`全屏状态变化，终端 ${session.id} 大小调整为: ${cols}x${rows} (目标: ${targetCols}x${targetRows})`)
                    socketClient.resizeTerminal(session.id, cols, rows)
                  }
                } catch (error) {
                  console.error(`调整终端 ${session.id} 大小失败:`, error)
                }
              })
            } catch (error) {
              console.error('全屏状态变化时调整终端失败:', error)
            }
          }
        }, 800)
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
    const loadExistingSessions = async () => {
      try {
        const response = await apiClient.getTerminalSessions()
        if (response.success && response.data) {
          // 获取活跃会话和保存的会话
          const activeSessions = response.data.activeSessions || []
          const savedSessions = response.data.savedSessions || []
          
          // 创建活跃会话ID的Set，用于去重
          const activeSessionIds = new Set(activeSessions.map((s: any) => s.id))
          
          // 过滤掉已经在活跃会话中的保存会话，避免重复
          const uniqueSavedSessions = savedSessions.filter((s: any) => !activeSessionIds.has(s.id))
          
          // 合并去重后的会话列表，优先使用活跃会话
          const sessionData = [...activeSessions, ...uniqueSavedSessions]
          
          if (sessionData.length > 0) {
            
            // 在设置初始会话之前，检查URL参数
            const params = new URLSearchParams(window.location.search)
            const sessionIdFromUrl = params.get('sessionId')
            const initialActiveId = sessionIdFromUrl && sessionData.some(s => s.id === sessionIdFromUrl)
              ? sessionIdFromUrl
              : sessionData[0].id
          
            const { cols, rows } = calculateTerminalSize()
            
            const newSessions: TerminalSession[] = sessionData.map((session: any, index: number) => {
              const terminal = new Terminal({
                cols: cols,
                rows: rows,
                theme: {
                  background: '#1a1a1a',
                  foreground: '#ffffff',
                  cursor: '#ffffff',
                  selectionBackground: '#ffffff30',
                  black: '#000000',
                  red: '#ff6b6b',
                  green: '#51cf66',
                  yellow: '#ffd43b',
                  blue: '#74c0fc',
                  magenta: '#f06292',
                  cyan: '#4dd0e1',
                  white: '#ffffff',
                  brightBlack: '#666666',
                  brightRed: '#ff8a80',
                  brightGreen: '#69f0ae',
                  brightYellow: '#ffff8d',
                  brightBlue: '#82b1ff',
                  brightMagenta: '#ff80ab',
                  brightCyan: '#84ffff',
                  brightWhite: '#ffffff'
                },
                fontFamily: 'JetBrains Mono, Fira Code, Consolas, Monaco, monospace',
                fontSize: 14,
                lineHeight: 1.2,
                cursorBlink: true,
                cursorStyle: 'block',
                scrollback: 1000,
                tabStopWidth: 4,
                allowTransparency: true
              })

              const fitAddon = new FitAddon()
              const webLinksAddon = new WebLinksAddon()
              terminal.loadAddon(fitAddon)
              terminal.loadAddon(webLinksAddon)

              terminal.onData((data) => {
                socketClient.sendTerminalInput(session.id, data)
              })

              terminal.onResize(({ cols, rows }) => {
                if (socketClient.isConnected()) {
                  socketClient.resizeTerminal(session.id, cols, rows)
                }
              })

              return {
                id: session.id,
                name: session.name || `终端 ${index + 1}`,
                terminal,
                fitAddon,
                active: session.id === initialActiveId
              }
            })
          
            sessionsRef.current = newSessions
            setSessions(newSessions)
            setActiveSessionId(initialActiveId)
          
            addNotification({
              type: 'info',
              title: '发现现有会话',
              message: `找到 ${sessionData.length} 个现有终端会话，正在恢复...`
            })
          
            // 延迟重连
            setTimeout(() => {
              const attemptReconnect = () => {
                if (socketClient.isConnected()) {
                  newSessions.forEach(session => {
                    socketClient.emit('reconnect-session', { sessionId: session.id })
                    // 通知后端调整PTY大小以匹配前端终端
                    socketClient.resizeTerminal(session.id, cols, rows)
                  })
                } else {
                  const onConnect = () => {
                    newSessions.forEach(session => {
                      socketClient.emit('reconnect-session', { sessionId: session.id })
                      // 通知后端调整PTY大小以匹配前端终端
                      socketClient.resizeTerminal(session.id, cols, rows)
                    })
                    socketClient.off('connect', onConnect)
                  }
                  socketClient.on('connect', onConnect as () => void)
                }
              }
              
              attemptReconnect()
            }, 1000)
          }
        }
      } catch (error) {
        console.error('获取现有终端会话失败:', error)
        addNotification({
          type: 'error',
          title: '加载会话失败',
          message: '无法从服务器获取现有的终端会话。'
        })
      } finally {
        setSessionsLoaded(true)
      }
    }
    
    loadExistingSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])
  
  useEffect(() => {
    // 监听终端输出
    const handleTerminalOutput = ({ sessionId, data, isHistorical }: { sessionId: string; data: string; isHistorical?: boolean }) => {
      const session = sessionsRef.current.find(s => s.id === sessionId)
      if (session) {
        // 如果是历史输出，先清空终端再写入，避免重复显示
        if (isHistorical) {
          session.terminal.clear()
        }
        session.terminal.write(data)
      }
    }
    
    // 监听终端创建成功
    const handleTerminalCreated = ({ sessionId, name }: { sessionId: string; name: string }) => {
      console.log(`终端创建成功: ${sessionId} - ${name}`)
    }
    
    // 监听终端关闭
    const handleTerminalClosed = ({ sessionId }: { sessionId: string }) => {
      console.log(`终端已关闭: ${sessionId}`)
    }
    
    // 监听会话重连成功
    const handleSessionReconnected = ({ sessionId }: { sessionId: string }) => {
      console.log(`会话重连成功: ${sessionId}`)
    }
    
    // 监听会话重连失败
    const handleSessionReconnectFailed = ({ sessionId }: { sessionId: string }) => {
      console.log(`会话重连失败: ${sessionId}`)
      addNotification({
        type: 'error',
        title: '会话重连失败',
        message: `终端会话 ${sessionId} 重连失败，可能已过期`
      })
    }
    
    // 监听终端大小调整完成
    const handleTerminalResized = ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      console.log(`终端大小调整完成: ${sessionId}, ${cols}x${rows}`)
      const session = sessionsRef.current.find(s => s.id === sessionId)
      if (session) {
        // 确保前端终端的大小与服务端同步
        setTimeout(() => {
          try {
            session.fitAddon.fit()
          } catch (error) {
            console.error('同步终端大小失败:', error)
          }
        }, 100)
      }
    }
    
    socketClient.on('terminal-output', handleTerminalOutput)
    socketClient.on('terminal-created', handleTerminalCreated)
    socketClient.on('terminal-closed', handleTerminalClosed)
    socketClient.on('session-reconnected', handleSessionReconnected)
    socketClient.on('session-reconnect-failed', handleSessionReconnectFailed)
    socketClient.on('terminal-resized', handleTerminalResized)
    
    return () => {
      socketClient.off('terminal-output', handleTerminalOutput)
      socketClient.off('terminal-created', handleTerminalCreated)
      socketClient.off('terminal-closed', handleTerminalClosed)
      socketClient.off('session-reconnected', handleSessionReconnected)
      socketClient.off('session-reconnect-failed', handleSessionReconnectFailed)
      socketClient.off('terminal-resized', handleTerminalResized)
    }
  }, []) // 移除addNotification依赖，避免重复注册事件监听器
  
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
      const targetSession = sessionsRef.current.find(s => s.id === sessionId)
      
      if (targetSession) {
        // 如果找到对应的会话，切换到该会话
        switchTerminalSession(targetSession.id)
        reconnectTerminalSession(targetSession.id)
        
        // 延迟调整终端大小，确保切换完成
        setTimeout(() => {
          const { cols, rows } = calculateTerminalSize()
          if (socketClient.isConnected()) {
            console.log(`切换到实例终端，调整大小为: ${cols}x${rows}`)
            socketClient.resizeTerminal(targetSession.id, cols, rows)
          }
        }, 800)
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
      const instanceSession = sessionsRef.current.find(s => 
        s.name.includes(instanceId) || s.id.includes(instanceId)
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
        setTimeout(() => {
          const delayedSession = sessionsRef.current.find(s => 
            s.name.includes(instanceId) || s.id.includes(instanceId)
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
      setTimeout(() => {
        createTerminalSession({ cwd })
        
        // 确保新创建的终端获得焦点，延迟时间更长
        setTimeout(() => {
          const activeSession = sessionsRef.current.find(s => s.active)
          if (activeSession && activeSession.terminal.element) {
            activeSession.terminal.focus()
          }
        }, 500)
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
    calculateTerminalSize,
    addNotification
  ])

  // 当活动会话改变时，挂载终端到DOM
  useEffect(() => {
    const activeSession = sessions.find(s => s.id === activeSessionId)
    if (activeSession && terminalContainerRef.current) {
      const container = terminalContainerRef.current

      // 清空容器
      while (container.firstChild) {
        container.removeChild(container.firstChild)
      }

      try {
        // 检查终端是否已经挂载到DOM
        if (!activeSession.terminal.element) {
          // 如果终端还没有挂载，则挂载到容器
          activeSession.terminal.open(container)
        } else {
          // 如果终端已经挂载，则将其移动到当前容器
          container.appendChild(activeSession.terminal.element)
        }

        // 确保终端获得焦点
        activeSession.terminal.focus()

        // 延迟调整大小，确保DOM更新完成
        setTimeout(() => {
          try {
            // 先调整大小
            activeSession.fitAddon.fit()
            
            // 获取调整后的实际大小
            const { cols, rows } = activeSession.terminal
            
            // 通知服务端当前的终端大小，确保前后端同步
            if (cols && rows && socketClient.isConnected()) {
              console.log(`终端大小已调整为: ${cols}x${rows}`)
              socketClient.resizeTerminal(activeSession.id, cols, rows)
            }
            
            // 在调整大小后再次确保焦点
            activeSession.terminal.focus()
          } catch (error) {
            console.error('调整终端大小失败:', error)
          }
        }, 100)
        
        // 额外的焦点确保机制
        setTimeout(() => {
          if (activeSession.terminal.element) {
            activeSession.terminal.focus()
          }
        }, 200)
      } catch (error) {
        console.error('挂载终端失败:', error)
      }
    }
  }, [activeSessionId, sessions])
  
  useEffect(() => {
    // 窗口大小变化时调整终端大小
    const handleResize = () => {
      const activeSession = sessions.find(s => s.id === activeSessionId)
      if (activeSession) {
        setTimeout(() => {
          try {
            // 重新计算理想的终端大小
            const { cols: targetCols, rows: targetRows } = calculateTerminalSize()
            
            // 先设置终端的目标大小
            activeSession.terminal.resize(targetCols, targetRows)
            
            // 调整终端大小以适应容器
            activeSession.fitAddon.fit()
            
            // 获取调整后的实际大小
            const { cols, rows } = activeSession.terminal
            
            // 通知服务端新的大小
            if (cols && rows && socketClient.isConnected()) {
              console.log(`窗口大小变化，终端大小调整为: ${cols}x${rows} (目标: ${targetCols}x${targetRows})`)
              socketClient.resizeTerminal(activeSession.id, cols, rows)
            }
          } catch (error) {
            console.error('窗口大小变化时调整终端失败:', error)
          }
        }, 100)
      }
    }
    
    // 监听全屏状态变化
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
        
        // 调整所有终端大小 - 增加延迟确保DOM完全更新
        setTimeout(() => {
          if (terminalContainerRef.current) {
            try {
              // 强制重新计算容器大小
              const container = terminalContainerRef.current
              
              // 清除所有内联样式，让CSS类控制布局
              container.style.width = ''
              container.style.height = ''
              container.style.maxWidth = ''
              
              // 强制浏览器重新计算布局
              container.offsetHeight
              
              const containerWidth = container.clientWidth || 800
              const containerHeight = container.clientHeight || 600
              
              console.log(`全屏模式切换后容器大小: ${containerWidth}x${containerHeight}, 全屏状态: ${isCurrentlyFullscreen}`)
              
              // 重新计算理想的终端大小
              const { cols: targetCols, rows: targetRows } = calculateTerminalSize()
              
              // 调整所有终端的大小，不仅仅是当前活动的
              sessions.forEach(session => {
                try {
                  // 先设置终端的目标大小
                  session.terminal.resize(targetCols, targetRows)
                  
                  // 调整终端大小以适应新的容器
                  session.fitAddon.fit()
                  
                  // 获取调整后的实际大小
                  const { cols, rows } = session.terminal
                  
                  // 通知服务端新的大小
                  if (cols && rows && socketClient.isConnected()) {
                    console.log(`终端 ${session.id} 大小调整为: ${cols}x${rows} (目标: ${targetCols}x${targetRows})`)
                    socketClient.resizeTerminal(session.id, cols, rows)
                  }
                } catch (error) {
                  console.error(`调整终端 ${session.id} 大小失败:`, error)
                }
              })
            } catch (error) {
              console.error('全屏模式切换时调整终端大小失败:', error)
            }
          }
        }, 300)
      }
    }
    
    window.addEventListener('resize', handleResize)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    
    return () => {
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [activeSessionId, sessions, isFullscreen, addNotification])
  
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
                        ${session.active
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
                        ${session.active
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
                      {sessions.find(s => s.active)?.name || '终端'}
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
                ref={terminalContainerRef}
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
                    ${session.active
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
                    ${session.active
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
                    {sessions.find(s => s.active)?.name || '终端'}
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
              ref={terminalContainerRef}
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
