import React, { useState, useEffect } from 'react';
import { Typography, Card, Tabs, Form, Input, Button, message, Alert, Divider, Spin, Switch, InputNumber, Select, Space } from 'antd';
import axios from 'axios';
import { HeartOutlined, InfoCircleOutlined, FileTextOutlined, DownloadOutlined, ReloadOutlined, GlobalOutlined, DockerOutlined } from '@ant-design/icons';
import PanelManager from '../components/PanelManager';

const { Title, Paragraph } = Typography;
const { TabPane } = Tabs;

const Settings: React.FC = () => {
  const [form] = Form.useForm();
  const [proxyForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [sponsorKeyLoading, setSponsorKeyLoading] = useState(true);
  const [hasSponsorKey, setHasSponsorKey] = useState(false);
  const [maskedSponsorKey, setMaskedSponsorKey] = useState('');
  
  // 日志相关状态
  const [logContent, setLogContent] = useState<string>('');
  const [logLoading, setLogLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  
  // 代理设置相关状态
  const [proxyLoading, setProxyLoading] = useState(false);
  const [networkTesting, setNetworkTesting] = useState(false);
  const [networkTestResult, setNetworkTestResult] = useState(null);
  const [proxyConfig, setProxyConfig] = useState({
    enabled: false,
    type: 'http',
    host: '',
    port: 8080,
    username: '',
    password: '',
    no_proxy: ''
  });

  // 获取赞助者凭证信息
  useEffect(() => {
    const fetchSponsorKey = async () => {
      try {
        setSponsorKeyLoading(true);
        const response = await axios.get('/api/settings/sponsor-key');
        
        if (response.data.status === 'success') {
          setHasSponsorKey(response.data.has_sponsor_key || false);
          setMaskedSponsorKey(response.data.masked_sponsor_key || '');
        }
      } catch (error) {
        console.error('获取赞助者凭证失败:', error);
        message.error('获取赞助者凭证信息失败');
      } finally {
        setSponsorKeyLoading(false);
      }
    };

    fetchSponsorKey();
  }, []);

  // 获取代理配置
  useEffect(() => {
    const fetchProxyConfig = async () => {
      try {
        const response = await axios.get('/api/settings/proxy');
        
        if (response.data.status === 'success') {
          const config = response.data.config;
          setProxyConfig(config);
          proxyForm.setFieldsValue(config);
        }
      } catch (error) {
        console.error('获取代理配置失败:', error);
        // 如果获取失败，使用默认配置
      }
    };

    fetchProxyConfig();
  }, [proxyForm]);

  // 获取日志内容
  const fetchLogContent = async () => {
    try {
      setLogLoading(true);
      const response = await axios.get('/api/logs/api-server');
      
      if (response.data.status === 'success') {
        setLogContent(response.data.content || '暂无日志内容');
      } else {
        message.error(`获取日志失败: ${response.data.message || '未知错误'}`);
        setLogContent('获取日志失败');
      }
    } catch (error) {
      console.error('获取日志失败:', error);
      message.error('获取日志失败');
      setLogContent('获取日志失败');
    } finally {
      setLogLoading(false);
    }
  };

  // 导出日志
  const handleExportLog = async () => {
    try {
      setExportLoading(true);
      const response = await axios.get('/api/logs/api-server/export', {
        responseType: 'blob'
      });
      
      // 创建下载链接
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      // 生成文件名（包含时间戳）
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
      link.download = `api_server_${timestamp}.log`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      message.success('日志导出成功');
    } catch (error) {
      console.error('导出日志失败:', error);
      message.error('导出日志失败');
    } finally {
      setExportLoading(false);
    }
  };

  // 保存代理配置
  const handleProxyConfigSubmit = async (values: any) => {
    try {
      setProxyLoading(true);
      
      const response = await axios.post('/api/settings/proxy', values);
      
      if (response.data.status === 'success') {
        message.success('代理配置保存成功');
        setProxyConfig(values);
      } else {
        message.error(response.data.message || '保存失败');
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '保存失败');
    } finally {
      setProxyLoading(false);
    }
  };

  // 测试网络连通性
  const testNetworkConnectivity = async () => {
    try {
      setNetworkTesting(true);
      setNetworkTestResult(null);
      
      const startTime = Date.now();
      const response = await axios.post('/api/settings/test-network', {
        timeout: 1000  // 设置默认超时时间为1000ms
      });
      const endTime = Date.now();
      const latency = endTime - startTime;
      
      if (response.data.status === 'success') {
        setNetworkTestResult({
          success: true,
          latency: latency,
          message: `连接成功，延迟: ${latency}ms`
        });
        message.success(`网络连通性测试成功，延迟: ${latency}ms`);
      } else {
        setNetworkTestResult({
          success: false,
          latency: null,
          message: response.data.message || '连接失败'
        });
        message.error(response.data.message || '网络连通性测试失败');
      }
    } catch (error: any) {
      let errorMessage = '网络连接失败';
      
      // 检查是否为超时错误
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        errorMessage = '请求超时，请检查代理配置';
      } else {
        errorMessage = error.response?.data?.message || error.message || '网络连接失败';
      }
      
      setNetworkTestResult({
        success: false,
        latency: null,
        message: errorMessage
      });
      message.error(errorMessage);
    } finally {
      setNetworkTesting(false);
    }
  };

  // 保存赞助者凭证
  const handleSponsorCredentialSubmit = async (values: { sponsorKey: string }) => {
    try {
      setLoading(true);
      
      // 发送请求保存赞助者凭证到 /home/steam/games/config.json
      const response = await axios.post('/api/settings/sponsor-key', {
        sponsorKey: values.sponsorKey
      });
      
      if (response.data.status === 'success') {
        message.success('赞助者凭证保存成功');
        
        // 重新获取凭证信息
        const getResponse = await axios.get('/api/settings/sponsor-key');
        if (getResponse.data.status === 'success') {
          setHasSponsorKey(getResponse.data.has_sponsor_key || false);
          setMaskedSponsorKey(getResponse.data.masked_sponsor_key || '');
        }
        
        // 清空表单
        form.resetFields();
      } else {
        message.error(`保存失败: ${response.data.message || '未知错误'}`);
      }
    } catch (error) {
      message.error(`保存失败: ${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  };

  // 日志管理部分的JSX
  const renderLogSection = () => (
    <Card 
      title={<><FileTextOutlined /> 系统日志</>}
      bordered={false} 
      className="settings-card"
      extra={
        <div>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={fetchLogContent}
            loading={logLoading}
            style={{ marginRight: 8 }}
          >
            刷新
          </Button>
          <Button 
            type="primary"
            icon={<DownloadOutlined />} 
            onClick={handleExportLog}
            loading={exportLoading}
          >
            导出日志
          </Button>
        </div>
      }
    >
      <Paragraph>
        查看和导出API服务器的运行日志，帮助诊断系统问题。
      </Paragraph>
      
      <div style={{ 
        border: '1px solid #d9d9d9', 
        borderRadius: 6, 
        padding: 12, 
        backgroundColor: '#fafafa',
        minHeight: 400,
        maxHeight: 600,
        overflow: 'auto',
        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
        fontSize: 12,
        lineHeight: 1.5
      }}>
        {logLoading ? (
          <div style={{ textAlign: 'center', padding: 50 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>正在加载日志...</div>
          </div>
        ) : (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'left' }}>
            {logContent}
          </pre>
        )}
      </div>
      
      <Alert
        message="日志文件路径"
        description="/home/steam/server/api_server.log"
        type="info"
        showIcon
        style={{ marginTop: 16 }}
      />
    </Card>
  );

  // 代理设置部分的JSX
  const renderProxySection = () => (
    <Card 
      title={<><GlobalOutlined /> 网络代理设置</>}
      bordered={false} 
      className="settings-card"
    >
      <Paragraph>
        配置全局网络代理，用于访问外部资源时使用代理服务器。
      </Paragraph>
      
      <Form
        form={proxyForm}
        layout="vertical"
        onFinish={handleProxyConfigSubmit}
        initialValues={proxyConfig}
      >
        <Form.Item
          name="enabled"
          label="启用代理"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
        
        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) => prevValues.enabled !== currentValues.enabled}
        >
          {({ getFieldValue }) => {
            const enabled = getFieldValue('enabled');
            return enabled ? (
              <>
                <Form.Item
                  name="type"
                  label="代理类型"
                  rules={[{ required: true, message: '请选择代理类型' }]}
                >
                  <Select>
                    <Select.Option value="http">HTTP</Select.Option>
                    <Select.Option value="https">HTTPS</Select.Option>
                    <Select.Option value="socks5">SOCKS5</Select.Option>
                  </Select>
                </Form.Item>
                
                <Form.Item
                  name="host"
                  label="代理服务器地址"
                  rules={[{ required: true, message: '请输入代理服务器地址' }]}
                >
                  <Input placeholder="例如: 127.0.0.1" />
                </Form.Item>
                
                <Form.Item
                  name="port"
                  label="端口"
                  rules={[{ required: true, message: '请输入端口号' }]}
                >
                  <InputNumber 
                    min={1} 
                    max={65535} 
                    placeholder="例如: 8080" 
                    style={{ width: '100%' }}
                  />
                </Form.Item>
                
                <Form.Item
                  name="username"
                  label="用户名（可选）"
                >
                  <Input placeholder="如果代理需要认证，请输入用户名" />
                </Form.Item>
                
                <Form.Item
                  name="password"
                  label="密码（可选）"
                >
                  <Input.Password placeholder="如果代理需要认证，请输入密码" />
                </Form.Item>
                
                <Form.Item
                  name="no_proxy"
                  label="不使用代理的地址（可选）"
                >
                  <Input.TextArea 
                    rows={3}
                    placeholder="不需要使用代理的地址，每行一个，例如：&#10;localhost&#10;127.0.0.1&#10;*.local"
                  />
                </Form.Item>
              </>
            ) : null;
          }}
        </Form.Item>
        
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={proxyLoading}>
              保存配置
            </Button>
            <Button 
              type="default" 
              loading={networkTesting}
              onClick={testNetworkConnectivity}
              icon={<GlobalOutlined />}
            >
              测试谷歌连通性
            </Button>
          </Space>
        </Form.Item>
        
        {networkTestResult && (
          <Form.Item>
            <Alert
              message={networkTestResult.success ? "网络连通性测试成功" : "网络连通性测试失败"}
              description={
                <div>
                  <div>{networkTestResult.message}</div>
                  {networkTestResult.success && networkTestResult.latency && (
                    <div style={{ marginTop: 8 }}>
                      <strong>延迟详情:</strong>
                      <ul style={{ margin: '4px 0 0 20px' }}>
                        <li>响应时间: {networkTestResult.latency}ms</li>
                        <li>连接状态: {networkTestResult.latency < 1000 ? '良好' : networkTestResult.latency < 3000 ? '一般' : '较慢'}</li>
                      </ul>
                    </div>
                  )}
                </div>
              }
              type={networkTestResult.success ? "success" : "error"}
              showIcon
              closable
              onClose={() => setNetworkTestResult(null)}
            />
          </Form.Item>
        )}
      </Form>
      
      <Alert
        message="注意事项"
        description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>代理配置将影响系统的所有网络请求</li>
            <li>请确保代理服务器地址和端口正确</li>
            <li>如果代理服务器需要认证，请填写用户名和密码</li>
            <li>修改配置后可能需要重启服务才能生效</li>
          </ul>
        }
        type="info"
        showIcon
        style={{ marginTop: 16 }}
      />
    </Card>
  );

  // 赞助者凭证设置部分的JSX
  const renderSponsorCredentialSection = () => (
    <Card 
      title={<><HeartOutlined /> 赞助者凭证</>}
      bordered={false} 
      className="settings-card"
    >
      <Paragraph>
        成为赞助者后，您将获得额外的特权功能，包括从云端获取更多可部署的游戏列表。
        请在下方输入您的赞助者凭证。
      </Paragraph>
      
      <Paragraph type="secondary">
        <InfoCircleOutlined /> 赞助者权益:
        <ul>
          <li>从云端获取更多可部署的游戏列表及最新的游戏启动脚本</li>
          <li>国内服务器高速下载Java运行环境</li>
          <li>在线部署使用权益</li>
          <li>版本更新提示功能</li>
          <li>享受星辰资源站的高速下载特权</li>
        </ul>
      </Paragraph>
      
      {hasSponsorKey ? (
        <Alert
          message="已保存赞助者凭证"
          description={`当前凭证: ${maskedSponsorKey}`}
          type="success"
          showIcon
          style={{ marginBottom: '16px' }}
        />
      ) : null}
      
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSponsorCredentialSubmit}
      >
        <Form.Item
          name="sponsorKey"
          label="赞助者凭证"
          rules={[{ required: true, message: '请输入赞助者凭证' }]}
        >
          <Input.Password placeholder="请输入您的赞助者凭证" />
        </Form.Item>
        
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            保存凭证
          </Button>
        </Form.Item>
      </Form>
      
      <Divider />
      
      <Paragraph type="secondary">
        还不是赞助者？ 
        <Button type="link" onClick={() => window.open('https://afdian.com/a/xiaozhuhouses', '_blank')}>
          立即赞助
        </Button>
        获取赞助者特权！
      </Paragraph>
    </Card>
  );

  return (
    <Card className="settings-card full-width" bordered={false}>
      <Title level={2}>系统设置</Title>
      
      <Tabs defaultActiveKey="sponsor">
        <TabPane tab="赞助者凭证" key="sponsor">
          <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 0' }}>
            {renderSponsorCredentialSection()}
          </div>
        </TabPane>
        <TabPane tab="代理设置" key="proxy">
          <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 0' }}>
            {renderProxySection()}
          </div>
        </TabPane>
        <TabPane tab="面板管理" key="panel">
          <PanelManager />
        </TabPane>
        <TabPane tab="日志" key="logs">
          <div style={{ padding: '20px 0' }}>
            {renderLogSection()}
          </div>
        </TabPane>
      </Tabs>
    </Card>
  );
};

export default Settings;