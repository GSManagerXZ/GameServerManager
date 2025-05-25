import axios from 'axios';
import { message } from 'antd';

// 终端类型
export type TerminalType = 'install' | 'server' | 'custom';

// 终端输入处理器接口
export interface TerminalInputHandler {
  send: (id: string, value: string) => Promise<boolean>;
  terminate: (id: string, force?: boolean) => Promise<boolean>;
}

// 终端处理器映射
const terminalHandlers: Record<TerminalType, TerminalInputHandler> = {
  // 安装终端处理器
  install: {
    send: async (gameId: string, value: string) => {
      try {
        const response = await axios.post('/api/send_input', { game_id: gameId, value });
        return response.data.status === 'success';
      } catch (error) {
        message.error('发送输入失败');
        return false;
      }
    },
    terminate: async (gameId: string) => {
      try {
        // 获取认证令牌
        const token = localStorage.getItem('auth_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        
        const response = await axios.post('/api/terminate_install', 
          { game_id: gameId },
          { headers }
        );
        return response.data.status === 'success';
      } catch (error) {
        message.error('终止安装失败');
        return false;
      }
    }
  },
  
  // 服务器终端处理器
  server: {
    send: async (gameId: string, value: string) => {
      try {
        const response = await axios.post('/api/server/send_input', { game_id: gameId, value });
        return response.data.status === 'success';
      } catch (error) {
        message.error('发送输入失败');
        return false;
      }
    },
    terminate: async (gameId: string, force: boolean = false) => {
      try {
        const response = await axios.post('/api/server/stop', { game_id: gameId, force });
        return response.data.status === 'success';
      } catch (error) {
        message.error('停止服务器失败');
        return false;
      }
    }
  },
  
  // 自定义终端处理器 (可扩展)
  custom: {
    send: async (id: string, value: string) => {
      return false;
    },
    terminate: async (id: string) => {
      return false;
    }
  }
};

// 终端事件源处理
export const createTerminalEventSource = (
  url: string,
  onMessage: (data: any) => void,
  onError: (error?: string) => void,
  onComplete?: () => void
): EventSource => {
  const eventSource = new EventSource(url);
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
      
      // 检查是否完成
      if (data.complete && onComplete) {
        onComplete();
        eventSource.close();
      }
    } catch (error) {
      eventSource.close();
      onError(`解析数据失败: ${error}`);
    }
  };
  
  eventSource.onerror = (event) => {
    eventSource.close();
    
    // 检查是否为404错误（服务器已停止）
    if ((event as any).target && (event as any).target.status === 404) {
      onError('服务器已停止或不存在，连接已关闭');
    } else {
      onError('连接已断开，可能是服务器已停止或网络问题');
    }
  };
  
  return eventSource;
};

// 终端服务
const terminalService = {
  // 获取指定类型的终端处理器
  getHandler(type: TerminalType): TerminalInputHandler {
    return terminalHandlers[type] || terminalHandlers.custom;
  },
  
  // 发送输入到终端
  async sendInput(type: TerminalType, id: string, value: string): Promise<boolean> {
    const handler = this.getHandler(type);
    return handler.send(id, value);
  },
  
  // 终止终端进程
  async terminateProcess(type: TerminalType, id: string, force: boolean = false): Promise<boolean> {
    const handler = this.getHandler(type);
    return handler.terminate(id, force);
  },
  
  // 创建安装流事件源
  createInstallStream(gameId: string, onMessage: (data: any) => void, onError: () => void, onComplete?: () => void): EventSource {
    return createTerminalEventSource(
      `/api/install_stream?game_id=${gameId}`,
      onMessage,
      onError,
      onComplete
    );
  },
  
  // 创建服务器流事件源
  createServerStream(gameId: string, onMessage: (data: any) => void, onError: (error?: string) => void, onComplete?: () => void, restart: boolean = false): EventSource {
    const url = `/api/server/stream?game_id=${gameId}${restart ? '&restart=true' : ''}`;
    return createTerminalEventSource(
      url,
      onMessage,
      onError,
      onComplete
    );
  },
  
  // 注册自定义终端处理器
  registerCustomHandler(type: string, handler: TerminalInputHandler): void {
    (terminalHandlers as any)[type] = handler;
  }
};

export default terminalService; 