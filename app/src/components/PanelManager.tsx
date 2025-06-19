import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Form,
  Input,
  Select,
  InputNumber,
  Space,
  Table,
  Modal,
  message,
  Tabs,
  Tag,
  Tooltip,
  Alert,
  Divider,
  Row,
  Col,
  Switch,
  Spin,
  Typography,
  Collapse
} from 'antd';
import {
  DockerOutlined,
  PlayCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  SettingOutlined,
  CopyOutlined,
  PlusOutlined,
  DeleteOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import axios from 'axios';
import { getDockerImages } from '../api';

const { Title, Text, Paragraph } = Typography;
const { TabPane } = Tabs;
const { Option } = Select;
const { TextArea } = Input;
const { Panel } = Collapse;

// 重启策略汉化映射
const restartPolicyMap = {
  'no': '不重启',
  'always': '总是重启',
  'unless-stopped': '除非手动停止',
  'on-failure': '失败时重启'
};

// 网络模式说明映射
const networkModeMap = {
  'bridge': '桥接模式 - 默认网络模式，容器有独立的网络栈',
  'host': '主机模式 - 容器与主机共享网络栈，性能最佳',
  'none': '无网络 - 容器没有网络连接',
  'container': '容器模式 - 与其他容器共享网络栈'
};

interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  image: string;
  created: string;
  network_mode: string;
  ports: Array<{
    container_port: string;
    host_port: string;
    host_ip: string;
  }>;
  mounts: Array<{
    source: string;
    destination: string;
    type: string;
    read_only: boolean;
  }>;
  environment: Array<{
    key: string;
    value: string;
  }>;
  restart_policy: {
    Name?: string;
    MaximumRetryCount?: number;
  };
}

interface ContainerListItem {
  id: string;
  name: string;
  status: string;
  image: string;
}

const PanelManager: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [containerInfo, setContainerInfo] = useState<ContainerInfo | null>(null);
  const [containerList, setContainerList] = useState<ContainerListItem[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>('GSManager');
  const [configForm] = Form.useForm();
  const [generatedCommand, setGeneratedCommand] = useState<string>('');
  const [commandModalVisible, setCommandModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('info');
  const [networkMode, setNetworkMode] = useState<string>('bridge');
  const [collapsedPanels, setCollapsedPanels] = useState<string[]>([]);
  
  // Docker镜像相关状态
  const [dockerImages, setDockerImages] = useState<{id: string, tag: string, size: number, created: string}[]>([]);
  const [dockerImagesLoading, setDockerImagesLoading] = useState(false);

  // 表单数据持久化工具函数
  const saveFormData = (formName: string, data: any) => {
    try {
      localStorage.setItem(`gsm_form_${formName}`, JSON.stringify(data));
    } catch (error) {
      console.error('保存表单数据失败:', error);
    }
  };

  const loadFormData = (formName: string) => {
    try {
      const saved = localStorage.getItem(`gsm_form_${formName}`);
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.error('加载表单数据失败:', error);
      return null;
    }
  };

  // 监听表单变化并自动保存
  const handleFormChange = (formName: string, formInstance: any) => {
    const values = formInstance.getFieldsValue();
    saveFormData(formName, values);
  };

  // 获取容器列表
  const fetchContainerList = async () => {
    try {
      const response = await axios.get('/api/docker/containers');
      if (response.data.status === 'success') {
        setContainerList(response.data.containers);
      }
    } catch (error) {
      console.error('获取容器列表失败:', error);
    }
  };

  // 获取容器信息
  const fetchContainerInfo = async (containerName: string) => {
    try {
      setLoading(true);
      const response = await axios.get(`/api/docker/container/${containerName}`);
      if (response.data.status === 'success') {
        const info = response.data.container;
        setContainerInfo(info);
        
        // 填充表单
        configForm.setFieldsValue({
          name: info.name,
          image: info.image,
          network_mode: info.network_mode,
          restart_policy: info.restart_policy?.Name || 'unless-stopped',
          ports: info.ports || [],
          mounts: info.mounts || [],
          environment: info.environment || []
        });
        
        // 更新网络模式状态
        setNetworkMode(info.network_mode);
      } else {
        message.error(response.data.message);
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        message.warning(`容器 ${containerName} 不存在，请选择其他容器`);
      } else {
        message.error('获取容器信息失败');
      }
    } finally {
      setLoading(false);
    }
  };

  // 停止容器
  const stopContainer = async () => {
    try {
      setLoading(true);
      const response = await axios.post(`/api/docker/container/${selectedContainer}/stop`);
      if (response.data.status === 'success') {
        message.success(response.data.message);
        fetchContainerInfo(selectedContainer);
      } else {
        message.error(response.data.message);
      }
    } catch (error) {
      message.error('停止容器失败');
    } finally {
      setLoading(false);
    }
  };

  // 重启容器
  const restartContainer = async () => {
    try {
      setLoading(true);
      const response = await axios.post(`/api/docker/container/${selectedContainer}/restart`);
      if (response.data.status === 'success') {
        message.success(response.data.message);
        fetchContainerInfo(selectedContainer);
      } else {
        message.error(response.data.message);
      }
    } catch (error) {
      message.error('重启容器失败');
    } finally {
      setLoading(false);
    }
  };

  // 生成Docker命令
  const generateDockerCommand = async () => {
    try {
      const values = await configForm.validateFields();
      
      // 确保数组字段存在，即使在折叠状态下
      const formData = {
        ...values,
        ports: values.ports || [],
        mounts: values.mounts || [],
        environment: values.environment || []
      };
      
      console.log('发送的表单数据:', formData);
      
      const response = await axios.post('/api/docker/generate-command', formData);
      if (response.data.status === 'success') {
        setGeneratedCommand(response.data.command);
        setCommandModalVisible(true);
      } else {
        message.error(response.data.message);
      }
    } catch (error) {
      console.error('生成Docker命令失败:', error);
      message.error('生成Docker命令失败');
    }
  };

  // 复制命令到剪贴板
  const copyCommand = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(generatedCommand).then(() => {
        message.success('命令已复制到剪贴板');
      }).catch(() => {
        message.error('复制失败');
      });
    } else {
      // 降级方案
      try {
        const textArea = document.createElement('textarea');
        textArea.value = generatedCommand;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
          message.success('命令已复制到剪贴板');
        } else {
          message.error('复制失败，请手动复制');
        }
      } catch (err) {
        message.error('复制失败，请手动复制');
      }
    }
  };

  useEffect(() => {
    fetchContainerList();
    if (selectedContainer) {
      fetchContainerInfo(selectedContainer);
    }
  }, [selectedContainer]);

  // 初始化表单默认值
  useEffect(() => {
    // 先尝试从localStorage恢复表单数据
    const savedConfigData = loadFormData('container_config');
    if (savedConfigData) {
      configForm.setFieldsValue(savedConfigData);
    } else {
      // 如果没有保存的数据，使用默认值
      configForm.setFieldsValue({
        ports: [],
        mounts: [],
        environment: []
      });
    }
  }, []);

  // 获取Docker镜像列表
  useEffect(() => {
    const fetchDockerImages = async () => {
      try {
        setDockerImagesLoading(true);
        const images = await getDockerImages();
        setDockerImages(images);
      } catch (error) {
        console.error('获取Docker镜像列表失败:', error);
      } finally {
        setDockerImagesLoading(false);
      }
    };

    fetchDockerImages();
  }, []);

  // 端口映射表格列
  const portColumns = [
    {
      title: '容器端口',
      dataIndex: 'container_port',
      key: 'container_port',
    },
    {
      title: '主机端口',
      dataIndex: 'host_port',
      key: 'host_port',
    },
    {
      title: '主机IP',
      dataIndex: 'host_ip',
      key: 'host_ip',
    }
  ];

  // 挂载点表格列
  const mountColumns = [
    {
      title: '主机路径',
      dataIndex: 'source',
      key: 'source',
    },
    {
      title: '容器路径',
      dataIndex: 'destination',
      key: 'destination',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
    },
    {
      title: '只读',
      dataIndex: 'read_only',
      key: 'read_only',
      render: (readOnly: boolean) => (
        <Tag color={readOnly ? 'red' : 'green'}>
          {readOnly ? '是' : '否'}
        </Tag>
      )
    }
  ];

  // 环境变量表格列
  const envColumns = [
    {
      title: '变量名',
      dataIndex: 'key',
      key: 'key',
    },
    {
      title: '变量值',
      dataIndex: 'value',
      key: 'value',
      render: (value: string) => (
        <Text ellipsis={{ tooltip: value }} style={{ maxWidth: 200 }}>
          {value}
        </Text>
      )
    }
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2}>
        <DockerOutlined /> 面板管理
      </Title>
      
      <Alert
        message="面板管理说明"
        description="此功能用于管理当前GSManager容器的配置和状态。您可以查看容器信息、配置参数，并生成重建命令。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card title="容器选择" size="small">
            <Space>
              <Text>选择容器：</Text>
              <Select
                value={selectedContainer}
                onChange={setSelectedContainer}
                style={{ width: 200 }}
                placeholder="请选择容器"
              >
                <Option value="GSManager">GSManager (推荐)</Option>
                {containerList.map(container => (
                  <Option key={container.name} value={container.name}>
                    {container.name} ({container.status})
                  </Option>
                ))}
              </Select>
              <Button 
                icon={<ReloadOutlined />} 
                onClick={() => fetchContainerList()}
                size="small"
              >
                刷新列表
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>

      {containerInfo && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col span={24}>
            <Card>
              <Tabs activeKey={activeTab} onChange={setActiveTab}>
                <TabPane tab="容器信息" key="info">
                  <Spin spinning={loading}>
                    <Row gutter={[16, 16]}>
                      <Col span={12}>
                        <Card title="基本信息" size="small">
                          <p><strong>容器名称：</strong>{containerInfo.name}</p>
                          <p><strong>容器ID：</strong>{containerInfo.id}</p>
                          <p><strong>状态：</strong>
                            <Tag color={containerInfo.status === 'running' ? 'green' : 'red'}>
                              {containerInfo.status}
                            </Tag>
                          </p>
                          <p><strong>镜像：</strong>{containerInfo.image}</p>
                          <p><strong>网络模式：</strong>
                            <Tooltip title={networkModeMap[containerInfo.network_mode as keyof typeof networkModeMap] || containerInfo.network_mode}>
                              {containerInfo.network_mode}
                            </Tooltip>
                          </p>
                          <p><strong>重启策略：</strong>{restartPolicyMap[containerInfo.restart_policy?.Name as keyof typeof restartPolicyMap] || containerInfo.restart_policy?.Name || '未设置'}</p>
                        </Card>
                      </Col>
                      <Col span={12}>
                        <Card title="容器操作" size="small">
                          <Space direction="vertical" style={{ width: '100%' }}>
                            <Button
                              type="primary"
                              icon={<ReloadOutlined />}
                              onClick={restartContainer}
                              loading={loading}
                              block
                            >
                              重启容器
                            </Button>
                            <Button
                              danger
                              icon={<StopOutlined />}
                              onClick={stopContainer}
                              loading={loading}
                              block
                            >
                              停止容器
                            </Button>
                            <Button
                              icon={<ReloadOutlined />}
                              onClick={() => fetchContainerInfo(selectedContainer)}
                              loading={loading}
                              block
                            >
                              刷新信息
                            </Button>
                          </Space>
                        </Card>
                      </Col>
                    </Row>

                    <Divider />

                    <Row gutter={[16, 16]}>
                      <Col span={24}>
                        <Collapse 
                          activeKey={collapsedPanels} 
                          onChange={(keys) => setCollapsedPanels(keys as string[])}
                          size="small"
                        >
                          <Panel header={`端口映射 (${containerInfo.ports?.length || 0})`} key="ports">
                            <Table
                              columns={portColumns}
                              dataSource={containerInfo.ports}
                              pagination={false}
                              size="small"
                              rowKey={(record, index) => `port-${index}`}
                            />
                          </Panel>
                          
                          <Panel header={`挂载点 (${containerInfo.mounts?.length || 0})`} key="mounts">
                            <Table
                              columns={mountColumns}
                              dataSource={containerInfo.mounts}
                              pagination={false}
                              size="small"
                              rowKey={(record, index) => `mount-${index}`}
                            />
                          </Panel>
                          
                          <Panel header={`环境变量 (${containerInfo.environment?.length || 0})`} key="environment">
                            <Table
                              columns={envColumns}
                              dataSource={containerInfo.environment}
                              pagination={false}
                              size="small"
                              rowKey={(record, index) => `env-${index}`}
                            />
                          </Panel>
                        </Collapse>
                      </Col>
                    </Row>
                  </Spin>
                </TabPane>

                <TabPane tab="容器配置" key="config">
                  <Alert
                    message="配置说明"
                    description="修改配置后，点击生成命令按钮获取Docker重建命令。请在宿主机执行该命令来重建容器。"
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  
                  <Form
                    form={configForm}
                    layout="vertical"
                    onFinish={generateDockerCommand}
                    onValuesChange={() => handleFormChange('container_config', configForm)}
                  >
                    <Row gutter={[16, 16]}>
                      <Col span={12}>
                        <Form.Item
                          label="容器名称"
                          name="name"
                          rules={[{ required: true, message: '请输入容器名称' }]}
                        >
                          <Input placeholder="容器名称" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          label="镜像名称"
                          name="image"
                          rules={[{ required: true, message: '请选择镜像名称' }]}
                        >
                          <Select
                            placeholder="请选择Docker镜像"
                            loading={dockerImagesLoading}
                            showSearch
                            allowClear
                            optionFilterProp="children"
                            filterOption={(input, option) =>
                              (option?.children as string)?.toLowerCase().includes(input.toLowerCase())
                            }
                            notFoundContent={dockerImagesLoading ? <Spin size="small" /> : '暂无镜像'}
                          >
                            {dockerImages.map((image) => (
                              <Option key={image.tag} value={image.tag}>
                                {image.tag}
                              </Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>

                    <Row gutter={[16, 16]}>
                      <Col span={12}>
                        <Form.Item
                          label={
                            <span>
                              网络模式
                              <Tooltip title="选择容器的网络连接方式">
                                <InfoCircleOutlined style={{ marginLeft: 4, color: '#1890ff' }} />
                              </Tooltip>
                            </span>
                          }
                          name="network_mode"
                        >
                          <Select 
                            placeholder="选择网络模式"
                            onChange={(value) => setNetworkMode(value)}
                          >
                            <Option value="bridge">
                              <div>
                                <div>bridge</div>
                                <div style={{ fontSize: '12px', color: '#666' }}>桥接模式 - 默认网络模式，容器有独立的网络栈</div>
                              </div>
                            </Option>
                            <Option value="host">
                              <div>
                                <div>host</div>
                                <div style={{ fontSize: '12px', color: '#666' }}>主机模式 - 容器与主机共享网络栈，性能最佳</div>
                              </div>
                            </Option>
                            <Option value="none">
                              <div>
                                <div>none</div>
                                <div style={{ fontSize: '12px', color: '#666' }}>无网络 - 容器没有网络连接</div>
                              </div>
                            </Option>
                            <Option value="container">
                              <div>
                                <div>container</div>
                                <div style={{ fontSize: '12px', color: '#666' }}>容器模式 - 与其他容器共享网络栈</div>
                              </div>
                            </Option>
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          label="重启策略"
                          name="restart_policy"
                        >
                          <Select placeholder="选择重启策略">
                            <Option value="no">不重启 (no)</Option>
                            <Option value="always">总是重启 (always)</Option>
                            <Option value="unless-stopped">除非手动停止 (unless-stopped)</Option>
                            <Option value="on-failure">失败时重启 (on-failure)</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>

                    <Collapse 
                      activeKey={collapsedPanels} 
                      onChange={(keys) => setCollapsedPanels(keys as string[])}
                      size="small"
                      destroyInactivePanel={false}
                    >
                      <Panel 
                        header={
                          <span>
                            端口映射配置
                            {networkMode === 'host' && (
                              <Tooltip title="host网络模式下容器直接使用主机网络，无需端口映射">
                                <InfoCircleOutlined style={{ marginLeft: 4, color: '#ff7875' }} />
                              </Tooltip>
                            )}
                          </span>
                        } 
                        key="config-ports"
                        forceRender={true}
                      >
                        <Form.List name="ports">
                          {(fields, { add, remove }) => (
                            <>
                              <Form.Item>
                                {networkMode === 'host' ? (
                                  <Alert
                                    message="host网络模式下无需配置端口映射"
                                    description="容器将直接使用主机的网络栈，所有端口都会直接暴露在主机上"
                                    type="info"
                                    showIcon
                                  />
                                ) : (
                                  <Button
                                    type="dashed"
                                    onClick={() => add()}
                                    icon={<PlusOutlined />}
                                  >
                                    添加端口映射
                                  </Button>
                                )}
                              </Form.Item>
                              {networkMode !== 'host' && fields.map(({ key, name, ...restField }) => (
                                <Row key={key} gutter={[8, 8]} align="middle">
                                  <Col span={5}>
                                    <Form.Item
                                      {...restField}
                                      name={[name, 'host_ip']}
                                      label="主机IP"
                                    >
                                      <Input placeholder="0.0.0.0" />
                                    </Form.Item>
                                  </Col>
                                  <Col span={4}>
                                    <Form.Item
                                      {...restField}
                                      name={[name, 'host_port']}
                                      label="主机端口"
                                    >
                                      <Input placeholder="主机端口" />
                                    </Form.Item>
                                  </Col>
                                  <Col span={4}>
                                    <Form.Item
                                      {...restField}
                                      name={[name, 'container_port']}
                                      label="容器端口"
                                    >
                                      <Input placeholder="容器端口" />
                                    </Form.Item>
                                  </Col>
                                  <Col span={4}>
                                    <Form.Item
                                      {...restField}
                                      name={[name, 'protocol']}
                                      label="协议"
                                      initialValue="tcp"
                                    >
                                      <Select placeholder="选择协议">
                                        <Option value="tcp">TCP</Option>
                                        <Option value="udp">UDP</Option>
                                        <Option value="sctp">SCTP</Option>
                                      </Select>
                                    </Form.Item>
                                  </Col>
                                  <Col span={3}>
                                    <Button
                                      type="link"
                                      danger
                                      icon={<DeleteOutlined />}
                                      onClick={() => remove(name)}
                                    >
                                      删除
                                    </Button>
                                  </Col>
                                </Row>
                              ))}
                            </>
                          )}
                        </Form.List>
                      </Panel>

                      <Panel header="挂载点配置" key="config-mounts" forceRender={true}>
                        <Form.List name="mounts">
                          {(fields, { add, remove }) => (
                            <>
                              <Form.Item>
                                <Button
                                  type="dashed"
                                  onClick={() => add()}
                                  icon={<PlusOutlined />}
                                >
                                  添加挂载点
                                </Button>
                              </Form.Item>
                              {fields.map(({ key, name, ...restField }) => (
                                <Row key={key} gutter={[8, 8]} align="middle">
                                  <Col span={7}>
                                    <Form.Item
                                      {...restField}
                                      name={[name, 'source']}
                                      label="主机路径"
                                    >
                                      <Input placeholder="主机路径" />
                                    </Form.Item>
                                  </Col>
                                  <Col span={7}>
                                    <Form.Item
                                      {...restField}
                                      name={[name, 'destination']}
                                      label="容器路径"
                                    >
                                      <Input placeholder="容器路径" />
                                    </Form.Item>
                                  </Col>
                                  <Col span={4}>
                                    <Form.Item
                                      {...restField}
                                      name={[name, 'read_only']}
                                      label="只读"
                                      valuePropName="checked"
                                    >
                                      <Switch />
                                    </Form.Item>
                                  </Col>
                                  <Col span={6}>
                                    <Button
                                      type="link"
                                      danger
                                      icon={<DeleteOutlined />}
                                      onClick={() => remove(name)}
                                    >
                                      删除
                                    </Button>
                                  </Col>
                                </Row>
                              ))}
                            </>
                          )}
                        </Form.List>
                      </Panel>

                      <Panel header="环境变量配置" key="config-environment" forceRender={true}>
                        <Form.List name="environment">
                          {(fields, { add, remove }) => (
                            <>
                              <Form.Item>
                                <Button
                                  type="dashed"
                                  onClick={() => add()}
                                  icon={<PlusOutlined />}
                                >
                                  添加环境变量
                                </Button>
                              </Form.Item>
                              {fields.map(({ key, name, ...restField }) => (
                                <Row key={key} gutter={[8, 8]} align="middle">
                                  <Col span={8}>
                                    <Form.Item
                                      {...restField}
                                      name={[name, 'key']}
                                      label="变量名"
                                    >
                                      <Input placeholder="变量名" />
                                    </Form.Item>
                                  </Col>
                                  <Col span={12}>
                                    <Form.Item
                                      {...restField}
                                      name={[name, 'value']}
                                      label="变量值"
                                    >
                                      <Input placeholder="变量值" />
                                    </Form.Item>
                                  </Col>
                                  <Col span={4}>
                                    <Button
                                      type="link"
                                      danger
                                      icon={<DeleteOutlined />}
                                      onClick={() => remove(name)}
                                    >
                                      删除
                                    </Button>
                                  </Col>
                                </Row>
                              ))}
                            </>
                          )}
                        </Form.List>
                      </Panel>
                    </Collapse>

                    <Form.Item>
                      <Button type="primary" htmlType="submit" icon={<SettingOutlined />}>
                        生成Docker命令
                      </Button>
                    </Form.Item>
                  </Form>
                </TabPane>
              </Tabs>
            </Card>
          </Col>
        </Row>
      )}

      {/* Docker命令生成弹窗 */}
      <Modal
        title="Docker重建命令"
        open={commandModalVisible}
        onCancel={() => setCommandModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setCommandModalVisible(false)}>
            关闭
          </Button>,
          <Button key="copy" type="primary" icon={<CopyOutlined />} onClick={copyCommand}>
            复制命令
          </Button>
        ]}
        width={800}
      >
        <Alert
          message="使用说明"
          description="由于容器更新需要删除之前容器，请确保在执行命令前正确将游戏存档目录映射到宿主路径，避免存档丢失！"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
        
        <Paragraph>
          <Text strong>生成的Docker命令：</Text>
        </Paragraph>
        
        <TextArea
          value={generatedCommand}
          rows={6}
          readOnly
          style={{ fontFamily: 'monospace', fontSize: '12px' }}
        />
        
        <Paragraph style={{ marginTop: 16 }}>
          <Text type="secondary">
            提示：复制命令后，请在宿主机的终端中执行。执行前请确保已停止当前容器。
          </Text>
        </Paragraph>
      </Modal>
    </div>
  );
};

export default PanelManager;