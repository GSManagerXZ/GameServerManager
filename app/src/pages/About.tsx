// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Typography, Card, Space, Divider, Tabs, Spin, Alert, Button } from 'antd';
import { GithubOutlined, HeartOutlined, QqOutlined, ShoppingOutlined, CoffeeOutlined, GlobalOutlined, TrophyOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Title, Paragraph, Text } = Typography;
const { TabPane } = Tabs;

// 定义金牌赞助商数据类型
interface SponsorData {
  [key: string]: {
    URL: string;
    txt: string;
  };
}

const About: React.FC = () => {
  const [officialWebLoading, setOfficialWebLoading] = useState<boolean>(true);
  const [officialWebError, setOfficialWebError] = useState<boolean>(false);
  const [githubLoading, setGithubLoading] = useState<boolean>(true);
  const [githubError, setGithubError] = useState<boolean>(false);
  const [html6Loading, setHtml6Loading] = useState<boolean>(true);
  const [html6Error, setHtml6Error] = useState<boolean>(false);
  const [sponsorLoading, setSponsorLoading] = useState<boolean>(true);
  const [sponsorError, setSponsorError] = useState<boolean>(false);
  const [sponsorData, setSponsorData] = useState<SponsorData>({});

  // 加载官网内容
  useEffect(() => {
    // 模拟加载官网内容
    setOfficialWebLoading(true);
    setOfficialWebError(false);
    
    // 设置超时，如果iframe加载时间过长，显示错误信息
    const timeoutId = setTimeout(() => {
      setOfficialWebLoading(false);
    }, 3000);
    
    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  // GitHub仓库信息
  useEffect(() => {
    // 模拟加载GitHub内容
    setGithubLoading(true);
    
    // 设置超时，模拟加载完成
    const timeoutId = setTimeout(() => {
      setGithubLoading(false);
    }, 1000);
    
    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  // HTML6页面加载
  useEffect(() => {
    // 模拟加载HTML6内容
    setHtml6Loading(true);
    setHtml6Error(false);
    
    // 设置超时，如果iframe加载时间过长，显示错误信息
    const timeoutId = setTimeout(() => {
      setHtml6Loading(false);
    }, 3000);
    
    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  // 获取金牌赞助商数据
  useEffect(() => {
    const fetchSponsorData = async () => {
      try {
        setSponsorLoading(true);
        setSponsorError(false);
        
        // 使用代理API避免CORS问题
        const response = await axios.get('/api/sponsor');
        setSponsorData(response.data);
      } catch (error) {
        console.error('获取金牌赞助商数据失败:', error);
        setSponsorError(true);
      } finally {
        setSponsorLoading(false);
      }
    };

    fetchSponsorData();
  }, []);

  // 处理官网iframe加载完成
  const handleOfficialWebIframeLoad = () => {
    setOfficialWebLoading(false);
  };

  // 处理官网iframe加载失败
  const handleOfficialWebIframeError = () => {
    setOfficialWebLoading(false);
    setOfficialWebError(true);
  };

  // 处理HTML6 iframe加载完成
  const handleHtml6IframeLoad = () => {
    setHtml6Loading(false);
  };

  // 处理HTML6 iframe加载失败
  const handleHtml6IframeError = () => {
    setHtml6Loading(false);
    setHtml6Error(true);
  };

  // 打开GitHub仓库
  const openGithubRepo = () => {
    window.open('https://github.com/yxsj245/gameserver_container/tree/2.0', '_blank');
  };

  // 打开闲鱼赞助页面
  const openXianyuSponsor = () => {
    window.open('https://h5.m.goofish.com/item?forceFlush=1&id=919136867258&ut_sk=1.ZK1cY5c8vMgDADyNPjuw0sjp_21407387_1748346738023.copy.detail.919136867258.2200699006720', '_blank');
  };

  // 打开爱发电赞助页面
  const openAfdianSponsor = () => {
    window.open('https://afdian.com/a/xiaozhuhouses', '_blank');
  };

  // 打开QQ交流群
  const openQQGroup = () => {
    window.open('https://qm.qq.com/q/WcNyaRWHaE', '_blank');
  };

  return (
    <Card className="about-card full-width" bordered={false}>
      <Tabs defaultActiveKey="1" centered>
        <TabPane tab="官方网站" key="1">
          {officialWebLoading && (
            <div className="loading-container">
              <Spin size="large" />
              <div style={{ marginTop: 16 }}>正在加载官网内容...</div>
            </div>
          )}
          
          {officialWebError ? (
            <Alert
              message="加载失败"
              description="无法加载官方网站内容，请检查您的网络连接或稍后再试。"
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
            />
          ) : (
            <div 
              className="official-website-container" 
              style={{ display: officialWebLoading ? 'none' : 'block', height: '100%' }}
            >
              <iframe 
                src="http://blogpage.xiaozhuhouses.asia/html5/index.html" 
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  border: 'none', 
                  borderRadius: '8px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}
                title="GameServerManager 官方网站"
                onLoad={handleOfficialWebIframeLoad}
                onError={handleOfficialWebIframeError}
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </div>
          )}
        </TabPane>
        
        <TabPane tab="GitHub" key="2">
          {githubLoading ? (
            <div className="loading-container">
              <Spin size="large" />
              <div style={{ marginTop: 16 }}>正在加载GitHub仓库信息...</div>
            </div>
          ) : (
            <div className="github-info-container">
              <div className="github-header">
                <GithubOutlined className="github-logo" />
                <Title level={2}>GameServer Container</Title>
              </div>
              
              <Paragraph className="github-description">
                一个可以用来运行几乎所有的steam服务端容器项目
              </Paragraph>
              
              <div className="github-stats">
                <div className="github-stat">
                  <span className="stat-number">84</span>
                  <span className="stat-label">Stars</span>
                </div>
                <div className="github-stat">
                  <span className="stat-number">2</span>
                  <span className="stat-label">Forks</span>
                </div>
                <div className="github-stat">
                  <span className="stat-number">1</span>
                  <span className="stat-label">Watchers</span>
                </div>
              </div>
              
              <Divider />
              
              <Title level={3}>开发方向</Title>
              <Paragraph>
                2.0版本主打网页端操作，在保持低占用的同时采用typescript语言进行开发，后端采用python进行重构。
              </Paragraph>
              
              <Title level={3}>许可证</Title>
              <Paragraph>
                AGPL-3.0 license
              </Paragraph>
              
              <Title level={3}>主要语言</Title>
              <div className="language-stats">
                <div className="language-stat">
                  <div className="language-color" style={{ backgroundColor: '#89e051' }}></div>
                  <span className="language-name">Shell</span>
                  <span className="language-percentage">95.6%</span>
                </div>
                <div className="language-stat">
                  <div className="language-color" style={{ backgroundColor: '#384d54' }}></div>
                  <span className="language-name">Dockerfile</span>
                  <span className="language-percentage">4.4%</span>
                </div>
              </div>
              
              <div className="github-actions">
                <Button 
                  type="primary" 
                  icon={<GithubOutlined />} 
                  size="large"
                  onClick={openGithubRepo}
                >
                  访问GitHub仓库
                </Button>
              </div>
            </div>
          )}
        </TabPane>
        
        <TabPane tab="赞助项目" key="3">
          <div className="sponsor-container">
            <div className="sponsor-header">
              <HeartOutlined className="sponsor-logo" />
              <Title level={2}>支持我们的项目</Title>
            </div>
            
            <Paragraph className="sponsor-description">
              GameServerManager 是一个开源项目，目前由 又菜又爱玩的小朱 独立开发。
              您的支持将帮助我们持续改进项目，提供更好的功能和服务。
            </Paragraph>
            
            <div className="sponsor-quote">
              <blockquote>
                "每一份支持都是对开源精神的传承，每一次赞助都是对创新力量的肯定。"
              </blockquote>
            </div>
            
            <Divider />
            
            <Title level={3}>赞助渠道</Title>
            
            <div className="sponsor-options">
              <div className="sponsor-option">
                <div className="sponsor-option-icon">
                  <ShoppingOutlined />
                </div>
                <div className="sponsor-option-content">
                  <Title level={4}>闲鱼平台（推荐）</Title>
                  <Paragraph>
                    通过闲鱼平台进行赞助，和提供技术支持，付款简单方便，也是购买项目所有权的唯一途径。
                  </Paragraph>
                  <Button 
                    type="primary" 
                    icon={<ShoppingOutlined />} 
                    onClick={openXianyuSponsor}
                    className="sponsor-button"
                  >
                    前往闲鱼赞助
                  </Button>
                </div>
              </div>
              
              <div className="sponsor-option">
                <div className="sponsor-option-icon">
                  <CoffeeOutlined />
                </div>
                <div className="sponsor-option-content">
                  <Title level={4}>爱发电平台</Title>
                  <Paragraph>
                    通过爱发电平台支持我们，让创作者持续输出优质内容。
                  </Paragraph>
                  <Button 
                    type="primary" 
                    icon={<CoffeeOutlined />} 
                    onClick={openAfdianSponsor}
                    className="sponsor-button"
                  >
                    前往爱发电赞助
                  </Button>
                </div>
              </div>
              
              <div className="sponsor-option">
                <div className="sponsor-option-icon">
                  <QqOutlined />
                </div>
                <div className="sponsor-option-content">
                  <Title level={4}>QQ交流群</Title>
                  <Paragraph>
                    加入我们的QQ交流群，与开发者和其他用户交流，获取最新动态。
                  </Paragraph>
                  <Button 
                    type="primary" 
                    icon={<QqOutlined />} 
                    onClick={openQQGroup}
                    className="sponsor-button"
                  >
                    加入QQ交流群
                  </Button>
                </div>
              </div>
            </div>
            
            <Divider />
            
            <div className="sponsor-footer">
              <Paragraph>
                感谢您对GameServerManager项目的关注与支持！您的每一份贡献都将帮助我们不断完善这个项目，
                为更多开服玩家提供便捷的渠道。
              </Paragraph>
              <Paragraph>
                <Text strong>
                  开源不易，感谢有您同行！
                </Text>
              </Paragraph>
            </div>
          </div>
        </TabPane>
        
        <TabPane tab="金牌赞助商" key="4">
          <div className="gold-sponsor-container">
            <div className="sponsor-header">
              <TrophyOutlined className="sponsor-logo" style={{ color: '#ffd700' }} />
              <Title level={2}>金牌赞助商</Title>
            </div>
            
            <Paragraph className="sponsor-description">
              感谢以下金牌赞助商对GameServerManager项目的大力支持！
            </Paragraph>
            
            {sponsorLoading ? (
              <div className="loading-container">
                <Spin size="large" />
                <div style={{ marginTop: 16 }}>正在加载金牌赞助商信息...</div>
              </div>
            ) : sponsorError ? (
              <Alert
                message="加载失败"
                description="无法获取金牌赞助商信息，请检查您的网络连接或稍后再试。"
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
              />
            ) : (
              <div className="gold-sponsors-grid">
                {Object.entries(sponsorData).length === 0 ? (
                  <div className="no-sponsors">
                    <Paragraph>暂无金牌赞助商信息</Paragraph>
                  </div>
                ) : (
                  Object.entries(sponsorData).map(([name, info]) => (
                    <Card
                      key={name}
                      className="sponsor-card"
                      hoverable
                      style={{
                        marginBottom: 16,
                        borderColor: '#ffd700',
                        borderWidth: 2
                      }}
                      onClick={() => {
                        if (info.URL) {
                          window.open(info.URL, '_blank');
                        }
                      }}
                    >
                      <div className="sponsor-card-content">
                        <div className="sponsor-name">
                          <TrophyOutlined style={{ color: '#ffd700', marginRight: 8 }} />
                          <Title level={4} style={{ margin: 0, color: '#ffd700' }}>
                            {name}
                          </Title>
                        </div>
                        {info.txt && (
                          <Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                            {info.txt}
                          </Paragraph>
                        )}
                        {info.URL && (
                          <div style={{ marginTop: 8 }}>
                            <Button 
                              type="link" 
                              icon={<GlobalOutlined />}
                              style={{ padding: 0, color: '#1890ff' }}
                            >
                              访问官网
                            </Button>
                          </div>
                        )}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            )}
            
            <Divider />
            
            <div className="sponsor-footer">
              <Paragraph>
                想要成为我们的金牌赞助商？请通过赞助项目页面联系我们！
              </Paragraph>
            </div>
          </div>
        </TabPane>
        
        <TabPane tab="文档站" key="5">
          {html6Loading && (
            <div className="loading-container">
              <Spin size="large" />
              <div style={{ marginTop: 16 }}>正在加载新版官网内容...</div>
            </div>
          )}
          
          {html6Error ? (
            <Alert
              message="加载失败"
              description="无法加载文档站内容，请检查您的网络连接或稍后再试。"
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
            />
          ) : (
            <div 
              className="html6-container" 
              style={{ display: html6Loading ? 'none' : 'block', height: '100%' }}
            >
              <iframe 
                src="http://blogpage.xiaozhuhouses.asia/html6/index.html#/" 
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  border: 'none', 
                  borderRadius: '8px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}
                title="GameServerManager 文档站"
                onLoad={handleHtml6IframeLoad}
                onError={handleHtml6IframeError}
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </div>
          )}
        </TabPane>
      </Tabs>
    </Card>
  );
};

export default About;