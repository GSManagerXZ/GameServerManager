import React, { useEffect, useRef, memo, useState } from 'react';
import { Spin, Modal, Input, Button } from 'antd';
import { StopOutlined } from '@ant-design/icons';

interface TerminalProps {
  output: (string | { prompt?: string; line?: string })[];
  loading: boolean;
  complete: boolean;
  gameId?: string;
  onSendInput?: (gameId: string, value: string) => void;
  allowInput?: boolean;  // 是否允许在终端直接输入
  onTerminate?: (gameId: string) => void; // 新增终止安装的回调
}

// ANSI颜色码映射
const ansiColorMap: { [key: string]: string } = {
  // 标准色
  '30': '#000', // 黑
  '31': '#ff4d4f', // 红
  '32': '#00ff90', // 绿
  '33': '#ffe066', // 黄
  '34': '#40a9ff', // 蓝
  '35': '#b37feb', // 洋红
  '36': '#36cfc9', // 青
  '37': '#fff', // 白
  // 亮色
  '90': '#434343', // 亮黑
  '91': '#ff7875', // 亮红
  '92': '#95de64', // 亮绿
  '93': '#fff566', // 亮黄
  '94': '#69c0ff', // 亮蓝
  '95': '#d3adf7', // 亮洋红
  '96': '#5cdbd3', // 亮青
  '97': '#fff', // 亮白
};

// 解析ANSI颜色和样式
const parseColoredText = (text: string): React.ReactNode => {
  // 匹配所有ANSI转义序列
  const ansiRegex = /\u001b\[([0-9;]+)m/g;
  let result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let styleStack: any = {};
  let keyIndex = 0;

  while ((match = ansiRegex.exec(text)) !== null) {
    // 添加前面的普通文本
    if (match.index > lastIndex) {
      result.push(
        <span key={`text-${keyIndex++}`} style={{ ...styleStack }}>{text.substring(lastIndex, match.index)}</span>
      );
    }
    // 解析ANSI参数
    const params = match[1].split(';');
    params.forEach(param => {
      if (param === '0') {
        // 重置
        styleStack = {};
      } else if (param === '1') {
        styleStack.fontWeight = 'bold';
      } else if (param === '4') {
        styleStack.textDecoration = 'underline';
      } else if (param === '7') {
        styleStack.filter = 'invert(100%)'; // 反色
      } else if (ansiColorMap[param]) {
        styleStack.color = ansiColorMap[param];
      } else if (param === '39') {
        // 默认前景色
        styleStack.color = undefined;
      } else if (param === '49') {
        // 默认背景色
        styleStack.background = undefined;
      } else if (/^4[0-7]$/.test(param)) {
        // 背景色 40-47
        const bgColor = ansiColorMap[(+param - 10).toString()];
        if (bgColor) styleStack.background = bgColor;
      } else if (/^10[0-7]$/.test(param)) {
        // 亮背景色 100-107
        const bgColor = ansiColorMap[(+param - 60).toString()];
        if (bgColor) styleStack.background = bgColor;
      }
    });
    lastIndex = ansiRegex.lastIndex;
  }
  // 添加剩余文本
  if (lastIndex < text.length) {
    result.push(
      <span key={`text-${keyIndex++}`} style={{ ...styleStack }}>{text.substring(lastIndex)}</span>
    );
  }
  return result.length > 0 ? <>{result}</> : <>{text}</>;
};

// 使用memo优化Terminal组件，避免不必要的重新渲染
const Terminal: React.FC<TerminalProps> = memo(({ output, loading, complete, gameId, onSendInput, allowInput, onTerminate }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const prevOutputLengthRef = useRef<number>(0);
  const [promptVisible, setPromptVisible] = useState(false);
  const [promptMsg, setPromptMsg] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [terminalInput, setTerminalInput] = useState('');
  const [terminateConfirmVisible, setTerminateConfirmVisible] = useState(false);

  // 检测output中是否有prompt
  useEffect(() => {
    if (!output) return;
    const last = output[output.length - 1];
    if (last && typeof last === 'object' && last.prompt) {
      setPromptMsg(last.prompt);
      setPromptVisible(true);
    }
  }, [output]);

  // 自动滚动到底部
  useEffect(() => {
    if (terminalRef.current && output.length !== prevOutputLengthRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
      prevOutputLengthRef.current = output.length;
    }
  }, [output.length]);

  const handlePromptOk = () => {
    if (onSendInput && gameId && inputValue) {
      onSendInput(gameId, inputValue);
    }
    setPromptVisible(false);
    setInputValue('');
  };

  // 处理终端输入提交
  const handleInputSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSendInput && gameId && terminalInput.trim()) {
      onSendInput(gameId, terminalInput);
      setTerminalInput('');
    }
  };

  // 处理终止安装
  const handleTerminate = () => {
    setTerminateConfirmVisible(true);
  };

  const confirmTerminate = () => {
    if (onTerminate && gameId) {
      onTerminate(gameId);
    }
    setTerminateConfirmVisible(false);
  };

  return (
    <div className="terminal-container">
      <div className="terminal" ref={terminalRef}>
        {output.map((line, index) => {
          if (typeof line === 'object' && line.prompt) {
            return <div key={index} style={{ color: '#ff4d4f' }}>{line.prompt}</div>;
          }
          if (typeof line === 'object' && line.line) {
            return <div key={index}>{parseColoredText(line.line)}</div>;
          }
          return <div key={index}>{parseColoredText(line as string)}</div>;
        })}
        {loading && (
          <div className="terminal-loading">
            <Spin size="small" /> 任务进行中...
          </div>
        )}
        {complete && (
          <div className="terminal-complete">
            ===== 进程已结束 =====
          </div>
        )}
      </div>
      
      {/* 添加终端输入框 */}
      {allowInput && !complete && onSendInput && gameId && (
        <div className="terminal-input-container">
          <Input
            value={terminalInput}
            onChange={e => setTerminalInput(e.target.value)}
            onKeyPress={handleInputSubmit}
            placeholder="输入命令并按回车发送..."
            prefix={<span style={{ color: '#1890ff' }}>❯</span>}
            autoFocus
          />
        </div>
      )}
      
      {/* 终止安装按钮 - 移至底部 */}
      {loading && onTerminate && gameId && (
        <div style={{ padding: '10px', textAlign: 'center' }}>
          <Button 
            danger
            icon={<StopOutlined />}
            onClick={handleTerminate}
            style={{ width: '150px' }}
          >
            终止安装
          </Button>
        </div>
      )}
      
      {/* 验证码输入对话框 */}
      <Modal
        title="需要输入"
        open={promptVisible}
        onOk={handlePromptOk}
        onCancel={() => setPromptVisible(false)}
        okText="提交"
        cancelText="取消"
        maskClosable={false}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>{promptMsg}</div>
        <Input.Password
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          autoFocus
          placeholder="请输入验证码/令牌"
          onPressEnter={handlePromptOk}
        />
      </Modal>
      
      {/* 终止安装确认对话框 */}
      <Modal
        title="确认终止安装"
        open={terminateConfirmVisible}
        onOk={confirmTerminate}
        onCancel={() => setTerminateConfirmVisible(false)}
        okText="确认终止"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p>确定要终止当前游戏的安装过程吗？</p>
        <p>终止安装可能会导致游戏文件不完整，需要重新安装。</p>
      </Modal>
    </div>
  );
});

export default Terminal; 