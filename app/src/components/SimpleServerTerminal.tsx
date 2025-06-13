import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Button, Input, Space, Tooltip, Modal } from 'antd';
import { ClearOutlined, SearchOutlined, HistoryOutlined, ReloadOutlined, CopyOutlined, EnterOutlined } from '@ant-design/icons';

interface SimpleServerTerminalProps {
  outputs: string[];
  onSendCommand?: (command: string) => void;
  onClear?: () => void;
  onReconnect?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

interface SimpleServerTerminalRef {
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
  focus: () => void;
  scrollToBottom: () => void;
}

const SimpleServerTerminal = forwardRef<SimpleServerTerminalRef, SimpleServerTerminalProps>((
  { outputs, onSendCommand, onClear, onReconnect, className = '', style = {} },
  ref
) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);
  const [commandInput, setCommandInput] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [isTerminalFocused, setIsTerminalFocused] = useState(false);
  const [fontSize, setFontSize] = useState(13);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // 滚动到底部
  const scrollToBottom = () => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  };

  // 当输出更新时滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [outputs]);

  // 全局快捷键监听
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 只在终端获得焦点时处理全局快捷键
      if (!isTerminalFocused && document.activeElement !== terminalRef.current) {
        return;
      }

      // Ctrl+F - 打开搜索
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setSearchVisible(true);
        return;
      }

      // Ctrl+Shift+C - 复制选中文本或全部内容
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        const selection = window.getSelection();
        if (selection && selection.toString()) {
          navigator.clipboard.writeText(selection.toString());
        } else {
          handleCopyAll();
        }
        return;
      }

      // Ctrl+Shift+V - 粘贴
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          setCommandInput(prev => prev + text);
        }).catch(() => {
          console.log('无法读取剪贴板内容');
        });
        return;
      }

      // Ctrl+D - 发送EOF或退出
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        if (commandInput.trim() === '') {
          if (onSendCommand) {
            onSendCommand('exit');
          }
        } else {
          setCommandInput('');
        }
        return;
      }

      // Ctrl+A - 全选当前输入
      if (e.ctrlKey && e.key === 'a') {
        e.preventDefault();
        // 这里可以实现全选当前输入的逻辑
        return;
      }

      // Ctrl+E - 移动到行尾
      if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        // 光标移动到行尾的逻辑
        return;
      }

      // Ctrl+U - 清空当前行
      if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
        setCommandInput('');
        return;
      }

      // Ctrl+K - 清空从光标到行尾
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        setCommandInput('');
        return;
      }

      // Ctrl+W - 删除前一个单词
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        setCommandInput(prev => {
          const words = prev.trim().split(' ');
          words.pop();
          return words.join(' ');
        });
        return;
      }

      // Ctrl+R - 反向搜索历史
      if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        showFullHistory();
        return;
      }

      // F1 - 显示快捷键帮助
      if (e.key === 'F1') {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }

      // Ctrl+Plus/Minus - 调整字体大小
      if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setFontSize(prev => Math.min(prev + 1, 20));
        return;
      }
      if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        setFontSize(prev => Math.max(prev - 1, 8));
        return;
      }

      // Ctrl+0 - 重置字体大小
      if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        setFontSize(13);
        return;
      }

      // Escape - 取消当前操作
      if (e.key === 'Escape') {
        e.preventDefault();
        setSearchVisible(false);
        setCommandInput('');
        setHistoryIndex(-1);
        return;
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isTerminalFocused, commandInput, commandHistory, historyIndex, onSendCommand, onClear]);

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    write: (data: string) => {
      // 这里可以添加实时写入逻辑
      console.log('Terminal write:', data);
    },
    writeln: (data: string) => {
      // 这里可以添加实时写入逻辑
      console.log('Terminal writeln:', data);
    },
    clear: () => {
      if (onClear) {
        onClear();
      }
    },
    focus: () => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    },
    scrollToBottom
  }));

  // 处理命令发送
  const handleSendCommand = () => {
    console.log("SimpleServerTerminal attempt to send:", commandInput);
    console.log("SimpleServerTerminal: typeof onSendCommand is", typeof onSendCommand);
    console.log("SimpleServerTerminal: commandInput.trim() is", `"${commandInput.trim()}"`);
    console.log("SimpleServerTerminal: commandInput.trim() ? is true : is false ->", commandInput.trim() ? true : false);

    if (onSendCommand && commandInput.trim()) {
      console.log("SimpleServerTerminal: Condition met, calling onSendCommand prop.");
      onSendCommand(commandInput.trim());
      
      // 添加到历史记录
      setCommandHistory(prev => {
        const newHistory = [...prev, commandInput.trim()];
        return newHistory.slice(-50); // 保留最近50条
      });
      setHistoryIndex(-1);
      setCommandInput('');
    } else {
      console.log("SimpleServerTerminal: Condition NOT met (onSendCommand or commandInput.trim() is falsy).");
    }
  };

  // 新的键盘处理器，用于 terminalRef (主输出区域)
  const handleTerminalKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault(); // 阻止默认行为，例如页面滚动
    setIsTerminalFocused(true); // 确保虚拟光标显示

    if (e.key === 'Enter') {
      handleSendCommand();
    } else if (e.key === 'Backspace') {
      setCommandInput(prev => prev.slice(0, -1));
    } else if (e.key === 'ArrowUp') {
      // 向上箭头 - 浏览历史 (与原 handleKeyDown 逻辑类似)
      if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setCommandInput(commandHistory[commandHistory.length - 1 - newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      // 向下箭头 - 浏览历史 (与原 handleKeyDown 逻辑类似)
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommandInput(commandHistory[commandHistory.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCommandInput('');
      }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // 处理可打印字符 (忽略控制键、Alt、Meta组合)
      setCommandInput(prev => prev + e.key);
    } else if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      // Ctrl+C - 清空当前行输入
      setCommandInput('');
    } else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
      // Ctrl+L - 清屏 (如果 onClear prop 存在)
      if (onClear) {
        onClear();
        setCommandInput(''); // 同时清空输入缓冲区
      }
    } else if (e.key === 'Tab') {
      // Tab - 简单的命令补全
      e.preventDefault();
      const commonCommands = ['ls', 'cd', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'grep', 'find', 'ps', 'kill', 'top', 'df', 'du', 'chmod', 'chown', 'tar', 'zip', 'unzip', 'wget', 'curl', 'ssh', 'scp', 'rsync', 'git', 'npm', 'node', 'python', 'java', 'docker', 'systemctl', 'service'];
      const currentInput = commandInput.toLowerCase();
      const matches = commonCommands.filter(cmd => cmd.startsWith(currentInput));
      if (matches.length === 1) {
        setCommandInput(matches[0] + ' ');
      } else if (matches.length > 1) {
        // 显示可能的补全选项
        console.log('可能的补全:', matches);
      }
    } else if (e.key === 'Home') {
      // Home - 移动到行首
      e.preventDefault();
      // 这里可以实现光标移动到行首的逻辑
    } else if (e.key === 'End') {
      // End - 移动到行尾
      e.preventDefault();
      // 这里可以实现光标移动到行尾的逻辑
    } else if (e.key === 'Delete') {
      // Delete - 删除光标后的字符
      e.preventDefault();
      // 这里可以实现删除光标后字符的逻辑
    } else if (e.key === 'PageUp') {
      // Page Up - 向上滚动
      e.preventDefault();
      if (terminalRef.current) {
        terminalRef.current.scrollTop -= terminalRef.current.clientHeight / 2;
      }
    } else if (e.key === 'PageDown') {
      // Page Down - 向下滚动
      e.preventDefault();
      if (terminalRef.current) {
        terminalRef.current.scrollTop += terminalRef.current.clientHeight / 2;
      }
    }
  };

  // 处理终端点击事件（模拟光标定位）
  const handleTerminalClick = (e: React.MouseEvent) => {
    const rect = terminalRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setCursorPosition({ x, y });
      setIsTerminalFocused(true);
      terminalRef.current?.focus(); // 点击时让主输出区域获得焦点
    }
  };

  // 处理搜索
  const handleSearch = (term: string, direction: 'next' | 'prev' = 'next') => {
    if (!term) return;
    
    const terminalElement = terminalRef.current;
    if (!terminalElement) return;
    
    // 查找所有匹配项
    const textContent = terminalElement.textContent || '';
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches: number[] = [];
    let match;
    
    while ((match = regex.exec(textContent)) !== null) {
      matches.push(match.index);
    }
    
    setSearchMatches(matches);
    
    if (matches.length > 0) {
      let newIndex;
      if (direction === 'next') {
        newIndex = searchIndex >= matches.length - 1 ? 0 : searchIndex + 1;
      } else {
        newIndex = searchIndex <= 0 ? matches.length - 1 : searchIndex - 1;
      }
      setSearchIndex(newIndex);
      
      // 滚动到匹配位置
      const matchPosition = matches[newIndex];
      const lines = textContent.substring(0, matchPosition).split('\n');
      const lineNumber = lines.length - 1;
      const lineHeight = 16; // 假设行高为16px
      const scrollPosition = lineNumber * lineHeight;
      
      if (terminalElement) {
        terminalElement.scrollTop = Math.max(0, scrollPosition - terminalElement.clientHeight / 2);
      }
    }
  };

  // 复制终端内容
  const handleCopyAll = () => {
    const content = outputs.join('\n');
    navigator.clipboard.writeText(content).then(() => {
      Modal.success({
        title: '复制成功',
        content: '终端内容已复制到剪贴板',
        okText: '确定'
      });
    }).catch(() => {
      Modal.error({
        title: '复制失败',
        content: '无法复制到剪贴板，请手动选择复制',
        okText: '确定'
      });
    });
  };

  // 显示完整历史
  const showFullHistory = () => {
    Modal.info({
      title: '完整终端历史',
      content: (
        <div style={{ 
          maxHeight: '400px', 
          overflow: 'auto',
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: '12px',
          backgroundColor: '#1a1a1a',
          color: '#f0f0f0',
          padding: '12px',
          borderRadius: '4px'
        }}>
          {outputs.map((line, index) => (
            <div key={index} style={{ marginBottom: '2px' }}>
              <span style={{ color: '#666', marginRight: '8px' }}>{index + 1}</span>
              <span>{line}</span>
            </div>
          ))}
        </div>
      ),
      width: 800,
      okText: '关闭'
    });
  };

  // 发送回车信号
  const [isEnterSending, setIsEnterSending] = useState(false);
  const handleSendEnter = async () => {
    if (isEnterSending) return; // 防止重复点击
    
    if (onSendCommand) {
      setIsEnterSending(true);
      console.log('发送回车信号: \\n');
      onSendCommand('\\n');
      // 短暂延迟后重置状态
      setTimeout(() => setIsEnterSending(false), 500);
    } else {
      console.log('onSendCommand 函数未定义');
    }
  };

  // 显示快捷键帮助
  const showShortcutsHelp = () => {
    Modal.info({
      title: '终端快捷键帮助',
      content: (
        <div style={{ 
          maxHeight: '500px', 
          overflow: 'auto',
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: '12px'
        }}>
          <h4>基本操作</h4>
          <p><strong>Enter</strong> - 执行命令</p>
          <p><strong>↑/↓</strong> - 浏览命令历史</p>
          <p><strong>Tab</strong> - 命令补全</p>
          <p><strong>Escape</strong> - 取消当前操作</p>
          
          <h4>编辑快捷键</h4>
          <p><strong>Ctrl+C</strong> - 清空当前输入</p>
          <p><strong>Ctrl+L</strong> - 清屏</p>
          <p><strong>Ctrl+U</strong> - 清空整行</p>
          <p><strong>Ctrl+K</strong> - 清空到行尾</p>
          <p><strong>Ctrl+W</strong> - 删除前一个单词</p>
          <p><strong>Ctrl+A</strong> - 移动到行首</p>
          <p><strong>Ctrl+E</strong> - 移动到行尾</p>
          <p><strong>Ctrl+D</strong> - 发送EOF/退出</p>
          
          <h4>复制粘贴</h4>
          <p><strong>Ctrl+Shift+C</strong> - 复制选中文本或全部内容</p>
          <p><strong>Ctrl+Shift+V</strong> - 粘贴</p>
          
          <h4>搜索和导航</h4>
          <p><strong>Ctrl+F</strong> - 打开搜索</p>
          <p><strong>Ctrl+R</strong> - 搜索历史</p>
          <p><strong>Page Up/Down</strong> - 滚动页面</p>
          <p><strong>Home/End</strong> - 移动到行首/行尾</p>
          
          <h4>显示控制</h4>
          <p><strong>Ctrl + +/-</strong> - 调整字体大小</p>
          <p><strong>Ctrl+0</strong> - 重置字体大小</p>
          <p><strong>F1</strong> - 显示此帮助</p>
          
          <h4>特殊功能</h4>
          <p><strong>回车按钮</strong> - 发送空行回车信号</p>
        </div>
      ),
      width: 600,
      okText: '关闭'
    });
  };

  return (
    <div className={`simple-server-terminal ${className}`} style={style}>
      {/* 工具栏 */}
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid #333',
        backgroundColor: '#2a2a2a',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ color: '#f0f0f0', fontSize: '12px' }}>
          增强终端 - 支持鼠标交互、命令历史和快捷键 | 输出行数: {outputs.length}
        </div>
        <Space size="small">
          <Tooltip title="发送回车信号 (\\n)">
            <Button 
              size="small" 
              icon={<EnterOutlined />}
              onClick={handleSendEnter}
              type="primary"
              ghost
              disabled={isEnterSending}
              loading={isEnterSending}
            />
          </Tooltip>
          <Tooltip title="搜索内容 (Ctrl+F)">
            <Button 
              size="small" 
              icon={<SearchOutlined />}
              onClick={() => setSearchVisible(!searchVisible)}
            />
          </Tooltip>
          <Tooltip title="快捷键帮助 (F1)">
            <Button 
              size="small" 
              onClick={showShortcutsHelp}
            >
              ?
            </Button>
          </Tooltip>
          <Tooltip title="查看完整历史">
            <Button 
              size="small" 
              icon={<HistoryOutlined />}
              onClick={showFullHistory}
            />
          </Tooltip>
          <Tooltip title="复制全部内容">
            <Button 
              size="small" 
              icon={<CopyOutlined />}
              onClick={handleCopyAll}
            />
          </Tooltip>
          <Tooltip title="重新连接">
            <Button 
              size="small" 
              icon={<ReloadOutlined />}
              onClick={onReconnect}
            />
          </Tooltip>
          <Tooltip title="清空终端">
            <Button 
              size="small" 
              icon={<ClearOutlined />}
              onClick={onClear}
            />
          </Tooltip>
        </Space>
      </div>

      {/* 搜索栏 */}
      {searchVisible && (
        <div style={{ 
          padding: '8px 12px', 
          backgroundColor: '#333',
          borderBottom: '1px solid #444'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Input.Search
              placeholder="搜索终端内容... (Enter搜索下一个，Shift+Enter搜索上一个)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onSearch={(value) => handleSearch(value, 'next')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.shiftKey) {
                  e.preventDefault();
                  handleSearch(searchTerm, 'prev');
                }
              }}
              style={{ maxWidth: 300 }}
              size="small"
            />
            {searchMatches.length > 0 && (
              <span style={{ color: '#f0f0f0', fontSize: '12px' }}>
                {searchIndex + 1} / {searchMatches.length}
              </span>
            )}
            <Button size="small" onClick={() => handleSearch(searchTerm, 'prev')}>上一个</Button>
            <Button size="small" onClick={() => handleSearch(searchTerm, 'next')}>下一个</Button>
          </div>
        </div>
      )}

      {/* 终端输出区域 */}
      <div 
        ref={terminalRef}
        onClick={handleTerminalClick}
        onKeyDown={handleTerminalKeyDown}
        tabIndex={0}
        style={{ 
          flex: 1,
          minHeight: '400px',
          maxHeight: '500px',
          overflow: 'auto',
          backgroundColor: '#1a1a1a',
          color: '#f0f0f0',
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: `${fontSize}px`,
          padding: '12px',
          cursor: 'text',
          position: 'relative',
          userSelect: 'text'
        }}
      >
        {/* 虚拟光标 */}
        {isTerminalFocused && (
          <div
            style={{
              position: 'absolute',
              left: cursorPosition.x,
              top: cursorPosition.y,
              width: '2px',
              height: '16px',
              backgroundColor: '#00ff00',
              animation: 'blink 1s infinite',
              pointerEvents: 'none'
            }}
          />
        )}
        
        {/* 输出内容 */}
        {outputs.map((line, index) => {
          let lineStyle: React.CSSProperties = { marginBottom: '2px', lineHeight: '1.4' };
          
          // 根据内容类型设置不同颜色
          if (typeof line === 'string') {
            if (line.includes('===')) {
              lineStyle.color = '#74c0fc';
              lineStyle.fontWeight = 'bold';
            } else if (line.includes('[文件]') || line.includes('[文件输出]')) {
              lineStyle.color = '#51cf66';
            } else if (line.includes('[心跳检查]')) {
              lineStyle.color = '#868e96';
            } else if (line.startsWith('>')) {
              lineStyle.color = '#ffd43b';
            } else if (line.includes('错误') || line.includes('Error') || line.includes('error')) {
              lineStyle.color = '#ff6b6b';
            } else if (line.includes('警告') || line.includes('Warning') || line.includes('warning')) {
              lineStyle.color = '#ffd43b';
            } else if (line.includes('成功') || line.includes('Success') || line.includes('success')) {
              lineStyle.color = '#51cf66';
            }
          }
          
          return (
            <div key={index} style={lineStyle}>
              {line}
            </div>
          );
        })}
        
        {/* 终端提示符 */}
        <div style={{ 
          color: '#00ff00', 
          marginTop: '8px',
          display: 'flex',
          alignItems: 'center'
        }}>
          <span>$ </span>
          <span style={{ color: '#f0f0f0', marginLeft: '4px' }}>
            {commandInput}
            <span style={{ 
              animation: 'blink 1s infinite',
              backgroundColor: '#00ff00',
              width: '8px',
              height: '16px',
              display: 'inline-block',
              marginLeft: '2px'
            }}>|</span>
          </span>
        </div>
      </div>

      {/* 命令输入区域 */}
      <div style={{ 
        padding: '8px 12px',
        backgroundColor: '#2a2a2a',
        borderTop: '1px solid #333'
      }}>
        <Input.Search
          ref={inputRef}
          placeholder="输入命令... (↑↓键浏览历史，Enter发送)"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onSearch={handleSendCommand}
          onFocus={() => setIsTerminalFocused(false)}
          onBlur={() => {
            // 如果希望焦点离开 Input.Search 后，主终端区域能重新显示虚拟光标（如果它有焦点的话）
            // 这部分逻辑可能需要更精细化处理，暂时保持简单
          }}
          enterButton="发送"
          style={{ width: '100%' }}
        />
        <div style={{ 
          marginTop: '4px', 
          fontSize: '11px', 
          color: '#666',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span>字体: {fontSize}px</span>
          <span>历史记录: {commandHistory.length} 条</span>
        </div>
      </div>
      
      {/* CSS动画 */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        
        .simple-server-terminal {
          display: flex;
          flex-direction: column;
          height: 100%;
          border: 1px solid #333;
          border-radius: 4px;
          overflow: hidden;
        }
        
        .simple-server-terminal ::-webkit-scrollbar {
          width: 8px;
        }
        
        .simple-server-terminal ::-webkit-scrollbar-track {
          background: #2a2a2a;
        }
        
        .simple-server-terminal ::-webkit-scrollbar-thumb {
          background: #555;
          border-radius: 4px;
        }
        
        .simple-server-terminal ::-webkit-scrollbar-thumb:hover {
          background: #777;
        }
      `}</style>
    </div>
  );
});

SimpleServerTerminal.displayName = 'SimpleServerTerminal';

export default SimpleServerTerminal;
export type { SimpleServerTerminalProps, SimpleServerTerminalRef };