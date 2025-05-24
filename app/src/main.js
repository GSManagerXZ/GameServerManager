// 简单的API客户端
const API_URL = window.location.origin + "/api";

// 全局变量用于追踪输出历史和连接状态
window.gameInstallState = {
  activeGameId: null,
  outputHistory: {},
  isInstalling: false,
  retryCount: 0,
  maxRetries: 3,
  lastPosition: 0,
  sseConnected: false
};

// 添加CSS样式用于ANSI颜色
const style = document.createElement('style');
style.textContent = `
  .terminal .black { color: #000000; }
  .terminal .red { color: #e74c3c; }
  .terminal .green { color: #2ecc71; }
  .terminal .yellow { color: #f1c40f; }
  .terminal .blue { color: #3498db; }
  .terminal .magenta { color: #9b59b6; }
  .terminal .cyan { color: #1abc9c; }
  .terminal .white { color: #ecf0f1; }
  .terminal .gray { color: #95a5a6; }
  .terminal .bright-red { color: #ff5252; }
  .terminal .bright-green { color: #5cd65c; }
  .terminal .bright-yellow { color: #ffeb3b; }
  .terminal .bright-blue { color: #42a5f5; }
  .terminal .bright-magenta { color: #d670d6; }
  .terminal .bright-cyan { color: #4dd0e1; }
  .terminal .bright-white { color: #ffffff; }
  .terminal .bold { font-weight: bold; }
  .terminal .italic { font-style: italic; }
  .terminal .underline { text-decoration: underline; }
`;
document.head.appendChild(style);

// 获取游戏列表
async function fetchGames() {
  try {
    console.log("获取游戏列表...");
    const response = await fetch(`${API_URL}/games`);
    if (!response.ok) {
      throw new Error(`获取游戏列表失败: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    console.log("游戏列表:", data);
    return data.status === 'success' ? data.games : [];
  } catch (error) {
    console.error("获取游戏列表失败:", error);
    return [];
  }
}

// 检查安装状态
async function checkInstallationStatus(gameId) {
  try {
    console.log(`检查游戏 ${gameId} 的安装状态...`);
    const response = await fetch(`${API_URL}/installation_status?game_id=${gameId}`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    console.log(`游戏 ${gameId} 的安装状态:`, data);
    return data.status === 'success' ? data.installation : null;
  } catch (error) {
    console.error(`检查游戏 ${gameId} 的安装状态失败:`, error);
    return null;
  }
}

// 解析ANSI颜色代码
const parseColoredText = (text) => {
  // 如果没有ANSI代码，直接返回
  if (!text.includes('\u001b[')) {
    const tempDiv = document.createElement('div');
    tempDiv.textContent = text;
    return tempDiv.innerHTML;
  }
  
  // 创建一个临时div来帮助构建HTML
  const tempDiv = document.createElement('div');
  
  // 分割所有ANSI序列和文本
  const parts = [];
  let currentIndex = 0;
  let currentStyles = new Set();
  
  // 正则表达式匹配所有ANSI转义序列
  const ansiRegex = /\u001b\[(\d+(?:;\d+)*)m/g;
  let match;
  
  // 处理文本中的每个ANSI序列
  while ((match = ansiRegex.exec(text)) !== null) {
    // 添加序列前的文本
    if (match.index > currentIndex) {
      const textContent = text.substring(currentIndex, match.index);
      if (textContent) {
        tempDiv.textContent = textContent;
        
        // 应用当前样式
        let styledText = tempDiv.innerHTML;
        if (currentStyles.size > 0) {
          const classes = Array.from(currentStyles).join(' ');
          styledText = `<span class="${classes}">${styledText}</span>`;
        }
        
        parts.push(styledText);
      }
    }
    
    // 解析ANSI代码
    const codes = match[1].split(';').map(Number);
    
    // 处理每个代码
    for (const code of codes) {
      if (code === 0) {
        // 重置所有样式
        currentStyles.clear();
      } else if (code === 1) {
        // 粗体
        currentStyles.add('bold');
      } else if (code === 3) {
        // 斜体
        currentStyles.add('italic');
      } else if (code === 4) {
        // 下划线
        currentStyles.add('underline');
      } else if (code >= 30 && code <= 37) {
        // 基本前景色
        const colorMap = {
          30: 'black',
          31: 'red',
          32: 'green',
          33: 'yellow',
          34: 'blue',
          35: 'magenta',
          36: 'cyan',
          37: 'white'
        };
        
        // 移除其他颜色类
        Array.from(currentStyles).forEach(style => {
          if (['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 
               'bright-red', 'bright-green', 'bright-yellow', 'bright-blue', 'bright-magenta', 'bright-cyan', 'bright-white', 'gray'].includes(style)) {
            currentStyles.delete(style);
          }
        });
        
        currentStyles.add(colorMap[code]);
      } else if (code >= 90 && code <= 97) {
        // 亮色前景色
        const brightColorMap = {
          90: 'gray',
          91: 'bright-red',
          92: 'bright-green',
          93: 'bright-yellow',
          94: 'bright-blue',
          95: 'bright-magenta',
          96: 'bright-cyan',
          97: 'bright-white'
        };
        
        // 移除其他颜色类
        Array.from(currentStyles).forEach(style => {
          if (['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 
               'bright-red', 'bright-green', 'bright-yellow', 'bright-blue', 'bright-magenta', 'bright-cyan', 'bright-white', 'gray'].includes(style)) {
            currentStyles.delete(style);
          }
        });
        
        currentStyles.add(brightColorMap[code]);
      }
    }
    
    currentIndex = match.index + match[0].length;
  }
  
  // 添加剩余文本
  if (currentIndex < text.length) {
    const textContent = text.substring(currentIndex);
    if (textContent) {
      tempDiv.textContent = textContent;
      
      // 应用当前样式
      let styledText = tempDiv.innerHTML;
      if (currentStyles.size > 0) {
        const classes = Array.from(currentStyles).join(' ');
        styledText = `<span class="${classes}">${styledText}</span>`;
      }
      
      parts.push(styledText);
    }
  }
  
  return parts.join('');
};

// 添加输出到终端
function appendOutput(outputElement, text, isError = false) {
  if (!text) return;
  
  const line = document.createElement('div');
  // 使用解析后的HTML而不是纯文本
  line.innerHTML = parseColoredText(text);
  
  if (isError && !text.includes('\u001b[')) {
    // 只有当文本没有ANSI颜色代码时才应用错误颜色
    line.style.color = '#ff4d4f';
  }
  
  outputElement.appendChild(line);
  outputElement.scrollTop = outputElement.scrollHeight;
  
  // 也保存到历史记录中
  const gameId = window.gameInstallState.activeGameId;
  if (gameId) {
    if (!window.gameInstallState.outputHistory[gameId]) {
      window.gameInstallState.outputHistory[gameId] = [];
    }
    window.gameInstallState.outputHistory[gameId].push({
      text,
      isError
    });
  }
}

// 清空终端输出
function clearOutput(outputElement) {
  outputElement.innerHTML = '';
}

// 初始化安装会话
async function startInstallSession(gameId, outputElement) {
  if (!gameId) return false;
  
  // 清理之前的连接
  closeSSEConnection();
  
  // 设置当前游戏ID和状态
  window.gameInstallState.activeGameId = gameId;
  window.gameInstallState.isInstalling = true;
  window.gameInstallState.lastPosition = 0;
  window.gameInstallState.retryCount = 0;
  
  // 清空输出
  clearOutput(outputElement);
  appendOutput(outputElement, '准备安装环境...');
  
  try {
    // 检查是否已有安装会话
    const status = await checkInstallationStatus(gameId);
    
    // 如果已经有会话并且未完成，可以直接连接到流
    if (status && !status.complete) {
      appendOutput(outputElement, `发现正在进行的安装任务，继续监控安装进度...`);
      connectToEventStream(gameId, outputElement);
      return true;
    }
    
    // 否则启动新的安装
    console.log(`发送游戏安装请求: ${gameId}`);
    const startResponse = await fetch(`${API_URL}/install`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ game_id: gameId })
    });
    
    if (!startResponse.ok) {
      const errorData = await startResponse.json();
      throw new Error(errorData.message || '安装请求失败');
    }
    
    const startData = await startResponse.json();
    console.log("安装请求响应:", startData);
    appendOutput(outputElement, startData.message);
    
    // 等待服务器处理（给服务器一点时间启动进程）
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 连接到事件流
    connectToEventStream(gameId, outputElement);
    return true;
  } catch (error) {
    console.error("启动安装会话失败:", error);
    appendOutput(outputElement, `错误: ${error.message}`, true);
    window.gameInstallState.isInstalling = false;
    return false;
  }
}

// 连接到事件流
function connectToEventStream(gameId, outputElement) {
  if (!gameId) return false;
  
  try {
    // 关闭任何现有的EventSource
    closeSSEConnection();
    
    const eventSourceUrl = `${API_URL}/install_stream?game_id=${gameId}`;
    console.log('连接到SSE:', eventSourceUrl);
    appendOutput(outputElement, '正在连接到安装流...');
    
    const eventSource = new EventSource(eventSourceUrl);
    window.activeEventSource = eventSource;
    
    eventSource.onopen = function() {
      console.log('SSE连接已打开');
      window.gameInstallState.sseConnected = true;
      window.gameInstallState.retryCount = 0;
      appendOutput(outputElement, '与服务器建立连接，开始接收安装进度...');
    };
    
    eventSource.onmessage = function(event) {
      try {
        console.log('收到SSE消息:', event.data);
        const data = JSON.parse(event.data);
        
        if (data.line) {
          // 修剪行尾的空白字符
          const line = data.line.trimEnd();
          if (line) {
            appendOutput(outputElement, line);
          }
        }
        
        if (data.complete) {
          console.log('安装完成，关闭SSE连接');
          eventSource.close();
          window.activeEventSource = null;
          window.gameInstallState.sseConnected = false;
          window.gameInstallState.isInstalling = false;
          
          appendOutput(outputElement, '\n===== 安装进程已结束 =====\n');
          if (data.status === 'success') {
            appendOutput(outputElement, `✅ ${data.message}`);
            setTimeout(() => {
              alert(`游戏 ${gameId} 安装成功!`);
            }, 500);
          } else {
            appendOutput(outputElement, `❌ ${data.message}`, true);
            setTimeout(() => {
              alert(`安装失败: ${data.message}`);
            }, 500);
          }
        }
      } catch (error) {
        console.error("解析服务器消息失败:", error);
        appendOutput(outputElement, `解析错误: ${error.message}`, true);
      }
    };
    
    eventSource.onerror = function(event) {
      console.error('SSE错误:', event);
      window.gameInstallState.sseConnected = false;
      
      // 尝试重新连接
      if (window.gameInstallState.isInstalling && window.gameInstallState.retryCount < window.gameInstallState.maxRetries) {
        window.gameInstallState.retryCount++;
        const retryDelay = 2000 * window.gameInstallState.retryCount;
        
        appendOutput(outputElement, `与服务器的连接中断，${retryDelay/1000}秒后尝试重新连接 (${window.gameInstallState.retryCount}/${window.gameInstallState.maxRetries})...`, true);
        
        eventSource.close();
        window.activeEventSource = null;
        
        setTimeout(() => {
          // 先检查安装状态
          checkInstallationStatus(gameId).then(status => {
            if (status) {
              if (status.complete) {
                // 安装已完成
                appendOutput(outputElement, '\n===== 安装进程已结束 =====\n');
                const successMessage = `游戏 ${gameId} 安装` + (status.return_code === 0 ? '成功!' : '失败');
                appendOutput(outputElement, successMessage, status.return_code !== 0);
                window.gameInstallState.isInstalling = false;
              } else {
                // 安装仍在进行，重新连接
                appendOutput(outputElement, '重新连接到安装流...');
                connectToEventStream(gameId, outputElement);
              }
            } else {
              // 无法获取状态，可能安装已中止
              appendOutput(outputElement, '无法获取安装状态，安装可能已中止', true);
              window.gameInstallState.isInstalling = false;
            }
          }).catch(error => {
            appendOutput(outputElement, `检查安装状态失败: ${error.message}`, true);
            window.gameInstallState.isInstalling = false;
          });
        }, retryDelay);
      } else if (window.gameInstallState.retryCount >= window.gameInstallState.maxRetries) {
        eventSource.close();
        window.activeEventSource = null;
        appendOutput(outputElement, '\n===== 连接重试次数已达上限 =====\n', true);
        appendOutput(outputElement, '无法与服务器建立稳定连接，请检查网络或服务器状态后刷新页面重试', true);
        window.gameInstallState.isInstalling = false;
      }
    };
    
    return true;
  } catch (error) {
    console.error("连接到安装流失败:", error);
    appendOutput(outputElement, `连接错误: ${error.message}`, true);
    window.gameInstallState.isInstalling = false;
    return false;
  }
}

// 安装游戏 - 主函数
async function installGame(gameId) {
  if (!gameId) return false;
  
  const outputElement = document.getElementById('terminal-output');
  return startInstallSession(gameId, outputElement);
}

// 检查游戏是否已安装
async function checkInstallation(gameId) {
  try {
    const response = await fetch(`${API_URL}/check_installation?game_id=${gameId}`);
    const data = await response.json();
    return data.status === 'success' && data.installed;
  } catch (error) {
    console.error("检查安装状态失败:", error);
    return false;
  }
}

// 关闭SSE连接的函数
function closeSSEConnection() {
  if (window.activeEventSource) {
    console.log('手动关闭SSE连接');
    window.activeEventSource.close();
    window.activeEventSource = null;
    window.gameInstallState.sseConnected = false;
  }
}

// 页面加载完成后执行
window.addEventListener('DOMContentLoaded', async () => {
  const gameList = document.getElementById('game-list');
  const games = await fetchGames();
  
  if (games.length === 0) {
    gameList.innerHTML = '<p>没有找到可安装的游戏...</p>';
    return;
  }
  
  // 创建游戏卡片
  games.forEach(game => {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.innerHTML = `
      <h3>${game.name}</h3>
      <p>AppID: ${game.appid}</p>
      <p>账户: ${game.anonymous ? '匿名' : '需要账户'}</p>
      <p class="tip">${game.tip}</p>
      <button class="install-btn" data-id="${game.id}">安装</button>
    `;
    gameList.appendChild(card);
    
    // 添加安装按钮点击事件
    card.querySelector('.install-btn').addEventListener('click', () => {
      document.getElementById('modal-title').textContent = `安装 ${game.name}`;
      document.getElementById('game-tip').textContent = game.tip;
      document.getElementById('modal').style.display = 'block';
      
      // 开始安装
      installGame(game.id);
    });
  });
  
  // 关闭模态框
  document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('modal').style.display = 'none';
    closeSSEConnection(); // 关闭SSE连接
  });
  
  // 页面关闭时清理资源
  window.addEventListener('beforeunload', () => {
    closeSSEConnection();
  });
});