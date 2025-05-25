import React, { useState } from 'react';
import { Card, Button, Space, Select, Input, Divider } from 'antd';
import { useTerminalManager, TerminalRenderer } from './TerminalManager';
import useTerminal from '../hooks/useTerminal';

const { Option } = Select;

// 终端示例组件
const TerminalExample: React.FC = () => {
  const [terminalId, setTerminalId] = useState('');
  const [terminalType, setTerminalType] = useState<'install' | 'server'>('install');
  const [gameId, setGameId] = useState('');
  const [inputValue, setInputValue] = useState('');
  const { terminals } = useTerminalManager();

  // 创建一个终端示例
  const createTerminalExample = () => {
    if (!gameId) return;
    
    // 使用游戏ID作为终端ID
    setTerminalId(gameId);
  };

  // 渲染终端列表
  const renderTerminalList = () => {
    return Object.keys(terminals).map(id => (
      <Button 
        key={id} 
        type={terminalId === id ? 'primary' : 'default'}
        onClick={() => setTerminalId(id)}
        style={{ margin: '0 8px 8px 0' }}
      >
        {terminals[id].title || id}
      </Button>
    ));
  };

  return (
    <div>
      <Card title="终端示例" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Space>
              <Input 
                placeholder="输入游戏ID" 
                value={gameId} 
                onChange={e => setGameId(e.target.value)}
                style={{ width: 200 }}
              />
              <Select 
                value={terminalType} 
                onChange={value => setTerminalType(value)}
                style={{ width: 120 }}
              >
                <Option value="install">安装终端</Option>
                <Option value="server">服务器终端</Option>
              </Select>
              <Button type="primary" onClick={createTerminalExample}>创建终端</Button>
            </Space>
          </div>
          
          <Divider>终端列表</Divider>
          <div>{renderTerminalList()}</div>
          
          {terminalId && <TerminalContent id={terminalId} type={terminalType} />}
        </Space>
      </Card>
    </div>
  );
};

// 终端内容组件
const TerminalContent: React.FC<{ id: string; type: 'install' | 'server' }> = ({ id, type }) => {
  const terminal = useTerminal({
    id,
    type,
    title: `${type === 'install' ? '安装' : '服务器'} - ${id}`,
    allowInput: true
  });
  
  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button onClick={terminal.connect} disabled={terminal.loading}>连接</Button>
        <Button onClick={terminal.disconnect} disabled={!terminal.loading}>断开</Button>
        <Button onClick={() => terminal.terminate()} disabled={!terminal.loading}>
          {type === 'install' ? '终止安装' : '停止服务器'}
        </Button>
        <Button onClick={terminal.clear}>清空输出</Button>
      </Space>
      
      <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, padding: 8, height: 400, overflow: 'auto' }}>
        <TerminalRenderer terminalId={id} />
      </div>
    </div>
  );
};

export default TerminalExample; 