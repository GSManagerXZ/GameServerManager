import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Layout, Typography, Row, Col, Card, Button, Spin, message, Tooltip, Modal, Tabs, Form, Input, Menu, Tag, Dropdown, Radio, Drawer, Switch } from 'antd';
import { CloudServerOutlined, DashboardOutlined, AppstoreOutlined, PlayCircleOutlined, ReloadOutlined, DownOutlined, InfoCircleOutlined, FolderOutlined, UserOutlined, LogoutOutlined, LockOutlined, GlobalOutlined, MenuOutlined } from '@ant-design/icons';
import axios from 'axios';
// 导入antd样式
import 'antd/dist/antd.css';
import './App.css';
import Terminal from './components/Terminal';
import ContainerInfo from './components/ContainerInfo';
import FileManager from './components/FileManager';
import Register from './components/Register'; // 导入注册组件
import FrpManager from './components/FrpManager'; // 导入内网穿透组件
import FrpDocModal from './components/FrpDocModal'; // 导入内网穿透文档弹窗组件
import FileManagerHelpModal from './components/FileManagerHelpModal'; // 导入文件管理帮助弹窗组件
import About from './pages/About'; // 导入关于项目页面
import { fetchGames, installGame, terminateInstall, installByAppId, openGameFolder } from './api';
import { GameInfo } from './types';
import { useAuth } from './context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from './hooks/useIsMobile'; // 导入移动设备检测钩子
import Cookies from 'js-cookie'; // 导入js-cookie库

const { Header, Content, Footer, Sider } = Layout;
const { Title, Paragraph } = Typography;
const { TabPane } = Tabs;

// 定义一个类型化的错误处理函数
const handleError = (err: any): void => {
  // console.error('Error:', err);
  message.error(err?.message || '发生未知错误');
};

interface InstallOutput {
  output: (string | { prompt?: string; line?: string })[];
  complete: boolean;
  installing: boolean;
}

// 新增API函数
const startServer = async (gameId: string, callback?: (line: any) => void, onComplete?: () => void, onError?: (error: any) => void, includeHistory: boolean = true, restart: boolean = false) => {
  try {
    // console.log(`正在启动服务器 ${gameId}...`);
    
    // 发送启动服务器请求
    const response = await axios.post('/api/server/start', { game_id: gameId });
    // console.log('启动服务器响应:', response.data);
    
    if (response.data.status !== 'success') {
      const errorMsg = response.data.message || '启动失败';
      // console.error(`启动服务器失败: ${errorMsg}`);
      if (onError) onError(new Error(errorMsg));
      throw new Error(errorMsg);
    }
    
    // 使用EventSource获取实时输出
    const token = localStorage.getItem('auth_token');
    const eventSource = new EventSource(`/api/server/stream?game_id=${gameId}${token ? `&token=${token}` : ''}&include_history=${includeHistory}${restart ? '&restart=true' : ''}`);
    // console.log(`已建立到 ${gameId} 服务器的SSE连接${restart ? ' (重启模式)' : ''}`);
    
    // 添加一个变量来跟踪上次输出时间，用于实时性检测
    let lastOutputTime = Date.now();
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // 更新最后输出时间
        lastOutputTime = Date.now();
        
        // 处理完成消息
        if (data.complete) {
          console.log(`服务器输出完成，关闭SSE连接`);
          eventSource.close();
          if (onComplete) onComplete();
          return;
        }
        
        // 处理心跳包
        if (data.heartbeat) {
          // console.log(`收到心跳包: ${new Date(data.timestamp * 1000).toLocaleTimeString()}`);
          return;
        }
        
        // 处理超时消息
        if (data.timeout) {
          console.log(`服务器连接超时`);
          eventSource.close();
          if (onError) onError(new Error(data.message || '连接超时'));
          return;
        }
        
        // 处理错误消息
        if (data.error) {
          console.error(`服务器返回错误: ${data.error}`);
          eventSource.close();
          if (onError) onError(new Error(data.error));
          return;
        }
        
        // 处理普通输出行
        if (data.line && callback) {
          // 如果是历史输出，添加history标记
          if (data.history) {
            callback(data.line);
          } else {
            callback(data.line);
          }
          
          // 确保滚动到底部
          setTimeout(() => {
            const terminalEndRef = document.querySelector('.terminal-end-ref');
            if (terminalEndRef) {
              terminalEndRef.scrollIntoView({ behavior: 'smooth' });
            }
          }, 10);
        }
      } catch (err) {
        console.error('解析服务器输出失败:', err, event.data);
        if (onError) onError(new Error(`解析服务器输出失败: ${err}`));
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('SSE连接错误:', error);
      eventSource.close();
      if (onError) onError(error || new Error('服务器连接错误'));
    };
    
    return eventSource;
  } catch (error) {
    // console.error('启动服务器函数出错:', error);
    if (onError) onError(error);
    throw error;
  }
};

const stopServer = async (gameId: string, force: boolean = false) => {
  try {
    // 显示加载消息
    const loadingKey = `stopping_${gameId}`;
    message.loading({ content: `正在${force ? '强制' : ''}停止服务器...`, key: loadingKey, duration: 0 });
    
    // 发送停止请求
    const response = await axios.post('/api/server/stop', { 
      game_id: gameId,
      force
    });
    
    // 如果成功或警告，验证服务器是否真的停止了
    if (response.data.status === 'success' || response.data.status === 'warning') {
      message.success({ content: `服务器已${force ? '强制' : '标准'}停止`, key: loadingKey });
      
      // 等待一小段时间，让服务器有时间完全停止
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        // 验证服务器是否真的停止了
        const statusResponse = await axios.get(`/api/server/status?game_id=${gameId}`);
        if (statusResponse.data.server_status === 'running') {
          console.warn('服务器报告已停止，但状态检查显示仍在运行');
          
          // 如果不是强制模式，记录警告但不改变返回状态
          if (!force) {
            response.data._serverStillRunning = true;
          }
        }
      } catch (error) {
        console.error('验证服务器状态失败:', error);
        // 确保即使状态检查失败，也关闭加载消息
        message.error({ content: `服务器状态验证失败，但操作已完成`, key: loadingKey });
      }
    } else {
      message.error({ content: `停止服务器失败: ${response.data.message || '未知错误'}`, key: loadingKey });
    }
    
    return response.data;
  } catch (error) {
    // 确保在发生错误时关闭加载消息
    const loadingKey = `stopping_${gameId}`;
    message.error({ content: `停止服务器时发生错误: ${error.message || '未知错误'}`, key: loadingKey });
    throw error;
  }
};

const sendServerInput = async (gameId: string, value: string) => {
  try {
    const response = await axios.post('/api/server/send_input', {
      game_id: gameId,
      value
    });
    return response.data;
  } catch (error) {
    throw error;
  }
};

const checkServerStatus = async (gameId: string) => {
  try {
    const response = await axios.get(`/api/server/status?game_id=${gameId}`);
    return response.data;
  } catch (error) {
    throw error;
  }
};

  const App: React.FC = () => {
  const { login, logout, username, isAuthenticated, loading, isFirstUse, setAuthenticated } = useAuth();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [gameLoading, setGameLoading] = useState<boolean>(true);
  const [selectedGame, setSelectedGame] = useState<GameInfo | null>(null);
  const [terminalVisible, setTerminalVisible] = useState<boolean>(false);
  // 保存每个游戏的输出和状态
  const [installOutputs, setInstallOutputs] = useState<{[key: string]: InstallOutput}>({});
  const [installedGames, setInstalledGames] = useState<string[]>([]);
  const [externalGames, setExternalGames] = useState<GameInfo[]>([]);  // 添加外部游戏状态
  const [tabKey, setTabKey] = useState<string>('install');
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [accountForm] = Form.useForm();
  const [pendingInstallGame, setPendingInstallGame] = useState<GameInfo | null>(null);
  // 新增游戏详情对话框状态
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [detailGame, setDetailGame] = useState<GameInfo | null>(null);
  // 新增AppID安装状态
  const [appIdInstalling, setAppIdInstalling] = useState(false);
  const [accountFormLoading, setAccountFormLoading] = useState<boolean>(false);
  // 新增：服务器相关状态
  const [serverOutputs, setServerOutputs] = useState<{[key: string]: string[]}>({});
  const [runningServers, setRunningServers] = useState<string[]>([]);
  // 新增：自启动服务器列表
  const [autoRestartServers, setAutoRestartServers] = useState<string[]>([]);
  const [selectedServerGame, setSelectedServerGame] = useState<GameInfo | null>(null);
  const [serverModalVisible, setServerModalVisible] = useState<boolean>(false);
  const [serverInput, setServerInput] = useState<string>('');
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [inputHistoryIndex, setInputHistoryIndex] = useState<number>(0);
  // 新增：保存EventSource引用
  const serverEventSourceRef = useRef<EventSource | null>(null);
  // 新增：背景图片开关
  const [enableRandomBackground, setEnableRandomBackground] = useState<boolean>(() => {
    // 从localStorage读取用户偏好设置，默认开启
    const savedPreference = localStorage.getItem('enableRandomBackground');
    return savedPreference === null ? true : savedPreference === 'true';
  });
  
  // 新增：是否启用不活动透明效果
  const [enableInactiveEffect, setEnableInactiveEffect] = useState<boolean>(() => {
    // 从localStorage读取用户偏好设置，默认开启
    const savedPreference = localStorage.getItem('enableInactiveEffect');
    return savedPreference === null ? true : savedPreference === 'true';
  });
  
  // 保存不活动效果设置到localStorage
  useEffect(() => {
    localStorage.setItem('enableInactiveEffect', enableInactiveEffect.toString());
  }, [enableInactiveEffect]);
  
  // 新增：用户活动状态和定时器
  const [isUserActive, setIsUserActive] = useState<boolean>(true);
  const userActivityTimerRef = useRef<number | null>(null);
  
  // 处理用户活动
  const handleUserActivity = useCallback(() => {
    // 如果未启用不活跃效果，则不设置定时器
    if (!enableInactiveEffect || !enableRandomBackground) {
      setIsUserActive(true);
      return;
    }
    
    setIsUserActive(true);
    
    // 重置定时器
    if (userActivityTimerRef.current) {
      window.clearTimeout(userActivityTimerRef.current);
    }
    
    // 设置新的定时器，20秒后将用户状态设为不活跃
    userActivityTimerRef.current = window.setTimeout(() => {
      setIsUserActive(false);
    }, 20000); // 20秒
  }, [enableInactiveEffect, enableRandomBackground]);
  
  // 当启用/禁用不活跃效果或随机背景时，重置用户活跃状态
  useEffect(() => {
    // 如果禁用了不活跃效果或随机背景，则强制设置为活跃状态
    if (!enableInactiveEffect || !enableRandomBackground) {
      setIsUserActive(true);
      if (userActivityTimerRef.current) {
        window.clearTimeout(userActivityTimerRef.current);
        userActivityTimerRef.current = null;
      }
    } else {
      // 重新启动活动检测
      handleUserActivity();
    }
  }, [enableInactiveEffect, enableRandomBackground, handleUserActivity]);
  
  // 设置用户活动监听器
  useEffect(() => {
    // 初始设置定时器
    handleUserActivity();
    
    // 添加鼠标移动和点击事件监听器
    window.addEventListener('mousemove', handleUserActivity);
    window.addEventListener('click', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);
    window.addEventListener('scroll', handleUserActivity);
    window.addEventListener('touchstart', handleUserActivity);
    
    // 组件卸载时清除事件监听器和定时器
    return () => {
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('click', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('scroll', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      
      if (userActivityTimerRef.current) {
        window.clearTimeout(userActivityTimerRef.current);
      }
    };
  }, [handleUserActivity]);
  
  // 保存背景图片设置到localStorage
  useEffect(() => {
    localStorage.setItem('enableRandomBackground', enableRandomBackground.toString());
  }, [enableRandomBackground]);
  
  // 监听serverModalVisible变化，当模态框关闭时关闭EventSource连接
  useEffect(() => {
    if (!serverModalVisible && serverEventSourceRef.current) {
      console.log('服务器控制台关闭，关闭SSE连接');
      serverEventSourceRef.current.close();
      serverEventSourceRef.current = null;
    }
  }, [serverModalVisible]);

  // 导航和文件管理相关状态
  const [currentNav, setCurrentNav] = useState<string>('dashboard');
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [fileManagerVisible, setFileManagerVisible] = useState<boolean>(false);
  const [fileManagerPath, setFileManagerPath] = useState<string>('/home/steam');
  
  // 移动端适配状态
  const isMobile = useIsMobile();
  const [mobileMenuVisible, setMobileMenuVisible] = useState<boolean>(false);

  // 在移动设备上自动折叠侧边栏
  useEffect(() => {
    if (isMobile) {
      setCollapsed(true);
    }
  }, [isMobile]);

  const navigate = useNavigate();

  // 在适当位置添加 terminalEndRef
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // 输出更新后自动滚动到底部
  useEffect(() => {
    if (terminalEndRef.current && serverModalVisible) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [serverOutputs, selectedServerGame, serverModalVisible]);

  // 添加 handleSendServerInput 函数
  const handleSendServerInput = async (gameId: string, input: string) => {
    try {
      if (!gameId || !input.trim()) return;
      
      // console.log(`发送服务器命令: gameId=${gameId}, input=${input}`);
      
      // 保存到输入历史
      setInputHistory(prev => [...prev, input]);
      setInputHistoryIndex(-1);
      
      // 添加到输出，以便用户可以看到自己的输入
      setServerOutputs(prev => {
        const oldOutput = prev[gameId] || [];
        // console.log(`添加命令到输出: gameId=${gameId}, 当前输出行数=${oldOutput.length}`);
        return {
          ...prev,
          [gameId]: [...oldOutput, `> ${input}`]
        };
      });
      
      // 发送输入到服务器
      // console.log(`调用API发送命令: gameId=${gameId}`);
      const response = await sendServerInput(gameId, input);
      // console.log(`发送命令响应:`, response);
      
      if (response.status !== 'success') {
        console.error(`发送命令失败: ${response.message}`);
        message.error(`发送命令失败: ${response.message}`);
      }
    } catch (error) {
      console.error(`发送命令异常: ${error}`);
      handleError(error);
    }
  };

  // 加载游戏列表
  useEffect(() => {
    // 并行加载游戏列表和已安装游戏
    const loadAll = async () => {
      setGameLoading(true);
      try {
        const [gameList, installedResp] = await Promise.all([
          fetchGames(),
          axios.get('/api/installed_games')
        ]);
        setGames(gameList);
        if (installedResp.data.status === 'success') {
          setInstalledGames(installedResp.data.installed || []);
          setExternalGames(installedResp.data.external || []);  // 设置外部游戏
        }
        
        // 初始化每个游戏的installOutputs
        const initialOutputs: {[key: string]: InstallOutput} = {};
        gameList.forEach(game => {
          initialOutputs[game.id] = {
            output: [],
            complete: false,
            installing: false
          };
        });
        setInstallOutputs(initialOutputs);
        
      } catch (error) {
        handleError(error);
      } finally {
        setGameLoading(false);
      }
    };
    loadAll();
  }, []);

  // 检查正在运行的服务器
  const refreshServerStatus = useCallback(async () => {
    try {
      // console.log('正在刷新服务器状态...');
      const response = await axios.get('/api/server/status');
      
      if (response.data.status === 'success' && response.data.servers) {
        const running = Object.keys(response.data.servers).filter(
          id => response.data.servers[id].status === 'running'
        );
        
        // console.log('当前运行中的服务器:', running);
        
        // 更新运行中的服务器列表
        setRunningServers(running);
        
        // 如果有选中的服务器游戏，检查它是否在运行
        if (selectedServerGame && !running.includes(selectedServerGame.id)) {
          // console.log(`选中的服务器 ${selectedServerGame.id} 已停止运行`);
        }
        
        return running;
      }
    } catch (error) {
      console.error('检查服务器状态失败:', error);
    }
    
    return [];
  }, [selectedServerGame]);

  // 安装游戏的处理函数
  const handleInstall = useCallback(async (game: GameInfo, account?: string, password?: string) => {
    setSelectedGame(game);
    setTerminalVisible(true);
    if (installOutputs[game.id]?.installing) {
      return;
    }
    setInstallOutputs(prev => ({
      ...prev,
      [game.id]: { output: [], complete: false, installing: true }
    }));
    try {
      const eventSource = await installGame(
        game.id,
        (line) => {
          // console.log('SSE output:', line);
          setInstallOutputs(prev => {
            const old = prev[game.id]?.output || [];
            return {
              ...prev,
              [game.id]: {
                ...prev[game.id],
                output: [...old, line],
                installing: true,
                complete: false
              }
            };
          });
        },
        () => {
          setInstallOutputs(prev => ({
            ...prev,
            [game.id]: {
              ...prev[game.id],
              installing: false,
              complete: true
            }
          }));
          message.success(`${game.name} 安装完成`);
          axios.get('/api/installed_games').then(res => {
            if (res.data.status === 'success') setInstalledGames(res.data.installed || []);
          });
        },
        (error) => {
          setInstallOutputs(prev => ({
            ...prev,
            [game.id]: {
              ...prev[game.id],
              installing: false,
              complete: true
            }
          }));
          handleError(error);
        },
        account,
        password
      );
      return () => {
        if (eventSource) eventSource.close();
      };
    } catch (error) {
      setInstallOutputs(prev => ({
        ...prev,
        [game.id]: {
          ...prev[game.id],
          installing: false,
          complete: true
        }
      }));
      handleError(error);
    }
  }, [installOutputs]);

  // 关闭终端窗口，只隐藏，不清空输出
  const closeTerminal = useCallback(() => {
    setTerminalVisible(false);
    message.info('窗口已关闭。若您正在安装，请不用担心，任务仍在继续运行中，刷新页面点击更新即可继续查看');
  }, []);

  // 获取当前选中游戏的输出和状态
  const currentOutput = selectedGame ? installOutputs[selectedGame.id]?.output || [] : [];
  // console.log('currentOutput:', currentOutput);
  const currentInstalling = selectedGame ? installOutputs[selectedGame.id]?.installing || false : false;
  const currentComplete = selectedGame ? installOutputs[selectedGame.id]?.complete || false : false;

  // 卸载游戏
  const handleUninstall = async (gameIdOrGame: string | GameInfo) => {
    try {
      // 判断传入的是游戏ID还是游戏对象
      let gameId: string;
      let gameName: string;
      let isExternal = false;
      
      if (typeof gameIdOrGame === 'string') {
        // 如果是从ContainerInfo传来的游戏ID，需要查找对应的游戏信息
        gameId = gameIdOrGame;
        
        // 先在正常游戏列表中查找
        const game = games.find(g => g.id === gameId);
        if (game) {
          gameName = game.name;
        } else {
          // 在外部游戏列表中查找
          const externalGame = externalGames.find(g => g.id === gameId);
          if (externalGame) {
            gameName = externalGame.name;
            isExternal = true;
          } else {
            // 如果在外部游戏列表中也找不到，则使用游戏ID作为游戏名称
            // 这种情况可能是外来游戏但没有被正确识别
            gameName = gameId;
            isExternal = true;
            console.warn(`未在游戏列表中找到游戏信息，将使用ID作为名称: ${gameId}`);
          }
        }
      } else {
        // 如果是从游戏列表传来的游戏对象
        gameId = gameIdOrGame.id;
        gameName = gameIdOrGame.name;
        isExternal = gameIdOrGame.external || false;
      }
      
      if (runningServers.includes(gameId)) {
        message.warning(`请先停止游戏 ${gameName} 的服务器`);
        return;
      }
      
      const confirmContent = isExternal
        ? `这是一个外部游戏文件夹，卸载将直接删除 /home/steam/games/${gameId} 目录及其所有内容。此操作不可恢复！`
        : '卸载后游戏数据将被删除，请确保您已备份重要数据。';
      
      Modal.confirm({
        title: `确定要卸载${isExternal ? '外部游戏' : ''} ${gameName} 吗?`,
        content: confirmContent,
        okText: '确认卸载',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          const response = await axios.post('/api/uninstall', { game_id: gameId });
          if (response.data.status === 'success') {
            message.success(`${gameName} 已卸载`);
            
            // 刷新游戏列表和服务器状态
            refreshGameLists();
            refreshServerStatus();
          }
        }
      });
    } catch (error) {
      handleError(error);
    }
  };

  // 处理"安装"按钮点击
  const handleInstallClick = (game: GameInfo) => {
    // 如果已经在安装中，不执行任何操作
    if (installOutputs[game.id]?.installing) {
      return;
    }
    
    if (game.anonymous === false) {
      setPendingInstallGame(game);
      setAccountModalVisible(true);
      accountForm.resetFields();
    } else {
      handleInstall(game);
    }
  };

  // 提交账号密码表单
  const onAccountModalOk = async () => {
    try {
      // 验证表单
      const values = await accountForm.validateFields();
      
      if (pendingInstallGame) {
        // 关闭模态框
        setAccountModalVisible(false);
        
        // 使用表单中的账号密码安装游戏
        handleInstall(pendingInstallGame, values.account, values.password);
        
        // 清空待安装游戏
        setPendingInstallGame(null);
      }
    } catch (error) {
      // 表单验证失败
      console.error('表单验证失败:', error);
    }
  };

  // 刷新已安装游戏和外部游戏列表
  const refreshGameLists = useCallback(async () => {
    try {
      // console.log('刷新游戏列表...');
      const response = await axios.get('/api/installed_games');
      if (response.data.status === 'success') {
        setInstalledGames(response.data.installed || []);
        setExternalGames(response.data.external || []);
        // console.log('游戏列表已更新', {
        //   installed: response.data.installed?.length || 0,
        //   external: response.data.external?.length || 0
        // });
      }
    } catch (error) {
      console.error('刷新游戏列表失败:', error);
    }
  }, []);

  // 当已安装游戏列表变化时，刷新服务器状态
  useEffect(() => {
    refreshServerStatus();
  }, [installedGames, externalGames, refreshServerStatus]);

  // 添加启动SteamCMD的函数
  const handleStartSteamCmd = async () => {
    try {
      // 设置当前选中的服务器游戏为steamcmd
      const steamcmd = { id: "steamcmd", name: "SteamCMD", external: false };
      
      setSelectedServerGame(steamcmd);
      setServerModalVisible(true);
      
      // 清空之前的输出
      setServerOutputs(prev => ({
        ...prev,
        ["steamcmd"]: []
      }));
      
      // 启动SteamCMD并获取输出流
      const eventSource = await axios.post('/api/server/start_steamcmd')
        .then(() => {
          // 建立EventSource连接
          const token = localStorage.getItem('auth_token');
          const source = new EventSource(`/api/server/stream?game_id=steamcmd${token ? `&token=${token}` : ''}&include_history=true`);
          
          source.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              
              // 处理完成消息
              if (data.complete) {
                console.log(`SteamCMD输出完成，关闭SSE连接`);
                source.close();
                message.success(`SteamCMD已停止`);
                // 刷新状态
                refreshServerStatus();
                // 清除EventSource引用
                serverEventSourceRef.current = null;
                return;
              }
              
              // 处理心跳包
              if (data.heartbeat) {
                return;
              }
              
              // 处理超时消息
              if (data.timeout) {
                console.log(`SteamCMD连接超时`);
                source.close();
                handleError(new Error(data.message || '连接超时'));
                return;
              }
              
              // 处理错误消息
              if (data.error) {
                console.error(`SteamCMD返回错误: ${data.error}`);
                source.close();
                handleError(new Error(data.error));
                return;
              }
              
              // 处理普通输出行
              if (data.line) {
                setServerOutputs(prev => {
                  const oldOutput = prev["steamcmd"] || [];
                  return {
                    ...prev,
                    ["steamcmd"]: [...oldOutput, data.line]
                  };
                });
                
                // 确保滚动到底部
                setTimeout(() => {
                  const terminalEndRef = document.querySelector('.terminal-end-ref');
                  if (terminalEndRef) {
                    terminalEndRef.scrollIntoView({ behavior: 'smooth' });
                  }
                }, 10);
              }
            } catch (err) {
              console.error('解析SteamCMD输出失败:', err, event.data);
              handleError(new Error(`解析SteamCMD输出失败: ${err}`));
            }
          };
          
          source.onerror = (error) => {
            console.error('SSE连接错误:', error);
            source.close();
            handleError(error || new Error('SteamCMD连接错误'));
          };
          
          return source;
        })
        .catch(error => {
          console.error(`启动SteamCMD失败: ${error}`);
          handleError(error);
          throw error;
        });
      
      // 保存EventSource引用
      serverEventSourceRef.current = eventSource;
      
      // 服务器启动后立即刷新状态列表
      message.success(`SteamCMD启动成功`);
      
      // 添加到运行中服务器列表
      setRunningServers(prev => {
        if (!prev.includes("steamcmd")) {
          return [...prev, "steamcmd"];
        }
        return prev;
      });
      
      // 延迟再次刷新以确保状态更新
      setTimeout(() => {
        refreshServerStatus();
      }, 2000);
      
    } catch (error) {
      console.error(`启动SteamCMD失败: ${error}`);
      handleError(error);
    }
  };

  // 服务器相关函数
  const handleStartServer = async (gameId: string, reconnect: boolean = false) => {
    try {
      // 设置当前选中的服务器游戏
      const game = games.find(g => g.id === gameId) || 
                  externalGames.find(g => g.id === gameId) || 
                  { id: gameId, name: gameId, external: true };
      
      // console.log(`处理启动服务器: gameId=${gameId}, reconnect=${reconnect}, 游戏名称=${game.name}`);
      
      setSelectedServerGame(game);
      setServerModalVisible(true);
      
      // 如果是重新连接，不清空之前的输出
      if (!reconnect) {
        // console.log(`清空之前的输出: gameId=${gameId}`);
        // 清空之前的输出
        setServerOutputs(prev => ({
          ...prev,
          [gameId]: []
        }));
      } else {
        // console.log(`重新连接，保留之前的输出: gameId=${gameId}, 当前输出行数=${serverOutputs[gameId]?.length || 0}`);
        // 添加一条分隔线
        setServerOutputs(prev => {
          const oldOutput = prev[gameId] || [];
          return {
            ...prev,
            [gameId]: [...oldOutput, "--- 重新连接到服务器 ---"]
          };
        });
      }
      
      // 启动服务器并获取输出流
      const eventSource = await startServer(
        gameId,
        (line) => {
          // console.log(`接收到服务器输出行: ${typeof line === 'string' ? (line.substring(0, 50) + (line.length > 50 ? '...' : '')) : JSON.stringify(line)}`);
          
          // 处理不同类型的输出行
          if (typeof line === 'string') {
            setServerOutputs(prev => {
              const oldOutput = prev[gameId] || [];
              // 检查是否为历史记录
              if (line.includes('[历史记录]')) {
                return {
                  ...prev,
                  [gameId]: [...oldOutput, line]
                };
              } else {
                return {
                  ...prev,
                  [gameId]: [...oldOutput, line]
                };
              }
            });
          } else if (typeof line === 'object' && line !== null) {
            // 处理对象类型的输出
            const outputLine = JSON.stringify(line);
            setServerOutputs(prev => {
              const oldOutput = prev[gameId] || [];
              return {
                ...prev,
                [gameId]: [...oldOutput, `[对象] ${outputLine}`]
              };
            });
          }
        },
        () => {
          // console.log(`服务器输出完成: gameId=${gameId}`);
          message.success(`${game.name} 服务器已停止`);
          // 服务器停止时刷新状态
          refreshServerStatus();
          // 清除EventSource引用
          serverEventSourceRef.current = null;
        },
        (error) => {
          console.error(`服务器输出错误: ${error.message}`);
          handleError(error);
          // 发生错误时也刷新状态
          refreshServerStatus();
          // 清除EventSource引用
          serverEventSourceRef.current = null;
        },
        true,  // 始终包含历史输出
        reconnect  // 传递reconnect参数作为restart参数
      );
      
      // 保存EventSource引用
      serverEventSourceRef.current = eventSource;
      
      // 服务器启动后立即刷新状态列表
      if (!reconnect) {
        // console.log(`服务器启动成功: gameId=${gameId}`);
        message.success(`${game.name} 服务器启动成功`);
      } else {
        // console.log(`重新连接到服务器: gameId=${gameId}`);
        message.success(`已重新连接到 ${game.name} 服务器`);
      }
      
      // 添加到运行中服务器列表
      setRunningServers(prev => {
        if (!prev.includes(gameId)) {
          return [...prev, gameId];
        }
        return prev;
      });
      
      // 延迟再次刷新以确保状态更新
      setTimeout(() => {
        refreshServerStatus();
      }, 2000);
      
    } catch (error) {
      console.error(`启动服务器失败: ${error}`);
      handleError(error);
    }
  };

  const handleStopServer = useCallback(async (gameId: string, force = false) => {
    try {
      // 如果不是强制停止，先显示确认对话框
      if (!force) {
        Modal.confirm({
          title: '停止服务器',
          content: (
            <div>
              <p>请选择停止服务器的方式：</p>
              <p>- 标准停止：发送Ctrl+C到控制台，让服务器正常退出</p>
              <p>- 强行停止：直接杀死进程，可能导致数据丢失</p>
            </div>
          ),
          okText: '标准停止',
          cancelText: '取消',
          okButtonProps: { type: 'primary' },
          onOk: async () => {
            const response = await stopServer(gameId, false);
            
            if (response.status === 'success') {
              message.success(`服务器已标准停止`);
              refreshServerStatus();
              // 清空服务器输出
              clearServerOutput(gameId);
            } else if (response.status === 'warning') {
              // 处理警告状态，例如服务器未响应标准停止
              Modal.confirm({
                title: '停止服务器警告',
                content: response.message || '服务器未完全停止，是否尝试强行停止？',
                okText: '强行停止',
                cancelText: '取消',
                okButtonProps: { danger: true },
                onOk: () => handleStopServer(gameId, true),
              });
            }
          },
          footer: (_, { OkBtn, CancelBtn }) => (
            <>
              <Button danger onClick={() => handleStopServer(gameId, true)}>强行停止</Button>
              <CancelBtn />
              <OkBtn />
            </>
          ),
        });
        return;
      }
      
      // 发送停止请求
      const response = await stopServer(gameId, force);
      
      if (response.status === 'success') {
        // 刷新运行中的服务器列表
        refreshServerStatus();
        // 清空服务器输出
        clearServerOutput(gameId);
        
        // 检查是否有隐藏的服务器仍在运行警告
        if (response._serverStillRunning) {
          // 处理警告状态，服务器可能仍在运行
          Modal.confirm({
            title: '服务器可能仍在运行',
            content: '服务器报告已停止，但状态检查显示可能仍在运行。是否尝试强制停止？',
            okText: '强制停止',
            cancelText: '忽略',
            okButtonProps: { danger: true },
            onOk: () => handleStopServer(gameId, true),
          });
        }
      } else if (response.status === 'warning') {
        // 处理警告状态，例如服务器未响应标准停止
        Modal.confirm({
          title: '停止服务器警告',
          content: response.message || '服务器未完全停止，是否尝试强行停止？',
          okText: '强行停止',
          cancelText: '取消',
          okButtonProps: { danger: true },
          onOk: () => handleStopServer(gameId, true),
        });
      }
    } catch (error) {
      // 即使出错也刷新服务器状态
      refreshServerStatus();
      handleError(error);
    }
  }, [refreshServerStatus]);

  // 添加一个清理服务器输出的函数
  const clearServerOutput = useCallback((gameId: string) => {
    setServerOutputs(prev => ({
      ...prev,
      [gameId]: []
    }));
  }, []);

  const handleServerInput = useCallback(async (gameId: string, value: string) => {
    try {
      await sendServerInput(gameId, value);
    } catch (e: any) {
      message.error(e?.message || '发送输入失败');
    }
  }, []);

  // 渲染游戏卡片安装按钮 (用于游戏安装页面)
  const renderGameButtons = (game: GameInfo) => {
    // 添加调试代码
    const primaryBtnStyle = {
      background: 'linear-gradient(90deg, #1677ff 0%, #69b1ff 100%)',
      color: 'white',
      padding: '5px 15px',
      border: 'none',
      borderRadius: '2px',
      cursor: 'pointer',
      fontSize: '14px'
    };
    
    const defaultBtnStyle = {
      background: '#f0f0f0',
      color: '#000',
      padding: '5px 15px',
      border: '1px solid #d9d9d9',
      borderRadius: '2px',
      cursor: 'pointer',
      marginRight: '8px',
      fontSize: '14px'
    };
    
    if (installedGames.includes(game.id)) {
      return (
        <>
          <button 
            style={defaultBtnStyle}
            onClick={() => handleUninstall(game)}
          >卸载</button>
          <button 
            style={primaryBtnStyle}
            onClick={() => handleInstall(game)}
          >{installOutputs[game.id]?.installing ? '安装中...' : '更新'}</button>
        </>
      );
    }
    return (
      <button 
        style={primaryBtnStyle}
        onClick={(e) => {
          e.stopPropagation();
          if (!installOutputs[game.id]?.installing) {
            handleInstallClick(game);
          }
        }}
      >
        {installOutputs[game.id]?.installing ? '安装中...' : '安装'}
      </button>
    );
  };

  // 服务器管理按钮已内联到各个使用位置

  // 服务器管理Tab内容
  const renderServerManager = () => (
    <div style={{marginTop: 32}}>
      <Title level={3}>已安装的游戏</Title>
      <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
        {/* 固定显示SteamCMD */}
        <Col xs={24} sm={12} md={8} lg={6} key="steamcmd">
          <Card
            hoverable
            className="game-card"
            title={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>SteamCMD</span>
                <Tag color="blue">工具</Tag>
              </div>
            }
            size={isMobile ? "small" : "default"}
          >
            <p>Steam游戏服务器命令行工具</p>
            <p>位置: /home/steam/steamcmd</p>
            <Button 
              type="primary" 
              size="small"
              onClick={() => handleStartSteamCmd()}
            >
              启动
            </Button>
          </Card>
        </Col>
        
        {/* 显示配置中的已安装游戏 */}
        {games.filter(g => installedGames.includes(g.id)).map(game => (
          <Col xs={24} sm={12} md={8} lg={6} key={game.id}>
            <Card
              hoverable
              className="game-card"
              title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{game.name}</span>
                  {runningServers.includes(game.id) ? (
                    <Tag color="green">运行中</Tag>
                  ) : (
                    <Tag color="default">未运行</Tag>
                  )}
                </div>
              }
              size={isMobile ? "small" : "default"}
            >
              <p>位置: /home/steam/games/{game.id}</p>
              {runningServers.includes(game.id) ? (
                <div>
                  <div style={{marginBottom: 8}}>
                    <Button 
                      danger
                      size="small"
                      onClick={() => handleUninstall(game.id)}
                    >
                      卸载
                    </Button>
                    <span style={{marginLeft: 8}}>
                      自启动: 
                      <Switch 
                        size="small" 
                        checked={autoRestartServers.includes(game.id)}
                        onChange={(checked) => handleAutoRestartChange(game.id, checked)}
                        style={{marginLeft: 4}}
                      />
                    </span>
                  </div>
                  <Button 
                    type="default" 
                    size="small" 
                    style={{marginRight: 8}}
                    onClick={() => handleStopServer(game.id)}
                  >
                    停止
                  </Button>
                  <Button 
                    type="primary" 
                    size="small"
                    style={{marginRight: 8}}
                    onClick={() => handleStartServer(game.id)}
                  >
                    控制台
                  </Button>
                  <Button
                    icon={<FolderOutlined />}
                    size="small"
                    onClick={() => handleOpenGameFolder(game.id)}
                  >
                    文件夹
                  </Button>
                </div>
              ) : (
                <div>
                  <div style={{marginBottom: 8}}>
                    <Button 
                      danger
                      size="small"
                      onClick={() => handleUninstall(game.id)}
                    >
                      卸载
                    </Button>
                    <span style={{marginLeft: 8}}>
                      自启动: 
                      <Switch 
                        size="small" 
                        checked={autoRestartServers.includes(game.id)}
                        onChange={(checked) => handleAutoRestartChange(game.id, checked)}
                        style={{marginLeft: 4}}
                      />
                    </span>
                  </div>
                  <Button 
                    type="primary" 
                    size="small"
                    style={{marginRight: 8}}
                    onClick={() => handleStartServer(game.id)}
                  >
                    启动
                  </Button>
                  <Button
                    icon={<FolderOutlined />}
                    size="small"
                    onClick={() => handleOpenGameFolder(game.id)}
                  >
                    文件夹
                  </Button>
                </div>
              )}
            </Card>
          </Col>
        ))}

        {/* 显示外部游戏 */}
        {externalGames.map(game => (
          <Col xs={24} sm={12} md={8} lg={6}>
            <Card
              hoverable
              className="game-card"
              title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{game.name}</span>
                  <Tag color="orange">外来</Tag>
                </div>
              }
            >
              <p>位置: /home/steam/games/{game.id}</p>
              <div style={{marginTop: 12}}>
                <div style={{marginBottom: 8}}>服务器控制:</div>
                {runningServers.includes(game.id) ? (
                  <div>
                    <div style={{marginBottom: 8}}>
                      <Button 
                        danger
                        size="small"
                        onClick={() => handleUninstall(game.id)}
                      >
                        卸载
                      </Button>
                      <span style={{marginLeft: 8}}>
                        自启动: 
                        <Switch 
                          size="small" 
                          checked={autoRestartServers.includes(game.id)}
                          onChange={(checked) => handleAutoRestartChange(game.id, checked)}
                          style={{marginLeft: 4}}
                        />
                      </span>
                    </div>
                    <Button 
                      type="default" 
                      size="small" 
                      style={{marginRight: 8}}
                      onClick={() => handleStopServer(game.id)}
                    >
                      停止
                    </Button>
                    <Button 
                      type="primary" 
                      size="small"
                      style={{marginRight: 8}}
                      onClick={() => handleStartServer(game.id)}
                    >
                      控制台
                    </Button>
                    <Button
                      icon={<FolderOutlined />}
                      size="small"
                      onClick={() => handleOpenGameFolder(game.id)}
                    >
                      文件夹
                    </Button>
                  </div>
                ) : (
                  <div>
                    <div style={{marginBottom: 8}}>
                      <Button 
                        danger
                        size="small"
                        onClick={() => handleUninstall(game.id)}
                      >
                        卸载
                      </Button>
                      <span style={{marginLeft: 8}}>
                        自启动: 
                        <Switch 
                          size="small" 
                          checked={autoRestartServers.includes(game.id)}
                          onChange={(checked) => handleAutoRestartChange(game.id, checked)}
                          style={{marginLeft: 4}}
                        />
                      </span>
                    </div>
                    <div style={{display: 'flex', justifyContent: 'center'}}>
                      <Button 
                        type="primary"
                        size="middle"
                        style={{marginRight: 8, width: '45%'}}
                        onClick={() => handleStartServer(game.id)}
                      >
                        启动
                      </Button>
                      <Button
                        icon={<FolderOutlined />}
                        size="middle"
                        style={{width: '45%'}}
                        onClick={() => handleOpenGameFolder(game.id)}
                      >
                        文件夹
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </Col>
        ))}

        {games.filter(g => installedGames.includes(g.id)).length === 0 && externalGames.length === 0 && (
          <Col span={24}><p>除了SteamCMD外，暂无已安装的游戏。</p></Col>
        )}
      </Row>
    </div>
  );

  // 发送验证码/令牌到后端
  const handleSendInput = async (gameId: string, value: string) => {
    try {
      await axios.post('/api/send_input', { game_id: gameId, value });
      message.success('已提交验证码/令牌');
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '提交失败');
    }
  };

  // 添加终止安装函数
  const handleTerminateInstall = useCallback(async (gameId: string) => {
    if (!gameId) return;
    
    try {
      const success = await terminateInstall(gameId);
      
      if (success) {
        message.success('安装已终止');
        // 更新安装状态
        setInstallOutputs(prev => ({
          ...prev,
          [gameId]: {
            ...prev[gameId],
            installing: false,
            complete: true,
            output: [...(prev[gameId]?.output || []), '安装已被用户手动终止']
          }
        }));
      } else {
        message.error('终止安装失败');
      }
    } catch (error) {
      handleError(error);
    }
  }, []);

  // 处理显示游戏详情
  const handleShowDetail = (game: GameInfo) => {
    setDetailGame(game);
    setDetailModalVisible(true);
  };

  // 处理在Steam中打开
  const handleOpenInSteam = (url: string, appid: string) => {
    // 如果url不完整，使用appid构建完整的Steam商店URL
    const fullUrl = url.includes('store.steampowered.com') 
      ? url 
      : `https://store.steampowered.com/app/${appid}`;
      
    // 直接在新窗口打开Steam页面
    window.open(fullUrl, '_blank', 'noopener,noreferrer');
  };

  // 添加通过AppID安装的处理函数
  const handleInstallByAppId = useCallback(async (values: any) => {
    try {
      setAppIdInstalling(true);
      setTerminalVisible(true);
      
      // 创建一个临时的游戏ID
      const gameId = `app_${values.appid}`;
      
      // 重置该游戏的安装输出
      setInstallOutputs(prev => ({
        ...prev,
        [gameId]: { output: [], complete: false, installing: true }
      }));
      
      // 调用API安装游戏
      await installByAppId(
        values.appid,
        values.name,
        values.anonymous,
        (line) => {
          // console.log('SSE output:', line);
          setInstallOutputs(prev => {
            const old = prev[gameId]?.output || [];
            return {
              ...prev,
              [gameId]: {
                ...prev[gameId],
                output: [...old, line],
                installing: true,
                complete: false
              }
            };
          });
        },
        () => {
          setInstallOutputs(prev => ({
            ...prev,
            [gameId]: {
              ...prev[gameId],
              installing: false,
              complete: true
            }
          }));
          message.success(`${values.name} (AppID: ${values.appid}) 安装完成`);
          // 刷新已安装游戏列表
          axios.get('/api/installed_games').then(res => {
            if (res.data.status === 'success') {
              setInstalledGames(res.data.installed || []);
              setExternalGames(res.data.external || []);
            }
          });
        },
        (error) => {
          setInstallOutputs(prev => ({
            ...prev,
            [gameId]: {
              ...prev[gameId],
              installing: false,
              complete: true
            }
          }));
          handleError(error);
        },
        !values.anonymous ? values.account : undefined,
        !values.anonymous ? values.password : undefined
      );
      
      // 创建一个临时游戏对象用于显示
      const tempGame: GameInfo = {
        id: gameId,
        name: values.name,
        appid: values.appid,
        anonymous: values.anonymous,
        has_script: false,
        external: false,
        tip: `通过AppID ${values.appid} 手动安装的游戏`
      };
      
      // 设置为当前选中的游戏，以便显示安装输出
      setSelectedGame(tempGame);
      
      message.success(`已开始安装 ${values.name} (AppID: ${values.appid})`);
    } catch (error) {
      handleError(error);
    } finally {
      setAppIdInstalling(false);
    }
  }, []);

  // 监听打开文件管理器的事件
  useEffect(() => {
    const handleOpenFileManager = (event: CustomEvent) => {
      const path = event.detail?.path;
      // 检查路径是否有效，如果无效则使用默认路径
      if (path && typeof path === 'string' && path.startsWith('/')) {
        setFileManagerPath(path);
      } else {
        // 使用默认路径
        setFileManagerPath('/home/steam');
      }
      setFileManagerVisible(true);
    };

    window.addEventListener('openFileManager', handleOpenFileManager as EventListener);
    
    return () => {
      window.removeEventListener('openFileManager', handleOpenFileManager as EventListener);
    };
  }, []);

  // 添加处理打开文件夹的函数
  const handleOpenGameFolder = async (gameId: string) => {
    try {
      // 不再调用API，而是直接设置文件管理器路径并显示文件管理器
      const gamePath = `/home/steam/games/${gameId}`;
      setFileManagerPath(gamePath);
      setFileManagerVisible(true);
    } catch (error) {
      message.error(`打开游戏文件夹失败: ${error}`);
    }
  };

  // 处理注册成功
  const handleRegisterSuccess = (token: string, username: string, role: string) => {
    setAuthenticated(token, username, role);
    message.success('注册成功，欢迎使用游戏容器！');
  };

  // 初始化
  useEffect(() => {
    // 如果已登录，加载游戏列表
    if (isAuthenticated) {
      // 并行加载游戏列表和已安装游戏
      const loadGames = async () => {
        setGameLoading(true);
        try {
          const [gameList, installedResp] = await Promise.all([
            fetchGames(),
            axios.get('/api/installed_games')
          ]);
          setGames(gameList);
          if (installedResp.data.status === 'success') {
            setInstalledGames(installedResp.data.installed || []);
            setExternalGames(installedResp.data.external || []);  // 设置外部游戏
          }
          
          // 初始化每个游戏的installOutputs
          const initialOutputs: {[key: string]: InstallOutput} = {};
          gameList.forEach(game => {
            initialOutputs[game.id] = {
              output: [],
              complete: false,
              installing: false
            };
          });
          setInstallOutputs(initialOutputs);
          
        } catch (error) {
          message.error('加载游戏列表失败，请刷新页面重试');
        } finally {
          setGameLoading(false);
        }
      };
      
      loadGames();
    }
  }, [isAuthenticated]);

  // 加载自启动服务器列表
  const loadAutoRestartServers = async () => {
    try {
      const response = await axios.get('/api/server/auto_restart');
      if (response.data.status === 'success') {
        setAutoRestartServers(response.data.auto_restart_servers || []);
      }
    } catch (error) {
      console.error('加载自启动服务器列表失败:', error);
    }
  };

  // 处理自启动开关变化
  const handleAutoRestartChange = async (gameId: string, checked: boolean) => {
    try {
      const response = await axios.post('/api/server/set_auto_restart', {
        game_id: gameId,
        auto_restart: checked
      });
      
      if (response.data.status === 'success') {
        message.success(`已${checked ? '开启' : '关闭'}服务端自启动`);
        // 更新自启动服务器列表
        loadAutoRestartServers();
      } else {
        message.error(response.data.message || '操作失败');
      }
    } catch (error) {
      console.error('设置自启动失败:', error);
      message.error('设置自启动失败');
    }
  };

  // 添加定期刷新服务器状态
  useEffect(() => {
    // 初始加载时刷新一次服务器状态
    refreshServerStatus();
    
    // 加载自启动服务器列表
    loadAutoRestartServers();
    
    // 设置定时器，每10秒刷新一次服务器状态
    const intervalId = setInterval(() => {
      if (currentNav === 'servers' || currentNav === 'dashboard') {
        refreshServerStatus();
      }
    }, 10000);
    
    // 组件卸载时清除定时器
    return () => clearInterval(intervalId);
  }, [refreshServerStatus, currentNav]);

  // 当切换到服务器tab时刷新状态
  useEffect(() => {
    if (currentNav === 'servers') {
      refreshServerStatus();
    }
  }, [currentNav, refreshServerStatus]);

  const [frpDocModalVisible, setFrpDocModalVisible] = useState<boolean>(false);
  const [fileManagerHelpModalVisible, setFileManagerHelpModalVisible] = useState<boolean>(false);
  
  // 检查是否需要显示内网穿透文档弹窗（仅在首次访问时）
  useEffect(() => {
    const frpDocViewed = Cookies.get('frp_doc_viewed');
    const currentPath = window.location.pathname;
    // 只有当用户访问内网穿透页面且没有查看过文档时才显示
    if (!frpDocViewed && currentPath.includes('/frp')) {
      setFrpDocModalVisible(true);
    }
  }, []);
  
  // 检查是否需要显示文件管理帮助弹窗（仅在首次访问时）
  useEffect(() => {
    const fileManagerHelpViewed = Cookies.get('file_manager_help_viewed');
    // 当切换到文件管理页面且没有查看过帮助时才显示
    if (!fileManagerHelpViewed && currentNav === 'files') {
      setFileManagerHelpModalVisible(true);
    }
  }, [currentNav]);
  
  // 关闭内网穿透文档弹窗
  const handleCloseFrpDocModal = () => {
    setFrpDocModalVisible(false);
  };
  
  // 关闭文件管理帮助弹窗
  const handleCloseFileManagerHelpModal = () => {
    setFileManagerHelpModalVisible(false);
  };

  // 如果正在加载认证状态，显示加载中
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  // 如果是首次使用，显示注册界面 - 强制渲染
  if (isFirstUse === true) {
    // 使用行内样式确保显示，避免样式冲突
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999 }}>
        <Register onRegisterSuccess={handleRegisterSuccess} />
      </div>
    );
  }

  // 如果未认证，显示登录界面
  if (!isAuthenticated) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' }}>
        <Card style={{ width: 400, boxShadow: '0 4px 8px rgba(0,0,0,0.1)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Title level={2}>游戏容器登录</Title>
          </div>
          
          <Form
            name="login_form"
            initialValues={{ remember: true }}
            onFinish={(values) => login(values.username, values.password)}
            layout="vertical"
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请输入用户名!' }]}
            >
              <Input 
                prefix={<UserOutlined />} 
                placeholder="用户名" 
                size="large"
              />
            </Form.Item>
            
            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码!' }]}
            >
              <Input.Password 
                prefix={<LockOutlined />} 
                placeholder="密码" 
                size="large"
              />
            </Form.Item>
            
            <Form.Item>
              <Button 
                type="primary" 
                htmlType="submit" 
                style={{ width: '100%' }} 
                size="large"
                loading={accountFormLoading}
              >
                登录
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </div>
    );
  }

  // 主应用界面
  return (
    <Layout 
      className={`site-layout ${enableRandomBackground ? 'with-random-bg' : 'without-random-bg'} ${!isUserActive && enableInactiveEffect && enableRandomBackground ? 'user-inactive' : ''}`} 
      style={{ minHeight: '100vh' }}
    >
      {isMobile ? (
        // 移动端侧边栏使用抽屉组件
        <>
          <Header className="site-header">
            <Button 
              type="text" 
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuVisible(true)}
              style={{ fontSize: '16px', padding: '0 8px' }}
            />
            <div className="header-title">
              GameServerManager
            </div>
            <div className="user-info">
              <Tooltip title={enableRandomBackground ? "关闭随机背景" : "开启随机背景"}>
                <Switch 
                  checkedChildren="背景" 
                  unCheckedChildren="背景" 
                  checked={enableRandomBackground}
                  onChange={(checked) => setEnableRandomBackground(checked)}
                  size="small"
                  style={{marginRight: 8}}
                />
              </Tooltip>
              {enableRandomBackground && (
                <Tooltip title={enableInactiveEffect ? "关闭20秒后自动透明效果" : "开启20秒后自动透明效果"}>
                  <Switch 
                    checkedChildren="透明" 
                    unCheckedChildren="透明" 
                    checked={enableInactiveEffect}
                    onChange={(checked) => setEnableInactiveEffect(checked)}
                    size="small"
                    style={{marginRight: 8}}
                  />
                </Tooltip>
              )}
              <span><UserOutlined /> {username}</span>
              <Button 
                type="link" 
                icon={<LogoutOutlined className="logout-icon" />} 
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
                className="logout-btn"
                size={isMobile ? "small" : "middle"}
              >
                {!isMobile && "退出"}
              </Button>
            </div>
          </Header>
          <Drawer
            title="GameServerManager"
            placement="left"
            onClose={() => setMobileMenuVisible(false)}
            visible={mobileMenuVisible}
            bodyStyle={{ padding: 0 }}
          >
            <div className="logo">
              <CloudServerOutlined /> <span>GSManager</span>
            </div>
            <Menu
              theme="light"
              mode="inline"
              selectedKeys={[currentNav]}
              onClick={({ key }) => {
                setCurrentNav(key.toString());
                setMobileMenuVisible(false);
                // 当切换到文件管理时，确保设置有效的默认路径
                if (key === 'files' && (!fileManagerPath || fileManagerPath === '')) {
                  setFileManagerPath('/home/steam');
                }
              }}
              items={[
                {
                  key: 'dashboard',
                  icon: <DashboardOutlined />,
                  label: '系统概览'
                },
                {
                  key: 'games',
                  icon: <AppstoreOutlined />,
                  label: '游戏管理'
                },
                {
                  key: 'servers',
                  icon: <PlayCircleOutlined />,
                  label: '运行服务端'
                },
                {
                  key: 'frp',
                  icon: <GlobalOutlined />,
                  label: '内网穿透'
                },
                {
                  key: 'files',
                  icon: <FolderOutlined />,
                  label: '文件管理'
                }
              ]}
            />
          </Drawer>
        </>
      ) : (
        // 桌面端侧边栏
      <Sider 
        className="fixed-sider"
        collapsible 
        collapsed={collapsed} 
        onCollapse={setCollapsed} 
        theme="light"
        width="var(--sider-width)"
        collapsedWidth="var(--sider-collapsed-width)"
      >
        <div className="logo">
          <CloudServerOutlined /> {!collapsed && <span>GSManager</span>}
        </div>
        <Menu
          theme="light"
          mode="inline"
          selectedKeys={[currentNav]}
          onClick={({ key }) => {
            setCurrentNav(key.toString());
            // 当切换到文件管理时，确保设置有效的默认路径
            if (key === 'files' && (!fileManagerPath || fileManagerPath === '')) {
              setFileManagerPath('/home/steam');
            }
          }}
          items={[
            {
              key: 'dashboard',
              icon: <DashboardOutlined />,
              label: '系统概览'
            },
            {
              key: 'games',
              icon: <AppstoreOutlined />,
              label: '游戏管理'
            },
            {
              key: 'servers',
              icon: <PlayCircleOutlined />,
              label: '运行服务端'
            },
            {
              key: 'frp',
              icon: <GlobalOutlined />,
              label: '内网穿透'
            },
            {
              key: 'files',
              icon: <FolderOutlined />,
              label: '文件管理'
            },
            {
              key: 'about',
              icon: <InfoCircleOutlined />,
              label: '关于项目'
            }
          ]}
        />
      </Sider>
      )}
      
      <Layout 
        className={`site-layout content-with-fixed-sider ${isMobile ? '' : (collapsed ? 'sider-collapsed' : 'sider-expanded')} ${enableRandomBackground ? 'with-random-bg' : 'without-random-bg'} ${!isUserActive && enableInactiveEffect && enableRandomBackground ? 'user-inactive' : ''}`}
      >
        {!isMobile && (
        <Header className="site-header">
          <div className="header-title">
            GameServerManager
          </div>
          <div className="user-info">
            <Tooltip title={enableRandomBackground ? "关闭随机背景" : "开启随机背景"}>
              <Switch 
                checkedChildren="背景" 
                unCheckedChildren="背景" 
                checked={enableRandomBackground}
                onChange={(checked) => setEnableRandomBackground(checked)}
                size="small"
                style={{marginRight: 8}}
              />
            </Tooltip>
            {enableRandomBackground && (
              <Tooltip title={enableInactiveEffect ? "关闭20秒后自动透明效果" : "开启20秒后自动透明效果"}>
                <Switch 
                  checkedChildren="透明" 
                  unCheckedChildren="透明" 
                  checked={enableInactiveEffect}
                  onChange={(checked) => setEnableInactiveEffect(checked)}
                  size="small"
                  style={{marginRight: 8}}
                />
              </Tooltip>
            )}
            <span><UserOutlined /> {username}</span>
            <Button 
              type="link" 
              icon={<LogoutOutlined className="logout-icon" />} 
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="logout-btn"
                size={isMobile ? "small" : "middle"}
            >
                {!isMobile && "退出"}
            </Button>
          </div>
        </Header>
        )}
        
        <Content style={{ width: '100%', maxWidth: '100%', margin: 0, padding: isMobile ? '4px' : '16px' }}>
          {currentNav === 'dashboard' && (
            <ContainerInfo 
              onStartServer={handleStartServer}
              onStopServer={handleStopServer}
              onUninstallGame={handleUninstall}
            />
          )}
          
          {currentNav === 'games' && (
            <div className="game-cards">
              <Title level={2}>游戏服务器管理</Title>
              <Tabs activeKey={tabKey} onChange={setTabKey}>
                <TabPane tab="快速部署" key="install">
                  {gameLoading ? (
                    <div className="loading-container">
                      <Spin size="large" />
                    </div>
                  ) : (
                    <Row gutter={[16, 16]}>
                      {games.map((game) => {
                        const isInstalled = installedGames.includes(game.id);
                        const isInstalling = installOutputs[game.id]?.installing;
                        
                        return (
                          <Col key={game.id} xs={24} sm={12} md={8} lg={6}>
                            <div className="custom-game-card">
                              {/* 游戏封面图片 */}
                              <div className="game-cover">
                                {game.image ? (
                                  <img src={game.image} alt={game.name} />
                                ) : (
                                  <div className="game-cover-placeholder">
                                    <AppstoreOutlined />
                                  </div>
                                )}
                              </div>
                              <div className="card-header">
                                <h3>{game.name}</h3>
                                {isInstalled ? (
                                  <Tag color="green">已安装</Tag>
                                ) : (
                                  <Tag color="blue">{game.anonymous ? '匿名安装' : '需要登录'}</Tag>
                                )}
                              </div>
                              <div className="card-content">
                                <p>AppID: {game.appid}</p>
                              </div>
                              <div className="card-actions">
                                {isInstalled ? (
                                  <>
                                    <button 
                                      className="btn-info"
                                      onClick={() => handleShowDetail(game)}
                                    >
                                      <InfoCircleOutlined /> 详情
                                    </button>
                                    <button 
                                      className="btn-default"
                                      onClick={() => handleUninstall(game)}
                                    >卸载</button>
                                    <button 
                                      className="btn-primary"
                                      onClick={() => handleInstall(game)}
                                    >
                                      {isInstalling ? '更新中...' : '更新'}
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button 
                                      className="btn-info"
                                      onClick={() => handleShowDetail(game)}
                                    >
                                      <InfoCircleOutlined /> 详情
                                    </button>
                                    <button 
                                      className="btn-primary"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isInstalling) {
                                          handleInstallClick(game);
                                        }
                                      }}
                                    >
                                      {isInstalling ? '安装中...' : '安装'}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </Col>
                        );
                      })}
                    </Row>
                  )}
                </TabPane>
                <TabPane tab="通过AppID安装" key="install-by-appid">
                  <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 0' }}>
                    <Card title="通过AppID安装游戏">
                      <Form layout="vertical" onFinish={handleInstallByAppId}>
                        <Form.Item
                          name="appid"
                          label="Steam AppID"
                          rules={[{ required: true, message: '请输入Steam AppID' }]}
                        >
                          <Input placeholder="请输入游戏的Steam AppID，例如: 252490" />
                        </Form.Item>
                        <Form.Item
                          name="name"
                          label="游戏名称"
                          rules={[{ required: true, message: '请输入游戏名称' }]}
                        >
                          <Input placeholder="请输入游戏名称，用于显示" />
                        </Form.Item>
                        <Form.Item
                          name="anonymous"
                          label="安装方式"
                          initialValue={true}
                        >
                          <Radio.Group>
                            <Radio value={true}>匿名安装（无需账号）</Radio>
                            <Radio value={false}>登录安装（需要Steam账号）</Radio>
                          </Radio.Group>
                        </Form.Item>
                        
                        <Form.Item noStyle dependencies={['anonymous']}>
                          {({ getFieldValue }) => {
                            const anonymous = getFieldValue('anonymous');
                            return !anonymous ? (
                              <>
                                <Form.Item
                                  name="account"
                                  label="Steam账号"
                                  rules={[{ required: true, message: '请输入Steam账号' }]}
                                >
                                  <Input placeholder="输入您的Steam账号" />
                                </Form.Item>
                                <Form.Item
                                  name="password"
                                  label="密码"
                                  extra="如您的账号启用了二步验证，安装过程中会提示您输入Steam Guard码"
                                >
                                  <Input.Password placeholder="输入密码 (可选)" />
                                </Form.Item>
                              </>
                            ) : null;
                          }}
                        </Form.Item>
                        
                        <Form.Item>
                          <Button type="primary" htmlType="submit" loading={appIdInstalling}>
                            开始安装
                          </Button>
                        </Form.Item>
                      </Form>
                    </Card>
                  </div>
                </TabPane>
                <TabPane tab="服务端管理" key="server">
                  <div className="server-management">
                    <Title level={3}>游戏服务端列表</Title>
                    <div className="server-controls">
                      <Button onClick={refreshGameLists} icon={<ReloadOutlined />} style={{marginRight: 8}}>刷新列表</Button>
                      <Button onClick={refreshServerStatus} icon={<ReloadOutlined />}>刷新状态</Button>
                    </div>
                    <Row gutter={[16, 16]}>
                      {/* 固定显示SteamCMD */}
                      <Col xs={24} sm={12} md={8} lg={6} key="steamcmd">
                        <Card
                          hoverable
                          className="game-card"
                          title={
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span>SteamCMD</span>
                              <Tag color="blue">工具</Tag>
                            </div>
                          }
                        >
                          <p>Steam游戏服务器命令行工具</p>
                          <p>位置: /home/steam/steamcmd</p>
                          <div style={{marginTop: 12}}>
                            <div style={{marginBottom: 8}}>SteamCMD控制:</div>
                            {runningServers.includes("steamcmd") ? (
                              <div>
                                <Button 
                                  type="default" 
                                  size="small" 
                                  style={{marginRight: 8}}
                                  onClick={() => handleStopServer("steamcmd")}
                                >
                                  停止
                                </Button>
                                <Button 
                                  type="primary" 
                                  size="small"
                                  style={{marginRight: 8}}
                                  onClick={() => handleStartSteamCmd()}
                                >
                                  控制台
                                </Button>
                              </div>
                            ) : (
                              <div style={{display: 'flex', justifyContent: 'center'}}>
                                <Button 
                                  type="primary"
                                  size="middle"
                                  style={{width: '100%'}}
                                  onClick={() => handleStartSteamCmd()}
                                >
                                  启动
                                </Button>
                              </div>
                            )}
                          </div>
                        </Card>
                      </Col>
                      
                      {/* 显示配置中的已安装游戏 */}
                      {games
                        .filter(game => installedGames.includes(game.id))
                        .map(game => (
                          <Col key={game.id} xs={24} sm={12} md={8} lg={6}>
                            <Card
                              title={game.name}
                              extra={
                                runningServers.includes(game.id) ? (
                                  <Tag color="green">运行中</Tag>
                                ) : (
                                  <Tag color="default">未运行</Tag>
                                )
                              }
                            >
                              <p>服务端状态: {runningServers.includes(game.id) ? '运行中' : '已停止'}</p>
                              <div style={{marginTop: 12}}>
                                {runningServers.includes(game.id) ? (
                                  <div>
                                    <div style={{marginBottom: 8}}>
                                      <Button 
                                        danger
                                        size="small"
                                        onClick={() => handleUninstall(game.id)}
                                      >
                                        卸载
                                      </Button>
                                      <span style={{marginLeft: 8}}>
                                        自启动: 
                                        <Switch 
                                          size="small" 
                                          checked={autoRestartServers.includes(game.id)}
                                          onChange={(checked) => handleAutoRestartChange(game.id, checked)}
                                          style={{marginLeft: 4}}
                                        />
                                      </span>
                                    </div>
                                    <Button 
                                      type="default" 
                                      size="small" 
                                      style={{marginRight: 8}}
                                      onClick={() => handleStopServer(game.id)}
                                    >
                                      停止
                                    </Button>
                                    <Button 
                                      type="primary" 
                                      size="small"
                                      style={{marginRight: 8}}
                                      onClick={() => handleStartServer(game.id)}
                                    >
                                      控制台
                                    </Button>
                                    <Button
                                      icon={<FolderOutlined />}
                                      size="small"
                                      onClick={() => handleOpenGameFolder(game.id)}
                                    >
                                      文件夹
                                    </Button>
                                  </div>
                                ) : (
                                  <div>
                                    <div style={{marginBottom: 8}}>
                                      <Button 
                                        danger
                                        size="small"
                                        onClick={() => handleUninstall(game.id)}
                                      >
                                        卸载
                                      </Button>
                                      <span style={{marginLeft: 8}}>
                                        自启动: 
                                        <Switch 
                                          size="small" 
                                          checked={autoRestartServers.includes(game.id)}
                                          onChange={(checked) => handleAutoRestartChange(game.id, checked)}
                                          style={{marginLeft: 4}}
                                        />
                                      </span>
                                    </div>
                                    <div style={{display: 'flex', justifyContent: 'center'}}>
                                      <Button 
                                        type="primary"
                                        size="middle"
                                        style={{marginRight: 8, width: '45%'}}
                                        onClick={() => handleStartServer(game.id)}
                                      >
                                        启动
                                      </Button>
                                      <Button
                                        icon={<FolderOutlined />}
                                        size="middle"
                                        style={{width: '45%'}}
                                        onClick={() => handleOpenGameFolder(game.id)}
                                      >
                                        文件夹
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </Card>
                          </Col>
                        ))}
                        
                      {/* 显示外部游戏 */}
                      {externalGames.map(game => (
                        <Col key={game.id} xs={24} sm={12} md={8} lg={6}>
                          <Card
                            title={
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>{game.name}</span>
                                <Tag color="orange">外来</Tag>
                              </div>
                            }
                          >
                            <p>位置: /home/steam/games/{game.id}</p>
                            <div style={{marginTop: 12}}>
                              <div style={{marginBottom: 8}}>服务器控制:</div>
                              {runningServers.includes(game.id) ? (
                                <div>
                                  <div style={{marginBottom: 8}}>
                                    <Button 
                                      danger
                                      size="small"
                                      onClick={() => handleUninstall(game.id)}
                                    >
                                      卸载
                                    </Button>
                                    <span style={{marginLeft: 8}}>
                                      自启动: 
                                      <Switch 
                                        size="small" 
                                        checked={autoRestartServers.includes(game.id)}
                                        onChange={(checked) => handleAutoRestartChange(game.id, checked)}
                                        style={{marginLeft: 4}}
                                      />
                                    </span>
                                  </div>
                                  <Button 
                                    type="default" 
                                    size="small" 
                                    style={{marginRight: 8}}
                                    onClick={() => handleStopServer(game.id)}
                                  >
                                    停止
                                  </Button>
                                  <Button 
                                    type="primary" 
                                    size="small"
                                    style={{marginRight: 8}}
                                    onClick={() => handleStartServer(game.id)}
                                  >
                                    控制台
                                  </Button>
                                  <Button
                                    icon={<FolderOutlined />}
                                    size="small"
                                    onClick={() => handleOpenGameFolder(game.id)}
                                  >
                                    文件夹
                                  </Button>
                                </div>
                              ) : (
                                <div>
                                  <div style={{marginBottom: 8}}>
                                    <Button 
                                      danger
                                      size="small"
                                      onClick={() => handleUninstall(game.id)}
                                    >
                                      卸载
                                    </Button>
                                    <span style={{marginLeft: 8}}>
                                      自启动: 
                                      <Switch 
                                        size="small" 
                                        checked={autoRestartServers.includes(game.id)}
                                        onChange={(checked) => handleAutoRestartChange(game.id, checked)}
                                        style={{marginLeft: 4}}
                                      />
                                    </span>
                                  </div>
                                  <div style={{display: 'flex', justifyContent: 'center'}}>
                                    <Button 
                                      type="primary"
                                      size="middle"
                                      style={{marginRight: 8, width: '45%'}}
                                      onClick={() => handleStartServer(game.id)}
                                    >
                                      启动
                                    </Button>
                                    <Button
                                      icon={<FolderOutlined />}
                                      size="middle"
                                      style={{width: '45%'}}
                                      onClick={() => handleOpenGameFolder(game.id)}
                                    >
                                      文件夹
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </Card>
                        </Col>
                      ))}

                      {games.filter(g => installedGames.includes(g.id)).length === 0 && externalGames.length === 0 && (
                        <Col span={24}><p>除了SteamCMD外，暂无已安装的游戏。</p></Col>
                      )}
                    </Row>
                  </div>
                </TabPane>
              </Tabs>
            </div>
          )}
          
          {currentNav === 'servers' && (
            <div className="running-servers">
              <Title level={2}>运行中的服务端</Title>
              <Button onClick={refreshServerStatus} icon={<ReloadOutlined />} style={{ marginBottom: 16 }}>
                刷新状态
              </Button>
              <Row gutter={[16, 16]}>
                {/* 显示配置中的游戏 */}
                {games
                  .filter(game => runningServers.includes(game.id))
                  .map(game => (
                    <Col key={game.id} xs={24} sm={12} md={8} lg={6}>
                      <Card
                        title={game.name}
                        extra={<Tag color="green">运行中</Tag>}
                        actions={[
                          <Button
                            key="console"
                            type="primary"
                            size="small"
                            style={{ width: '100%', maxWidth: '100px' }}
                            onClick={() => handleStartServer(game.id)}
                          >
                            控制台
                          </Button>,
                          <Button
                            key="folder"
                            icon={<FolderOutlined />}
                            size="small"
                            style={{ width: '100%', maxWidth: '100px' }}
                            onClick={() => handleOpenGameFolder(game.id)}
                          >
                            文件夹
                          </Button>,
                          <Dropdown key="stop" overlay={
                            <Menu>
                              <Menu.Item key="1" onClick={() => handleStopServer(game.id, false)}>
                                标准停止(Ctrl+C)
                              </Menu.Item>
                              <Menu.Item key="2" danger onClick={() => handleStopServer(game.id, true)}>
                                强行停止(Kill)
                              </Menu.Item>
                            </Menu>
                          } trigger={['click']} overlayClassName="stop-server-dropdown">
                            <Button danger size="small" style={{ width: '100%', maxWidth: '100px' }}>
                              停止服务端 <DownOutlined />
                            </Button>
                          </Dropdown>
                        ]}
                      >
                        <p>位置: /home/steam/games/{game.id}</p>
                        <div style={{marginTop: 8}}>
                          自启动: 
                          <Switch 
                            size="small" 
                            checked={autoRestartServers.includes(game.id)}
                            onChange={(checked) => handleAutoRestartChange(game.id, checked)}
                            style={{marginLeft: 4}}
                          />
                        </div>
                      </Card>
                    </Col>
                  ))}
                  
                {/* 显示运行中的外部游戏 */}
                {externalGames
                  .filter(game => runningServers.includes(game.id))
                  .map(game => (
                    <Col key={game.id} xs={24} sm={12} md={8} lg={6}>
                      <Card
                        title={
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>{game.name}</span>
                            <Tag color="orange">外来</Tag>
                          </div>
                        }
                        extra={<Tag color="green">运行中</Tag>}
                        actions={[
                          <Button
                            key="console"
                            type="primary"
                            size="small"
                            style={{ width: '100%', maxWidth: '100px' }}
                            onClick={() => handleStartServer(game.id)}
                          >
                            控制台
                          </Button>,
                          <Button
                            key="folder"
                            icon={<FolderOutlined />}
                            size="small"
                            style={{ width: '100%', maxWidth: '100px' }}
                            onClick={() => handleOpenGameFolder(game.id)}
                          >
                            文件夹
                          </Button>,
                          <Dropdown key="stop" overlay={
                            <Menu>
                              <Menu.Item key="1" onClick={() => handleStopServer(game.id, false)}>
                                标准停止(Ctrl+C)
                              </Menu.Item>
                              <Menu.Item key="2" danger onClick={() => handleStopServer(game.id, true)}>
                                强行停止(Kill)
                              </Menu.Item>
                            </Menu>
                          } trigger={['click']} overlayClassName="stop-server-dropdown">
                            <Button danger size="small" style={{ width: '100%', maxWidth: '100px' }}>
                              停止服务端 <DownOutlined />
                            </Button>
                          </Dropdown>
                        ]}
                      >
                        <p>位置: /home/steam/games/{game.id}</p>
                        <div style={{marginTop: 8}}>
                          自启动: 
                          <Switch 
                            size="small" 
                            checked={autoRestartServers.includes(game.id)}
                            onChange={(checked) => handleAutoRestartChange(game.id, checked)}
                            style={{marginLeft: 4}}
                          />
                        </div>
                      </Card>
                    </Col>
                  ))}
                  
                {runningServers.length === 0 && (
                  <Col span={24}>
                    <div className="empty-servers">
                      <p>当前没有正在运行的服务端</p>
                    </div>
                  </Col>
                )}
              </Row>
            </div>
          )}

          {currentNav === 'files' && (
            <div className="file-management">
              <Title level={2}>文件管理</Title>
              <FileManager initialPath={fileManagerPath || '/home/steam'} />
            </div>
          )}

          {currentNav === 'frp' && (
            <div className="frp-management">
              <FrpManager />
            </div>
          )}
          
          {currentNav === 'about' && (
            <div className="about-page">
              <About />
            </div>
          )}
        </Content>
        <Footer style={{ textAlign: 'center' }}>GameServerManager ©2025 又菜又爱玩的小朱</Footer>
      </Layout>

      {/* 安装终端Modal */}
      <Modal
        title={`安装 ${selectedGame?.name || ''} 服务端`}
        open={terminalVisible}
        onCancel={closeTerminal}
        footer={null}
        width={800}
        maskClosable={false}
        style={{ top: 20 }}
        bodyStyle={{ padding: 0 }}
      >
        {selectedGame && (
          <Terminal
            output={currentOutput}
            loading={currentInstalling}
            complete={currentComplete}
            gameId={selectedGame.id}
            onSendInput={handleSendInput}
            onTerminate={handleTerminateInstall}
          />
        )}
      </Modal>

      {/* 服务器终端Modal */}
      <Modal
        title={`${selectedServerGame?.name || ''} 服务端控制台`}
        open={serverModalVisible}
        onCancel={() => {
          setServerModalVisible(false);
          // 关闭控制台时刷新服务器状态
          refreshServerStatus();
        }}
        footer={
          <div className="server-console-buttons">
            <Button key="reconnect" type="primary" ghost 
              onClick={() => {
                // 重新连接到控制台，保留现有输出并获取历史记录
                handleStartServer(selectedServerGame?.id, true);
              }}
              size={isMobile ? "small" : "middle"}
            >
              重新连接
            </Button>
            <Button key="clear" 
              onClick={() => {
                // 清空当前输出
                if (selectedServerGame?.id) {
                  setServerOutputs(prev => ({
                    ...prev,
                    [selectedServerGame.id]: []
                  }));
                }
              }}
              size={isMobile ? "small" : "middle"}
            >
              清空输出
            </Button>
            <Button key="stop" danger
              onClick={() => {
                handleStopServer(selectedServerGame?.id);
              }}
              size={isMobile ? "small" : "middle"}
            >
              停止服务器
            </Button>
            <Button key="close" 
              onClick={() => {
                setServerModalVisible(false);
                // 关闭控制台时刷新服务器状态
                refreshServerStatus();
              }}
              size={isMobile ? "small" : "middle"}
            >
              关闭控制台
            </Button>
          </div>
        }
        width={isMobile ? "95%" : 800}
      >
        <div className="server-console">
          <div className="terminal-container">
            <div className="terminal-output">
              {(serverOutputs[selectedServerGame?.id] || [])
                .filter(line => !line.includes('等待服务器输出...'))
                .map((line, index) => {
                // 处理不同类型的输出行
                let lineClass = "terminal-line";
                let lineContent = line;
                
                // 检查是否为特殊类型的输出
                if (typeof line === 'string') {
                  if (line.includes('===')) {
                    lineClass += " section-header";
                  } else if (line.includes('[文件]') || line.includes('[文件输出]')) {
                    lineClass += " file-output";
                  } else if (line.includes('[心跳检查]')) {
                    lineClass += " heartbeat-output";
                  } else if (line.startsWith('>')) {
                    lineClass += " command-input";
                  }
                }
                
                return (
                  <div 
                    key={index} 
                    className={lineClass}
                  >
                    {lineContent}
                  </div>
                );
              })}
              <div ref={terminalEndRef} className="terminal-end-ref" />
            </div>
          </div>
          <div className="terminal-input">
            <Input.Search
              placeholder="输入命令..."
              enterButton="发送"
              value={serverInput}
              onChange={(e) => setServerInput(e.target.value)}
              onSearch={value => {
                if (value.trim()) {
                  handleSendServerInput(selectedServerGame?.id, value);
                  setServerInput('');
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') {
                  // 实现历史命令功能
                  if (inputHistory.length > 0 && inputHistoryIndex < inputHistory.length - 1) {
                    setInputHistoryIndex(prev => prev + 1);
                    setServerInput(inputHistory[inputHistory.length - 1 - inputHistoryIndex - 1]);
                  }
                } else if (e.key === 'ArrowDown') {
                  if (inputHistoryIndex > 0) {
                    setInputHistoryIndex(prev => prev - 1);
                    setServerInput(inputHistory[inputHistory.length - 1 - inputHistoryIndex + 1]);
                  } else {
                    setInputHistoryIndex(-1);
                    setServerInput('');
                  }
                }
              }}
            />
          </div>
        </div>
      </Modal>

      {/* 账号输入Modal */}
      <Modal
        title="输入Steam账号"
        open={accountModalVisible}
        onOk={onAccountModalOk}
        onCancel={() => {
          setAccountModalVisible(false);
          setPendingInstallGame(null);
        }}
        okText="安装"
        cancelText="取消"
      >
        <Form form={accountForm} layout="vertical">
          <Form.Item
            name="account"
            label="Steam账号"
            rules={[{ required: true, message: '请输入Steam账号' }]}
          >
            <Input placeholder="输入您的Steam账号" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码 (可选)"
            extra="如您的账号启用了二步验证，安装过程中会提示您输入Steam Guard码"
          >
            <Input.Password placeholder="输入密码 (可选)" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 游戏详情Modal */}
      <Modal
        title={`${detailGame?.name || ''} 详细信息`}
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={isMobile ? "95%" : 600}
      >
        {detailGame && (
          <div className="game-detail">
            {detailGame.image && (
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <img 
                  src={detailGame.image} 
                  alt={detailGame.name} 
                  style={{ maxWidth: '100%', maxHeight: '200px' }} 
                />
              </div>
            )}
            <p><strong>游戏ID:</strong> {detailGame.id}</p>
            <p><strong>AppID:</strong> {detailGame.appid}</p>
            <p><strong>安装方式:</strong> {detailGame.anonymous ? '匿名安装' : '需要登录'}</p>
            <p><strong>包含启动脚本:</strong> {detailGame.has_script ? '是' : '否'}</p>
            
            {detailGame.tip && (
              <div>
                <strong>安装提示:</strong>
                <div className="game-detail-tip">
                  {detailGame.tip}
                </div>
              </div>
            )}
            
            {/* 添加从Steam中打开按钮 */}
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <p style={{ marginBottom: 10, fontSize: 13, color: '#888' }}>
                点击下方按钮将在新窗口打开Steam商店页面
              </p>
              <Button 
                type="primary" 
                size="large"
                onClick={() => handleOpenInSteam(detailGame.url || '', detailGame.appid)}
                icon={<CloudServerOutlined />}
              >
                在Steam中查看
              </Button>
            </div>
          </div>
        )}
      </Modal>
      
      {/* 文件管理器Modal */}
      <Modal
        title={`游戏文件管理 - ${fileManagerPath.split('/').pop() || ''}`}
        open={fileManagerVisible}
        onCancel={() => setFileManagerVisible(false)}
        footer={null}
        width={isMobile ? "95%" : "80%"}
        style={{ top: 20 }}
        bodyStyle={{ 
          padding: 0, 
          maxHeight: 'calc(100vh - 150px)',
          minHeight: isMobile ? '400px' : '550px',
          overflow: 'auto',
          paddingBottom: '30px'
        }}
      >
        <FileManager initialPath={fileManagerPath} />
      </Modal>
      
      {/* 添加内网穿透文档弹窗 */}
      <FrpDocModal visible={frpDocModalVisible} onClose={handleCloseFrpDocModal} />
      
      {/* 添加文件管理帮助弹窗 */}
      <FileManagerHelpModal visible={fileManagerHelpModalVisible} onClose={handleCloseFileManagerHelpModal} />
    </Layout>
  );
};

export default App; 