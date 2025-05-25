import React, { useState, useEffect } from 'react';
import { Card, Progress, Statistic, Table, Typography, Button, Space, Row, Col, Divider, Tag, Dropdown, Menu } from 'antd';
import { ReloadOutlined, HddOutlined, RocketOutlined, AppstoreOutlined, DownOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Title, Paragraph } = Typography;

interface SystemInfo {
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
  games_space?: Record<string, number>;
}

interface GameInfo {
  id: string;
  name: string;
  size_mb?: number;
  started_at?: number;
  uptime?: number;
  external?: boolean;
}

interface ContainerInfoProps {
  onInstallGame?: (gameId: string) => void;
  onStartServer?: (gameId: string) => void;
  onStopServer?: (gameId: string, force?: boolean) => void;
  onUninstallGame?: (gameId: string) => void;
}

const ContainerInfo: React.FC<ContainerInfoProps> = ({
  onInstallGame,
  onStartServer,
  onStopServer,
  onUninstallGame
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [installedGames, setInstalledGames] = useState<GameInfo[]>([]);
  const [runningGames, setRunningGames] = useState<GameInfo[]>([]);

  const fetchContainerInfo = async () => {
    setLoading(true);
    try {
      const [containerInfoResp, installedGamesResp] = await Promise.all([
        axios.get('/api/container_info'),
        axios.get('/api/installed_games')
      ]);
      
      if (containerInfoResp.data.status === 'success') {
        setSystemInfo(containerInfoResp.data.system_info);
        setRunningGames(containerInfoResp.data.running_games || []);
        
        // 处理已安装游戏列表
        let allInstalledGames = containerInfoResp.data.installed_games || [];
        
        // 加入外部游戏
        if (installedGamesResp.data.status === 'success' && installedGamesResp.data.external) {
          const externalGames = installedGamesResp.data.external.map((game: any) => ({
            ...game,
            size_mb: containerInfoResp.data.system_info?.games_space?.[game.id] || 0
          }));
          
          // 合并正常游戏和外部游戏
          allInstalledGames = [...allInstalledGames, ...externalGames];
        }
        
        setInstalledGames(allInstalledGames);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContainerInfo();
    // 设置定时刷新（每30秒）
    const interval = setInterval(fetchContainerInfo, 30000);
    return () => clearInterval(interval);
  }, []);

  // 格式化时间显示
  const formatUptime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时${minutes}分钟`;
  };

  // 格式化大小显示
  const formatSize = (mb: number): string => {
    if (mb < 1024) {
      return `${mb.toFixed(1)} MB`;
    }
    return `${(mb / 1024).toFixed(1)} GB`;
  };

  // 格式化磁盘/内存大小显示（GB格式）
  const formatGB = (gb: number): string => {
    return `${gb.toFixed(1)}`;
  };
  
  // 格式化GB大小对的显示
  const formatGBPair = (used: number, total: number): string => {
    return `${formatGB(used)}/${formatGB(total)} GB`;
  };

  const installedGamesColumns = [
    {
      title: '游戏名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: GameInfo) => (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span>{name}</span>
          {record.external && <Tag color="orange" style={{ marginLeft: 8 }}>外来</Tag>}
        </div>
      ),
    },
    {
      title: '占用空间',
      dataIndex: 'size_mb',
      key: 'size',
      render: (size_mb: number) => formatSize(size_mb),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record: GameInfo) => (
        <Space size="small">
          {runningGames.some(game => game.id === record.id) ? (
            <Dropdown overlay={
              <Menu>
                <Menu.Item key="1" onClick={() => onStopServer && onStopServer(record.id, false)}>
                  标准停止(Ctrl+C)
                </Menu.Item>
                <Menu.Item key="2" danger onClick={() => onStopServer && onStopServer(record.id, true)}>
                  强行停止(Kill)
                </Menu.Item>
              </Menu>
            } trigger={['click']} overlayClassName="stop-server-dropdown">
              <Button size="small" danger>
                停止 <DownOutlined />
              </Button>
            </Dropdown>
          ) : (
            <Button size="small" type="primary" onClick={() => onStartServer && onStartServer(record.id)}>启动</Button>
          )}
          <Button size="small" danger onClick={() => onUninstallGame && onUninstallGame(record.id)}>卸载</Button>
        </Space>
      ),
    },
  ];

  const runningGamesColumns = [
    {
      title: '游戏名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '运行时间',
      dataIndex: 'uptime',
      key: 'uptime',
      render: (uptime: number) => formatUptime(uptime),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record: GameInfo) => (
        <Dropdown overlay={
          <Menu>
            <Menu.Item key="1" onClick={() => onStopServer && onStopServer(record.id, false)}>
              标准停止(Ctrl+C)
            </Menu.Item>
            <Menu.Item key="2" danger onClick={() => onStopServer && onStopServer(record.id, true)}>
              强行停止(Kill)
            </Menu.Item>
          </Menu>
        } trigger={['click']} overlayClassName="stop-server-dropdown">
          <Button size="small" danger>
            停止服务器 <DownOutlined />
          </Button>
        </Dropdown>
      ),
    },
  ];

  return (
    <div className="container-info" style={{ width: '100%', maxWidth: '100%' }}>
      <div className="page-header">
        <Title level={2}>容器信息面板</Title>
        <Paragraph>
          查看容器资源占用情况、已安装游戏和正在运行的游戏服务器
        </Paragraph>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={fetchContainerInfo}
          loading={loading}
        >
          刷新信息
        </Button>
      </div>

      <Divider />

      <Row gutter={16} className="resource-cards">
        <Col span={8}>
          <Card title={<><HddOutlined /> CPU使用率</>} loading={loading}>
            <Progress 
              type="dashboard" 
              percent={Math.round(systemInfo?.cpu_usage || 0)} 
              status={systemInfo?.cpu_usage && systemInfo.cpu_usage > 90 ? 'exception' : 'normal'} 
              format={percent => `${Math.round(percent || 0)}%`}
            />
            <Statistic title="使用率" value={`${Math.round(systemInfo?.cpu_usage || 0)}%`} />
          </Card>
        </Col>
        <Col span={8}>
          <Card title={<><HddOutlined /> 内存使用</>} loading={loading}>
            <Progress 
              type="dashboard" 
              percent={Math.round(systemInfo?.memory.percent || 0)} 
              status={systemInfo?.memory.percent && systemInfo.memory.percent > 90 ? 'exception' : 'normal'} 
              format={percent => `${Math.round(percent || 0)}%`}
            />
            <Statistic 
              title="使用/总量" 
              value={systemInfo ? formatGBPair(systemInfo.memory.used, systemInfo.memory.total) : '-'} 
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card title={<><HddOutlined /> 磁盘使用</>} loading={loading}>
            <Progress 
              type="dashboard" 
              percent={Math.round(systemInfo?.disk.percent || 0)}
              status={systemInfo?.disk.percent && systemInfo.disk.percent > 90 ? 'exception' : 'normal'} 
              format={percent => `${Math.round(percent || 0)}%`}
            />
            <Statistic 
              title="使用/总量" 
              value={systemInfo ? formatGBPair(systemInfo.disk.used, systemInfo.disk.total) : '-'} 
            />
          </Card>
        </Col>
      </Row>

      <Divider />

      <Row gutter={16} className="games-tables">
        <Col span={12}>
          <Card 
            title={<><AppstoreOutlined /> 已安装游戏 ({installedGames.length})</>} 
            extra={<Tag color="blue">{formatSize(installedGames.reduce((acc, game) => acc + (game.size_mb || 0), 0))}</Tag>}
            loading={loading}
          >
            <Table 
              dataSource={installedGames} 
              columns={installedGamesColumns} 
              rowKey="id"
              pagination={false}
              size="small"
              locale={{ emptyText: '暂无已安装游戏' }}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card 
            title={<><RocketOutlined /> 正在运行的服务器 ({runningGames.length})</>}
            loading={loading}
          >
            <Table 
              dataSource={runningGames} 
              columns={runningGamesColumns} 
              rowKey="id"
              pagination={false}
              size="small"
              locale={{ emptyText: '暂无正在运行的服务器' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default ContainerInfo; 