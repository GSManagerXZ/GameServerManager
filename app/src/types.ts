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
  line?: string | { prompt?: string; line?: string };
  prompt?: string;
  status?: 'success' | 'error';
  message?: string;
  complete?: boolean;
} 