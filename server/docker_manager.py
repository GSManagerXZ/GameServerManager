import docker
import json
import logging
import subprocess
import os
from typing import Dict, List, Optional, Any

# 配置日志
logger = logging.getLogger("docker_manager")

class DockerManager:
    """Docker容器管理类"""
    
    def __init__(self):
        """初始化Docker客户端"""
        try:
            self.client = docker.from_env()
            # 测试连接
            self.client.ping()
            logger.info("Docker客户端连接成功")
        except Exception as e:
            logger.error(f"Docker客户端连接失败: {str(e)}")
            self.client = None
    
    def is_connected(self) -> bool:
        """检查Docker连接状态"""
        return self.client is not None
    
    def get_container_by_name(self, container_name: str) -> Optional[Any]:
        """根据容器名称获取容器对象"""
        if not self.is_connected():
            return None
        
        try:
            containers = self.client.containers.list(all=True)
            for container in containers:
                if container.name == container_name:
                    return container
            return None
        except Exception as e:
            logger.error(f"获取容器失败: {str(e)}")
            return None
    
    def get_container_info(self, container_name: str) -> Optional[Dict]:
        """获取容器详细信息"""
        container = self.get_container_by_name(container_name)
        if not container:
            return None
        
        try:
            # 刷新容器状态
            container.reload()
            
            # 获取容器配置
            config = container.attrs
            
            # 解析网络模式
            network_mode = config.get('HostConfig', {}).get('NetworkMode', 'default')
            
            # 解析端口映射
            port_bindings = config.get('HostConfig', {}).get('PortBindings', {})
            ports = []
            for container_port, host_bindings in port_bindings.items():
                if host_bindings:
                    for binding in host_bindings:
                        # 解析容器端口和协议
                        if '/' in container_port:
                            port_num, protocol = container_port.split('/', 1)
                        else:
                            port_num = container_port
                            protocol = 'tcp'  # 默认协议
                        
                        ports.append({
                            'container_port': port_num,
                            'host_port': binding.get('HostPort', ''),
                            'host_ip': binding.get('HostIp', '0.0.0.0'),
                            'protocol': protocol
                        })
            
            # 解析挂载点
            mounts = []
            for mount in config.get('Mounts', []):
                mounts.append({
                    'source': mount.get('Source', ''),
                    'destination': mount.get('Destination', ''),
                    'type': mount.get('Type', 'bind'),
                    'read_only': mount.get('RW', True) == False
                })
            
            # 解析环境变量
            env_vars = []
            for env in config.get('Config', {}).get('Env', []):
                if '=' in env:
                    key, value = env.split('=', 1)
                    env_vars.append({'key': key, 'value': value})
            
            return {
                'id': container.id,
                'name': container.name,
                'status': container.status,
                'image': config.get('Config', {}).get('Image', ''),
                'created': config.get('Created', ''),
                'network_mode': network_mode,
                'ports': ports,
                'mounts': mounts,
                'environment': env_vars,
                'restart_policy': config.get('HostConfig', {}).get('RestartPolicy', {})
            }
        except Exception as e:
            logger.error(f"获取容器信息失败: {str(e)}")
            return None
    
    def stop_container(self, container_name: str) -> Dict[str, Any]:
        """停止容器"""
        if not self.is_connected():
            return {'status': 'error', 'message': 'Docker客户端未连接'}
        
        try:
            container = self.get_container_by_name(container_name)
            if not container:
                return {'status': 'error', 'message': f'容器 {container_name} 不存在'}
            
            if container.status == 'running':
                container.stop(timeout=30)
                logger.info(f"容器 {container_name} 已停止")
                return {'status': 'success', 'message': f'容器 {container_name} 已停止'}
            else:
                return {'status': 'info', 'message': f'容器 {container_name} 当前状态: {container.status}'}
        except Exception as e:
            logger.error(f"停止容器失败: {str(e)}")
            return {'status': 'error', 'message': f'停止容器失败: {str(e)}'}
    
    def restart_container(self, container_name: str) -> Dict[str, Any]:
        """重启容器"""
        if not self.is_connected():
            return {'status': 'error', 'message': 'Docker客户端未连接'}
        
        try:
            container = self.get_container_by_name(container_name)
            if not container:
                return {'status': 'error', 'message': f'容器 {container_name} 不存在'}
            
            container.restart(timeout=30)
            logger.info(f"容器 {container_name} 已重启")
            return {'status': 'success', 'message': f'容器 {container_name} 已重启'}
        except Exception as e:
            logger.error(f"重启容器失败: {str(e)}")
            return {'status': 'error', 'message': f'重启容器失败: {str(e)}'}
    
    def generate_docker_command(self, config: Dict[str, Any]) -> str:
        """根据配置生成Docker重建命令"""
        try:
            if not isinstance(config, dict):
                logger.error(f"配置参数必须是字典类型，当前类型: {type(config)}")
                return ''
            
            # 先停止并删除现有容器，然后重新创建
            container_name = config.get('name', '')
            if container_name:
                cmd_parts = [
                    f'docker stop {container_name} 2>/dev/null || true',
                    f'docker rm {container_name} 2>/dev/null || true',
                    'docker run -d'
                ]
            else:
                cmd_parts = ['docker run -d']
            
            # 容器名称
            if config.get('name'):
                cmd_parts.append(f'--name {config["name"]}')
            
            # 网络模式
            if config.get('network_mode'):
                cmd_parts.append(f'--network {config["network_mode"]}')
            
            # 端口映射
            ports = config.get('ports', [])
            if isinstance(ports, list):
                for port in ports:
                    if isinstance(port, dict):
                        host_port = port.get('host_port', '')
                        container_port = port.get('container_port', '')
                        host_ip = port.get('host_ip', '0.0.0.0')
                        protocol = port.get('protocol', 'tcp')
                        
                        if host_port and container_port:
                            # 构建端口映射字符串，包含协议
                            port_mapping = f'{container_port}/{protocol}'
                            
                            if host_ip and host_ip != '0.0.0.0':
                                cmd_parts.append(f'-p {host_ip}:{host_port}:{port_mapping}')
                            else:
                                cmd_parts.append(f'-p {host_port}:{port_mapping}')
            
            # 挂载点
            mounts = config.get('mounts', [])
            if isinstance(mounts, list):
                for mount in mounts:
                    if isinstance(mount, dict):
                        source = mount.get('source', '')
                        destination = mount.get('destination', '')
                        read_only = mount.get('read_only', False)
                        
                        if source and destination:
                            mount_str = f'-v {source}:{destination}'
                            if read_only:
                                mount_str += ':ro'
                            cmd_parts.append(mount_str)
            
            # 环境变量
            environment = config.get('environment', [])
            if isinstance(environment, list):
                for env in environment:
                    if isinstance(env, dict):
                        key = env.get('key', '')
                        value = env.get('value', '')
                        if key:
                            # 对包含特殊字符的值进行引号包装
                            if ' ' in str(value) or '"' in str(value) or "'" in str(value) or '$' in str(value) or '&' in str(value):
                                # 转义双引号并用双引号包装
                                escaped_value = str(value).replace('"', '\\"')
                                cmd_parts.append(f'-e "{key}={escaped_value}"')
                            else:
                                cmd_parts.append(f'-e {key}={value}')
            
            # 重启策略
            restart_policy = config.get('restart_policy', '')
            if restart_policy:
                if isinstance(restart_policy, str):
                    # 处理字符串格式的重启策略
                    if restart_policy != 'no' and restart_policy != '':
                        cmd_parts.append(f'--restart {restart_policy}')
                elif isinstance(restart_policy, dict) and restart_policy.get('Name'):
                    # 处理字典格式的重启策略（Docker API返回格式）
                    policy_name = restart_policy['Name']
                    if policy_name and policy_name != 'no':
                        if policy_name == 'on-failure' and restart_policy.get('MaximumRetryCount', 0) > 0:
                            cmd_parts.append(f'--restart {policy_name}:{restart_policy["MaximumRetryCount"]}')
                        else:
                            cmd_parts.append(f'--restart {policy_name}')
            
            # 镜像名称
            if config.get('image'):
                if container_name:
                    # 如果有容器名称，将镜像添加到最后一个docker run命令中
                    cmd_parts.append(config['image'])
                    # 将停止、删除、运行命令组合
                    stop_cmd = cmd_parts[0]
                    rm_cmd = cmd_parts[1]
                    run_cmd = ' '.join(cmd_parts[2:])
                    return f'{stop_cmd} && {rm_cmd} && {run_cmd}'
                else:
                    cmd_parts.append(config['image'])
                    return ' '.join(cmd_parts)
            
            if container_name:
                # 如果有容器名称但没有镜像，返回停止和删除命令
                stop_cmd = cmd_parts[0]
                rm_cmd = cmd_parts[1]
                run_cmd = ' '.join(cmd_parts[2:])
                return f'{stop_cmd} && {rm_cmd} && {run_cmd}'
            else:
                return ' '.join(cmd_parts)
        except Exception as e:
            logger.error(f"生成Docker命令失败: {str(e)}")
            return ''
    
    def list_containers(self, all_containers: bool = True) -> List[Dict[str, Any]]:
        """列出所有容器"""
        if not self.is_connected():
            return []
        
        try:
            containers = self.client.containers.list(all=all_containers)
            result = []
            
            for container in containers:
                result.append({
                    'id': container.id[:12],
                    'name': container.name,
                    'status': container.status,
                    'image': container.image.tags[0] if container.image.tags else container.image.id[:12]
                })
            
            return result
        except Exception as e:
            logger.error(f"列出容器失败: {str(e)}")
            return []
    
    def list_images(self) -> List[Dict[str, Any]]:
        """列出所有Docker镜像"""
        if not self.is_connected():
            return []
        
        try:
            images = self.client.images.list()
            result = []
            
            for image in images:
                # 获取镜像标签
                tags = image.tags if image.tags else []
                
                # 如果没有标签，使用镜像ID
                if not tags:
                    tags = [image.id[:12]]
                
                for tag in tags:
                    # 跳过<none>标签
                    if '<none>' not in tag:
                        result.append({
                            'id': image.id[:12],
                            'tag': tag,
                            'size': image.attrs.get('Size', 0),
                            'created': image.attrs.get('Created', '')
                        })
            
            # 按标签名排序，gameservermanager相关镜像排在前面
            result.sort(key=lambda x: (0 if 'gameservermanager' in x['tag'].lower() else 1, x['tag']))
            
            return result
        except Exception as e:
            logger.error(f"列出镜像失败: {str(e)}")
            return []
    
    def download_and_import_image(self, download_url: str, image_name: str = "gameservermanager:latest") -> Dict[str, Any]:
        """下载并导入Docker镜像"""
        try:
            # 创建临时目录
            temp_dir = "/tmp/gsm_image_download"
            os.makedirs(temp_dir, exist_ok=True)
            
            # 生成临时文件名
            temp_file = os.path.join(temp_dir, "gameservermanager.tar.xz")
            
            logger.info(f"开始下载镜像: {download_url}")
            
            # 使用aria2c下载镜像文件
            aria2_cmd = [
                'aria2c',
                '--dir', temp_dir,
                '--out', 'gameservermanager.tar.xz',
                '--split=8',
                '--max-connection-per-server=8',
                '--min-split-size=1M',
                '--continue=true',
                '--max-tries=0',
                '--retry-wait=5',
                '--user-agent=GSManager/1.0',
                '--allow-overwrite=true',
                download_url
            ]
            
            # 执行下载
            result = subprocess.run(aria2_cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                logger.error(f"下载失败: {result.stderr}")
                return {
                    'status': 'error',
                    'message': f'下载失败: {result.stderr}'
                }
            
            # 检查文件是否存在
            if not os.path.exists(temp_file):
                return {
                    'status': 'error',
                    'message': '下载完成但文件不存在'
                }
            
            logger.info("下载完成，开始导入镜像")
            
            # 导入镜像
            import_cmd = ['docker', 'load', '-i', temp_file]
            import_result = subprocess.run(import_cmd, capture_output=True, text=True)
            
            if import_result.returncode != 0:
                logger.error(f"导入镜像失败: {import_result.stderr}")
                return {
                    'status': 'error',
                    'message': f'导入镜像失败: {import_result.stderr}'
                }
            
            # 重命名镜像
            if image_name != "gameservermanager:latest":
                tag_cmd = ['docker', 'tag', 'gameservermanager:latest', image_name]
                tag_result = subprocess.run(tag_cmd, capture_output=True, text=True)
                
                if tag_result.returncode != 0:
                    logger.warning(f"重命名镜像失败: {tag_result.stderr}")
            
            # 清理临时文件
            try:
                os.remove(temp_file)
                os.rmdir(temp_dir)
            except Exception as e:
                logger.warning(f"清理临时文件失败: {str(e)}")
            
            logger.info(f"镜像导入成功: {image_name}")
            return {
                'status': 'success',
                'message': f'镜像 {image_name} 导入成功',
                'image_name': image_name
            }
            
        except Exception as e:
            logger.error(f"下载并导入镜像失败: {str(e)}")
            return {
                'status': 'error',
                'message': f'下载并导入镜像失败: {str(e)}'
            }

# 创建全局Docker管理器实例
docker_manager = DockerManager()