import { create } from 'zustand'
import socketClient from '@/utils/socket'

interface ConsoleLogStore {
    // 状态
    lines: string[]
    isConnected: boolean
    mode: 'console' | 'file'
    selectedFile: string
    isLoading: boolean

    // Actions
    setMode: (mode: 'console' | 'file') => void
    setSelectedFile: (file: string) => void
    connect: () => void
    disconnect: () => void
    clearLogs: () => void
    loadFileContent: () => Promise<void>

    // 内部方法
    addLog: (line: string) => void
    setLogs: (lines: string[]) => void
    setupSocketListeners: () => void
    cleanupSocketListeners: () => void
}

// 保存事件处理函数引用，用于清理
let historyHandler: ((data: { lines: string[] }) => void) | null = null
let logHandler: ((data: { line: string }) => void) | null = null

export const useConsoleLogStore = create<ConsoleLogStore>((set, get) => ({
    lines: [],
    isConnected: false,
    mode: 'console',
    selectedFile: '',
    isLoading: false,

    setMode: (mode) => {
        const state = get()
        // 如果正在连接，先断开
        if (state.isConnected) {
            state.disconnect()
        }
        set({ mode, lines: [] })
    },

    setSelectedFile: (file) => {
        set({ selectedFile: file, lines: [] })
    },

    connect: () => {
        const state = get()

        if (state.mode === 'console') {
            // 实时终端模式：使用 WebSocket
            state.setupSocketListeners()
            socketClient.subscribeConsoleLogs()
            set({ isConnected: true })
        }
        // 日志文件模式不需要 connect，只需要 loadFileContent
    },

    disconnect: () => {
        const state = get()

        if (state.mode === 'console') {
            // 取消 WebSocket 订阅
            socketClient.unsubscribeConsoleLogs()
            state.cleanupSocketListeners()
        }

        set({ isConnected: false })
    },

    // 加载日志文件内容（一次性加载，不监控）
    loadFileContent: async () => {
        const state = get()

        if (!state.selectedFile) {
            console.warn('未选择日志文件')
            return
        }

        set({ isLoading: true })

        try {
            const token = localStorage.getItem('gsm3_token')
            const response = await fetch(`/api/system/logs/${state.selectedFile}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })

            if (!response.ok) {
                throw new Error('加载日志文件失败')
            }

            const result = await response.json()
            if (result.success && result.data) {
                // API 返回的 data.lines 已经是按行分割的数组
                set({ lines: result.data.lines || [] })
            }
        } catch (error) {
            console.error('加载日志文件失败:', error)
        } finally {
            set({ isLoading: false })
        }
    },

    clearLogs: () => {
        set({ lines: [] })
    },

    addLog: (line) => {
        const state = get()
        const newLines = [...state.lines, line]
        set({ lines: newLines.slice(-500) })
    },

    setLogs: (lines) => {
        set({ lines })
    },

    setupSocketListeners: () => {
        const state = get()

        // 清理之前的监听器
        state.cleanupSocketListeners()

        // 历史日志处理
        historyHandler = (data: { lines: string[] }) => {
            set({ lines: data.lines || [] })
        }

        // 新日志处理
        logHandler = (data: { line: string }) => {
            const currentState = get()
            const newLines = [...currentState.lines, data.line]
            set({ lines: newLines.slice(-500) })
        }

        socketClient.on('console-logs-history', historyHandler)
        socketClient.on('console-log', logHandler)
    },

    cleanupSocketListeners: () => {
        if (historyHandler) {
            socketClient.off('console-logs-history', historyHandler)
            historyHandler = null
        }
        if (logHandler) {
            socketClient.off('console-log', logHandler)
            logHandler = null
        }
    }
}))
