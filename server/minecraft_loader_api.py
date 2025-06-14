#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Minecraft 加载器统一 API
支持 Fabric、Forge 和 Quilt 的统一接口
"""

import os
import tempfile
import logging
import requests
from abc import ABC, abstractmethod
from enum import Enum
from typing import Dict, List, Optional, Any, Union

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('minecraft_loader_api.log', encoding='utf-8')
    ]
)

logger = logging.getLogger(__name__)


class LoaderType(Enum):
    """加载器类型枚举"""
    FABRIC = "fabric"
    FORGE = "forge"
    QUILT = "quilt"


class BaseLoaderAPI(ABC):
    """加载器API基类"""
    
    def __init__(self, base_url: str, user_agent: str = "MinecraftLoaderAPI/1.0"):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': user_agent})
        self.loader_name = self.__class__.__name__.replace('API', '')
    
    def _log_operation(self, operation: str, details: str = ""):
        """记录操作日志"""
        if details:
            logger.info(f"[{self.loader_name}] {operation}: {details}")
        else:
            logger.info(f"[{self.loader_name}] {operation}")
    
    def _log_version_info(self, version_type: str, version: str, is_latest: bool = False):
        """记录版本信息"""
        latest_text = " (最新)" if is_latest else ""
        logger.info(f"[{self.loader_name}] {version_type}: {version}{latest_text}")
    
    def _log_found_versions(self, version_type: str, count: int, context: str = ""):
        """记录找到的版本数量"""
        context_text = f" ({context})" if context else ""
        logger.info(f"[{self.loader_name}] 找到 {count} 个{version_type}{context_text}")
    
    def _make_request(self, url: str, params: Optional[Dict] = None) -> Union[Dict, List]:
        """发送HTTP请求"""
        try:
            response = self.session.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            logger.error(f"[{self.loader_name}] 请求失败: {url} - {e}")
            raise Exception(f"API请求失败: {e}")
        except ValueError as e:
            logger.error(f"[{self.loader_name}] JSON解析失败: {url} - {e}")
            raise Exception(f"响应格式错误: {e}")
    
    def _download_file(self, url: str, save_path: str, params: Optional[Dict] = None) -> str:
        """下载文件"""
        try:
            # 记录下载开始
            filename = os.path.basename(save_path)
            if params:
                logger.info(f"[{self.loader_name}] 下载: {filename} <- {url} (参数: {params})")
            else:
                logger.info(f"[{self.loader_name}] 下载: {filename} <- {url}")
            
            response = self.session.get(url, params=params, stream=True)
            response.raise_for_status()
            
            # 记录响应头信息
            content_length = response.headers.get('content-length')
            if content_length:
                logger.info(f"[{self.loader_name}] 文件大小: {int(content_length) / 1024 / 1024:.2f} MB")
            
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            
            # 下载文件
            with open(save_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            file_size = os.path.getsize(save_path)
            logger.info(f"[{self.loader_name}] 完成: {filename} ({file_size / 1024 / 1024:.2f} MB)")
            return save_path
            
        except requests.RequestException as e:
            logger.error(f"[{self.loader_name}] 下载失败: {url} - {e}")
            raise Exception(f"下载失败: {e}")
    
    @abstractmethod
    def get_game_versions(self, stable_only: bool = True) -> List[str]:
        """获取支持的游戏版本"""
        pass
    
    @abstractmethod
    def get_loader_versions(self, game_version: Optional[str] = None) -> List[Dict]:
        """获取加载器版本"""
        pass
    
    @abstractmethod
    def get_compatible_loader_versions(self, game_version: str, stable_only: bool = True, limit: int = 10) -> List[Dict]:
        """
        根据游戏版本获取兼容的加载器版本
        
        Args:
            game_version: 游戏版本，如 "1.20.1"
            stable_only: 是否只返回稳定版本
            limit: 限制返回数量
            
        Returns:
            兼容的加载器版本列表，统一格式为:
            [
                {
                    "version": "加载器版本号",
                    "stable": bool,  # 是否为稳定版本
                    "build": int,    # 构建号（如果有）
                    "maven": str,    # Maven坐标（如果有）
                    "url": str       # 下载链接（如果有）
                }
            ]
        """
        pass
    
    @abstractmethod
    def download_installer(self, save_path: str, **kwargs) -> str:
        """下载安装器"""
        pass
    
    @abstractmethod
    def download_loader(self, save_path: str, loader_version: Optional[str] = None, **kwargs) -> str:
        """下载加载器JAR文件"""
        pass


class FabricAPI(BaseLoaderAPI):
    """Fabric API 实现"""
    
    def __init__(self):
        super().__init__("https://meta.fabricmc.net")
    
    def get_game_versions(self, stable_only: bool = True) -> List[str]:
        """获取支持的游戏版本"""
        self._log_operation("获取游戏版本", f"仅稳定版: {stable_only}")
        versions = self._make_request(f"{self.base_url}/v2/versions/game")
        if stable_only:
            stable_versions = [v["version"] for v in versions if v.get("stable", False)]
            self._log_found_versions("稳定版本", len(stable_versions))
            return stable_versions
        self._log_found_versions("版本", len(versions))
        return [v["version"] for v in versions]
    
    def get_loader_versions(self, game_version: Optional[str] = None) -> List[Dict]:
        """获取加载器版本"""
        if game_version:
            self._log_operation("获取加载器版本", f"游戏版本 {game_version}")
            url = f"{self.base_url}/v2/versions/loader/{game_version}"
        else:
            self._log_operation("获取加载器版本", "所有版本")
            url = f"{self.base_url}/v2/versions/loader"
        
        versions = self._make_request(url)
        self._log_found_versions("加载器版本", len(versions))
        return versions
    
    def get_compatible_loader_versions(self, game_version: str, stable_only: bool = True, limit: int = 10) -> List[Dict]:
        """根据游戏版本获取兼容的Fabric加载器版本"""
        self._log_operation("获取兼容的加载器版本", f"游戏版本 {game_version}, 仅稳定版: {stable_only}")
        
        try:
            # 获取该游戏版本的加载器信息
            url = f"{self.base_url}/v2/versions/loader/{game_version}"
            versions = self._make_request(url)
            
            if not versions:
                self._log_operation("未找到兼容版本", f"游戏版本 {game_version}")
                return []
            
            # 转换为统一格式
            compatible_versions = []
            for version_data in versions:
                if "loader" in version_data:
                    loader_info = version_data["loader"]
                    compatible_version = {
                        "version": loader_info.get("version", ""),
                        "stable": loader_info.get("stable", False),
                        "build": loader_info.get("build", 0),
                        "maven": loader_info.get("maven", ""),
                        "url": f"https://maven.fabricmc.net/net/fabricmc/fabric-loader/{loader_info.get('version', '')}/fabric-loader-{loader_info.get('version', '')}.jar"
                    }
                    
                    # 过滤稳定版本
                    if stable_only and not compatible_version["stable"]:
                        continue
                    
                    compatible_versions.append(compatible_version)
            
            # 限制数量
            if limit > 0:
                compatible_versions = compatible_versions[:limit]
            
            self._log_found_versions("兼容加载器版本", len(compatible_versions), f"游戏版本 {game_version}")
            return compatible_versions
            
        except Exception as e:
            self._log_operation("获取兼容版本失败", f"游戏版本 {game_version}: {e}")
            return []
    
    def get_installer_versions(self) -> List[Dict]:
        """获取安装器版本"""
        return self._make_request(f"{self.base_url}/v2/versions/installer")
    
    def download_installer(self, save_path: str, version: Optional[str] = None) -> str:
        """下载Fabric安装器"""
        if not version:
            self._log_operation("获取最新安装器版本")
            installers = self.get_installer_versions()
            version = installers[0]["version"]
            self._log_version_info("安装器版本", version, is_latest=True)
        else:
            self._log_version_info("安装器版本", version)
        
        filename = f"fabric-installer-{version}.jar"
        full_path = os.path.join(save_path, filename)
        # 使用Maven仓库的直接下载链接
        url = f"https://maven.fabricmc.net/net/fabricmc/fabric-installer/{version}/fabric-installer-{version}.jar"
        
        return self._download_file(url, full_path)
    
    def download_loader(self, save_path: str, loader_version: Optional[str] = None, **kwargs) -> str:
        """下载Fabric加载器JAR文件"""
        if not loader_version:
            self._log_operation("获取最新加载器版本")
            loaders = self.get_loader_versions()
            # 检查返回的数据结构
            if loaders and isinstance(loaders[0], dict):
                if "loader" in loaders[0]:
                    # 带游戏版本的调用格式: {"loader": {...}, "intermediary": {...}}
                    loader_version = loaders[0]["loader"]["version"]
                else:
                    # 不带游戏版本的调用格式: {"version": "...", "stable": ...}
                    loader_version = loaders[0]["version"]
            else:
                raise ValueError("无法获取加载器版本信息")
            self._log_version_info("加载器版本", loader_version, is_latest=True)
        else:
            self._log_version_info("加载器版本", loader_version)
        
        filename = f"fabric-loader-{loader_version}.jar"
        full_path = os.path.join(save_path, filename)
        # 使用Maven仓库的直接下载链接
        url = f"https://maven.fabricmc.net/net/fabricmc/fabric-loader/{loader_version}/fabric-loader-{loader_version}.jar"
        
        return self._download_file(url, full_path)


class ForgeAPI(BaseLoaderAPI):
    """Forge API 实现（基于BMCL镜像）"""
    
    def __init__(self):
        super().__init__("https://bmclapi2.bangbang93.com")
    
    def get_game_versions(self, stable_only: bool = True) -> List[str]:
        """获取支持的游戏版本"""
        self._log_operation("获取游戏版本", f"仅稳定版: {stable_only}")
        versions = self._make_request(f"{self.base_url}/forge/minecraft")
        # Forge API返回的是游戏版本列表
        if stable_only:
            # 对于Forge，我们认为所有返回的版本都是稳定版
            self._log_found_versions("稳定版本", len(versions))
        else:
            self._log_found_versions("版本", len(versions))
        return versions
    
    def get_loader_versions(self, game_version: Optional[str] = None) -> List[Dict]:
        """获取加载器版本"""
        if not game_version:
            raise ValueError("Forge 需要指定游戏版本")
        
        self._log_operation("获取Forge版本", f"游戏版本 {game_version}")
        versions = self._make_request(f"{self.base_url}/forge/minecraft/{game_version}")
        self._log_found_versions("Forge版本", len(versions))
        return versions
    
    def get_compatible_loader_versions(self, game_version: str, stable_only: bool = True, limit: int = 10) -> List[Dict]:
        """根据游戏版本获取兼容的Forge加载器版本"""
        self._log_operation("获取兼容的Forge版本", f"游戏版本 {game_version}")
        
        try:
            # 获取该游戏版本的Forge版本信息
            url = f"{self.base_url}/forge/minecraft/{game_version}"
            versions = self._make_request(url)
            
            if not versions:
                self._log_operation("未找到兼容版本", f"游戏版本 {game_version}")
                return []
            
            # 转换为统一格式
            compatible_versions = []
            for version_data in versions:
                # Forge API返回的格式通常包含version, build等字段
                compatible_version = {
                    "version": version_data.get("version", ""),
                    "stable": True,  # Forge通常只返回稳定版本
                    "build": version_data.get("build", 0),
                    "maven": f"net.minecraftforge:forge:{game_version}-{version_data.get('version', '')}",
                    "url": f"{self.base_url}/forge/download?mcversion={game_version}&version={version_data.get('version', '')}&category=installer&format=jar"
                }
                
                compatible_versions.append(compatible_version)
            
            # 限制数量
            if limit > 0:
                compatible_versions = compatible_versions[:limit]
            
            self._log_found_versions("兼容Forge版本", len(compatible_versions), f"游戏版本 {game_version}")
            return compatible_versions
            
        except Exception as e:
            self._log_operation("获取兼容版本失败", f"游戏版本 {game_version}: {e}")
            return []
    
    def download_installer(self, save_path: str, mc_version: str,
                          forge_version: Optional[str] = None) -> str:
        """下载Forge安装器"""
        if not forge_version:
            self._log_operation("获取最新Forge版本", f"MC {mc_version}")
            versions = self.get_loader_versions(mc_version)
            if not versions:
                raise ValueError(f"未找到MC版本 {mc_version} 的Forge版本")
            forge_version = versions[0]["version"]
            self._log_version_info("Forge版本", forge_version, is_latest=True)
        else:
            self._log_version_info("Forge版本", forge_version)
        
        filename = f"forge-{mc_version}-{forge_version}-installer.jar"
        full_path = os.path.join(save_path, filename)
        
        # 使用BMCL的下载接口
        url = f"{self.base_url}/forge/download"
        params = {
            'mcversion': mc_version,
            'version': forge_version,
            'category': 'installer',
            'format': 'jar'
        }
        
        return self._download_file(url, full_path, params)
    
    def download_loader(self, save_path: str, loader_version: Optional[str] = None, 
                       mc_version: Optional[str] = None, **kwargs) -> str:
        """下载Forge加载器JAR文件"""
        if not mc_version:
            raise ValueError("Forge 需要指定 Minecraft 版本")
        
        if not loader_version:
            versions = self.get_loader_versions(mc_version)
            if not versions:
                raise ValueError(f"未找到MC版本 {mc_version} 的Forge版本")
            loader_version = versions[0]["version"]
        
        filename = f"forge-{mc_version}-{loader_version}.jar"
        full_path = os.path.join(save_path, filename)
        
        # 使用BMCL的下载接口
        url = f"{self.base_url}/forge/download"
        params = {
            'mcversion': mc_version,
            'version': loader_version,
            'category': 'universal',  # Forge的通用JAR
            'format': 'jar'
        }
        
        logger.info(f"正在下载 Forge Loader v{loader_version} for MC {mc_version}...")
        
        return self._download_file(url, full_path, params)


class QuiltAPI(BaseLoaderAPI):
    """Quilt API 实现"""
    
    def __init__(self):
        super().__init__("https://meta.quiltmc.org")
    
    def get_game_versions(self, stable_only: bool = True) -> List[str]:
        """获取支持的游戏版本"""
        self._log_operation("获取游戏版本", f"仅稳定版: {stable_only}")
        versions = self._make_request(f"{self.base_url}/v3/versions/game")
        if stable_only:
            stable_versions = [v["version"] for v in versions if v.get("stable", False)]
            self._log_found_versions("稳定版本", len(stable_versions))
            return stable_versions
        self._log_found_versions("版本", len(versions))
        return [v["version"] for v in versions]
    
    def get_loader_versions(self, game_version: Optional[str] = None) -> List[Dict]:
        """获取加载器版本"""
        self._log_operation("获取加载器版本")
        versions = self._make_request(f"{self.base_url}/v3/versions/loader")
        self._log_found_versions("加载器版本", len(versions))
        return versions
    
    def get_compatible_loader_versions(self, game_version: str, stable_only: bool = True, limit: int = 10) -> List[Dict]:
        """根据游戏版本获取兼容的Quilt加载器版本"""
        self._log_operation("获取兼容的Quilt版本", f"游戏版本 {game_version}, 仅稳定版: {stable_only}")
        
        try:
            # 根据Quilt API文档，获取特定游戏版本的加载器元数据
            url = f"{self.base_url}/v3/versions/loader/{game_version}"
            versions = self._make_request(url)
            
            if not versions:
                self._log_operation("未找到兼容版本", f"游戏版本 {game_version}")
                return []
            
            # 转换为统一格式
            compatible_versions = []
            for version_data in versions:
                if "loader" in version_data:
                    loader_info = version_data["loader"]
                    
                    # Quilt版本稳定性判断：没有beta/alpha等标识的版本认为是稳定版
                    version_str = loader_info.get("version", "")
                    is_stable = not any(keyword in version_str.lower() for keyword in ["beta", "alpha", "rc", "snapshot"])
                    
                    compatible_version = {
                        "version": version_str,
                        "stable": is_stable,
                        "build": loader_info.get("build", 0),
                        "maven": loader_info.get("maven", f"org.quiltmc:quilt-loader:{version_str}"),
                        "url": f"https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-loader/{version_str}/quilt-loader-{version_str}.jar"
                    }
                    
                    # 过滤稳定版本
                    if stable_only and not compatible_version["stable"]:
                        continue
                    
                    compatible_versions.append(compatible_version)
            
            # 限制数量
            if limit > 0:
                compatible_versions = compatible_versions[:limit]
            
            self._log_found_versions("兼容Quilt版本", len(compatible_versions), f"游戏版本 {game_version}")
            return compatible_versions
            
        except Exception as e:
            self._log_operation("获取兼容版本失败", f"游戏版本 {game_version}: {e}")
            return []
    
    def get_installer_versions(self) -> List[Dict]:
        """获取安装器版本"""
        return self._make_request(f"{self.base_url}/v3/versions/installer")
    
    def download_installer(self, save_path: str, version: Optional[str] = None) -> str:
        """下载Quilt安装器"""
        if not version:
            self._log_operation("获取最新安装器版本")
            installers = self.get_installer_versions()
            version = installers[0]["version"]
            self._log_version_info("安装器版本", version, is_latest=True)
        else:
            self._log_version_info("安装器版本", version)
        
        installer_info = None
        for installer in self.get_installer_versions():
            if installer["version"] == version:
                installer_info = installer
                break
        
        if not installer_info:
            raise ValueError(f"未找到安装器版本: {version}")
        
        filename = f"quilt-installer-{version}.jar"
        full_path = os.path.join(save_path, filename)
        
        return self._download_file(installer_info["url"], full_path)
    
    def download_loader(self, save_path: str, loader_version: Optional[str] = None, **kwargs) -> str:
        """下载Quilt加载器JAR文件"""
        if not loader_version:
            self._log_operation("获取最新加载器版本")
            loaders = self.get_loader_versions()
            if not loaders:
                raise ValueError("未找到加载器版本")
            loader_version = loaders[0]["version"]
            self._log_version_info("加载器版本", loader_version, is_latest=True)
        else:
            self._log_version_info("加载器版本", loader_version)
        
        # 构建 Maven 下载 URL
        maven_base = "https://maven.quiltmc.org/repository/release"
        maven_path = f"org/quiltmc/quilt-loader/{loader_version}/quilt-loader-{loader_version}.jar"
        url = f"{maven_base}/{maven_path}"
        
        filename = f"quilt-loader-{loader_version}.jar"
        full_path = os.path.join(save_path, filename)
        
        logger.warning(f"[{self.loader_name}] 注意: 通常不需要手动下载 Loader，安装器会自动处理")
        
        return self._download_file(url, full_path)


class MinecraftLoaderAPI:
    """统一的Minecraft加载器API"""
    
    def __init__(self, temp_dir: Optional[str] = None):
        """
        初始化统一API
        
        Args:
            temp_dir: 临时目录路径，默认使用系统临时目录
        """
        self.temp_dir = temp_dir or tempfile.mkdtemp(prefix="minecraft_loader_")
        
        # 初始化各个加载器的API
        self.apis = {
            LoaderType.FABRIC: FabricAPI(),
            LoaderType.FORGE: ForgeAPI(),
            LoaderType.QUILT: QuiltAPI()
        }
        
        logger.info(f"统一API初始化完成，临时目录: {self.temp_dir}")
    
    def _create_response(self, success: bool, message: str, data: Any = None) -> Dict[str, Any]:
        """创建标准响应格式"""
        return {
            "success": success,
            "message": message,
            "data": data
        }
    
    def get_supported_loaders(self) -> List[str]:
        """获取支持的加载器类型"""
        return [loader.value for loader in LoaderType]
    
    def get_game_versions(self, loader_type: str, stable_only: bool = True, 
                         limit: int = 50) -> Dict[str, Any]:
        """
        获取指定加载器支持的游戏版本
        
        Args:
            loader_type: 加载器类型 (fabric/forge/quilt)
            stable_only: 是否只返回稳定版本
            limit: 限制返回数量
            
        Returns:
            标准响应格式
        """
        try:
            loader_enum = LoaderType(loader_type.lower())
            api = self.apis[loader_enum]
            
            versions = api.get_game_versions(stable_only)
            
            if limit > 0:
                versions = versions[:limit]
            
            return self._create_response(
                True,
                f"成功获取 {loader_type} 的 {len(versions)} 个游戏版本",
                {
                    "loader_type": loader_type,
                    "total": len(versions),
                    "versions": versions
                }
            )
            
        except ValueError:
            return self._create_response(
                False, f"不支持的加载器类型: {loader_type}"
            )
        except Exception as e:
            return self._create_response(
                False, f"获取游戏版本失败: {str(e)}"
            )
    
    def download_installer(self, loader_type: str, save_path: Optional[str] = None,
                          **kwargs) -> Dict[str, Any]:
        """
        下载安装器
        
        Args:
            loader_type: 加载器类型
            save_path: 保存路径，默认使用临时目录
            **kwargs: 其他参数（如版本号等）
            
        Returns:
            标准响应格式
        """
        try:
            loader_enum = LoaderType(loader_type.lower())
            api = self.apis[loader_enum]
            
            if save_path is None:
                save_path = self.temp_dir
            
            file_path = api.download_installer(save_path, **kwargs)
            file_size = os.path.getsize(file_path)
            
            return self._create_response(
                True,
                f"{loader_type} 安装器下载成功",
                {
                    "loader_type": loader_type,
                    "file_path": file_path,
                    "filename": os.path.basename(file_path),
                    "file_size": file_size
                }
            )
            
        except ValueError as ve:
            return self._create_response(False, str(ve))
        except Exception as e:
            return self._create_response(
                False, f"下载 {loader_type} 安装器失败: {str(e)}"
            )
    
    def download_loader(self, loader_type: str, save_path: Optional[str] = None,
                       loader_version: Optional[str] = None, **kwargs) -> Dict[str, Any]:
        """
        下载加载器JAR文件
        
        Args:
            loader_type: 加载器类型
            save_path: 保存路径，默认使用临时目录
            loader_version: 加载器版本，默认使用最新版本
            **kwargs: 其他参数（如Forge需要的mc_version）
            
        Returns:
            标准响应格式
        """
        try:
            loader_enum = LoaderType(loader_type.lower())
            api = self.apis[loader_enum]
            
            if save_path is None:
                save_path = self.temp_dir
            
            file_path = api.download_loader(save_path, loader_version, **kwargs)
            file_size = os.path.getsize(file_path)
            
            return self._create_response(
                True,
                f"{loader_type} 加载器下载成功",
                {
                    "loader_type": loader_type,
                    "loader_version": loader_version,
                    "file_path": file_path,
                    "filename": os.path.basename(file_path),
                    "file_size": file_size
                }
            )
            
        except ValueError as ve:
            return self._create_response(False, str(ve))
        except Exception as e:
            return self._create_response(
                False, f"下载 {loader_type} 加载器失败: {str(e)}"
            )
    
    def get_compatible_loader_versions(self, loader_type: str, game_version: str, 
                                     stable_only: bool = True, limit: int = 10) -> Dict[str, Any]:
        """
        根据游戏版本获取兼容的加载器版本
        
        Args:
            loader_type: 加载器类型 (fabric/forge/quilt)
            game_version: 游戏版本，如 "1.20.1"
            stable_only: 是否只返回稳定版本
            limit: 限制返回数量
            
        Returns:
            标准响应格式，包含兼容的加载器版本列表
        """
        try:
            loader_enum = LoaderType(loader_type.lower())
            api = self.apis[loader_enum]
            
            compatible_versions = api.get_compatible_loader_versions(game_version, stable_only, limit)
            
            return self._create_response(
                True,
                f"成功获取 {loader_type} 与游戏版本 {game_version} 兼容的 {len(compatible_versions)} 个加载器版本",
                {
                    "loader_type": loader_type,
                    "game_version": game_version,
                    "stable_only": stable_only,
                    "total": len(compatible_versions),
                    "compatible_versions": compatible_versions
                }
            )
            
        except ValueError:
            return self._create_response(
                False, f"不支持的加载器类型: {loader_type}"
            )
        except Exception as e:
            return self._create_response(
                False, f"获取兼容加载器版本失败: {str(e)}"
            )
    
    def cleanup(self):
        """清理临时文件"""
        try:
            import shutil
            if os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir)
                logger.info(f"已清理临时目录: {self.temp_dir}")
        except Exception as e:
            logger.warning(f"清理临时文件失败: {e}")
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.cleanup() 