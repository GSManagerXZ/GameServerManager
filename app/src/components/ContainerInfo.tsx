import React, { useState, useEffect } from 'react';
import { Card, Progress, Statistic, Table, Typography, Button, Space, Row, Col, Divider, Tag, Dropdown, Menu, Alert } from 'antd';
import { ReloadOutlined, HddOutlined, RocketOutlined, AppstoreOutlined, DownOutlined, GlobalOutlined, WarningOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useIsMobile } from '../hooks/useIsMobile'; // 导入移动端检测钩子

const { Title, Paragraph } = Typography;

interface SystemInfo {
  cpu_usage: number;
  cpu_model?: string;
  cpu_cores?: number;
  cpu_logical_cores?: number;
  memory: {
    total: number;
    used: number;
    percent: number;
    frequency?: string;
  };
  disk: {
    total: number;
    used: number;
    percent: number;
  };
  games_space?: Record<string, number>;
  network?: {
    interfaces: Record<string, {
      addresses: Array<{
        type: string;
        address: string;
        netmask: string;
      }>;
      status: string;
      speed: number;
      duplex: string;
      mtu: number;
    }>;
    public_ip: {
      ipv4: string | null;
      ipv6: string | null;
    };
    io_stats: Record<string, {
      bytes_sent: number;
      bytes_recv: number;
      packets_sent: number;
      packets_recv: number;
      errin: number;
      errout: number;
      dropin: number;
      dropout: number;
    }>;
  };
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
  const [networkStats, setNetworkStats] = useState<{sent: number[], recv: number[]}>({sent: [], recv: []});
  const isMobile = useIsMobile(); // 检测是否为移动端

  const fetchContainerInfo = async () => {
    setLoading(true);
    try {
      // 添加超时处理
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
      
      try {
        const [containerInfoResp, installedGamesResp, networkInfoResp] = await Promise.all([
          axios.get('/api/container_info', { 
            signal: controller.signal,
            timeout: 10000 // 设置axios超时
          }),
          axios.get('/api/installed_games', { 
            signal: controller.signal,
            timeout: 10000 
          }),
          axios.get('/api/network_info', { 
            signal: controller.signal,
            timeout: 10000 
          })
        ]);
        
        // 清除超时定时器
        clearTimeout(timeoutId);
        
        if (containerInfoResp.data.status === 'success') {
          const sysInfo = containerInfoResp.data.system_info;
          
          // 添加网络信息
          if (networkInfoResp.data.status === 'success') {
            sysInfo.network = {
              interfaces: networkInfoResp.data.network_interfaces,
              public_ip: networkInfoResp.data.public_ip,
              io_stats: networkInfoResp.data.io_stats
            };
            
            // 更新网络统计数据
            let totalSent = 0;
            let totalRecv = 0;
            
            Object.values(networkInfoResp.data.io_stats || {}).forEach((stats: any) => {
              totalSent += stats.bytes_sent || 0;
              totalRecv += stats.bytes_recv || 0;
            });
            
            // 保留最多10个数据点
            setNetworkStats(prev => ({
              sent: [...prev.sent.slice(-9), totalSent],
              recv: [...prev.recv.slice(-9), totalRecv]
            }));
          }
          
          setSystemInfo(sysInfo);
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
      } catch (error: any) {
        // 清除超时定时器
        clearTimeout(timeoutId);
        
        // 处理请求错误
        console.error("获取容器信息失败:", error);
        
        // 如果是超时错误，显示适当的提示
        if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
          console.warn("容器信息请求超时，使用缓存数据");
          // 保持使用现有数据，不更新状态
        } else {
          // 其他错误，可以考虑设置一些默认值
          // 但不要完全重置状态，保留之前的数据
          console.warn("容器信息请求失败，使用缓存数据");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContainerInfo();
    // 设置定时刷新（每30秒）但如果有运行中的服务器，增加间隔时间避免频繁请求
    const interval = setInterval(fetchContainerInfo, runningGames.length > 0 ? 60000 : 30000);
    return () => clearInterval(interval);
  }, [runningGames.length]);

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

  // 计算网络流量变化率 (bytes/s)
  const calculateNetworkRate = (current: number[], previous: number[]): number => {
    if (current.length < 2 || previous.length < 2) return 0;
    const lastCurrent = current[current.length - 1];
    const lastPrevious = current[current.length - 2];
    return Math.max(0, (lastCurrent - lastPrevious) / 30); // 30秒刷新间隔
  };

  // 格式化网络速率
  const formatNetworkRate = (bytesPerSecond: number): string => {
    if (bytesPerSecond < 1024) {
      return `${bytesPerSecond.toFixed(1)} B/s`;
    } else if (bytesPerSecond < 1024 * 1024) {
      return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    } else if (bytesPerSecond < 1024 * 1024 * 1024) {
      return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
    } else {
      return `${(bytesPerSecond / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
    }
  };

  // 渲染简单的网络流量图表
  const renderNetworkChart = (data: number[], color: string) => {
    if (data.length < 2) return null;
    
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    
    return (
      <div style={{ height: '40px', display: 'flex', alignItems: 'flex-end' }}>
        {data.map((value, index) => {
          const height = ((value - min) / range) * 100;
          return (
            <div 
              key={index}
              style={{
                height: `${Math.max(5, height)}%`,
                backgroundColor: color,
                flex: 1,
                margin: '0 1px',
                borderRadius: '1px'
              }}
            />
          );
        })}
      </div>
    );
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
        <Space size="small" wrap={isMobile}>
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
              <Button size={isMobile ? "small" : "middle"} danger>
                停止 <DownOutlined />
              </Button>
            </Dropdown>
          ) : (
            <Button size={isMobile ? "small" : "middle"} type="primary" onClick={() => onStartServer && onStartServer(record.id)}>启动</Button>
          )}
          <Button size={isMobile ? "small" : "middle"} danger onClick={() => onUninstallGame && onUninstallGame(record.id)}>卸载</Button>
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
          <Button size={isMobile ? "small" : "middle"} danger>
            停止服务器 <DownOutlined />
          </Button>
        </Dropdown>
      ),
    },
  ];

  // 为移动端设计的列
  const getMobileInstalledGamesColumns = () => {
    return [
      {
        title: '游戏信息',
        key: 'info',
        render: (_, record: GameInfo) => (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 'bold' }}>{record.name}</span>
              {record.external && <Tag color="orange" style={{ marginLeft: 8 }}>外来</Tag>}
            </div>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: 8 }}>
              占用空间: {formatSize(record.size_mb || 0)}
            </div>
            <Space size="small" wrap>
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
          </div>
        ),
      },
    ];
  };

  const getMobileRunningGamesColumns = () => {
    return [
      {
        title: '服务器信息',
        key: 'info',
        render: (_, record: GameInfo) => (
          <div>
            <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{record.name}</div>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: 8 }}>
              运行时间: {formatUptime(record.uptime || 0)}
            </div>
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
          </div>
        ),
      },
    ];
  };

  // 检查资源使用率是否超过阈值
  const hasHighResourceUsage = () => {
    if (!systemInfo) return false;
    return (systemInfo.memory.percent > 80 || systemInfo.disk.percent > 80);
  };

  // 生成警告消息
  const getResourceWarningMessage = () => {
    if (!systemInfo) return '';
    
    let messages = [];
    if (systemInfo.memory.percent > 80) {
      messages.push(`内存使用率 ${Math.round(systemInfo.memory.percent)}%`);
    }
    if (systemInfo.disk.percent > 80) {
      messages.push(`磁盘使用率 ${Math.round(systemInfo.disk.percent)}%`);
    }
    
    return messages.join(' 和 ');
  };

  return (
    <div className="container-info" style={{ width: '100%', maxWidth: '100%' }}>
      <div className="page-header">
        <Title level={isMobile ? 3 : 2}>容器信息面板</Title>
        <Paragraph>
          查看容器资源占用情况、已安装游戏和正在运行的游戏服务器
        </Paragraph>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={fetchContainerInfo}
          loading={loading}
          size={isMobile ? "small" : "middle"}
        >
          刷新信息
        </Button>
      </div>

      {hasHighResourceUsage() && (
        <Alert
          message="资源使用警告"
          description={`${getResourceWarningMessage()}已超过80%，请注意系统稳定性！`}
          type="error"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginTop: 16, marginBottom: 16 }}
        />
      )}

      <Divider />

      <Row gutter={isMobile ? 8 : 16} className="resource-cards">
        <Col xs={24} sm={24} md={8}>
          <Card title={<><HddOutlined /> CPU使用率</>} loading={loading} style={{marginBottom: isMobile ? 8 : 0, borderRadius: '8px'}} size={isMobile ? "small" : "default"}>
            <Progress 
              type="dashboard" 
              percent={Math.round(systemInfo?.cpu_usage || 0)} 
              status={systemInfo?.cpu_usage && systemInfo.cpu_usage > 80 ? 'exception' : 'normal'} 
              format={percent => `${Math.round(percent || 0)}%`}
              width={isMobile ? 80 : 120}
            />
            <Statistic title="使用率" value={`${Math.round(systemInfo?.cpu_usage || 0)}%`} />
            {systemInfo?.cpu_model && (
              <div style={{ marginTop: 8 }}>
                <div><strong>CPU型号:</strong> {systemInfo.cpu_model}</div>
                <div><strong>核心数:</strong> {systemInfo.cpu_cores || 0} 物理核心 / {systemInfo.cpu_logical_cores || 0} 逻辑核心</div>
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} sm={24} md={8}>
          <Card title={<><HddOutlined /> 内存使用</>} loading={loading} style={{marginBottom: isMobile ? 8 : 0, borderRadius: '8px'}} size={isMobile ? "small" : "default"}>
            <Progress 
              type="dashboard" 
              percent={Math.round(systemInfo?.memory.percent || 0)} 
              status={systemInfo?.memory.percent && systemInfo.memory.percent > 80 ? 'exception' : 'normal'} 
              format={percent => `${Math.round(percent || 0)}%`}
              width={isMobile ? 80 : 120}
            />
            <Statistic 
              title="使用/总量" 
              value={systemInfo ? formatGBPair(systemInfo.memory.used, systemInfo.memory.total) : '-'} 
            />
            {systemInfo?.memory.frequency && (
              <div style={{ marginTop: 8 }}>
                <div><strong>内存频率:</strong> {systemInfo.memory.frequency}</div>
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} sm={24} md={8}>
          <Card title={<><HddOutlined /> 磁盘使用</>} loading={loading} style={{marginBottom: isMobile ? 8 : 0, borderRadius: '8px'}} size={isMobile ? "small" : "default"}>
            <Progress 
              type="dashboard" 
              percent={Math.round(systemInfo?.disk.percent || 0)}
              status={systemInfo?.disk.percent && systemInfo.disk.percent > 80 ? 'exception' : 'normal'} 
              format={percent => `${Math.round(percent || 0)}%`}
              width={isMobile ? 80 : 120}
            />
            <Statistic 
              title="使用/总量" 
              value={systemInfo ? formatGBPair(systemInfo.disk.used, systemInfo.disk.total) : '-'} 
            />
            <div style={{ marginTop: 8 }}>
              <div>&nbsp;</div>
            </div>
          </Card>
        </Col>
      </Row>

      <Divider />
      
      {/* 网络状态卡片 */}
      <Row gutter={isMobile ? 8 : 16} className="network-cards">
        <Col xs={24}>
          <Card 
            title={<><GlobalOutlined /> 网络状态</>} 
            loading={loading}
            style={{marginBottom: isMobile ? 8 : 16, borderRadius: '8px'}}
            size={isMobile ? "small" : "default"}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {/* IPv4 状态行 */}
                <tr>
                  <td style={{ padding: '12px 0', width: '80px', fontWeight: 'bold' }}>IPv4</td>
                  <td style={{ padding: '12px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div style={{ 
                        backgroundColor: '#f0f0f0', 
                        width: '30px', 
                        height: '30px', 
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginRight: '10px'
                      }}>
                        <GlobalOutlined style={{ color: '#1890ff' }} />
                      </div>
                      <div style={{ 
                        flex: 1, 
                        height: '3px', 
                        backgroundColor: '#e8e8e8', 
                        position: 'relative' 
                      }}>
                        <div style={{ 
                          position: 'absolute', 
                          left: '25%', 
                          top: '-8px', 
                          width: '18px', 
                          height: '18px', 
                          borderRadius: '50%', 
                          backgroundColor: '#1890ff',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          color: 'white',
                          fontSize: '12px'
                        }}>
                          ✓
                        </div>
                        <div style={{ 
                          position: 'absolute', 
                          left: '60%', 
                          top: '-8px', 
                          width: '18px', 
                          height: '18px', 
                          borderRadius: '50%', 
                          backgroundColor: '#1890ff',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          color: 'white',
                          fontSize: '12px'
                        }}>
                          ✓
                        </div>
                        <div style={{ 
                          position: 'absolute', 
                          right: '0', 
                          top: '-8px', 
                          width: '18px', 
                          height: '18px', 
                          borderRadius: '50%', 
                          backgroundColor: '#f0f0f0',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          color: '#1890ff',
                          fontSize: '12px',
                          border: '1px solid #1890ff'
                        }}>
                          <GlobalOutlined style={{ fontSize: '10px' }} />
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
                
                {/* IPv4地址行 */}
                <tr>
                  <td style={{ padding: '12px 0', fontWeight: 'bold' }}>IPv4公网地址</td>
                  <td style={{ padding: '12px 0' }}>
                    {systemInfo?.network?.public_ip?.ipv4 || '未获取到'}
                  </td>
                </tr>
                
                {/* IPv6 状态行 */}
                <tr>
                  <td style={{ padding: '12px 0', width: '80px', fontWeight: 'bold' }}>IPv6</td>
                  <td style={{ padding: '12px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div style={{ 
                        backgroundColor: '#f0f0f0', 
                        width: '30px', 
                        height: '30px', 
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginRight: '10px'
                      }}>
                        <GlobalOutlined style={{ color: systemInfo?.network?.public_ip?.ipv6 ? '#1890ff' : '#ff4d4f' }} />
                      </div>
                      <div style={{ 
                        flex: 1, 
                        height: '3px', 
                        backgroundColor: '#e8e8e8', 
                        position: 'relative' 
                      }}>
                        {systemInfo?.network?.public_ip?.ipv6 ? (
                          <>
                            <div style={{ 
                              position: 'absolute', 
                              left: '50%', 
                              top: '-8px', 
                              width: '18px', 
                              height: '18px', 
                              borderRadius: '50%', 
                              backgroundColor: '#1890ff',
                              display: 'flex',
                              justifyContent: 'center',
                              alignItems: 'center',
                              color: 'white',
                              fontSize: '12px'
                            }}>
                              ✓
                            </div>
                            <div style={{ 
                              position: 'absolute', 
                              right: '0', 
                              top: '-8px', 
                              width: '18px', 
                              height: '18px', 
                              borderRadius: '50%', 
                              backgroundColor: '#f0f0f0',
                              display: 'flex',
                              justifyContent: 'center',
                              alignItems: 'center',
                              color: '#1890ff',
                              fontSize: '12px',
                              border: '1px solid #1890ff'
                            }}>
                              <GlobalOutlined style={{ fontSize: '10px' }} />
                            </div>
                          </>
                        ) : (
                          <div style={{ 
                            position: 'absolute', 
                            left: '50%', 
                            top: '-8px', 
                            width: '18px', 
                            height: '18px', 
                            borderRadius: '50%', 
                            backgroundColor: '#ff4d4f',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            color: 'white',
                            fontSize: '12px'
                          }}>
                            ✗
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
                
                {/* IPv6地址行 */}
                <tr>
                  <td style={{ padding: '12px 0', fontWeight: 'bold' }}>IPv6公网地址</td>
                  <td style={{ padding: '12px 0' }}>
                    {systemInfo?.network?.public_ip?.ipv6 || '未获取到'}
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
        </Col>
      </Row>

      <Divider />

      <Row gutter={isMobile ? 8 : 16} className="games-tables">
        <Col xs={24} sm={24} md={12}>
          <Card 
            title={<><AppstoreOutlined /> 已安装游戏 ({installedGames.length})</>} 
            extra={<Tag color="blue">{formatSize(installedGames.reduce((acc, game) => acc + (game.size_mb || 0), 0))}</Tag>}
            loading={loading}
            style={{marginBottom: isMobile ? 8 : 0, borderRadius: '8px'}}
            size={isMobile ? "small" : "default"}
          >
            <Table 
              dataSource={installedGames} 
              columns={isMobile ? getMobileInstalledGamesColumns() : installedGamesColumns} 
              rowKey="id"
              pagination={false}
              size={isMobile ? "small" : "default"}
              locale={{ emptyText: '暂无已安装游戏' }}
              scroll={isMobile ? { x: '100%' } : undefined}
            />
          </Card>
        </Col>
        <Col xs={24} sm={24} md={12}>
          <Card 
            title={<><RocketOutlined /> 正在运行的服务器 ({runningGames.length})</>}
            loading={loading}
            style={{marginBottom: isMobile ? 8 : 0, borderRadius: '8px'}}
            size={isMobile ? "small" : "default"}
          >
            <Table 
              dataSource={runningGames} 
              columns={isMobile ? getMobileRunningGamesColumns() : runningGamesColumns} 
              rowKey="id"
              pagination={false}
              size={isMobile ? "small" : "default"}
              locale={{ emptyText: '暂无正在运行的服务器' }}
              scroll={isMobile ? { x: '100%' } : undefined}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default ContainerInfo; 