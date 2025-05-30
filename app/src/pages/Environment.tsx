import React, { useState, useEffect } from 'react';
import { Card, Button, Progress, message, Tabs, List, Typography, Tag, Tooltip, Alert, Modal } from 'antd';
import { CloudDownloadOutlined, CheckCircleOutlined, CloseCircleOutlined, InfoCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';

const { TabPane } = Tabs;
const { Title, Paragraph, Text } = Typography;
const { confirm } = Modal;

// Java版本类型定义
interface JavaVersion {
  id: string;
  name: string;
  installed: boolean;
  version: string | null;
}

// Java安装进度类型定义
interface JavaProgress {
  progress: number;
  status: string;
  completed: boolean;
  error?: string;
  version?: string;
  path?: string;
  usage_hint?: string;
}

const Environment: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('java');
  const [javaVersions, setJavaVersions] = useState<JavaVersion[]>([]);
  const [javaProgress, setJavaProgress] = useState<Record<string, JavaProgress>>({});
  const [loading, setLoading] = useState<boolean>(true);

  // 获取Java版本列表
  const fetchJavaVersions = async () => {
    try {
      const response = await axios.get('/api/environment/java/versions');
      if (response.data.status === 'success') {
        setJavaVersions(response.data.versions);
      }
    } catch (error) {
      console.error('获取Java版本列表失败:', error);
      message.error('获取Java版本列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 获取Java安装状态
  const fetchJavaStatus = async (versionId: string) => {
    try {
      const response = await axios.get(`/api/environment/java/status?version=${versionId}`);
      if (response.data.status === 'success') {
        setJavaProgress(prev => ({
          ...prev,
          [versionId]: response.data.progress
        }));
      }
    } catch (error) {
      console.error(`获取Java ${versionId}安装状态失败:`, error);
    }
  };

  // 安装Java
  const installJava = async (versionId: string) => {
    try {
      const response = await axios.post('/api/environment/java/install', { version: versionId });
      if (response.data.status === 'success') {
        message.success(response.data.message);
        // 开始轮询安装进度
        pollJavaProgress(versionId);
      } else {
        message.error(response.data.message || '安装失败');
      }
    } catch (error: any) {
      console.error('安装Java失败:', error);
      message.error(error?.response?.data?.message || '安装失败');
    }
  };

  // 卸载Java
  const uninstallJava = async (versionId: string, versionName: string) => {
    confirm({
      title: `确定要卸载 ${versionName} 吗?`,
      content: '卸载后，所有使用此Java版本的应用可能无法正常运行。',
      okText: '确认卸载',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const response = await axios.post('/api/environment/java/uninstall', { version: versionId });
          if (response.data.status === 'success') {
            message.success(response.data.message);
            // 刷新Java版本列表
            fetchJavaVersions();
            // 清除进度信息
            setJavaProgress(prev => {
              const newProgress = { ...prev };
              delete newProgress[versionId];
              return newProgress;
            });
          } else {
            message.error(response.data.message || '卸载失败');
          }
        } catch (error: any) {
          console.error('卸载Java失败:', error);
          message.error(error?.response?.data?.message || '卸载失败');
        }
      }
    });
  };

  // 轮询Java安装进度
  const pollJavaProgress = async (versionId: string) => {
    const checkProgress = async () => {
      try {
        const response = await axios.get(`/api/environment/java/status?version=${versionId}`);
        if (response.data.status === 'success') {
          const progressData = response.data.progress;
          setJavaProgress(prev => ({
            ...prev,
            [versionId]: progressData
          }));

          // 如果安装完成或出错，停止轮询
          if (progressData.completed) {
            if (progressData.error) {
              message.error(`安装失败: ${progressData.error}`);
            } else {
              message.success(`安装成功: ${progressData.version}`);
              // 刷新Java版本列表
              fetchJavaVersions();
            }
            return;
          }

          // 继续轮询
          setTimeout(checkProgress, 2000);
        }
      } catch (error) {
        console.error('获取安装进度失败:', error);
        message.error('获取安装进度失败');
      }
    };

    // 开始轮询
    checkProgress();
  };

  // 初始化加载
  useEffect(() => {
    fetchJavaVersions();
  }, []);

  // 获取状态文本
  const getStatusText = (status: string): string => {
    const statusMap: Record<string, string> = {
      'not_started': '未开始',
      'downloading': '下载中',
      'extracting': '解压中',
      'installing': '安装中',
      'setting_permissions': '设置权限',
      'verifying': '验证安装',
      'completed': '安装完成',
      'error': '安装失败'
    };
    return statusMap[status] || status;
  };

  // 渲染Java安装状态
  const renderJavaStatus = (version: JavaVersion) => {
    const progress = javaProgress[version.id];
    
    if (!progress) {
      return (
        <Button 
          type="primary" 
          icon={<CloudDownloadOutlined />} 
          onClick={() => installJava(version.id)}
          loading={loading}
        >
          安装 {version.name}
        </Button>
      );
    }

    if (progress.completed && !progress.error) {
      return (
        <div>
          <Tag color="success" icon={<CheckCircleOutlined />}>已安装 - {progress.version}</Tag>
          {progress.usage_hint && (
            <Alert
              message="使用提示"
              description={
                <div>
                  <p>{progress.usage_hint}</p>
                  <p>路径: {progress.path}</p>
                </div>
              }
              type="info"
              showIcon
              style={{ marginTop: 10 }}
            />
          )}
        </div>
      );
    }

    if (progress.error) {
      return (
        <div>
          <Tag color="error" icon={<CloseCircleOutlined />}>安装失败</Tag>
          <p style={{ color: 'red' }}>{progress.error}</p>
          <Button 
            type="primary" 
            icon={<CloudDownloadOutlined />} 
            onClick={() => installJava(version.id)}
          >
            重试安装
          </Button>
        </div>
      );
    }

    return (
      <div>
        <Progress 
          percent={progress.progress} 
          status={progress.error ? "exception" : "active"} 
        />
        <p>{getStatusText(progress.status)}</p>
      </div>
    );
  };

  return (
    <div className="environment-page">
      <Title level={2}>环境安装</Title>
      <Paragraph>
        在这里您可以安装游戏服务器所需的各种环境和依赖。
      </Paragraph>

      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab="Java环境" key="java">
          <Card title="Java环境安装" bordered={false}>
            <Paragraph>
              许多游戏服务器（如Minecraft）需要Java环境才能运行。请选择需要安装的Java版本。
            </Paragraph>
            
            <List
              loading={loading}
              itemLayout="horizontal"
              dataSource={javaVersions}
              renderItem={item => (
                <List.Item
                  actions={[
                    <Tooltip title={item.installed ? "已安装" : "点击安装"}>
                      <Button 
                        type={item.installed ? "default" : "primary"}
                        icon={item.installed ? <CheckCircleOutlined /> : <CloudDownloadOutlined />}
                        onClick={() => {
                          if (!item.installed) {
                            installJava(item.id);
                          } else {
                            fetchJavaStatus(item.id);
                          }
                        }}
                        disabled={loading || (javaProgress[item.id] && !javaProgress[item.id].completed && !javaProgress[item.id].error)}
                      >
                        {item.installed ? "已安装" : "安装"}
                      </Button>
                    </Tooltip>,
                    item.installed && (
                      <Tooltip title="卸载">
                        <Button 
                          type="default" 
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => uninstallJava(item.id, item.name)}
                        >
                          卸载
                        </Button>
                      </Tooltip>
                    )
                  ].filter(Boolean)}
                >
                  <List.Item.Meta
                    title={
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        {item.name}
                        {item.installed && (
                          <Tag color="success" style={{ marginLeft: 8 }}>
                            已安装 - {item.version}
                          </Tag>
                        )}
                      </div>
                    }
                    description={
                      <div>
                        {javaProgress[item.id] && (
                          <div style={{ marginTop: 8 }}>
                            {renderJavaStatus(item)}
                          </div>
                        )}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </TabPane>
      </Tabs>
    </div>
  );
};

export default Environment; 