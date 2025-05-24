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

export const fetchGames = async (): Promise<GameInfo[]> => {
  try {
    // 修正API响应类型
    interface GamesResponse {
      status: 'success' | 'error';
      games: GameInfo[];
      message?: string;
    }
    
    const response = await axios.get<GamesResponse>(`${API_BASE_URL}/games`);
    
    if (response.data.status === 'success' && response.data.games) {
      // 检查每个游戏的安装状态
      const games = response.data.games;
      
      // 并行检查所有游戏的安装状态
      const gameStatusPromises = games.map(async (game: GameInfo) => {
        try {
          const statusResponse = await axios.get(`${API_BASE_URL}/check_installation?game_id=${game.id}`);
          if (statusResponse.data.status === 'success') {
            game.installed = statusResponse.data.installed;
          }
        } catch (error) {
          console.error(`Failed to check installation status for ${game.id}:`, error);
          game.installed = false;
        }
        return game;
      });
      
      return Promise.all(gameStatusPromises);
    } else {
      throw new Error(response.data.message || '获取游戏列表失败');
    }
  } catch (error) {
    console.error('Error fetching games:', error);
    throw error;
  }
};

export const installGame = async (
  gameId: string,
  onOutput: (line: string) => void,
  onComplete: () => void,
  onError: (error: string) => void,
  account?: string,
  password?: string
): Promise<EventSource | null> => {
  try {
    // 1. 先请求安装
    const installResp = await axios.post(`${API_BASE_URL}/install`, {
      game_id: gameId,
      ...(account ? { account } : {}),
      ...(password ? { password } : {})
    });
    if (installResp.data.status !== 'success') {
      onError(installResp.data.message || '安装请求失败');
      return null;
    }
    // 2. 再连接SSE
    const sseUrl = `${API_BASE_URL}/install_stream?game_id=${gameId}`;
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
        console.error('Error parsing SSE data:', error);
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
    const response = await axios.post(`${API_BASE_URL}/terminate_install`, {
      game_id: gameId
    });
    
    return response.data.status === 'success';
  } catch (error) {
    console.error('Error terminating installation:', error);
    throw error;
  }
};

// 通过AppID安装游戏
export const installByAppId = async (
  appId: string,
  name: string,
  anonymous: boolean,
  onOutput: (line: string) => void,
  onComplete: () => void,
  onError: (error: string) => void,
  account?: string,
  password?: string
): Promise<EventSource | null> => {
  try {
    // 1. 先请求安装
    const installResp = await axios.post(`${API_BASE_URL}/install_by_appid`, {
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
    
    // 2. 再连接SSE，使用生成的game_id
    const gameId = `app_${appId}`;
    const sseUrl = `${API_BASE_URL}/install_stream?game_id=${gameId}`;
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
        console.error('Error parsing SSE data:', error);
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