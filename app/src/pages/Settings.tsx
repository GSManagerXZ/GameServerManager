import React, { useState, useEffect } from 'react';
import { Typography, Card, Tabs, Form, Input, Button, message, Alert, Divider } from 'antd';
import axios from 'axios';
import { HeartOutlined, InfoCircleOutlined } from '@ant-design/icons';

const { Title, Paragraph } = Typography;
const { TabPane } = Tabs;

const Settings: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [sponsorKeyLoading, setSponsorKeyLoading] = useState(true);
  const [hasSponsorKey, setHasSponsorKey] = useState(false);
  const [maskedSponsorKey, setMaskedSponsorKey] = useState('');

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
          <li>从云端获取更多可部署的游戏列表</li>
          <li>获取专属的游戏服务器部署脚本</li>
          <li>后续更多特权功能将陆续推出</li>
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
      </Tabs>
    </Card>
  );
};

export default Settings; 