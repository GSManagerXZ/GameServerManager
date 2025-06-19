import React, { useState, useEffect, useRef } from 'react';
import { Card, Button, Space, Progress, Slider } from 'antd';
import { PlayCircleOutlined, PauseOutlined, StepBackwardOutlined, StepForwardOutlined, SoundOutlined, CloseOutlined, RetweetOutlined, ReloadOutlined, SwapOutlined } from '@ant-design/icons';
import { useMusic, PlayMode } from '../context/MusicContext';

const GlobalMusicPlayer: React.FC = () => {
  const { 
    musicState, 
    audioRef,
    playMusic, 
    pauseMusic, 
    resumeMusic, 
    nextSong, 
    previousSong,
    setMusicState,
    togglePlayMode
  } = useMusic();

  const { currentSong, isPlaying, isPaused, playlist, isPlayerVisible, playMode } = musicState;
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(50);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 定时更新播放进度
  useEffect(() => {
    const interval = setInterval(() => {
      if (audioRef.current && isPlaying && !isPaused) {
        setCurrentTime(audioRef.current.currentTime * 1000);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [audioRef, isPlaying, isPaused]);

  // 设置音量
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume, audioRef]);

  // 处理音量变化
  const handleVolumeChange = (value: number) => {
    setVolume(value);
  };

  // 关闭播放器
  const handleClose = () => {
    setMusicState({ isPlayerVisible: false });
  };

  // 获取播放模式图标
  const getPlayModeIcon = () => {
    switch (playMode) {
      case PlayMode.SEQUENCE:
        return <RetweetOutlined />;
      case PlayMode.LOOP:
        return <ReloadOutlined />;
      case PlayMode.RANDOM:
        return <SwapOutlined />;
      default:
        return <RetweetOutlined />;
    }
  };

  // 获取播放模式文本
  const getPlayModeText = () => {
    switch (playMode) {
      case PlayMode.SEQUENCE:
        return '顺序播放';
      case PlayMode.LOOP:
        return '循环播放';
      case PlayMode.RANDOM:
        return '随机播放';
      default:
        return '顺序播放';
    }
  };

  // 重置自动收起定时器
  const resetCollapseTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsCollapsed(false);
    timeoutRef.current = setTimeout(() => {
      setIsCollapsed(true);
    }, 3000);
  };

  // 鼠标进入播放器区域
  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsCollapsed(false);
  };

  // 鼠标离开播放器区域
  const handleMouseLeave = () => {
    resetCollapseTimer();
  };

  // 组件挂载时启动定时器
  useEffect(() => {
    resetCollapseTimer();
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [currentSong]);

  // 如果没有当前歌曲或播放列表为空，或者播放器不可见，不显示播放器
  if (!currentSong || playlist.length === 0 || !isPlayerVisible) {
    return null;
  }

  const formatDuration = (duration: number) => {
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const getCurrentTime = () => {
    return formatDuration(currentTime);
  };

  const getProgress = () => {
    if (currentSong && currentTime > 0) {
      return (currentTime / currentSong.duration) * 100;
    }
    return 0;
  };

  // 收起状态的小标识
  if (isCollapsed) {
    return (
      <div
        onMouseEnter={handleMouseEnter}
        style={{
          position: 'fixed',
          bottom: '10px',
          right: '10px',
          zIndex: 1000,
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          backgroundColor: '#1890ff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
          transition: 'all 0.3s ease'
        }}
      >
        <SoundOutlined style={{ color: '#fff', fontSize: '16px' }} />
      </div>
    );
  }

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 1000,
        width: '320px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        borderRadius: '8px',
        backgroundColor: '#fff',
        transition: 'all 0.3s ease'
      }}
    >
      <Card
        size="small"
        bodyStyle={{ padding: '12px' }}
        style={{ borderRadius: '8px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
          <SoundOutlined style={{ color: '#1890ff', marginRight: '8px' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Button 
              size="small" 
              type="text" 
              icon={<CloseOutlined />}
              onClick={handleClose}
              style={{ 
                position: 'absolute', 
                top: '8px', 
                right: '8px', 
                zIndex: 1001,
                color: '#999'
              }}
            />
            <div style={{ 
              fontWeight: 'bold', 
              fontSize: '14px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {currentSong.name}
            </div>
            <div style={{ 
              fontSize: '12px', 
              color: '#666',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {currentSong.artist}
            </div>
          </div>
        </div>
        
        {/* 进度条 */}
        <div style={{ marginBottom: '8px' }}>
          <Progress 
            percent={getProgress()} 
            showInfo={false} 
            size="small"
            strokeColor="#1890ff"
          />
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            fontSize: '11px', 
            color: '#999',
            marginTop: '2px'
          }}>
            <span>{getCurrentTime()}</span>
            <span>{formatDuration(currentSong.duration)}</span>
          </div>
        </div>
        
        {/* 音量控制 */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
          <SoundOutlined style={{ color: '#666', fontSize: '12px' }} />
          <Slider
            min={0}
            max={100}
            value={volume}
            onChange={handleVolumeChange}
            style={{ flex: 1 }}
            size="small"
          />
          <span style={{ fontSize: '11px', color: '#999', minWidth: '30px' }}>{volume}%</span>
        </div>
        
        {/* 播放模式和控制按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          {/* 播放模式按钮 */}
          <Button 
            size="small" 
            icon={getPlayModeIcon()}
            onClick={togglePlayMode}
            title={getPlayModeText()}
            style={{ color: '#666' }}
          />
          
          {/* 播放控制按钮 */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button 
              size="small" 
              icon={<StepBackwardOutlined />}
              onClick={previousSong}
              disabled={playlist.length <= 1}
            />
            {isPlaying && !isPaused ? (
              <Button 
                size="small" 
                type="primary"
                icon={<PauseOutlined />}
                onClick={pauseMusic}
              />
            ) : (
              <Button 
                size="small" 
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={isPlaying ? resumeMusic : () => playMusic()}
              />
            )}
            <Button 
              size="small" 
              icon={<StepForwardOutlined />}
              onClick={nextSong}
              disabled={playlist.length <= 1}
            />
          </div>
          
          {/* 占位元素保持对称 */}
          <div style={{ width: '24px' }}></div>
        </div>
      </Card>
    </div>
  );
};

export default GlobalMusicPlayer;