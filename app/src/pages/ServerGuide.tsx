import React, { useState, useMemo } from 'react';
import { Typography, Card, Row, Col, Button, Space, Tooltip, message, Tag } from 'antd';

const { Title, Paragraph } = Typography;

// 定义导航站点类型
interface SiteInfo {
  name: string;
  description: string;
  url: string;
  tags?: string[];
}

const ServerGuide: React.FC = () => {
  const [hoveredSite, setHoveredSite] = useState<number | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  
  // 导航站点数据
  const sites: SiteInfo[] = [
    {
      name: 'SteamDB',
      description: 'Steam平台上所有可用游戏服务器的完整列表和AppID',
      url: 'https://steamdb.info/search/?a=app&q=server',
      tags: ['工具']
    },
    {
      name: '灵依资源站',
      description: '我的世界核心下载|快速下载所有MC开服资源',
      url: 'https://mcres.cn/',
      tags: ['Minecraft', '资源']
    },
    {
      name: 'ME Frp 幻缘映射',
      description: '免费·公益·好用·低延迟·稳定的内网穿透服务|五年技术沉淀·稳定可靠',
      url: 'https://www.mefrp.com/',
      tags: ['内网穿透', 'FRP']
    },
    {
      name: 'LoCyanFrp 乐青映射',
      description: '一个完全免费, 高自由度的内网穿透',
      url: 'https://www.locyanfrp.cn/',
      tags: ['内网穿透', 'FRP']
    },
    {
      name: 'Sakura 樱花内网穿透',
      description: '免费穿，轻松透',
      url: 'https://www.natfrp.com/',
      tags: ['内网穿透', 'FRP']
    },
    {
      name: 'Rust服务器配置指南',
      description: '详细的Rust服务器配置教程，包括参数说明和优化建议',
      url: 'https://umod.org/community/oxide/guides',
      tags: ['教程']
    },
    {
      name: '7 Days to Die服务器指南',
      description: '7D2D服务器设置和管理的完整教程',
      url: 'https://7daystodie.fandom.com/wiki/Server',
      tags: ['教程']
    },
    {
      name: 'UMOD插件平台',
      description: '各类游戏服务器的插件资源站，包括Rust、Unturned等',
      url: 'https://umod.org/',
      tags: ['插件']
    },
    {
      name: 'SourceMod插件',
      description: '适用于CS2、Team Fortress 2等Source引擎游戏的插件资源',
      url: 'https://www.sourcemod.net/',
      tags: ['插件']
    },
    {
      name: 'frp',
      description: '快速反向代理，可帮助您将 NAT 或防火墙后面的本地服务器公开给 Internet。',
      url: 'https://github.com/fatedier/frp',
      tags: ['内网穿透', 'FRP']
    },
    {
      name: 'nps',
      description: '一款轻量级、高性能、功能强大的内网穿透代理服务器。支持tcp、udp、socks5、http等几乎所有流量转发，可用来访问内网网站、本地支付接口调试、ssh访问、远程桌面，内网dns解析、内网socks5代理等等……，并带有功能强大的web管理端。',
      url: 'https://github.com/ehang-io/nps',
      tags: ['内网穿透', 'nps']
    },
    {
      name: '我的世界基岩服务端',
      description: '如果想运行 Minecraft 版多人联机服务器，则首先要下载适用于 Windows 或 Ubuntu (Linux) 的 Bedrock 版专属服务器。',
      url: 'https://www.minecraft.net/zh-hans/download/server/bedrock',
      tags: ['内网穿透', 'nps']
    },
    {
      name: '我的世界基岩服务端',
      description: '如果想运行 Minecraft 版多人联机服务器，则首先要下载适用于 Windows 或 Ubuntu (Linux) 的 Bedrock 版专属服务器。',
      url: 'https://www.minecraft.net/zh-hans/download/server/bedrock',
      tags: ['Minecraft', '资源']
    },
    {
      name: '我的世界Java服务端',
      description: '请注意：该服务器的设置仅与 Minecraft：Java 版兼容。',
      url: 'https://www.minecraft.net/zh-hans/download/server',
      tags: ['Minecraft', '资源']
    },
    {
      name: 'MineBBS 我的世界中文论坛',
      description: '我的世界中文论坛',
      url: 'https://www.minebbs.com/',
      tags: ['Minecraft', '论坛']
    },
    {
      name: '苦力怕论坛',
      description: '最大的我的世界《Minecraft》基岩版（BE）中文资源、交流论坛之一。 你可以在这里找到优质的BE版附加包、BE版材质包、BE版地图等资源，以及最新的我的世界新闻资讯。',
      url: 'https://klpbbs.com/',
      tags: ['Minecraft', '论坛']
    },
    {
      name: 'MCSManager',
      description: '开源，易用，分布式架构的游戏服务器管理面板。',
      url: 'https://www.mcsmanager.com/',
      tags: ['面板', '程序']
    },
    {
      name: 'MC百科|最大的Minecraft中文MOD百科',
      description: '最大的Minecraft中文MOD百科',
      url: 'https://www.mcmod.cn/',
      tags: ['Minecraft', '论坛']
    },
    {
      name: '幻兽帕鲁 | 繁殖计算器',
      description: '最大的Minecraft中文MOD百科',
      url: 'https://palworld.gg/zh-Hans/breeding-calculator',
      tags: ['工具']
    },
    {
      name: '幸福工厂 | 计算器',
      description: '来自 Coffee Stain Studios 的 Satisfactory 游戏工具集合。',
      url: 'https://satisfactory-calculator.com/zh',
      tags: ['工具']
    }
  ];

  // 收集所有可用标签
  const allTags = useMemo(() => {
    const tagsSet = new Set<string>();
    sites.forEach(site => {
      site.tags?.forEach(tag => tagsSet.add(tag));
    });
    return Array.from(tagsSet).sort();
  }, [sites]);

  // 处理标签点击
  const handleTagClick = (tag: string) => {
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        return prev.filter(t => t !== tag);
      } else {
        return [...prev, tag];
      }
    });
  };

  // 清除所有筛选
  const clearFilters = () => {
    setSelectedTags([]);
  };

  // 筛选站点
  const filteredSites = useMemo(() => {
    if (selectedTags.length === 0) {
      return sites;
    }
    return sites.filter(site => 
      selectedTags.some(tag => site.tags?.includes(tag))
    );
  }, [sites, selectedTags]);

  // 跳转到外部链接
  const handleOpenSite = (url: string, name: string) => {
    window.open(url, '_blank');
    message.success(`正在跳转到 ${name}`);
  };

  return (
    <div className="server-guide-container">
      <Title level={2}>开服指南</Title>
      <Paragraph>
        这里提供了各种游戏服务器部署和配置的有用资源。点击任意卡片跳转到相应网站获取详细指南。
      </Paragraph>
      
      <div className="filter-tags-container">
        <div className="filter-tags-header">
          <span className="filter-title">标签筛选：</span>
          {selectedTags.length > 0 && (
            <Button size="small" onClick={clearFilters} style={{ marginLeft: 8 }}>
              清除筛选
            </Button>
          )}
        </div>
        <div className="filter-tags">
          {allTags.map(tag => (
            <Tag
              key={tag}
              color={selectedTags.includes(tag) ? "#1890ff" : "default"}
              onClick={() => handleTagClick(tag)}
              style={{ cursor: 'pointer', margin: '4px' }}
            >
              {tag}
            </Tag>
          ))}
        </div>
      </div>
      
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {filteredSites.length > 0 ? (
          filteredSites.map((site, index) => (
            <Col xs={24} sm={12} md={8} lg={6} key={index}>
              <Card 
                hoverable 
                className="site-card"
                onClick={() => handleOpenSite(site.url, site.name)}
                onMouseEnter={() => setHoveredSite(index)}
                onMouseLeave={() => setHoveredSite(null)}
              >
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <div className="site-card-title">
                    <Typography.Title level={4}>{site.name}</Typography.Title>
                  </div>
                  
                  {site.tags && (
                    <div className="site-card-tags">
                      {site.tags.map((tag, tagIndex) => (
                        <span 
                          className={`site-tag ${selectedTags.includes(tag) ? 'site-tag-selected' : ''}`} 
                          key={tagIndex}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  <Paragraph ellipsis={{ rows: 3 }}>{site.description}</Paragraph>
                  
                  <Tooltip title="点击访问站点">
                    <Button 
                      type="primary" 
                      block
                      className={hoveredSite === index ? 'btn-animated' : ''}
                    >
                      访问站点
                    </Button>
                  </Tooltip>
                </Space>
              </Card>
            </Col>
          ))
        ) : (
          <Col span={24}>
            <div className="empty-sites">
              <p>没有符合筛选条件的站点</p>
            </div>
          </Col>
        )}
      </Row>
    </div>
  );
};

export default ServerGuide; 