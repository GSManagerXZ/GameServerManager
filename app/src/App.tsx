import React, { useState, useEffect, useCallback } from 'react';
import { Layout, Typography, Row, Col, Card, Button, Spin, message, Tooltip, Modal, Tabs, Form, Input, Menu, Tag, Dropdown, Radio } from 'antd';
import { CloudServerOutlined, DashboardOutlined, AppstoreOutlined, PlayCircleOutlined, ReloadOutlined, DownOutlined, InfoCircleOutlined, FolderOutlined, UserOutlined, LogoutOutlined, LockOutlined } from '@ant-design/icons';
import axios from 'axios';
// 导入antd样式
import 'antd/dist/antd.css';
import './App.css';
import Terminal from './components/Terminal';
import ContainerInfo from './components/ContainerInfo';
import FileManager from './components/FileManager';
import Register from './components/Register'; // 导入注册组件
import { fetchGames, installGame, terminateInstall, installByAppId, openGameFolder } from './api';
import { GameInfo } from './types';
import { useAuth } from './context/AuthContext';
import { useNavigate } from 'react-router-dom';

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
const startServer = async (gameId: string, callback?: (line: any) => void, onComplete?: () => void, onError?: (error: any) => void) => {
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
    const eventSource = new EventSource(`/api/server/stream?game_id=${gameId}${token ? `&token=${token}` : ''}`);
    // console.log(`已建立到 ${gameId} 服务器的SSE连接`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // console.log(`收到服务器输出:`, data);
        
        // 处理完成消息
        if (data.complete) {
          // console.log(`服务器输出完成，关闭SSE连接`);
          eventSource.close();
          if (onComplete) onComplete();
          return;
        }
        
        // 处理心跳包
        if (data.heartbeat) return;
        
        // 处理超时消息
        if (data.timeout) {
          // console.log(`服务器连接超时`);
          eventSource.close();
          if (onError) onError(new Error(data.message || '连接超时'));
          return;
        }
        
        // 处理错误消息
        if (data.error) {
          // console.error(`服务器返回错误: ${data.error}`);
          eventSource.close();
          if (onError) onError(new Error(data.error));
          return;
        }
        
        // 处理普通输出行
        if (data.line && callback) {
          callback(data.line);
        }
      } catch (err) {
        // console.error('解析服务器输出失败:', err, event.data);
        if (onError) onError(new Error(`解析服务器输出失败: ${err}`));
      }
    };
    
    eventSource.onerror = (error) => {
      // console.error('SSE连接错误:', error);
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
    const response = await axios.post('/api/server/stop', { 
      game_id: gameId,
      force
    });
    return response.data;
  } catch (error) {
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
  const [serverOutputs, setServerOutputs] = useState<{[key: string]: any[]}>({});
  const [runningServers, setRunningServers] = useState<string[]>([]);
  const [serverModalVisible, setServerModalVisible] = useState<boolean>(false);
  const [selectedServerGame, setSelectedServerGame] = useState<GameInfo | null>(null);
  
  // 导航相关状态
  const [currentNav, setCurrentNav] = useState<string>('dashboard');
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // 新增：文件管理窗口相关状态
  const [fileManagerVisible, setFileManagerVisible] = useState<boolean>(false);
  const [fileManagerPath, setFileManagerPath] = useState<string>('/home/steam');

  const navigate = useNavigate();

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
      const response = await axios.get('/api/server/status');
      if (response.data.status === 'success' && response.data.servers) {
        const running = Object.keys(response.data.servers).filter(
          id => response.data.servers[id].status === 'running'
        );
        setRunningServers(running);
      }
    } catch (error) {
      // console.error('检查服务器状态失败:', error);
    }
  }, []);

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
            message.error(`找不到游戏信息 (ID: ${gameId})`);
            return;
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
  const onAccountModalOk = async (values: { username: string; password: string }) => {
    try {
      setAccountFormLoading(true);
      const success = await login(values.username, values.password);
      
      if (success) {
        message.success('登录成功');
      } else {
        message.error('登录失败，请检查用户名和密码');
      }
    } catch (error) {
      message.error('登录失败，请稍后重试');
    } finally {
      setAccountFormLoading(false);
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
      // console.error('刷新游戏列表失败:', error);
    }
  }, []);

  // 当已安装游戏列表变化时，刷新服务器状态
  useEffect(() => {
    refreshServerStatus();
  }, [installedGames, externalGames, refreshServerStatus]);

  // 服务器相关函数
  const handleStartServer = useCallback(async (gameId: string) => {
    try {
      // console.log(`处理启动服务器请求: ${gameId}`);
      
      // 对于外部游戏，获取游戏名称
      let gameName = gameId;
      let gameObj = games.find(g => g.id === gameId);
      
      // 如果在games中找不到，可能是外部游戏
      if (!gameObj) {
        const externalGame = externalGames.find(g => g.id === gameId);
        if (externalGame) {
          gameObj = externalGame;
          gameName = externalGame.name;
          // console.log(`找到外部游戏: ${gameName}`);
        } else {
          // console.log(`警告: 找不到游戏对象 ${gameId}`);
        }
      }
      
      const response = await startServer(
        gameId,
        (line) => {
          // console.log(`服务器输出 (${gameId}):`, line);
          setServerOutputs(prev => {
            const old = prev[gameId] || [];
            return {
              ...prev,
              [gameId]: [...old, line]
            };
          });
        },
        () => {
          // 服务器已停止
          // console.log(`服务器已停止: ${gameId}`);
          message.success(`服务器已停止`);
          refreshServerStatus();
        },
        (error) => {
          // console.error(`启动服务器错误: ${error?.message || error}`);
          message.error(`启动服务器失败: ${error?.message || '未知错误'}`);
        }
      );
      
      // 打开服务器终端
      if (gameObj) {
        setSelectedServerGame(gameObj);
        setServerModalVisible(true);
      } else {
        // 如果找不到游戏对象，创建一个临时对象
        setSelectedServerGame({
          id: gameId,
          name: gameName || gameId,
          appid: '',
          anonymous: true,
          has_script: true,
          external: true
        });
        setServerModalVisible(true);
      }
      
      return response;
    } catch (error) {
      // console.error(`handleStartServer错误:`, error);
      handleError(error);
      return null;
    }
  }, [games, externalGames, refreshServerStatus]);

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
        message.success(`服务器已${force ? '强行' : '标准'}停止`);
        // 刷新运行中的服务器列表
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
    } catch (error) {
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

  // 渲染服务器管理按钮
  const renderServerButtons = (game: GameInfo) => {
    const isRunning = runningServers.includes(game.id);
    
    if (isRunning) {
      return (
        <>
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
        </>
      );
    } else {
      return (
        <>
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
        </>
      );
    }
  };

  // 服务器管理Tab内容
  const renderServerManager = () => (
    <div style={{marginTop: 32}}>
      <Title level={3}>已安装的游戏</Title>
      <Row gutter={[16, 16]}>
        {/* 显示配置中的已安装游戏 */}
        {games.filter(g => installedGames.includes(g.id)).map(game => (
          <Col xs={24} sm={12} md={8} lg={6} key={game.id}>
            <Card
              hoverable
              className="game-card"
              title={game.name}
              extra={renderGameButtons(game)}
            >
              <p>AppID: {game.appid}</p>
              <p>账户: {game.anonymous ? '匿名' : '需要账户'}</p>
              <div style={{marginTop: 12}}>
                <div style={{marginBottom: 8}}>服务器控制:</div>
                {renderServerButtons(game)}
              </div>
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
                  <>
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
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
              <Button
                danger
                style={{marginTop: 12}}
                onClick={() => handleUninstall(game.id)}
              >
                卸载
              </Button>
            </Card>
          </Col>
        ))}

        {games.filter(g => installedGames.includes(g.id)).length === 0 && externalGames.length === 0 && (
          <Col span={24}><p>暂无已安装的游戏。</p></Col>
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
      const success = await openGameFolder(gameId);
      if (!success) {
        message.error('无法打开游戏文件夹');
      }
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
            onFinish={onAccountModalOk}
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
    <Layout style={{ minHeight: '100vh' }}>
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
              key: 'files',
              icon: <FolderOutlined />,
              label: '文件管理'
            }
          ]}
        />
      </Sider>
      <Layout 
        className={`site-layout content-with-fixed-sider ${collapsed ? 'sider-collapsed' : 'sider-expanded'}`}
      >
        <Header className="site-header">
          <div className="header-title">
            GameServerManager
          </div>
          <div className="user-info">
            <span><UserOutlined /> {username}</span>
            <Button 
              type="link" 
              icon={<LogoutOutlined className="logout-icon" />} 
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="logout-btn"
            >
              退出
            </Button>
          </div>
        </Header>
        <Content style={{ width: '100%', maxWidth: '100%', margin: 0, padding: '16px' }}>
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
                                {renderServerButtons(game)}
                              </div>
                              <Button
                                danger
                                style={{marginTop: 12}}
                                onClick={() => handleUninstall(game)}
                              >
                                卸载
                              </Button>
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
                              {runningServers.includes(game.id) ? (
                                <>
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
                                </>
                              ) : (
                                <>
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
                                </>
                              )}
                            </div>
                            <Button
                              danger
                              style={{marginTop: 12}}
                              onClick={() => handleUninstall(game.id)}
                            >
                              卸载
                            </Button>
                          </Card>
                        </Col>
                      ))}

                      {games.filter(g => installedGames.includes(g.id)).length === 0 && externalGames.length === 0 && (
                        <Col span={24}><p>暂无已安装的游戏。</p></Col>
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
                            key="view" 
                            type="primary" 
                            onClick={() => {
                              setSelectedServerGame(game);
                              setServerModalVisible(true);
                            }}
                          >
                            查看控制台
                          </Button>,
                          <Button
                            key="folder"
                            icon={<FolderOutlined />}
                            onClick={() => handleOpenGameFolder(game.id)}
                          >
                            打开文件夹
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
                            <Button danger>
                              停止服务端 <DownOutlined />
                            </Button>
                          </Dropdown>
                        ]}
                      >
                        <p>游戏ID: {game.id}</p>
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
                            key="view" 
                            type="primary" 
                            onClick={() => {
                              setSelectedServerGame(game);
                              setServerModalVisible(true);
                            }}
                          >
                            查看控制台
                          </Button>,
                          <Button
                            key="folder"
                            icon={<FolderOutlined />}
                            onClick={() => handleOpenGameFolder(game.id)}
                          >
                            打开文件夹
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
                            <Button danger>
                              停止服务端 <DownOutlined />
                            </Button>
                          </Dropdown>
                        ]}
                      >
                        <p>位置: /home/steam/games/{game.id}</p>
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
        onCancel={() => setServerModalVisible(false)}
        footer={null}
        width={800}
        maskClosable={false}
        style={{ top: 20 }}
        bodyStyle={{ padding: 0 }}
      >
        {selectedServerGame && (
          <Terminal
            output={serverOutputs[selectedServerGame.id] || []}
            loading={false}
            complete={false}
            gameId={selectedServerGame.id}
            onSendInput={handleServerInput}
            allowInput={true}
          />
        )}
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
        width={600}
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
        width="80%"
        style={{ top: 20 }}
        bodyStyle={{ 
          padding: 0, 
          maxHeight: 'calc(100vh - 150px)',
          minHeight: '550px',
          overflow: 'auto',
          paddingBottom: '30px'
        }}
      >
        <FileManager initialPath={fileManagerPath} />
      </Modal>
    </Layout>
  );
};

export default App; 