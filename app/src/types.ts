export interface GameInfo {
  id: string;
  name: string;
  appid: string;
  anonymous: boolean;
  has_script: boolean;
  tip: string;
  image?: string;
  url?: string;
  installed?: boolean;
  external?: boolean;
}

export interface ApiResponse {
  status: 'success' | 'error';
  message?: string;
  games?: GameInfo[];
  installed?: boolean;
  [key: string]: any;  // 允许其他属性
}

export interface InstallEventData {
  line?: string;
  prompt?: string;
  complete?: boolean;
  status?: 'success' | 'error' | 'warning' | 'terminated';
  message?: string;
  heartbeat?: boolean;
  timestamp?: number;
  error?: string;
  timeout?: boolean;
  [key: string]: any;  // 允许其他属性
}

export interface SystemInfo {
  cpu_usage: number;
  memory: {
    total: number;
    used: number;
    percent: number;
  };
  disk: {
    total: number;
    used: number;
    percent: number;
  };
  games_space?: {[key: string]: number};
}

// 扩展Window接口，添加electron属性
declare global {
  interface Window {
    electron?: {
      openFolder: (path: string) => void;
    };
  }
} 