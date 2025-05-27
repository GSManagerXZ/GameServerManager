import React, { useState, useEffect } from 'react';
import { Card, Tabs, Form, Input, Button, Table, Space, Modal, Typography, message, Popconfirm, Divider, InputNumber, Select, Switch } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, DeleteOutlined, EyeOutlined, PlusOutlined, MinusCircleOutlined, GlobalOutlined } from '@ant-design/icons';
import axios from 'axios';
import FrpDocModal from './FrpDocModal';
import Cookies from 'js-cookie';

const { TabPane } = Tabs;
const { Title, Paragraph, Text } = Typography;

interface FrpConfig {
  id: string;
  name: string;
  type: string;
  command: string;
  status: string;
  created_at: number;
}

interface CustomFrpProxy {
  name: string;
  type: string;
  localIP: string;
  localPort: number;
  remotePort: number;
}

interface CustomFrpConfig {
  serverAddr: string;
  serverPort: number;
  token: string;
  proxies: CustomFrpProxy[];
}

const FrpManager: React.FC = () => {
  const [frpConfigs, setFrpConfigs] = useState<FrpConfig[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('general');
  const [form] = Form.useForm();
  const [customForm] = Form.useForm();
  const [logModalVisible, setLogModalVisible] = useState<boolean>(false);
  const [currentLogContent, setCurrentLogContent] = useState<string>('');
  const [currentFrpId, setCurrentFrpId] = useState<string>('');
  const [customFrpConfig, setCustomFrpConfig] = useState<CustomFrpConfig>({
    serverAddr: '',
    serverPort: 7000,
    token: '',
    proxies: []
  });
  const [customFrpStatus, setCustomFrpStatus] = useState<string>('stopped');
  const [customFrpLoading, setCustomFrpLoading] = useState<boolean>(false);
  const [proxyModalVisible, setProxyModalVisible] = useState<boolean>(false);
  const [proxyForm] = Form.useForm();
  const [editingProxyIndex, setEditingProxyIndex] = useState<number>(-1);
  const [locyanWebsiteVisible, setLocyanWebsiteVisible] = useState<boolean>(false);
  const [mefrpWebsiteVisible, setMefrpWebsiteVisible] = useState<boolean>(false);
  const [sakuraWebsiteVisible, setSakuraWebsiteVisible] = useState<boolean>(false);
  const [autoRestartFrps, setAutoRestartFrps] = useState<string[]>([]);
  const [docModalVisible, setDocModalVisible] = useState<boolean>(false);

  // 检查是否需要显示文档弹窗
  useEffect(() => {
    const frpDocViewed = Cookies.get('frp_doc_viewed');
    if (!frpDocViewed) {
      setDocModalVisible(true);
    }
  }, []);

  // 加载FRP配置
  const loadFrpConfigs = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/frp/list');
      if (response.data.status === 'success') {
        setFrpConfigs(response.data.configs || []);
      } else {
        message.error(response.data.message || '加载FRP配置失败');
      }
    } catch (error: any) {
      message.error(error.message || '加载FRP配置失败');
    } finally {
      setLoading(false);
    }
  };

  // 创建FRP配置
  const createFrpConfig = async (values: any) => {
    try {
      setLoading(true);
      const response = await axios.post('/api/frp/create', {
        name: values.name,
        type: activeTab,
        command: values.command
      });
      
      if (response.data.status === 'success') {
        message.success('创建FRP配置成功');
        form.resetFields();
        loadFrpConfigs();
      } else {
        message.error(response.data.message || '创建FRP配置失败');
      }
    } catch (error: any) {
      message.error(error.message || '创建FRP配置失败');
    } finally {
      setLoading(false);
    }
  };

  // 启动FRP
  const startFrp = async (id: string) => {
    try {
      const response = await axios.post('/api/frp/start', { id });
      if (response.data.status === 'success') {
        message.success('FRP已启动');
        loadFrpConfigs();
      } else {
        message.error(response.data.message || '启动FRP失败');
      }
    } catch (error: any) {
      message.error(error.message || '启动FRP失败');
    }
  };

  // 停止FRP
  const stopFrp = async (id: string) => {
    try {
      const response = await axios.post('/api/frp/stop', { id });
      if (response.data.status === 'success') {
        message.success('FRP已停止');
        loadFrpConfigs();
      } else {
        message.error(response.data.message || '停止FRP失败');
      }
    } catch (error: any) {
      message.error(error.message || '停止FRP失败');
    }
  };

  // 删除FRP配置
  const deleteFrp = async (id: string) => {
    try {
      const response = await axios.post('/api/frp/delete', { id });
      if (response.data.status === 'success') {
        message.success('FRP配置已删除');
        loadFrpConfigs();
      } else {
        message.error(response.data.message || '删除FRP配置失败');
      }
    } catch (error: any) {
      message.error(error.message || '删除FRP配置失败');
    }
  };

  // 查看FRP日志
  const viewFrpLog = async (id: string) => {
    try {
      const response = await axios.get(`/api/frp/log?id=${id}`);
      if (response.data.status === 'success') {
        setCurrentLogContent(response.data.log || '暂无日志');
        setCurrentFrpId(id);
        setLogModalVisible(true);
      } else {
        message.error(response.data.message || '获取FRP日志失败');
      }
    } catch (error: any) {
      message.error(error.message || '获取FRP日志失败');
    }
  };

  // 加载自建FRP配置
  const loadCustomFrpConfig = async () => {
    try {
      setCustomFrpLoading(true);
      const response = await axios.get('/api/frp/custom/config');
      if (response.data.status === 'success') {
        setCustomFrpConfig(response.data.config);
        customForm.setFieldsValue(response.data.config);
      } else {
        message.error(response.data.message || '加载自建FRP配置失败');
      }
    } catch (error: any) {
      message.error(error.message || '加载自建FRP配置失败');
    } finally {
      setCustomFrpLoading(false);
    }
  };

  // 获取自建FRP状态
  const loadCustomFrpStatus = async () => {
    try {
      const response = await axios.get('/api/frp/custom/status');
      if (response.data.status === 'success') {
        setCustomFrpStatus(response.data.frp_status);
      }
    } catch (error: any) {
      console.error('获取自建FRP状态失败:', error);
    }
  };

  // 加载自启动FRP列表
  const loadAutoRestartFrps = async () => {
    try {
      const response = await axios.get('/api/frp/auto_restart');
      if (response.data.status === 'success') {
        setAutoRestartFrps(response.data.auto_restart_frps || []);
      }
    } catch (error: any) {
      console.error('加载自启动FRP列表失败:', error);
    }
  };

  // 处理自启动开关变化
  const handleAutoRestartChange = async (frpId: string, checked: boolean) => {
    try {
      const response = await axios.post('/api/frp/set_auto_restart', {
        frp_id: frpId,
        auto_restart: checked
      });
      
      if (response.data.status === 'success') {
        message.success(`已${checked ? '开启' : '关闭'}内网穿透自启动`);
        // 更新自启动FRP列表
        setAutoRestartFrps(response.data.auto_restart_frps || []);
      } else {
        message.error(response.data.message || '操作失败');
      }
    } catch (error: any) {
      message.error(error.message || '设置自启动状态失败');
    }
  };

  // 保存自建FRP配置
  const saveCustomFrpConfig = async (values: any) => {
    try {
      setCustomFrpLoading(true);
      const config = {
        serverAddr: values.serverAddr,
        serverPort: values.serverPort,
        token: values.token,
        proxies: customFrpConfig.proxies
      };
      
      const response = await axios.post('/api/frp/custom/config', config);
      if (response.data.status === 'success') {
        message.success('自建FRP配置保存成功');
        setCustomFrpConfig(config);
      } else {
        message.error(response.data.message || '保存自建FRP配置失败');
      }
    } catch (error: any) {
      message.error(error.message || '保存自建FRP配置失败');
    } finally {
      setCustomFrpLoading(false);
    }
  };

  // 启动自建FRP
  const startCustomFrp = async () => {
    try {
      const response = await axios.post('/api/frp/custom/start');
      if (response.data.status === 'success') {
        message.success('自建FRP已启动');
        loadCustomFrpStatus();
      } else {
        message.error(response.data.message || '启动自建FRP失败');
      }
    } catch (error: any) {
      message.error(error.message || '启动自建FRP失败');
    }
  };

  // 停止自建FRP
  const stopCustomFrp = async () => {
    try {
      const response = await axios.post('/api/frp/custom/stop');
      if (response.data.status === 'success') {
        message.success('自建FRP已停止');
        loadCustomFrpStatus();
      } else {
        message.error(response.data.message || '停止自建FRP失败');
      }
    } catch (error: any) {
      message.error(error.message || '停止自建FRP失败');
    }
  };

  // 查看自建FRP日志
  const viewCustomFrpLog = async () => {
    try {
      const response = await axios.get('/api/frp/log?id=custom_frp');
      if (response.data.status === 'success') {
        setCurrentLogContent(response.data.log || '暂无日志');
        setCurrentFrpId('custom_frp');
        setLogModalVisible(true);
      } else {
        message.error(response.data.message || '获取自建FRP日志失败');
      }
    } catch (error: any) {
      message.error(error.message || '获取自建FRP日志失败');
    }
  };

  // 打开添加代理配置对话框
  const openAddProxyModal = () => {
    proxyForm.resetFields();
    setEditingProxyIndex(-1);
    setProxyModalVisible(true);
  };

  // 打开编辑代理配置对话框
  const openEditProxyModal = (index: number) => {
    const proxy = customFrpConfig.proxies[index];
    proxyForm.setFieldsValue(proxy);
    setEditingProxyIndex(index);
    setProxyModalVisible(true);
  };

  // 保存代理配置
  const saveProxyConfig = async (values: any) => {
    try {
      const newProxy: CustomFrpProxy = {
        name: values.name,
        type: values.type,
        localIP: values.localIP,
        localPort: values.localPort,
        remotePort: values.remotePort
      };

      const newProxies = [...customFrpConfig.proxies];
      
      if (editingProxyIndex >= 0) {
        // 编辑现有代理
        newProxies[editingProxyIndex] = newProxy;
      } else {
        // 添加新代理
        newProxies.push(newProxy);
      }
      
      const newConfig = {
        ...customFrpConfig,
        proxies: newProxies
      };
      
      const response = await axios.post('/api/frp/custom/config', newConfig);
      if (response.data.status === 'success') {
        message.success(editingProxyIndex >= 0 ? '代理配置已更新' : '代理配置已添加');
        setCustomFrpConfig(newConfig);
        setProxyModalVisible(false);
      } else {
        message.error(response.data.message || '保存代理配置失败');
      }
    } catch (error: any) {
      message.error(error.message || '保存代理配置失败');
    }
  };

  // 删除代理配置
  const deleteProxy = async (index: number) => {
    try {
      const newProxies = [...customFrpConfig.proxies];
      newProxies.splice(index, 1);
      
      const newConfig = {
        ...customFrpConfig,
        proxies: newProxies
      };
      
      const response = await axios.post('/api/frp/custom/config', newConfig);
      if (response.data.status === 'success') {
        message.success('代理配置已删除');
        setCustomFrpConfig(newConfig);
      } else {
        message.error(response.data.message || '删除代理配置失败');
      }
    } catch (error: any) {
      message.error(error.message || '删除代理配置失败');
    }
  };

  // 组件加载时获取配置
  useEffect(() => {
    loadFrpConfigs();
    loadAutoRestartFrps();
  }, []);

  // 切换到自建FRP标签时加载配置
  useEffect(() => {
    if (activeTab === 'custom') {
      loadCustomFrpConfig();
      loadCustomFrpStatus();
    }
  }, [activeTab]);

  // 定期检查自建FRP状态
  useEffect(() => {
    if (activeTab === 'custom') {
      const intervalId = setInterval(() => {
        loadCustomFrpStatus();
      }, 5000);
      
      return () => clearInterval(intervalId);
    }
  }, [activeTab]);

  // FRP配置表格列定义
  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (text: string) => text === 'general' ? '乐青FRP' : text === 'custom' ? '自建FRP' : text
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (text: string) => text === 'running' ? 
        <Text type="success">运行中</Text> : <Text type="danger">已停止</Text>
    },
    {
      title: '自启动',
      key: 'auto_restart',
      render: (text: any, record: FrpConfig) => (
        <Switch
          size="small"
          checked={autoRestartFrps.includes(record.id)}
          onChange={(checked) => handleAutoRestartChange(record.id, checked)}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (text: any, record: FrpConfig) => (
        <Space size="middle">
          {record.status === 'running' ? (
            <Button 
              icon={<PauseCircleOutlined />} 
              onClick={() => stopFrp(record.id)}
              type="primary"
              danger
            >
              停止
            </Button>
          ) : (
            <Button 
              icon={<PlayCircleOutlined />} 
              onClick={() => startFrp(record.id)}
              type="primary"
            >
              启动
            </Button>
          )}
          <Button 
            icon={<EyeOutlined />} 
            onClick={() => viewFrpLog(record.id)}
          >
            查看日志
          </Button>
          <Popconfirm
            title="确定要删除此配置吗？"
            onConfirm={() => deleteFrp(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button 
              icon={<DeleteOutlined />} 
              danger
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 代理配置表格列定义
  const proxyColumns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
    },
    {
      title: '本地IP',
      dataIndex: 'localIP',
      key: 'localIP',
    },
    {
      title: '本地端口',
      dataIndex: 'localPort',
      key: 'localPort',
    },
    {
      title: '远程端口',
      dataIndex: 'remotePort',
      key: 'remotePort',
    },
    {
      title: '操作',
      key: 'action',
      render: (text: any, record: CustomFrpProxy, index: number) => (
        <Space size="middle">
          <Button 
            onClick={() => openEditProxyModal(index)}
            type="primary"
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除此代理配置吗？"
            onConfirm={() => deleteProxy(index)}
            okText="确定"
            cancelText="取消"
          >
            <Button 
              danger
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 关闭文档弹窗
  const handleCloseDocModal = () => {
    setDocModalVisible(false);
  };

  return (
    <div className="frp-manager">
      <Title level={2}>内网穿透</Title>
      <Paragraph>
        配置并管理FRP内网穿透服务，让您的服务可以被外网访问。
      </Paragraph>

      <Card title="创建新的内网穿透配置" style={{ marginBottom: 24 }}>
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <TabPane tab="自建FRP" key="custom">
            <div style={{ marginBottom: 24 }}>
              <Title level={4}>服务器配置</Title>
              <Form 
                form={customForm} 
                layout="vertical" 
                onFinish={saveCustomFrpConfig}
                initialValues={customFrpConfig}
              >
                <Form.Item
                  name="serverAddr"
                  label="服务器地址"
                  rules={[{ required: true, message: '请输入FRP服务器地址' }]}
                >
                  <Input placeholder="请输入FRP服务器地址，如：frps.example.com" />
                </Form.Item>
                <Form.Item
                  name="serverPort"
                  label="服务器端口"
                  rules={[{ required: true, message: '请输入FRP服务器端口' }]}
                >
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                  name="token"
                  label="认证Token"
                >
                  <Input placeholder="如果FRP服务器需要认证，请输入Token" />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={customFrpLoading}>
                    保存服务器配置
                  </Button>
                </Form.Item>
              </Form>
            </div>

            <Divider />

            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Title level={4}>代理配置</Title>
                <Button 
                  type="primary" 
                  icon={<PlusOutlined />} 
                  onClick={openAddProxyModal}
                >
                  添加代理
                </Button>
              </div>

              <Table 
                dataSource={customFrpConfig.proxies} 
                columns={proxyColumns} 
                rowKey="name"
                pagination={false}
                locale={{ emptyText: '暂无代理配置，请点击"添加代理"按钮创建' }}
              />
            </div>

            <Divider />

            <div style={{ marginTop: 24 }}>
              <Title level={4}>运行控制</Title>
              <Space>
                {customFrpStatus === 'running' ? (
                  <Button 
                    icon={<PauseCircleOutlined />} 
                    onClick={stopCustomFrp}
                    type="primary"
                    danger
                  >
                    停止自建FRP
                  </Button>
                ) : (
                  <Button 
                    icon={<PlayCircleOutlined />} 
                    onClick={startCustomFrp}
                    type="primary"
                    disabled={customFrpConfig.proxies.length === 0}
                  >
                    启动自建FRP
                  </Button>
                )}
                <Button 
                  icon={<EyeOutlined />} 
                  onClick={viewCustomFrpLog}
                >
                  查看日志
                </Button>
                <Text>
                  状态: {customFrpStatus === 'running' ? 
                    <Text type="success">运行中</Text> : 
                    <Text type="danger">已停止</Text>}
                </Text>
                <div style={{ marginLeft: 16 }}>
                  自启动: 
                  <Switch 
                    size="small" 
                    style={{ marginLeft: 8 }}
                    checked={autoRestartFrps.includes('custom_frp')}
                    onChange={(checked) => handleAutoRestartChange('custom_frp', checked)}
                  />
                </div>
              </Space>
            </div>
          </TabPane>
          <TabPane tab="LoCyanFrp(乐青映射)" key="general">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button 
                type="primary" 
                icon={<GlobalOutlined />} 
                onClick={() => setLocyanWebsiteVisible(true)}
              >
                官网首页
              </Button>
            </div>
            <Form form={form} layout="vertical" onFinish={createFrpConfig}>
              <Form.Item
                name="name"
                label="配置名称"
                rules={[{ required: true, message: '请输入配置名称' }]}
              >
                <Input placeholder="请输入配置名称，如：我的FRP" />
              </Form.Item>
              <Form.Item
                name="command"
                label="启动参数"
                rules={[{ required: true, message: '请输入FRP启动参数' }]}
              >
                <Input placeholder="例如：-u 4b224da161e93fc5f9f5b62772ee411d -p 117664" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading}>
                  创建
                </Button>
              </Form.Item>
            </Form>
          </TabPane>
          <TabPane tab="MEFrp(幻缘映射)" key="mefrp">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button 
                type="primary" 
                icon={<GlobalOutlined />} 
                onClick={() => setMefrpWebsiteVisible(true)}
              >
                官网首页
              </Button>
            </div>
            <Form form={form} layout="vertical" onFinish={createFrpConfig}>
              <Form.Item
                name="name"
                label="配置名称"
                rules={[{ required: true, message: '请输入配置名称' }]}
              >
                <Input placeholder="请输入配置名称，如：我的mefrp" />
              </Form.Item>
              <Form.Item
                name="command"
                label="启动参数"
                rules={[{ required: true, message: '请输入mefrp启动参数' }]}
              >
                <Input placeholder="例如：-u 4b224da161e93fc5f9f5b62772ee411d -p 117664" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading}>
                  创建
                </Button>
              </Form.Item>
            </Form>
          </TabPane>
          <TabPane tab="Sakura(樱花内网穿透)" key="sakura">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button 
                type="primary" 
                icon={<GlobalOutlined />} 
                onClick={() => setSakuraWebsiteVisible(true)}
              >
                官网首页
              </Button>
            </div>
            <Form form={form} layout="vertical" onFinish={createFrpConfig}>
              <Form.Item
                name="name"
                label="配置名称"
                rules={[{ required: true, message: '请输入配置名称' }]}
              >
                <Input placeholder="请输入配置名称，如：我的Sakura" />
              </Form.Item>
              <Form.Item
                name="command"
                label="启动参数"
                rules={[{ required: true, message: '请输入Sakura启动参数' }]}
              >
                <Input placeholder="例如：-f l4b6jidmikr36resl0epqtoq63r:21186532" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading}>
                  创建
                </Button>
              </Form.Item>
            </Form>
          </TabPane>
        </Tabs>
      </Card>

      <Card title="我的内网穿透配置">
        <Table 
          dataSource={frpConfigs} 
          columns={columns} 
          rowKey="id"
          loading={loading}
          locale={{ emptyText: '暂无FRP配置，请在上方创建' }}
        />
      </Card>

      {/* 日志查看对话框 */}
      <Modal
        title="FRP日志"
        visible={logModalVisible}
        onCancel={() => setLogModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setLogModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={800}
      >
        <pre style={{ 
          maxHeight: '500px', 
          overflowY: 'auto', 
          backgroundColor: '#f0f0f0',
          padding: '10px',
          borderRadius: '4px'
        }}>
          {currentLogContent}
        </pre>
      </Modal>

      {/* 代理配置对话框 */}
      <Modal
        title={editingProxyIndex >= 0 ? "编辑代理配置" : "添加代理配置"}
        visible={proxyModalVisible}
        onCancel={() => setProxyModalVisible(false)}
        footer={null}
      >
        <Form 
          form={proxyForm} 
          layout="vertical" 
          onFinish={saveProxyConfig}
          initialValues={{ type: 'tcp', localIP: '127.0.0.1' }}
        >
          <Form.Item
            name="name"
            label="代理名称"
            rules={[{ required: true, message: '请输入代理名称' }]}
          >
            <Input placeholder="请输入代理名称，如：ssh" />
          </Form.Item>
          <Form.Item
            name="type"
            label="代理类型"
            rules={[{ required: true, message: '请选择代理类型' }]}
          >
            <Select>
              <Select.Option value="tcp">TCP</Select.Option>
              <Select.Option value="udp">UDP</Select.Option>
              <Select.Option value="http">HTTP</Select.Option>
              <Select.Option value="https">HTTPS</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="localIP"
            label="本地IP"
            rules={[{ required: true, message: '请输入本地IP' }]}
          >
            <Input placeholder="请输入本地IP，如：127.0.0.1" />
          </Form.Item>
          <Form.Item
            name="localPort"
            label="本地端口"
            rules={[{ required: true, message: '请输入本地端口' }]}
          >
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="remotePort"
            label="远程端口"
            rules={[{ required: true, message: '请输入远程端口' }]}
          >
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                保存
              </Button>
              <Button onClick={() => setProxyModalVisible(false)}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 乐青FRP官网对话框 */}
      <Modal
        title="官网"
        visible={locyanWebsiteVisible}
        onCancel={() => setLocyanWebsiteVisible(false)}
        footer={[
          <Button key="close" onClick={() => setLocyanWebsiteVisible(false)}>
            关闭
          </Button>
        ]}
        width={1000}
        bodyStyle={{ padding: 0, height: '600px' }}
      >
        <iframe 
          src="https://dashboard.locyanfrp.cn/auth/login" 
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="乐青FRP官网"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </Modal>

      {/* mefrp官网对话框 */}
      <Modal
        title="官网"
        visible={mefrpWebsiteVisible}
        onCancel={() => setMefrpWebsiteVisible(false)}
        footer={[
          <Button key="close" onClick={() => setMefrpWebsiteVisible(false)}>
            关闭
          </Button>
        ]}
        width={1000}
        bodyStyle={{ padding: 0, height: '600px' }}
      >
        <iframe 
          src="https://www.mefrp.com/auth/login" 
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="mefrp官网"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </Modal>

      {/* Sakura官网对话框 */}
      <Modal
        title="官网"
        visible={sakuraWebsiteVisible}
        onCancel={() => setSakuraWebsiteVisible(false)}
        footer={[
          <Button key="close" onClick={() => setSakuraWebsiteVisible(false)}>
            关闭
          </Button>
        ]}
        width={1000}
        bodyStyle={{ padding: 0, height: '600px' }}
      >
        <iframe 
          src="https://openid.13a.com/login" 
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="Sakura官网"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </Modal>

      {/* 添加文档弹窗 */}
      <FrpDocModal visible={docModalVisible} onClose={handleCloseDocModal} />
    </div>
  );
};

export default FrpManager; 