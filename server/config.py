import os
import json
import secrets

# 使用固定的配置文件路径
CONFIG_PATH = "/home/steam/games/config.json"

# 打印配置文件路径以便调试
print(f"JWT配置文件路径: {CONFIG_PATH}")
print(f"当前工作目录: {os.getcwd()}")

def load_config():
    """加载配置文件，如不存在则创建默认配置"""
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                config = json.load(f)
                print(f"成功加载配置文件: {CONFIG_PATH}")
                
                # 确保配置中包含jwt部分
                if "jwt" not in config:
                    config["jwt"] = {}
                
                return config
        except Exception as e:
            print(f"加载配置文件失败: {str(e)}")
            # 出错时返回一个包含默认jwt配置的配置对象
            return {"jwt": {}}
    else:
        print(f"配置文件不存在，将使用默认配置")
        # 不存在时返回空配置
        return {"jwt": {}}

def save_config(config):
    """保存配置到文件"""
    try:
        # 确保目录存在
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        
        # 如果文件已存在，先读取现有配置
        existing_config = {}
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                    existing_config = json.load(f)
            except:
                pass
        
        # 合并现有配置和新配置（追加方式，不覆盖其他配置）
        for key, value in config.items():
            existing_config[key] = value
        
        # 保存合并后的配置
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(existing_config, f, indent=4, ensure_ascii=False)
        print(f"配置已保存到: {CONFIG_PATH}")
        return True
    except Exception as e:
        print(f"保存配置文件失败: {str(e)}")
        return False

# 启动时加载或创建配置
app_config = load_config()

# 如果没有JWT密钥，则生成一个并保存
if "jwt" not in app_config or "secret" not in app_config["jwt"]:
    jwt_config = {
        "secret": secrets.token_hex(32),  # 生成随机密钥
        "expiration": 24 * 60 * 60  # 24小时过期
    }
    app_config["jwt"] = jwt_config
    save_config(app_config)
    print(f"已生成新的JWT密钥")
else:
    print(f"使用现有JWT密钥")
    # 确保过期时间存在
    if "expiration" not in app_config["jwt"]:
        app_config["jwt"]["expiration"] = 24 * 60 * 60
        save_config(app_config)

# 导出JWT配置供其他模块使用
JWT_SECRET = app_config["jwt"]["secret"]
JWT_EXPIRATION = app_config["jwt"]["expiration"]