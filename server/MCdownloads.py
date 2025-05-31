import json
import os
import requests
import sys

# 配置
API_BASE_URL = "https://download.fastmirror.net/api/v3"
DOWNLOAD_BASE_URL = "https://download.fastmirror.net/download"
OUTPUT_DIR = "downloads"

# 确保下载目录存在
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

def get_server_list():
    """获取支持的服务端列表"""
    try:
        response = requests.get(f"{API_BASE_URL}")
        response.raise_for_status()
        result = response.json()
        
        if result.get("success", False):
            return result.get("data", [])
        else:
            print(f"错误: {result.get('message', '未知错误')}")
            return []
    except Exception as e:
        print(f"获取服务端列表时出错: {e}")
        return []

def get_server_info(name):
    """获取服务端部分信息"""
    try:
        response = requests.get(f"{API_BASE_URL}/{name}")
        response.raise_for_status()
        result = response.json()
        
        if result.get("success", False):
            return result.get("data", {})
        else:
            print(f"错误: {result.get('message', '未知错误')}")
            return {}
    except Exception as e:
        print(f"获取服务端信息时出错: {e}")
        return {}

def get_builds(name, mc_version):
    """获取对应游戏版本的所有构建版本列表"""
    try:
        # 先获取总数量
        count_url = f"{API_BASE_URL}/{name}/{mc_version}?offset=0&limit=1"
        count_response = requests.get(count_url)
        count_response.raise_for_status()
        count_result = count_response.json()

        # 在获取总数后添加检查
        if "count" not in count_result.get("data", {}):
            print("API响应中缺少count字段，使用默认limit=50")
            total_count = 50
        
        if not count_result.get("success", False):
            print(f"错误: {count_result.get('message', '获取构建总数失败')}")
            return {}
        
        # 从响应中获取总构建数量
        total_count = count_result.get("data", {}).get("count", 0)
        if total_count == 0:
            print(f"没有找到 {name} {mc_version} 的构建版本!")
            return {}
        
        # 使用总数量作为limit获取所有构建版本
        all_builds_url = f"{API_BASE_URL}/{name}/{mc_version}?offset=0&limit={total_count}"
        all_builds_response = requests.get(all_builds_url)
        all_builds_response.raise_for_status()
        all_builds_result = all_builds_response.json()
        
        if all_builds_result.get("success", False):
            return all_builds_result.get("data", {})
        else:
            print(f"错误: {all_builds_result.get('message', '获取构建列表失败')}")
            return {}
    except Exception as e:
        print(f"获取构建版本列表时出错: {e}")
        return {}

def get_core_info(name, mc_version, core_version):
    """获取指定核心信息"""
    try:
        response = requests.get(f"{API_BASE_URL}/{name}/{mc_version}/{core_version}")
        response.raise_for_status()
        result = response.json()
        
        if result.get("success", False):
            return result.get("data", {})
        else:
            print(f"错误: {result.get('message', '未知错误')}")
            return {}
    except Exception as e:
        print(f"获取核心信息时出错: {e}")
        return {}

def download_file(name, mc_version, core_version):
    """下载文件"""
    # 先获取核心信息以获取文件名
    core_info = get_core_info(name, mc_version, core_version)
    if not core_info:
        return False
    
    filename = core_info.get("filename", f"{name}-{mc_version}-{core_version}.jar")
    download_path = os.path.join(OUTPUT_DIR, filename)
    
    try:
        print(f"正在下载 {filename}...")
        download_url = f"{DOWNLOAD_BASE_URL}/{name}/{mc_version}/{core_version}"
        response = requests.get(download_url, stream=True)
        response.raise_for_status()
        
        total_size = int(response.headers.get('content-length', 0))
        downloaded = 0
        
        with open(download_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    # 显示下载进度
                    if total_size > 0:
                        percent = int(100 * downloaded / total_size)
                        sys.stdout.write(f"\r下载进度: {percent}% [{downloaded} / {total_size} 字节]")
                        sys.stdout.flush()
        
        print(f"\n下载完成! 文件保存在: {download_path}")
        return True
    except Exception as e:
        print(f"下载文件时出错: {e}")
        return False

def print_server_list(servers):
    """打印服务端列表"""
    print("\n可用的服务端列表:")
    print("-" * 50)
    print(f"{'序号':<5}{'名称':<20}{'类型':<10}{'推荐':<5}")
    print("-" * 50)
    
    for i, server in enumerate(servers, 1):
        recommend = "是" if server.get("recommend", False) else "否"
        print(f"{i:<5}{server.get('name', ''):<20}{server.get('tag', ''):<10}{recommend:<5}")

def print_mc_versions(versions):
    """打印MC版本列表"""
    print("\n可用的MC版本:")
    print("-" * 30)
    print(f"{'序号':<5}{'版本':<20}")
    print("-" * 30)
    
    for i, version in enumerate(versions, 1):
        print(f"{i:<5}{version:<20}")

def print_builds(builds_data):
    """打印构建版本列表"""
    builds = builds_data.get("builds", [])
    if not builds:
        print("没有找到构建版本!")
        return
    
    print("\n可用的构建版本:")
    print("-" * 80)
    print(f"{'序号':<5}{'核心版本':<15}{'更新时间':<25}{'SHA1':<40}")
    print("-" * 80)
    
    for i, build in enumerate(builds, 1):
        print(f"{i:<5}{build.get('core_version', ''):<15}{build.get('update_time', ''):<25}{build.get('sha1', ''):<40}")
    
    print(f"\n显示 {builds_data.get('offset', 0)+1} 到 {builds_data.get('offset', 0)+len(builds)} 个构建，共 {builds_data.get('count', 0)} 个")

def main():
    """主函数"""
    print("欢迎使用 FastMirror 服务端下载工具!")
    
    # 获取服务端列表
    servers = get_server_list()
    if not servers:
        print("无法获取服务端列表，请检查网络连接或API地址是否正确。")
        return
    
    while True:
        print_server_list(servers)
        
        # 选择服务端
        try:
            choice = input("\n请选择服务端序号 (输入q退出): ")
            if choice.lower() == 'q':
                break
            
            server_index = int(choice) - 1
            if server_index < 0 or server_index >= len(servers):
                print("无效的选择!")
                continue
            
            selected_server = servers[server_index]
            server_name = selected_server.get("name")
            print(f"\n已选择: {server_name}")
            
            # 获取服务端信息
            server_info = get_server_info(server_name)
            if not server_info:
                print(f"无法获取 {server_name} 的信息!")
                continue
            
            mc_versions = server_info.get("mc_versions", [])
            if not mc_versions:
                print(f"{server_name} 没有可用的MC版本!")
                continue
            
            # 显示MC版本列表
            print_mc_versions(mc_versions)
            
            # 选择MC版本
            mc_choice = input("\n请选择MC版本序号 (输入b返回): ")
            if mc_choice.lower() == 'b':
                continue
            
            mc_index = int(mc_choice) - 1
            if mc_index < 0 or mc_index >= len(mc_versions):
                print("无效的选择!")
                continue
            
            selected_mc = mc_versions[mc_index]
            print(f"\n已选择MC版本: {selected_mc}")
            
            # 获取构建版本列表
            builds_data = get_builds(server_name, selected_mc)
            if not builds_data or not builds_data.get("builds"):
                print(f"没有找到 {server_name} {selected_mc} 的构建版本!")
                continue
            
            # 显示构建版本列表
            print_builds(builds_data)
            
            # 选择构建版本
            build_choice = input("\n请选择构建版本序号 (输入b返回): ")
            if build_choice.lower() == 'b':
                continue
            
            build_index = int(build_choice) - 1
            builds = builds_data.get("builds", [])
            if build_index < 0 or build_index >= len(builds):
                print("无效的选择!")
                continue
            
            selected_build = builds[build_index]
            core_version = selected_build.get("core_version")
            print(f"\n已选择构建版本: {core_version}")
            
            # 下载文件
            confirm = input("是否下载此文件? (y/n): ")
            if confirm.lower() == 'y':
                download_file(server_name, selected_mc, core_version)
        
        except ValueError:
            print("请输入有效的数字!")
        except Exception as e:
            print(f"发生错误: {e}")

if __name__ == "__main__":
    main()