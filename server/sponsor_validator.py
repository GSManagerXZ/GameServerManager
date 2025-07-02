#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
赞助者验证模块
提供赞助者身份验证和云端游戏获取功能
"""

import os
import json
import requests
import logging
from typing import Optional, Dict, List, Any

# 配置日志
logger = logging.getLogger("sponsor_validator")

class SponsorValidator:
    """赞助者验证器类"""
    
    def __init__(self, config_path: str = "/home/steam/games/config.json"):
        """
        初始化赞助者验证器
        
        Args:
            config_path: 配置文件路径
        """
        self.config_path = config_path
        self.cloud_api_url = "http://gsm.server.xiaozhuhouses.asia:10000/games"
        self.version_api_url = "http://gsm.server.xiaozhuhouses.asia:10000/version"
        self.request_timeout = 5
    
    def load_config(self) -> Dict[str, Any]:
        """
        加载配置文件
        
        Returns:
            配置字典
        """
        if not os.path.exists(self.config_path):
            logger.warning(f"配置文件不存在: {self.config_path}")
            return {}
            
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                logger.debug(f"成功加载配置文件: {self.config_path}")
                return config
        except Exception as e:
            logger.error(f"读取配置文件失败: {str(e)}")
            return {}
    
    def save_config(self, config: Dict[str, Any]) -> bool:
        """
        保存配置文件
        
        Args:
            config: 配置字典
            
        Returns:
            是否保存成功
        """
        try:
            # 确保目录存在
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=4, ensure_ascii=False)
                
            logger.info(f"配置文件保存成功: {self.config_path}")
            return True
        except Exception as e:
            logger.error(f"保存配置文件失败: {str(e)}")
            return False
    
    def get_sponsor_key(self) -> Optional[str]:
        """
        获取赞助者密钥
        
        Returns:
            赞助者密钥，如果不存在则返回None
        """
        config = self.load_config()
        return config.get('sponsor_key')
    
    def save_sponsor_key(self, sponsor_key: str) -> bool:
        """
        保存赞助者密钥
        
        Args:
            sponsor_key: 赞助者密钥
            
        Returns:
            是否保存成功
        """
        if not sponsor_key or not sponsor_key.strip():
            logger.error("赞助者密钥不能为空")
            return False
            
        config = self.load_config()
        config['sponsor_key'] = sponsor_key.strip()
        
        if self.save_config(config):
            logger.info("赞助者密钥保存成功")
            return True
        else:
            logger.error("赞助者密钥保存失败")
            return False
    
    def validate_sponsor_key(self, sponsor_key: Optional[str] = None) -> bool:
        """
        验证赞助者密钥是否有效
        
        Args:
            sponsor_key: 要验证的密钥，如果为None则使用配置文件中的密钥
            
        Returns:
            密钥是否有效
        """
        if sponsor_key is None:
            sponsor_key = self.get_sponsor_key()
            
        if not sponsor_key:
            logger.warning("没有找到赞助者密钥")
            return False
            
        try:
            session = requests.Session()
            response = session.get(
                self.cloud_api_url,
                headers={'key': sponsor_key},
                timeout=self.request_timeout
            )
            
            if response.status_code == 200:
                logger.info("赞助者密钥验证成功")
                return True
            elif response.status_code == 403:
                logger.error("赞助者密钥验证失败：凭证无效")
                return False
            else:
                logger.error(f"赞助者密钥验证失败：服务器返回状态码 {response.status_code}")
                return False
                
        except requests.exceptions.RequestException as e:
            logger.error(f"验证赞助者密钥时网络请求失败: {str(e)}")
            return False
    
    def fetch_cloud_games(self, sponsor_key: Optional[str] = None) -> Optional[List[Dict[str, Any]]]:
        """
        从云端获取游戏列表
        
        Args:
            sponsor_key: 赞助者密钥，如果为None则使用配置文件中的密钥
            
        Returns:
            游戏列表，如果获取失败则返回None
            
        Raises:
            Exception: 当赞助者凭证验证不通过时抛出403异常
        """
        if sponsor_key is None:
            sponsor_key = self.get_sponsor_key()
            
        if not sponsor_key:
            logger.warning("没有找到赞助者密钥，无法获取云端游戏列表")
            return None
            
        try:
            logger.debug("正在从云端获取游戏列表...")
            
            session = requests.Session()
            response = session.get(
                self.cloud_api_url,
                headers={'key': sponsor_key},
                timeout=self.request_timeout
            )
            
            if response.status_code == 200:
                cloud_data = response.json()
                game_list = []
                
                # 处理返回的云端游戏数据
                for game_id, game_info in cloud_data.items():
                    game_list.append({
                        'id': game_id,
                        'name': game_info.get('game_nameCN', game_id),
                        'appid': game_info.get('appid'),
                        'anonymous': game_info.get('anonymous', True),
                        'has_script': game_info.get('script', False),
                        'tip': game_info.get('tip', ''),
                        'image': game_info.get('image', ''),
                        'url': game_info.get('url', ''),
                        'script_name': game_info.get('script_name', '')
                    })
                
                logger.info(f"成功获取到 {len(game_list)} 个云端游戏")
                return game_list
                
            elif response.status_code == 403:
                logger.error("赞助者凭证验证不通过，状态码403")
                raise Exception("403：赞助者凭证验证不通过")
            else:
                logger.error(f"云端服务器返回错误: {response.status_code}")
                return None
                
        except requests.exceptions.RequestException as e:
            logger.error(f"请求云端服务器失败: {str(e)}")
            raise
    
    def get_masked_sponsor_key(self) -> Optional[str]:
        """
        获取掩码后的赞助者密钥（用于安全显示）
        
        Returns:
            掩码后的密钥，如果不存在则返回None
        """
        sponsor_key = self.get_sponsor_key()
        if not sponsor_key:
            return None
            
        if len(sponsor_key) > 8:
            return sponsor_key[:4] + '*' * (len(sponsor_key) - 8) + sponsor_key[-4:]
        else:
            return sponsor_key
    
    def has_sponsor_key(self) -> bool:
        """
        检查是否存在赞助者密钥
        
        Returns:
            是否存在赞助者密钥
        """
        sponsor_key = self.get_sponsor_key()
        return bool(sponsor_key and sponsor_key.strip())
    
    def remove_sponsor_key(self) -> bool:
        """
        移除赞助者密钥
        
        Returns:
            是否移除成功
        """
        config = self.load_config()
        if 'sponsor_key' in config:
            del config['sponsor_key']
            if self.save_config(config):
                logger.info("赞助者密钥已移除")
                return True
            else:
                logger.error("移除赞助者密钥失败")
                return False
        else:
            logger.info("没有找到赞助者密钥，无需移除")
            return True
    
    def check_version_update(self, sponsor_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        检查版本更新
        
        Args:
            sponsor_key: 赞助者密钥，如果为None则使用配置文件中的密钥
            
        Returns:
            版本信息字典，包含version和description字段，如果获取失败则返回None
        """
        if sponsor_key is None:
            sponsor_key = self.get_sponsor_key()
            
        if not sponsor_key:
            logger.warning("没有找到赞助者密钥，无法检查版本更新")
            return None
            
        try:
            logger.debug("正在检查版本更新...")
            
            session = requests.Session()
            response = session.get(
                self.version_api_url,
                headers={'key': sponsor_key},
                timeout=self.request_timeout
            )
            
            if response.status_code == 200:
                version_data = response.json()
                logger.info(f"成功获取版本信息: {version_data.get('version', 'unknown')}")
                return version_data
                
            elif response.status_code == 403:
                logger.error("赞助者凭证验证不通过，状态码403")
                return None
                
            else:
                logger.error(f"检查版本更新失败：服务器返回状态码 {response.status_code}")
                return None
                
        except requests.exceptions.RequestException as e:
            logger.error(f"检查版本更新时网络请求失败: {str(e)}")
            return None


# 便捷函数，提供简单的调用接口
def get_sponsor_validator(config_path: str = "/home/steam/games/config.json") -> SponsorValidator:
    """
    获取赞助者验证器实例
    
    Args:
        config_path: 配置文件路径
        
    Returns:
        SponsorValidator实例
    """
    return SponsorValidator(config_path)


def validate_sponsor(sponsor_key: Optional[str] = None, config_path: str = "/home/steam/games/config.json") -> bool:
    """
    快速验证赞助者密钥
    
    Args:
        sponsor_key: 要验证的密钥，如果为None则使用配置文件中的密钥
        config_path: 配置文件路径
        
    Returns:
        密钥是否有效
    """
    validator = SponsorValidator(config_path)
    return validator.validate_sponsor_key(sponsor_key)


def get_cloud_games(sponsor_key: Optional[str] = None, config_path: str = "/home/steam/games/config.json") -> Optional[List[Dict[str, Any]]]:
    """
    快速获取云端游戏列表
    
    Args:
        sponsor_key: 赞助者密钥，如果为None则使用配置文件中的密钥
        config_path: 配置文件路径
        
    Returns:
        游戏列表，如果获取失败则返回None
    """
    validator = SponsorValidator(config_path)
    return validator.fetch_cloud_games(sponsor_key)


if __name__ == "__main__":
    # 测试代码
    import sys
    
    # 配置日志
    logging.basicConfig(
        level=logging.DEBUG,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    validator = SponsorValidator()
    
    if len(sys.argv) > 1:
        command = sys.argv[1]
        
        if command == "validate":
            # 验证当前配置的赞助者密钥
            if validator.validate_sponsor_key():
                print("✅ 赞助者密钥验证成功")
            else:
                print("❌ 赞助者密钥验证失败")
                
        elif command == "games":
            # 获取云端游戏列表
            try:
                games = validator.fetch_cloud_games()
                if games:
                    print(f"✅ 成功获取到 {len(games)} 个云端游戏:")
                    for game in games[:5]:  # 只显示前5个
                        print(f"  - {game['name']} (ID: {game['id']})")
                    if len(games) > 5:
                        print(f"  ... 还有 {len(games) - 5} 个游戏")
                else:
                    print("❌ 获取云端游戏列表失败")
            except Exception as e:
                print(f"❌ 获取云端游戏列表时出错: {str(e)}")
                
        elif command == "info":
            # 显示赞助者信息
            if validator.has_sponsor_key():
                masked_key = validator.get_masked_sponsor_key()
                print(f"✅ 已配置赞助者密钥: {masked_key}")
            else:
                print("❌ 未配置赞助者密钥")
                
        else:
            print("未知命令。可用命令: validate, games, info")
    else:
        print("赞助者验证模块")
        print("可用命令:")
        print("  python sponsor_validator.py validate  - 验证赞助者密钥")
        print("  python sponsor_validator.py games     - 获取云端游戏列表")
        print("  python sponsor_validator.py info      - 显示赞助者信息")