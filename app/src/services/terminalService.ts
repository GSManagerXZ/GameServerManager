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
        // 先检查服务器状态
        try {
          const statusCheck = await axios.get(`/api/server/status?game_id=${gameId}`);
          if (statusCheck.data.server_status !== 'running') {
            message.error('服务器未运行，无法发送命令');
            return false;
          }
        } catch (statusError) {
          console.error('检查服务器状态失败:', statusError);
          message.error('无法确认服务器状态，请刷新页面后重试');
          return false;
        }
        
        // 发送命令
        const response = await axios.post('/api/server/send_input', { game_id: gameId, value });
        return response.data.status === 'success';
      } catch (error: any) {
        if (error.response && error.response.status === 400) {
          message.error('服务器未运行或已停止，请重新启动服务器');
        } else {
          message.error('发送输入失败: ' + (error.message || '未知错误'));
        }
        console.error('发送服务器命令失败:', error);
        return false;
      }
    },
    terminate: async (gameId: string, force: boolean = false) => {
      try {
        const response = await axios.post('/api/server/stop', { game_id: gameId, force });
        
        // 增加对警告状态的处理
        if (response.data.status === 'warning') {
          message.warning(response.data.message || '服务器可能未完全停止');
          
          // 如果不是强制模式，提示用户是否要强制停止
          if (!force) {
            if (window.confirm('服务器未完全停止，是否尝试强制停止？')) {
              // 递归调用，使用强制模式
              return await terminalHandlers.server.terminate(gameId, true);
            }
          }
          // 即使有警告，也返回成功，因为服务器已标记为停止
          return true;
        }
        
        // 停止后验证服务器状态
        try {
          const statusCheck = await axios.get(`/api/server/status?game_id=${gameId}`);
          if (statusCheck.data.server_status === 'running') {
            message.warning('服务器仍在运行，尝试强制停止');
            // 如果仍在运行且不是强制模式，使用强制模式再次尝试
            if (!force) {
              return await terminalHandlers.server.terminate(gameId, true);
            }
          }
        } catch (statusError) {
          console.error('检查服务器状态失败:', statusError);
        }
        
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