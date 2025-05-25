import axios from 'axios';
import { GameInfo, InstallEventData } from './types';

// 当通过外部IP访问时，动态获取当前域名和端口作为API基础URL
const getApiBaseUrl = () => {
  // 如果是相对路径（通过同一服务器访问），使用相对路径
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return '/api';
  }
  // 否则使用完整的URL（通过外部IP访问）
  return `${window.location.protocol}//${window.location.host}/api`;
};

const API_BASE_URL = getApiBaseUrl();

// 创建axios实例
const api = axios.create({
  baseURL: API_BASE_URL,
});

// 添加请求拦截器，自动添加身份验证令牌
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 添加响应拦截器，处理未授权错误
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // 如果是401未授权错误，重定向到登录页面
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('username');
      
      // 延迟跳转，避免循环重定向
      if (!window.location.pathname.includes('/login')) {
        setTimeout(() => {
          window.location.href = '/login';
        }, 500);
      }
    }
    
    return Promise.reject(error);
  }
);

export const fetchGames = async (): Promise<GameInfo[]> => {
  try {
    // 修正API响应类型
    interface GamesResponse {
      status: 'success' | 'error';
      games: GameInfo[];
      message?: string;
    }
    
    const response = await api.get<GamesResponse>('/games');
    
    if (response.data.status === 'success' && response.data.games) {
      // 获取所有游戏列表
      const games = response.data.games;
      
      // 使用批量检查API检查所有游戏的安装状态
      if (games.length > 0) {
        try {
          const gameIds = games.map(game => game.id);
          const batchResponse = await api.post('/batch_check_installation', {
            game_ids: gameIds
          });
          
          if (batchResponse.data.status === 'success') {
            const installations = batchResponse.data.installations;
            // 更新每个游戏的安装状态
            games.forEach(game => {
              game.installed = installations[game.id] || false;
            });
          }
        } catch (error) {
          console.error('批量检查游戏安装状态失败:', error);
          // 如果批量检查失败，所有游戏都设为未安装
          games.forEach(game => {
            game.installed = false;
          });
        }
      }
      
      return games;
    } else {
      throw new Error(response.data.message || '获取游戏列表失败');
    }
  } catch (error) {
    // console.error('Error fetching games:', error);
    throw error;
  }
};

// 批量检查游戏安装状态
export const batchCheckInstallation = async (gameIds: string[]): Promise<Record<string, boolean>> => {
  try {
    const response = await api.post('/batch_check_installation', {
      game_ids: gameIds
    });
    
    if (response.data.status === 'success') {
      return response.data.installations;
    } else {
      throw new Error(response.data.message || '批量检查安装状态失败');
    }
  } catch (error) {
    console.error('批量检查游戏安装状态失败:', error);
    throw error;
  }
};

// 检查单个游戏的安装状态 (保留原有函数以兼容旧代码)
export const checkInstallation = async (gameId: string): Promise<boolean> => {
  try {
    const response = await api.get(`/check_installation?game_id=${gameId}`);
    
    if (response.data.status === 'success') {
      return response.data.installed;
    } else {
      throw new Error(response.data.message || '检查安装状态失败');
    }
  } catch (error) {
    console.error(`检查游戏 ${gameId} 安装状态失败:`, error);
    return false;
  }
};

export const installGame = async (
  gameId: string,
  onOutput: (line: string | { prompt: string }) => void,
  onComplete: () => void,
  onError: (error: string) => void,
  account?: string,
  password?: string
): Promise<EventSource | null> => {
  try {
    // 1. 先请求安装
    const installResp = await api.post('/install', {
      game_id: gameId,
      ...(account ? { account } : {}),
      ...(password ? { password } : {})
    });
    if (installResp.data.status !== 'success') {
      onError(installResp.data.message || '安装请求失败');
      return null;
    }
    
    // 获取身份验证令牌
    const token = localStorage.getItem('auth_token');
    
    // 2. 再连接SSE
    const sseUrl = `${API_BASE_URL}/install_stream?game_id=${gameId}${token ? `&token=${token}` : ''}`;
    const eventSource = new EventSource(sseUrl);
    eventSource.onmessage = (event) => {
      try {
        const data: InstallEventData = JSON.parse(event.data);
        if (data.line) {
          onOutput(data.line);
        }
        if (data.prompt) {
          onOutput({ prompt: data.prompt });
        }
        if (data.complete) {
          eventSource.close();
          if (data.status === 'success') {
            onComplete();
          } else {
            onError(data.message || '安装过程发生错误');
          }
        }
      } catch (error) {
        // console.error('Error parsing SSE data:', error);
        onOutput(`解析安装输出错误: ${error}`);
      }
    };
    eventSource.onerror = () => {
      eventSource.close();
      onError('与服务器的连接中断');
    };
    return eventSource;
  } catch (error: any) {
    onError(error?.message || '安装请求失败');
    return null;
  }
};

// 终止游戏安装
export const terminateInstall = async (gameId: string): Promise<boolean> => {
  try {
    // 确保使用正确的API路径
    const response = await api.post('/terminate_install', {
      game_id: gameId
    });
    
    return response.data.status === 'success';
  } catch (error) {
    // console.error('Error terminating installation:', error);
    throw error;
  }
};

// 通过AppID安装游戏
export const installByAppId = async (
  appId: string,
  name: string,
  anonymous: boolean,
  onOutput: (line: string | { prompt: string }) => void,
  onComplete: () => void,
  onError: (error: string) => void,
  account?: string,
  password?: string
): Promise<EventSource | null> => {
  try {
    // 1. 先请求安装
    const installResp = await api.post('/install_by_appid', {
      appid: appId,
      name: name,
      anonymous: anonymous,
      ...(account ? { account } : {}),
      ...(password ? { password } : {})
    });
    
    if (installResp.data.status !== 'success') {
      onError(installResp.data.message || '安装请求失败');
      return null;
    }
    
    // 获取身份验证令牌
    const token = localStorage.getItem('auth_token');
    
    // 2. 再连接SSE，使用生成的game_id
    const gameId = `app_${appId}`;
    const sseUrl = `${API_BASE_URL}/install_stream?game_id=${gameId}${token ? `&token=${token}` : ''}`;
    const eventSource = new EventSource(sseUrl);
    
    eventSource.onmessage = (event) => {
      try {
        const data: InstallEventData = JSON.parse(event.data);
        if (data.line) {
          onOutput(data.line);
        }
        if (data.prompt) {
          onOutput({ prompt: data.prompt });
        }
        if (data.complete) {
          eventSource.close();
          if (data.status === 'success') {
            onComplete();
          } else {
            onError(data.message || '安装过程发生错误');
          }
        }
      } catch (error) {
        // console.error('Error parsing SSE data:', error);
        onOutput(`解析安装输出错误: ${error}`);
      }
    };
    
    eventSource.onerror = () => {
      eventSource.close();
      onError('与服务器的连接中断');
    };
    
    return eventSource;
  } catch (error: any) {
    onError(error?.message || '安装请求失败');
    return null;
  }
};

// 打开游戏文件夹
export const openGameFolder = async (gameId: string): Promise<boolean> => {
  try {
    const response = await api.post('/open_game_folder', {
      game_id: gameId
    });
    
    return response.data.status === 'success';
  } catch (error) {
    return false;
  }
}; 