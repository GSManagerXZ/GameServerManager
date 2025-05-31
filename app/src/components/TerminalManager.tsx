import React, { createContext, useContext, useState, useCallback } from 'react';
import Terminal from './Terminal';

// 定义终端类型
export type TerminalType = 'install' | 'server' | 'custom';

// 定义终端数据接口
export interface TerminalData {
  id: string;
  type: TerminalType;
  output: (string | { prompt?: string; line?: string })[];
  loading: boolean;
  complete: boolean;
  title?: string;
  onSendInput?: (id: string, value: string) => void;
  allowInput?: boolean;
  onTerminate?: (id: string) => void;
}

// 定义终端管理器上下文接口
interface TerminalManagerContextType {
  terminals: Record<string, TerminalData>;
  addTerminal: (terminal: TerminalData) => void;
  updateTerminal: (id: string, data: Partial<TerminalData>) => void;
  removeTerminal: (id: string) => void;
  addTerminalOutput: (id: string, output: string | { prompt?: string; line?: string }) => void;
  clearTerminalOutput: (id: string) => void;
  getTerminal: (id: string) => TerminalData | undefined;
}

// 创建终端管理器上下文
const TerminalManagerContext = createContext<TerminalManagerContextType | null>(null);

// 终端管理器提供者组件
export const TerminalManagerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [terminals, setTerminals] = useState<Record<string, TerminalData>>({});

  // 添加终端
  const addTerminal = useCallback((terminal: TerminalData) => {
    setTerminals(prev => ({
      ...prev,
      [terminal.id]: terminal
    }));
  }, []);

  // 更新终端
  const updateTerminal = useCallback((id: string, data: Partial<TerminalData>) => {
    setTerminals(prev => {
      if (!prev[id]) return prev;
      return {
        ...prev,
        [id]: {
          ...prev[id],
          ...data
        }
      };
    });
  }, []);

  // 移除终端
  const removeTerminal = useCallback((id: string) => {
    setTerminals(prev => {
      const newTerminals = { ...prev };
      delete newTerminals[id];
      return newTerminals;
    });
  }, []);

  // 添加终端输出
  const addTerminalOutput = useCallback((id: string, output: string | { prompt?: string; line?: string }) => {
    setTerminals(prev => {
      if (!prev[id]) return prev;
      return {
        ...prev,
        [id]: {
          ...prev[id],
          output: [...prev[id].output, output]
        }
      };
    });
  }, []);

  // 清空终端输出
  const clearTerminalOutput = useCallback((id: string) => {
    setTerminals(prev => {
      if (!prev[id]) return prev;
      return {
        ...prev,
        [id]: {
          ...prev[id],
          output: []
        }
      };
    });
  }, []);

  // 获取终端
  const getTerminal = useCallback((id: string) => {
    return terminals[id];
  }, [terminals]);

  const value = {
    terminals,
    addTerminal,
    updateTerminal,
    removeTerminal,
    addTerminalOutput,
    clearTerminalOutput,
    getTerminal
  };

  return (
    <TerminalManagerContext.Provider value={value}>
      {children}
    </TerminalManagerContext.Provider>
  );
};

// 终端管理器Hook
export const useTerminalManager = () => {
  const context = useContext(TerminalManagerContext);
  if (!context) {
    throw new Error('useTerminalManager must be used within a TerminalManagerProvider');
  }
  return context;
};

// 终端渲染组件
export const TerminalRenderer: React.FC<{
  terminalId: string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ terminalId, className, style }) => {
  const { getTerminal } = useTerminalManager();
  const terminal = getTerminal(terminalId);

  if (!terminal) {
    return <div className="terminal-error">终端不存在</div>;
  }

  return (
    <div className={className} style={style}>
      <Terminal
        output={terminal.output}
        loading={terminal.loading}
        complete={terminal.complete}
        gameId={terminal.id}
        onSendInput={terminal.onSendInput}
        allowInput={terminal.allowInput}
        onTerminate={terminal.onTerminate}
      />
    </div>
  );
};

export default TerminalManagerProvider;