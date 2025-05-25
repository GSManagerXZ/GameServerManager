import { useState, useEffect, useCallback, useRef } from 'react';
import { useTerminalManager } from '../components/TerminalManager';
import terminalService, { TerminalType } from '../services/terminalService';

// 终端Hook配置
interface UseTerminalOptions {
  id: string;
  type: TerminalType;
  title?: string;
  autoConnect?: boolean;
  allowInput?: boolean;
}

// 终端Hook返回值
interface UseTerminalReturn {
  output: (string | { prompt?: string; line?: string })[];
  loading: boolean;
  complete: boolean;
  connect: (restart?: boolean) => void;
  disconnect: () => void;
  sendInput: (value: string) => Promise<boolean>;
  terminate: (force?: boolean) => Promise<boolean>;
  clear: () => void;
}

// 终端Hook
const useTerminal = (options: UseTerminalOptions): UseTerminalReturn => {
  const { id, type, title, autoConnect = false, allowInput = true } = options;
  const { addTerminal, updateTerminal, removeTerminal, clearTerminalOutput, getTerminal } = useTerminalManager();
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  
  // 初始化终端
  useEffect(() => {
    // 创建终端
    addTerminal({
      id,
      type,
      title,
      output: [],
      loading: false,
      complete: false,
      allowInput,
      onSendInput: (terminalId, value) => terminalService.sendInput(type, terminalId, value),
      onTerminate: (terminalId) => terminalService.terminateProcess(type, terminalId)
    });
    
    // 自动连接
    if (autoConnect) {
      connect();
    }
    
    // 清理函数
    return () => {
      disconnect();
      removeTerminal(id);
    };
  }, [id, type, title, autoConnect, allowInput]);
  
  // 连接终端
  const connect = useCallback((restart: boolean = false) => {
    if (connected || eventSourceRef.current) return;
    
    // 更新状态
    updateTerminal(id, { loading: true });
    
    // 处理消息
    const handleMessage = (data: any) => {
      if (data.line) {
        updateTerminal(id, {
          output: [...(getTerminal(id)?.output || []), { line: data.line }]
        });
      } else if (data.prompt) {
        updateTerminal(id, {
          output: [...(getTerminal(id)?.output || []), { prompt: data.prompt }]
        });
      } else if (typeof data === 'string') {
        updateTerminal(id, {
          output: [...(getTerminal(id)?.output || []), data]
        });
      }
      
      // 处理完成状态
      if (data.complete) {
        updateTerminal(id, {
          loading: false,
          complete: true
        });
        disconnect();
      }
    };
    
    // 处理错误
    const handleError = (errorMsg?: string) => {
      const errorMessage = errorMsg || '连接已断开，请刷新页面重试';
      
      updateTerminal(id, {
        loading: false,
        output: [...(getTerminal(id)?.output || []), errorMessage]
      });
      
      // 如果是404错误（服务器已停止），标记为已完成
      if (errorMsg && errorMsg.includes('服务器已停止')) {
        updateTerminal(id, {
          complete: true
        });
      }
      
      setConnected(false);
    };
    
    // 处理完成
    const handleComplete = () => {
      updateTerminal(id, {
        loading: false,
        complete: true
      });
      setConnected(false);
    };
    
    // 创建事件源
    try {
      if (type === 'install') {
        eventSourceRef.current = terminalService.createInstallStream(
          id,
          handleMessage,
          handleError,
          handleComplete
        );
      } else if (type === 'server') {
        eventSourceRef.current = terminalService.createServerStream(
          id,
          handleMessage,
          handleError,
          handleComplete,
          restart
        );
      } else {
        console.warn('不支持的终端类型:', type);
        return;
      }
      
      setConnected(true);
    } catch (error) {
      console.error('创建终端连接失败:', error);
      updateTerminal(id, {
        loading: false,
        output: [...(getTerminal(id)?.output || []), '创建终端连接失败']
      });
    }
  }, [id, type, connected]);
  
  // 断开连接
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      console.log(`关闭终端 ${id} 的SSE连接`);
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnected(false);
  }, [id]);
  
  // 组件卸载时确保断开连接
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);
  
  // 发送输入
  const sendInput = useCallback(async (value: string) => {
    return terminalService.sendInput(type, id, value);
  }, [id, type]);
  
  // 终止进程
  const terminate = useCallback(async (force: boolean = false) => {
    const result = await terminalService.terminateProcess(type, id, force);
    if (result) {
      updateTerminal(id, {
        loading: false,
        complete: true
      });
      disconnect();
    }
    return result;
  }, [id, type]);
  
  // 清空输出
  const clear = useCallback(() => {
    clearTerminalOutput(id);
  }, [id, clearTerminalOutput]);
  
  // 获取终端数据
  const terminal = getTerminal(id) || {
    output: [],
    loading: false,
    complete: false
  };
  
  return {
    output: terminal.output,
    loading: terminal.loading,
    complete: terminal.complete,
    connect,
    disconnect,
    sendInput,
    terminate,
    clear
  };
};

export default useTerminal; 