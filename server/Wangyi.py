#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网易云音乐歌单播放器
功能：读取指定歌单下的所有歌曲并播放
"""

import requests
import json
import time
import random
from urllib.parse import quote
import threading
import os

class NeteaseMusicPlayer:
    def __init__(self):
        # 不再初始化pygame音频模块，只管理歌单信息
        self.current_song = None
        self.playlist = []
        self.current_index = 0
        self.is_playing = False
        self.is_paused = False
        
        # 请求头，模拟浏览器访问
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://music.163.com/',
            'Cookie': 'appver=1.5.2'
        }
    
    def get_playlist_detail(self, playlist_id):
        """
        获取歌单详情
        :param playlist_id: 歌单ID
        :return: 歌单信息和歌曲列表
        """
        # 尝试多个API端点，使用不同的参数获取完整歌单
        api_urls = [
            f'https://music.163.com/api/playlist/detail?id={playlist_id}&n=1000',
            f'https://music.163.com/api/v6/playlist/detail?id={playlist_id}&limit=1000&offset=0',
            f'https://music.163.com/api/playlist/detail?id={playlist_id}'
        ]
        
        for i, url in enumerate(api_urls):
            try:
                print(f"尝试API端点 {i+1}/{len(api_urls)}: {url.split('/')[-2]}")
                
                # 添加更多请求头
                headers = self.headers.copy()
                headers.update({
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                })
                
                response = requests.get(url, headers=headers, timeout=15)
                
                if response.status_code == 200:
                    data = response.json()
                    print(f"API响应数据结构: {list(data.keys())}")
                    
                    # 处理不同的API响应格式
                    result = None
                    if data.get('code') == 200 and 'result' in data:
                        result = data['result']
                        print("使用result字段")
                    elif 'playlist' in data and data['playlist']:
                        result = data['playlist']
                        print("使用playlist字段")
                    elif data.get('code') == 200:
                        result = data
                        print("使用根数据")
                    else:
                        error_code = data.get('code', 'unknown')
                        error_msg = data.get('message', data.get('msg', '未知错误'))
                        print(f"API返回错误: code={error_code}, message={error_msg}")
                        
                        # 如果是服务器忙碌错误，尝试下一个端点
                        if error_code in [-447, -460, 301]:
                            print("服务器忙碌或需要登录，尝试下一个API端点...")
                            continue
                        else:
                            return None, []
                    
                    if not result:
                        print("无法从API响应中提取歌单数据，尝试下一个端点...")
                        continue
                    
                    playlist_info = {
                        'name': result.get('name', '未知歌单'),
                        'description': result.get('description', '') or '',
                        'coverImgUrl': result.get('coverImgUrl', ''),
                        'trackCount': result.get('trackCount', 0)
                    }
                    
                    # 提取歌曲列表
                    tracks = result.get('tracks', [])
                    if not tracks:
                        print("歌单中没有找到歌曲列表，可能是私有歌单或需要登录")
                        # 如果没有歌曲但有歌单信息，仍然返回歌单信息
                        return playlist_info, []
                    
                    songs = []
                    for track in tracks:
                        if track:  # 确保track不为None
                            artists = track.get('artists', [])
                            artist_name = '未知歌手'
                            if artists and len(artists) > 0 and artists[0]:
                                artist_name = artists[0].get('name', '未知歌手')
                            
                            song_info = {
                                'id': track.get('id'),
                                'name': track.get('name', '未知歌曲'),
                                'artist': artist_name,
                                'duration': track.get('duration', 0),
                                'url': f'https://music.163.com/song/media/outer/url?id={track.get("id")}.mp3'
                            }
                            songs.append(song_info)
                    
                    print(f"成功获取歌单信息，共 {len(songs)} 首歌曲")
                    return playlist_info, songs
                    
                else:
                    print(f"请求失败，状态码: {response.status_code}")
                    if i < len(api_urls) - 1:
                        print("尝试下一个API端点...")
                        continue
                    
            except requests.exceptions.Timeout:
                print(f"请求超时，尝试下一个端点...")
                continue
            except Exception as e:
                print(f"请求发生错误: {e}")
                if i < len(api_urls) - 1:
                    print("尝试下一个API端点...")
                    continue
        
        print("所有API端点都失败了")
        return None, []
    
    def get_song_url(self, song_id):
        """
        获取歌曲播放链接
        :param song_id: 歌曲ID
        :return: 播放链接
        """
        try:
            # 尝试多个可能的API端点
            urls = [
                f'https://music.163.com/song/media/outer/url?id={song_id}.mp3',
                f'https://music.163.com/api/song/enhance/player/url?id={song_id}&ids=[{song_id}]&br=128000'
            ]
            
            for url in urls:
                response = requests.head(url, headers=self.headers, timeout=5, allow_redirects=True)
                if response.status_code == 200:
                    return url
            
            return None
            
        except Exception as e:
            print(f"获取歌曲链接时发生错误: {e}")
            return None
    
    def load_playlist(self, playlist_id, song_limit=None):
        """
        加载歌单
        :param playlist_id: 歌单ID
        :param song_limit: 歌曲数量限制，None表示不限制
        """
        print(f"正在加载歌单 {playlist_id}...")
        playlist_info, songs = self.get_playlist_detail(playlist_id)
        
        if playlist_info and songs:
            # 应用歌曲数量限制
            if song_limit is not None and song_limit > 0:
                songs = songs[:song_limit]
            self.playlist = songs
            print(f"\n歌单信息:")
            print(f"名称: {playlist_info['name']}")
            description = playlist_info.get('description', '') or ''
            print(f"描述: {description[:100]}..." if len(description) > 100 else f"描述: {description}")
            print(f"歌曲数量: {len(songs)}")
            print("\n歌曲列表:")
            
            for i, song in enumerate(songs[:10]):  # 只显示前10首
                duration_min = song['duration'] // 60000
                duration_sec = (song['duration'] % 60000) // 1000
                print(f"{i+1:2d}. {song['name']} - {song['artist']} ({duration_min:02d}:{duration_sec:02d})")
            
            if len(songs) > 10:
                print(f"... 还有 {len(songs) - 10} 首歌曲")
            
            return True
        else:
            print("加载歌单失败")
            return False
    
    def play_song(self, song_index=None):
        """
        设置当前播放歌曲（不进行实际音频播放）
        :param song_index: 歌曲索引，如果为None则播放当前索引的歌曲
        """
        if not self.playlist:
            print("歌单为空，请先加载歌单")
            return False
        
        if song_index is not None:
            self.current_index = song_index
        
        if self.current_index >= len(self.playlist):
            self.current_index = 0
        
        song = self.playlist[self.current_index]
        print(f"\n设置播放: {song['name']} - {song['artist']}")
        
        # 获取歌曲播放链接
        song_url = self.get_song_url(song['id'])
        
        if song_url:
            # 只更新播放状态，不进行实际播放
            song['url'] = song_url  # 将播放链接添加到歌曲信息中
            self.current_song = song
            self.is_playing = True
            self.is_paused = False
            
            return True
        else:
            print("无法获取歌曲链接，尝试下一首...")
            return self.next_song()
    
    def pause(self):
        """暂停播放（仅更新状态）"""
        if self.is_playing and not self.is_paused:
            self.is_paused = True
            print("已暂停")
    
    def resume(self):
        """恢复播放（仅更新状态）"""
        if self.is_playing and self.is_paused:
            self.is_paused = False
            print("已恢复播放")
    
    def stop(self):
        """停止播放（仅更新状态）"""
        self.is_playing = False
        self.is_paused = False
        print("已停止播放")
    
    def next_song(self):
        """播放下一首"""
        if not self.playlist:
            return False
        
        self.current_index = (self.current_index + 1) % len(self.playlist)
        return self.play_song()
    
    def previous_song(self):
        """播放上一首"""
        if not self.playlist:
            return False
        
        self.current_index = (self.current_index - 1) % len(self.playlist)
        return self.play_song()
    
    def shuffle_play(self):
        """随机播放"""
        if not self.playlist:
            return False
        
        self.current_index = random.randint(0, len(self.playlist) - 1)
        return self.play_song()
    
    def show_current_song(self):
        """显示当前播放的歌曲信息"""
        if self.current_song:
            duration_min = self.current_song['duration'] // 60000
            duration_sec = (self.current_song['duration'] % 60000) // 1000
            status = "播放中" if self.is_playing and not self.is_paused else "已暂停" if self.is_paused else "已停止"
            
            print(f"\n当前歌曲: {self.current_song['name']}")
            print(f"歌手: {self.current_song['artist']}")
            print(f"时长: {duration_min:02d}:{duration_sec:02d}")
            print(f"状态: {status}")
            print(f"进度: {self.current_index + 1}/{len(self.playlist)}")
        else:
            print("当前没有播放歌曲")
    
    def auto_play_monitor(self):
        """自动播放监控（已禁用，因为不进行实际音频播放）"""
        # 由于不进行实际音频播放，此方法不再需要
        pass

def main():
    """主函数"""
    player = NeteaseMusicPlayer()
    
    print("=" * 50)
    print("     网易云音乐歌单播放器")
    print("=" * 50)
    
    # 示例歌单ID（可以替换为任意歌单ID）
    default_playlist_ids = [
        "19723756",    # 飙升榜
        "3778678",     # 热歌榜  
        "2884035",     # 原创榜
        "991319590",   # 听歌识曲榜
        "2161739123"   # 备用歌单
    ]
    default_playlist_id = default_playlist_ids[0]
    
    while True:
        print("\n请选择操作:")
        print("1. 加载歌单")
        print("2. 播放当前歌曲")
        print("3. 暂停/恢复")
        print("4. 停止播放")
        print("5. 下一首")
        print("6. 上一首")
        print("7. 随机播放")
        print("8. 显示当前歌曲")
        print("9. 显示歌单")
        print("0. 退出")
        
        choice = input("\n请输入选择 (0-9): ").strip()
        
        if choice == '1':
            print(f"\n推荐歌单ID:")
            for i, pid in enumerate(default_playlist_ids):
                names = ["飙升榜", "热歌榜", "原创榜", "听歌识曲榜", "备用歌单"]
                print(f"  {pid} - {names[i]}")
            
            playlist_id = input(f"\n请输入歌单ID (直接回车使用默认: {default_playlist_id}): ").strip()
            if not playlist_id:
                playlist_id = default_playlist_id
            
            success = player.load_playlist(playlist_id)
            if success:
                # 启动自动播放监控线程
                monitor_thread = threading.Thread(target=player.auto_play_monitor, daemon=True)
                monitor_thread.start()
            else:
                print("\n加载失败，建议尝试以下操作:")
                print("1. 检查歌单ID是否正确")
                print("2. 尝试使用推荐的歌单ID")
                print("3. 确保网络连接正常")
                print("4. 稍后再试（可能是服务器繁忙）")
        
        elif choice == '2':
            if player.playlist:
                song_num = input("请输入要播放的歌曲序号 (直接回车播放第一首): ").strip()
                if song_num.isdigit():
                    index = int(song_num) - 1
                    if 0 <= index < len(player.playlist):
                        player.play_song(index)
                    else:
                        print("歌曲序号超出范围")
                else:
                    player.play_song(0)
            else:
                print("请先加载歌单")
        
        elif choice == '3':
            if player.is_paused:
                player.resume()
            else:
                player.pause()
        
        elif choice == '4':
            player.stop()
        
        elif choice == '5':
            player.next_song()
        
        elif choice == '6':
            player.previous_song()
        
        elif choice == '7':
            player.shuffle_play()
        
        elif choice == '8':
            player.show_current_song()
        
        elif choice == '9':
            if player.playlist:
                print(f"\n当前歌单 ({len(player.playlist)} 首歌曲):")
                for i, song in enumerate(player.playlist):
                    duration_min = song['duration'] // 60000
                    duration_sec = (song['duration'] % 60000) // 1000
                    current_mark = " ♪" if i == player.current_index else "  "
                    print(f"{current_mark}{i+1:2d}. {song['name']} - {song['artist']} ({duration_min:02d}:{duration_sec:02d})")
            else:
                print("歌单为空")
        
        elif choice == '0':
            player.stop()
            print("感谢使用，再见！")
            break
        
        else:
            print("无效选择，请重新输入")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n程序被用户中断")
    except Exception as e:
        print(f"\n程序发生错误: {e}")