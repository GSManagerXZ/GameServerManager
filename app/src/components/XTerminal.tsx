import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from 'xterm-addon-search';
import 'xterm/css/xterm.css';

interface XTerminalProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  className?: string;
  style?: React.CSSProperties;
  options?: any;
}

const XTerminal: React.FC<XTerminalProps> = ({
  onData,
  onResize,
  className = '',
  style = {},
  options = {}
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!terminalRef.current) return;

    // 创建终端实例
    terminal.current = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#f0f0f0',
        cursor: '#ffffff',
        selection: '#3a3a3a',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5'
      },
      allowTransparency: true,
      convertEol: true,
      scrollback: 1000,
      tabStopWidth: 4,
      ...options
    });

    // 创建插件
    fitAddon.current = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    // 加载插件
    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(webLinksAddon);
    terminal.current.loadAddon(searchAddon);

    // 打开终端
    terminal.current.open(terminalRef.current);

    // 适配大小
    fitAddon.current.fit();

    // 设置事件监听
    if (onData) {
      terminal.current.onData(onData);
    }

    if (onResize) {
      terminal.current.onResize(({ cols, rows }) => {
        onResize(cols, rows);
      });
    }

    // 监听窗口大小变化
    const handleResize = () => {
      if (fitAddon.current) {
        fitAddon.current.fit();
      }
    };

    window.addEventListener('resize', handleResize);
    setIsReady(true);

    // 清理函数
    return () => {
      window.removeEventListener('resize', handleResize);
      if (terminal.current) {
        terminal.current.dispose();
      }
    };
  }, []);

  // 提供给父组件的方法
  const write = (data: string) => {
    if (terminal.current) {
      terminal.current.write(data);
    }
  };

  const writeln = (data: string) => {
    if (terminal.current) {
      terminal.current.writeln(data);
    }
  };

  const clear = () => {
    if (terminal.current) {
      terminal.current.clear();
    }
  };

  const focus = () => {
    if (terminal.current) {
      terminal.current.focus();
    }
  };

  const fit = () => {
    if (fitAddon.current) {
      fitAddon.current.fit();
    }
  };

  const scrollToBottom = () => {
    if (terminal.current) {
      terminal.current.scrollToBottom();
    }
  };

  // 暴露方法给父组件
  React.useImperativeHandle(React.forwardRef(() => null), () => ({
    write,
    writeln,
    clear,
    focus,
    fit,
    scrollToBottom,
    terminal: terminal.current
  }));

  return (
    <div
      ref={terminalRef}
      className={`xterm-container ${className}`}
      style={{
        width: '100%',
        height: '100%',
        ...style
      }}
    />
  );
};

export default XTerminal;
export type { XTerminalProps };