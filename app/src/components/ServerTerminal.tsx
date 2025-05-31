import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from 'xterm-addon-search';
import { Button, Input, Space, Tooltip } from 'antd';
import { ClearOutlined, SearchOutlined, HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import 'xterm/css/xterm.css';

interface ServerTerminalProps {
  outputs: string[];
  onSendCommand?: (command: string) => void;
  onClear?: () => void;
  onReconnect?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

interface ServerTerminalRef {
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
  focus: () => void;
  scrollToBottom: () => void;
}

const ServerTerminal = forwardRef<ServerTerminalRef, ServerTerminalProps>((
  { outputs, onSendCommand, onClear, onReconnect, className = '', style = {} },
  ref
) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const searchAddon = useRef<SearchAddon | null>(null);
  const [commandInput, setCommandInput] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const lastOutputLength = useRef(0);

  // 初始化终端
  useEffect(() => {
    if (!terminalRef.current) return;

    // 创建终端实例
    terminal.current = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#f0f0f0',
        cursor: '#00ff00',
        selection: '#3a3a3a',
        black: '#000000',
        red: '#ff6b6b',
        green: '#51cf66',
        yellow: '#ffd43b',
        blue: '#74c0fc',
        magenta: '#d0bfff',
        cyan: '#3bc9db',
        white: '#f8f9fa',
        brightBlack: '#495057',
        brightRed: '#ff8787',
        brightGreen: '#8ce99a',
        brightYellow: '#ffec99',
        brightBlue: '#91a7ff',
        brightMagenta: '#e599f7',
        brightCyan: '#66d9ef',
        brightWhite: '#ffffff'
      },
      allowTransparency: false,
      convertEol: true,
      scrollback: 5000,
      tabStopWidth: 4,
      rightClickSelectsWord: true,
      macOptionIsMeta: true,
      allowProposedApi: true
    });

    // 创建插件
    fitAddon.current = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    searchAddon.current = new SearchAddon();

    // 加载插件
    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(webLinksAddon);
    terminal.current.loadAddon(searchAddon.current);

    // 打开终端
    terminal.current.open(terminalRef.current);

    // 适配大小
    setTimeout(() => {
      if (fitAddon.current) {
        fitAddon.current.fit();
      }
    }, 100);

    // 监听数据输入（用户在终端中输入）
    terminal.current.onData((data) => {
      // 处理特殊按键
      if (data === '\r') { // Enter键
        if (onSendCommand && commandInput.trim()) {
          onSendCommand(commandInput.trim());
          setCommandInput(''); // 清空 xterm 内部的命令缓冲区
        }
        terminal.current?.write('\r\n');
      } else if (data === '\u007F') { // Backspace键
        if (commandInput.length > 0) {
          setCommandInput(prev => prev.slice(0, -1));
          terminal.current?.write('\b \b'); // 将退格写回 xterm
        }
      } else if (data === '\u0003') { // Ctrl+C
        terminal.current?.write('^C\r\n');
        setCommandInput(''); // 清空命令缓冲区
      } else if (data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) { // 可打印ASCII字符
        setCommandInput(prev => prev + data);
        terminal.current?.write(data); // 将字符写回 xterm
      } else {
        // 对于其他控制字符或特殊输入，可以选择忽略或按需处理
        // terminal.current?.write(data); // 如果需要回显其他特殊字符
      }
    });

    // 监听窗口大小变化
    const handleResize = () => {
      setTimeout(() => {
        if (fitAddon.current) {
          fitAddon.current.fit();
        }
      }, 100);
    };

    window.addEventListener('resize', handleResize);

    // 清理函数
    return () => {
      window.removeEventListener('resize', handleResize);
      if (terminal.current) {
        terminal.current.dispose();
      }
    };
  }, []);

  // 处理输出更新
  useEffect(() => {
    if (!terminal.current || !outputs) return;

    // 只处理新增的输出
    const newOutputs = outputs.slice(lastOutputLength.current);
    lastOutputLength.current = outputs.length;

    newOutputs.forEach(line => {
      if (typeof line === 'string') {
        // 处理不同类型的输出样式
        let styledLine = line;
        
        if (line.includes('===')) {
          // 节标题 - 蓝色加粗
          styledLine = `\x1b[1;34m${line}\x1b[0m`;
        } else if (line.includes('[文件]') || line.includes('[文件输出]')) {
          // 文件输出 - 绿色
          styledLine = `\x1b[32m${line}\x1b[0m`;
        } else if (line.includes('[心跳检查]')) {
          // 心跳检查 - 灰色
          styledLine = `\x1b[90m${line}\x1b[0m`;
        } else if (line.startsWith('>')) {
          // 命令输入 - 黄色
          // styledLine = `\x1b[33m${line}\x1b[0m`; // 注释掉，因为命令回显可能由父组件处理或直接来自服务器
        } else if (line.includes('错误') || line.includes('Error') || line.includes('error')) {
          // 错误信息 - 红色
          styledLine = `\x1b[31m${line}\x1b[0m`;
        } else if (line.includes('警告') || line.includes('Warning') || line.includes('warning')) {
          // 警告信息 - 橙色
          styledLine = `\x1b[33m${line}\x1b[0m`;
        } else if (line.includes('成功') || line.includes('Success') || line.includes('success')) {
          // 成功信息 - 绿色
          styledLine = `\x1b[32m${line}\x1b[0m`;
        }
        
        terminal.current.writeln(styledLine);
      }
    });

    // 滚动到底部
    setTimeout(() => {
      if (terminal.current) {
        terminal.current.scrollToBottom();
      }
    }, 10);
  }, [outputs]);

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    write: (data: string) => {
      if (terminal.current) {
        terminal.current.write(data);
      }
    },
    writeln: (data: string) => {
      if (terminal.current) {
        terminal.current.writeln(data);
      }
    },
    clear: () => {
      if (terminal.current) {
        terminal.current.clear();
        lastOutputLength.current = 0;
      }
    },
    focus: () => {
      if (terminal.current) {
        terminal.current.focus();
      }
    },
    scrollToBottom: () => {
      if (terminal.current) {
        terminal.current.scrollToBottom();
      }
    }
  }));

  // 处理搜索
  const handleSearch = (term: string, direction: 'next' | 'previous' = 'next') => {
    if (searchAddon.current && term) {
      if (direction === 'next') {
        searchAddon.current.findNext(term, { incremental: false, caseSensitive: false });
      } else {
        searchAddon.current.findPrevious(term, { incremental: false, caseSensitive: false });
      }
    }
  };

  // 处理命令发送
  const handleSendCommand = () => {
    if (onSendCommand && commandInput.trim()) {
      onSendCommand(commandInput.trim());
      setCommandInput('');
    }
  };

  return (
    <div className={`server-terminal-container ${className}`} style={style}>
      {/* 工具栏 */}
      <div className="terminal-toolbar" style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid #333',
        backgroundColor: '#2a2a2a',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ color: '#f0f0f0', fontSize: '12px' }}>
          服务器终端 - 支持鼠标交互和快捷键
        </div>
        <Space size="small">
          <Tooltip title="搜索 (Ctrl+F)">
            <Button 
              size="small" 
              icon={<SearchOutlined />}
              onClick={() => setSearchVisible(!searchVisible)}
            />
          </Tooltip>
          <Tooltip title="查看历史">
            <Button 
              size="small" 
              icon={<HistoryOutlined />}
              onClick={() => {
                // 显示完整历史记录
                if (terminal.current) {
                  terminal.current.clear();
                  outputs.forEach(line => {
                    if (typeof line === 'string') {
                      terminal.current?.writeln(line);
                    }
                  });
                  terminal.current.scrollToBottom();
                }
              }}
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
              onClick={() => {
                if (terminal.current) {
                  terminal.current.clear();
                }
                if (onClear) {
                  onClear();
                }
              }}
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
          <Input.Search
            placeholder="搜索终端内容..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onSearch={(value) => handleSearch(value)}
            onPressEnter={(e) => {
              if (e.shiftKey) {
                handleSearch(searchTerm, 'previous');
              } else {
                handleSearch(searchTerm, 'next');
              }
            }}
            style={{ maxWidth: 300 }}
            size="small"
          />
        </div>
      )}

      {/* 终端区域 */}
      <div 
        ref={terminalRef} 
        style={{ 
          flex: 1,
          minHeight: '400px',
          backgroundColor: '#1a1a1a'
        }}
      />

      {/* 命令输入区域 (将被移除) */}
      {/* 
      <div style={{ 
        padding: '8px 12px',
        backgroundColor: '#2a2a2a',
        borderTop: '1px solid #333'
      }}>
        <Input.Search
          placeholder="输入命令... (支持历史记录: ↑↓键)"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onSearch={handleSendCommand}
          enterButton="发送"
          style={{ width: '100%' }}
        />
      </div>
      */}
    </div>
  );
});

ServerTerminal.displayName = 'ServerTerminal';

export default ServerTerminal;
export type { ServerTerminalProps, ServerTerminalRef };