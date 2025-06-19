import os
import configparser
import json
import os
from typing import Dict, List, Any, Optional
from flask import jsonify
import logging
from ruamel.yaml import YAML
from pyhocon import ConfigFactory
import toml

logger = logging.getLogger(__name__)

class GameConfigManager:
    """游戏配置文件管理器"""
    
    def __init__(self):
        self.config_schemas_dir = os.path.join(os.path.dirname(__file__), 'public', 'gameconfig')
        self.supported_parsers = {
            'configobj': self._parse_with_configobj,
            'pyhocon': self._parse_with_pyhocon,
            'ruamel.yaml': self._parse_with_yaml,
            'properties': self._parse_with_properties,
            'json': self._parse_with_json,
            'toml': self._parse_with_toml
        }
    
    def get_available_configs(self) -> List[Dict[str, str]]:
        """获取所有可用的配置文件模板"""
        configs = []
        try:
            if not os.path.exists(self.config_schemas_dir):
                return configs
                
            for filename in os.listdir(self.config_schemas_dir):
                if filename.endswith('.yml') or filename.endswith('.yaml'):
                    config_path = os.path.join(self.config_schemas_dir, filename)
                    try:
                        
                        yaml = YAML()
                        
                        with open(config_path, 'r', encoding='utf-8') as f:
                            config_data = yaml.load(f)
                            
                        if 'meta' in config_data:
                            configs.append({
                                'id': filename.replace('.yml', '').replace('.yaml', ''),
                                'name': config_data['meta'].get('game_name', filename),
                                'config_file': config_data['meta'].get('config_file', ''),
                                'filename': filename
                            })
                    except Exception as e:
                        logger.error(f"解析配置文件 {filename} 失败: {e}")
                        continue
        except Exception as e:
            logger.error(f"读取配置目录失败: {e}")
            
        return configs
    
    def get_config_schema(self, config_id: str) -> Optional[Dict[str, Any]]:
        """获取指定配置文件的模板结构"""
        try:
            config_path = os.path.join(self.config_schemas_dir, f"{config_id}.yml")
            if not os.path.exists(config_path):
                config_path = os.path.join(self.config_schemas_dir, f"{config_id}.yaml")
                
            if not os.path.exists(config_path):
                return None
                
            yaml = YAML()
            
            with open(config_path, 'r', encoding='utf-8') as f:
                return yaml.load(f)
        except Exception as e:
            logger.error(f"读取配置模板失败: {e}")
            return None
    
    def read_game_config(self, server_path: str, config_schema: Dict[str, Any], parser_type: str = 'configobj') -> Dict[str, Any]:
        """读取游戏配置文件"""
        try:
            config_file_path = config_schema['meta']['config_file']
            full_config_path = os.path.join(server_path, config_file_path)
            
            logger.debug(f"正在读取配置文件: {full_config_path}")
            logger.debug(f"使用解析器: {parser_type}")
            
            if not os.path.exists(full_config_path):
                logger.warning(f"配置文件不存在: {full_config_path}，正在创建默认配置文件")
                # 获取默认配置值
                default_config = self._get_default_values(config_schema)
                # 创建配置文件
                if self.save_game_config(server_path, config_schema, default_config, parser_type):
                    logger.info(f"已创建默认配置文件: {full_config_path}")
                else:
                    logger.error(f"创建默认配置文件失败: {full_config_path}")
                    return {}
            
            # 根据解析器类型读取配置
            if parser_type in self.supported_parsers:
                result = self.supported_parsers[parser_type](full_config_path, config_schema)
                logger.debug(f"配置解析结果: {result}")
                return result
            else:
                logger.error(f"不支持的解析器类型: {parser_type}")
                return {}
                
        except Exception as e:
            logger.error(f"读取游戏配置失败: {e}")
            return {}
    
    def save_game_config(self, server_path: str, config_schema: Dict[str, Any], config_data: Dict[str, Any], parser_type: str = 'configobj') -> bool:
        """保存游戏配置文件"""
        try:
            config_file_path = config_schema['meta']['config_file']
            full_config_path = os.path.join(server_path, config_file_path)
            
            # 确保目录存在
            os.makedirs(os.path.dirname(full_config_path), exist_ok=True)
            
            # 根据解析器类型保存配置
            if parser_type == 'configobj':
                return self._save_with_configobj(full_config_path, config_data, config_schema)
            elif parser_type == 'ruamel.yaml':
                return self._save_with_yaml(full_config_path, config_data, config_schema)
            elif parser_type == 'pyhocon':
                return self._save_with_pyhocon(full_config_path, config_data, config_schema)

            elif parser_type == 'properties':
                return self._save_with_properties(full_config_path, config_data, config_schema)
            elif parser_type == 'json':
                return self._save_with_json(full_config_path, config_data, config_schema)
            elif parser_type == 'toml':
                return self._save_with_toml(full_config_path, config_data, config_schema)
            else:
                logger.error(f"不支持的解析器类型: {parser_type}")
                return False
                
        except Exception as e:
            logger.error(f"保存游戏配置失败: {e}")
            return False
    
    def _get_default_values(self, config_schema: Dict[str, Any]) -> Dict[str, Any]:
        """获取默认配置值"""
        result = {}
        
        for section in config_schema.get('sections', []):
            section_key = section.get('key', 'default')
            result[section_key] = {}
            
            for field in section.get('fields', []):
                field_name = field['name']
                default_value = field.get('default', '')
                result[section_key][field_name] = default_value
                
        return result
    
    def _parse_with_configobj(self, config_path: str, config_schema: Dict[str, Any]) -> Dict[str, Any]:
        """使用configobj解析配置文件"""
        try:
            import configobj
            config = configobj.ConfigObj(config_path, encoding='utf-8')
            logger.debug(f"configobj读取到的原始配置: {dict(config)}")
            result = {}
            
            for section in config_schema.get('sections', []):
                section_key = section.get('key', 'default')
                result[section_key] = {}
                logger.debug(f"处理section: {section_key}")
                
                if section_key in config:
                    logger.debug(f"在配置文件中找到section: {section_key}, 内容: {dict(config[section_key])}")
                    for field in section.get('fields', []):
                        field_name = field['name']
                        logger.debug(f"处理字段: {field_name}")
                        if field_name in config[section_key]:
                            value = config[section_key][field_name]
                            logger.debug(f"字段 {field_name} 的原始值: {value} (类型: {type(value)})")
                            
                            # 检查是否为嵌套字段
                            if field.get('type') == 'nested':
                                # 处理嵌套字段，将括号格式转换为字符串数组
                                if isinstance(value, list):
                                    logger.debug(f"检测到列表类型的嵌套字段，重新组合: {value}")
                                    # 检查第一个元素是否以'('开头，最后一个元素是否以')'结尾
                                    if value and value[0].startswith('(') and value[-1].endswith(')'):
                                        # 直接拼接列表元素，保留括号
                                        combined_value = ','.join(value)
                                    else:
                                        # 如果不是标准格式，添加括号
                                        combined_value = '(' + ','.join(value) + ')'
                                    logger.debug(f"重新组合后的值: {combined_value}")
                                    value = combined_value
                                
                                if isinstance(value, str) and value.startswith('(') and value.endswith(')'):
                                    # 去掉括号并按逗号分割
                                    inner_content = value[1:-1]
                                    if inner_content:
                                        # 解析参数，处理带引号的字符串
                                        params = []
                                        current_param = ''
                                        in_quotes = False
                                        quote_char = None
                                        
                                        for char in inner_content:
                                            if char in ['"', "'"] and not in_quotes:
                                                in_quotes = True
                                                quote_char = char
                                                current_param += char
                                            elif char == quote_char and in_quotes:
                                                in_quotes = False
                                                quote_char = None
                                                current_param += char
                                            elif char == ',' and not in_quotes:
                                                if current_param.strip():
                                                    params.append(current_param.strip())
                                                current_param = ''
                                            else:
                                                current_param += char
                                        
                                        # 添加最后一个参数
                                        if current_param.strip():
                                            params.append(current_param.strip())
                                        
                                        value = params
                                        logger.debug(f"解析后的嵌套字段参数: {value}")
                                    else:
                                        value = []
                                elif isinstance(value, list):
                                    # 如果仍然是列表但不是括号格式，直接使用列表
                                    logger.debug(f"嵌套字段保持列表格式: {value}")
                                else:
                                    value = []
                            else:
                                # 普通字段的类型转换
                                if 'default' in field:
                                    default_type = type(field['default'])
                                    if default_type == bool:
                                        value = str(value).lower() in ('true', '1', 'yes', 'on')
                                    elif default_type == int:
                                        value = int(value)
                                    elif default_type == float:
                                        value = float(value)
                            
                            result[section_key][field_name] = value
                            logger.debug(f"字段 {field_name} 的最终值: {value}")
                        else:
                            logger.warning(f"字段 {field_name} 在配置文件中不存在")
                            # 如果字段不存在，不设置默认值，保持字段不存在的状态
                else:
                    # 如果section不存在，创建空的section但不填充默认值
                    logger.warning(f"section {section_key} 在配置文件中不存在")
                    pass
                        
            return result
        except ImportError:
            logger.error("configobj库未安装")
            return {}
        except Exception as e:
            logger.error(f"configobj解析失败: {e}")
            return {}
    
    def _parse_with_yaml(self, config_path: str, config_schema: Dict[str, Any]) -> Dict[str, Any]:
        """使用ruamel.yaml解析配置文件"""
        try:
            
            yaml = YAML()
            yaml.preserve_quotes = True
            
            with open(config_path, 'r', encoding='utf-8') as f:
                config = yaml.load(f) or {}
            
            result = {}
            for section in config_schema.get('sections', []):
                # 检查是否有key字段，如果没有则使用默认的section名称
                section_key = section.get('key', 'default')
                result[section_key] = {}
                
                # 如果有key字段，从对应的section读取；否则从根级别读取
                config_source = config.get(section_key, {}) if 'key' in section else config
                
                for field in section.get('fields', []):
                    field_name = field['name']
                    if field_name in config_source:
                         value = config_source[field_name]
                        # 如果字段不存在，不设置默认值
                else:
                    # 如果section不存在，创建空的section但不填充默认值
                    pass
                        
            return result
        except Exception as e:
            logger.error(f"yaml解析失败: {e}")
            return {}
    
    def _parse_with_pyhocon(self, config_path: str, config_schema: Dict[str, Any]) -> Dict[str, Any]:
        """使用pyhocon解析配置文件"""
        try:
            
            config = ConfigFactory.parse_file(config_path)
            
            result = {}
            for section in config_schema.get('sections', []):
                section_key = section.get('key', 'default')
                result[section_key] = {}
                
                if section_key in config:
                    for field in section.get('fields', []):
                        field_name = field['name']
                        if field_name in config[section_key]:
                            result[section_key][field_name] = config[section_key][field_name]
                        # 如果字段不存在，不设置默认值
                else:
                    # 如果section不存在，创建空的section但不填充默认值
                    pass
                        
            return result
        except ImportError:
            logger.error("pyhocon库未安装")
            return {}
        except Exception as e:
            logger.error(f"pyhocon解析失败: {e}")
            return {}
    

    
    def _save_with_configobj(self, config_path: str, config_data: Dict[str, Any], config_schema: Dict[str, Any]) -> bool:
        """使用configobj保存配置文件"""
        try:
            import configobj
            
            # 检查是否有嵌套字段需要特殊处理
            has_nested_fields = False
            nested_fields_data = {}
            
            for section_key, section_data in config_data.items():
                # 获取对应的schema section
                schema_section = None
                for section in config_schema.get('sections', []):
                    # 检查是否有key字段，如果没有则使用默认匹配
                    section_schema_key = section.get('key', 'default')
                    if section_schema_key == section_key:
                        schema_section = section
                        break
                
                if schema_section:
                    for field_name, field_value in section_data.items():
                        # 检查是否为嵌套字段
                        field_schema = None
                        for field in schema_section.get('fields', []):
                            if field['name'] == field_name:
                                field_schema = field
                                break
                        
                        if field_schema and field_schema.get('type') == 'nested':
                            has_nested_fields = True
                            if section_key not in nested_fields_data:
                                nested_fields_data[section_key] = {}
                            nested_fields_data[section_key][field_name] = field_value
            
            if has_nested_fields:
                # 对于有嵌套字段的情况，使用原生文件写入
                return self._save_with_raw_write(config_path, config_data, config_schema, nested_fields_data)
            else:
                # 对于普通字段，使用configobj
                if os.path.exists(config_path):
                    config = configobj.ConfigObj(config_path, encoding='utf-8')
                else:
                    config = configobj.ConfigObj(encoding='utf-8')
                
                # 更新配置
                for section_key, section_data in config_data.items():
                    if section_key not in config:
                        config[section_key] = {}
                    for field_name, field_value in section_data.items():
                        config[section_key][field_name] = str(field_value)
                
                # 保存文件
                config.filename = config_path
                config.write()
                return True
                
        except ImportError:
            logger.error("configobj库未安装")
            return False
        except Exception as e:
            logger.error(f"configobj保存失败: {e}")
            return False
    
    def _save_with_raw_write(self, config_path: str, config_data: Dict[str, Any], config_schema: Dict[str, Any], nested_fields_data: Dict[str, Any]) -> bool:
        """使用原生文件写入处理嵌套字段"""
        try:
            lines = []
            
            for section_key, section_data in config_data.items():
                lines.append(f'[{section_key}]')
                
                # 获取对应的schema section
                schema_section = None
                for section in config_schema.get('sections', []):
                    # 检查是否有key字段，如果没有则使用默认匹配
                    section_schema_key = section.get('key', 'default')
                    if section_schema_key == section_key:
                        schema_section = section
                        break
                
                for field_name, field_value in section_data.items():
                    # 检查是否为嵌套字段
                    field_schema = None
                    if schema_section:
                        for field in schema_section.get('fields', []):
                            if field['name'] == field_name:
                                field_schema = field
                                break
                    
                    if field_schema and field_schema.get('type') == 'nested':
                        # 处理嵌套字段，将字符串数组转换为括号格式
                        if isinstance(field_value, list):
                            # 处理嵌套字段中的每个元素，根据字段类型决定是否加引号
                            formatted_elements = []
                            nested_fields = field_schema.get('nested_fields', [])
                            
                            for element in field_value:
                                # 解析每个元素，检查是否需要引号
                                if '=' in element:
                                    key, value = element.split('=', 1)
                                    # 查找对应的嵌套字段定义
                                    nested_field_type = None
                                    for nested_field in nested_fields:
                                        if nested_field['name'] == key:
                                            nested_field_type = nested_field.get('type')
                                            break
                                    
                                    # 如果是字符串类型且值不为空，确保有引号
                                    if nested_field_type == 'string' and value and not (value.startswith('"') and value.endswith('"')):
                                        formatted_elements.append(f'{key}="{value}"')
                                    else:
                                        formatted_elements.append(element)
                                else:
                                    formatted_elements.append(element)
                            
                            formatted_value = '(' + ','.join(formatted_elements) + ')'
                            lines.append(f'{field_name} = {formatted_value}')
                        else:
                            lines.append(f'{field_name} = {field_value}')
                    else:
                        lines.append(f'{field_name} = {field_value}')
                
                lines.append('')  # 添加空行分隔section
            
            # 写入文件
            with open(config_path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(lines))
            
            return True
        except Exception as e:
            logger.error(f"原生文件写入失败: {e}")
            return False
    
    def _save_with_yaml(self, config_path: str, config_data: Dict[str, Any], config_schema: Dict[str, Any]) -> bool:
        """使用ruamel.yaml保存配置文件"""
        try:
            
            yaml = YAML()
            yaml.preserve_quotes = True
            yaml.default_flow_style = False
            
            with open(config_path, 'w', encoding='utf-8') as f:
                yaml.dump(config_data, f)
            return True
        except Exception as e:
            logger.error(f"yaml保存失败: {e}")
            return False
    
    def _save_with_pyhocon(self, config_path: str, config_data: Dict[str, Any], config_schema: Dict[str, Any]) -> bool:
        """使用pyhocon保存配置文件"""
        try:
            # pyhocon通常用于读取，保存时转换为JSON格式
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config_data, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            logger.error(f"pyhocon保存失败: {e}")
            return False
    

    
    def _parse_with_properties(self, config_path: str, config_schema: Dict[str, Any]) -> Dict[str, Any]:
        """使用properties格式解析配置文件（平面键值对格式，无section）"""
        try:
            result = {}
            
            # 对于properties文件，我们假设只有一个section
            if not config_schema.get('sections'):
                logger.warning("配置模板中没有定义sections")
                return {}
            
            # 获取第一个section作为默认section
            section = config_schema['sections'][0]
            section_key = section.get('key', 'default')
            result[section_key] = {}
            
            logger.debug(f"处理properties文件section: {section_key}")
            
            # 读取properties文件
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    for line_num, line in enumerate(f, 1):
                        line = line.strip()
                        # 跳过空行和注释行
                        if not line or line.startswith('#') or line.startswith('!'):
                            continue
                        
                        # 解析键值对
                        if '=' in line:
                            key, value = line.split('=', 1)
                            key = key.strip()
                            value = value.strip()
                            
                            # 查找对应的字段配置
                            field_config = None
                            for field in section.get('fields', []):
                                if field['name'] == key:
                                    field_config = field
                                    break
                            
                            if field_config:
                                # 根据字段类型转换值
                                field_type = field_config.get('type', 'string')
                                try:
                                    if field_type == 'boolean':
                                        converted_value = value.lower() in ('true', '1', 'yes', 'on')
                                    elif field_type == 'number':
                                        # 尝试转换为整数，如果失败则转换为浮点数
                                        try:
                                            converted_value = int(value)
                                        except ValueError:
                                            converted_value = float(value)
                                    else:
                                        converted_value = value
                                    
                                    result[section_key][key] = converted_value
                                    logger.debug(f"解析字段 {key} = {converted_value} (类型: {field_type})")
                                except (ValueError, TypeError) as e:
                                    logger.warning(f"字段 {key} 类型转换失败: {e}，使用原始值")
                                    result[section_key][key] = value
                            else:
                                logger.debug(f"字段 {key} 不在配置模板中，跳过")
                        else:
                            logger.warning(f"第{line_num}行格式不正确: {line}")
            else:
                logger.warning(f"配置文件不存在: {config_path}")
            
            logger.debug(f"properties解析结果: {result}")
            return result
            
        except Exception as e:
             logger.error(f"properties配置解析失败: {e}")
             return {}
    
    def _save_with_properties(self, config_path: str, config_data: Dict[str, Any], config_schema: Dict[str, Any]) -> bool:
        """使用properties格式保存配置文件（平面键值对格式，无section）"""
        try:
            # 对于properties文件，我们假设只有一个section
            if not config_schema.get('sections'):
                logger.warning("配置模板中没有定义sections")
                return False
            
            # 获取第一个section作为默认section
            section = config_schema['sections'][0]
            section_key = section.get('key', 'default')
            
            logger.debug(f"保存properties文件section: {section_key}")
            
            # 准备要写入的内容
            lines = []
            
            # 添加文件头注释
            lines.append("# Minecraft Bedrock Server Configuration")
            lines.append("# Generated by GameServerManager")
            lines.append("")
            
            if section_key in config_data:
                section_data = config_data[section_key]
                
                # 按照schema中字段的顺序写入
                for field in section.get('fields', []):
                    field_name = field['name']
                    if field_name in section_data:
                        value = section_data[field_name]
                        
                        # 添加字段描述作为注释
                        if field.get('description'):
                            lines.append(f"# {field.get('display', field_name)}: {field['description']}")
                        
                        # 根据字段类型格式化值
                        field_type = field.get('type', 'string')
                        if field_type == 'boolean':
                            formatted_value = 'true' if value else 'false'
                        elif field_type == 'number':
                            formatted_value = str(value)
                        else:
                            formatted_value = str(value)
                        
                        lines.append(f"{field_name}={formatted_value}")
                        lines.append("")  # 空行分隔
            
            # 写入文件
            with open(config_path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(lines))
            
            logger.debug(f"properties配置保存成功: {config_path}")
            return True
            
        except Exception as e:
            logger.error(f"properties配置保存失败: {e}")
            return False
    
    def _parse_with_json(self, config_path: str, config_schema: Dict[str, Any]) -> Dict[str, Any]:
        """使用JSON格式解析配置文件"""
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
            
            result = {}
            for section in config_schema.get('sections', []):
                section_key = section.get('key', 'default')
                result[section_key] = {}
                
                if section_key in config:
                    for field in section.get('fields', []):
                        field_name = field['name']
                        if field_name in config[section_key]:
                            value = config[section_key][field_name]
                            
                            # 检查是否为嵌套字段
                            if field.get('type') == 'nested':
                                # JSON中的嵌套字段可能是对象或数组
                                if isinstance(value, dict):
                                    # 将对象转换为键值对数组
                                    nested_array = []
                                    for k, v in value.items():
                                        if isinstance(v, str) and ' ' in v:
                                            nested_array.append(f'{k}="{v}"')
                                        else:
                                            nested_array.append(f'{k}={v}')
                                    value = nested_array
                                elif isinstance(value, list):
                                    # 如果已经是数组，直接使用
                                    pass
                                else:
                                    value = []
                            else:
                                # 普通字段的类型转换
                                if 'default' in field:
                                    default_type = type(field['default'])
                                    if default_type == bool and not isinstance(value, bool):
                                        value = str(value).lower() in ('true', '1', 'yes', 'on')
                                    elif default_type == int and not isinstance(value, int):
                                        value = int(value)
                                    elif default_type == float and not isinstance(value, (int, float)):
                                        value = float(value)
                            
                            result[section_key][field_name] = value
                            logger.debug(f"JSON解析字段 {field_name} = {value}")
                        # 如果字段不存在，不设置默认值
                else:
                    # 如果section不存在，创建空的section但不填充默认值
                    pass
                        
            logger.debug(f"JSON解析结果: {result}")
            return result
        except Exception as e:
            logger.error(f"JSON解析失败: {e}")
            return {}
    
    def _save_with_json(self, config_path: str, config_data: Dict[str, Any], config_schema: Dict[str, Any]) -> bool:
        """使用JSON格式保存配置文件"""
        try:
            # 处理嵌套字段
            processed_data = {}
            
            for section_key, section_data in config_data.items():
                processed_data[section_key] = {}
                
                # 获取对应的schema section
                schema_section = None
                for section in config_schema.get('sections', []):
                    # 检查是否有key字段，如果没有则使用默认匹配
                    section_schema_key = section.get('key', 'default')
                    if section_schema_key == section_key:
                        schema_section = section
                        break
                
                for field_name, field_value in section_data.items():
                    # 检查是否为嵌套字段
                    field_schema = None
                    if schema_section:
                        for field in schema_section.get('fields', []):
                            if field['name'] == field_name:
                                field_schema = field
                                break
                    
                    if field_schema and field_schema.get('type') == 'nested':
                        # 处理嵌套字段，将字符串数组转换为JSON对象
                        if isinstance(field_value, list):
                            nested_obj = {}
                            for element in field_value:
                                if '=' in element:
                                    key, value = element.split('=', 1)
                                    # 去掉可能的引号
                                    if value.startswith('"') and value.endswith('"'):
                                        value = value[1:-1]
                                    
                                    # 尝试转换为合适的类型
                                    try:
                                        if value.lower() in ('true', 'false'):
                                            nested_obj[key] = value.lower() == 'true'
                                        elif value.isdigit():
                                            nested_obj[key] = int(value)
                                        elif '.' in value and value.replace('.', '').isdigit():
                                            nested_obj[key] = float(value)
                                        else:
                                            nested_obj[key] = value
                                    except:
                                        nested_obj[key] = value
                            processed_data[section_key][field_name] = nested_obj
                        else:
                            processed_data[section_key][field_name] = field_value
                    else:
                        processed_data[section_key][field_name] = field_value
            
            # 保存为格式化的JSON文件
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(processed_data, f, indent=2, ensure_ascii=False)
            
            logger.debug(f"JSON配置保存成功: {config_path}")
            return True
        except Exception as e:
            logger.error(f"JSON保存失败: {e}")
            return False
    
    def _parse_with_toml(self, config_path: str, config_schema: Dict[str, Any]) -> Dict[str, Any]:
        """使用TOML格式解析配置文件"""
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = toml.load(f)
            
            result = {}
            for section in config_schema.get('sections', []):
                # 检查是否有key字段，如果没有则使用默认的section名称
                section_key = section.get('key', 'default')
                result[section_key] = {}
                
                # 如果有key字段，从对应的section读取；否则从根级别读取
                config_source = config.get(section_key, {}) if 'key' in section else config
                
                for field in section.get('fields', []):
                    field_name = field['name']
                    if field_name in config_source:
                        value = config_source[field_name]
                        
                        # 检查是否为嵌套字段
                        if field.get('type') == 'nested':
                            # TOML中的嵌套字段可能是表格或数组
                            if isinstance(value, dict):
                                # 将对象转换为键值对数组
                                nested_array = []
                                for k, v in value.items():
                                    if isinstance(v, str) and ' ' in v:
                                        nested_array.append(f'{k}="{v}"')
                                    else:
                                        nested_array.append(f'{k}={v}')
                                value = nested_array
                            elif isinstance(value, list):
                                # 如果已经是数组，直接使用
                                pass
                            else:
                                value = []
                        else:
                            # 普通字段的类型转换
                            if 'default' in field:
                                default_type = type(field['default'])
                                if default_type == bool and not isinstance(value, bool):
                                    value = str(value).lower() in ('true', '1', 'yes', 'on')
                                elif default_type == int and not isinstance(value, int):
                                    value = int(value)
                                elif default_type == float and not isinstance(value, (int, float)):
                                    value = float(value)
                        
                        result[section_key][field_name] = value
                        logger.debug(f"TOML解析字段 {field_name} = {value}")
                    # 如果字段不存在，不设置默认值
                        
            logger.debug(f"TOML解析结果: {result}")
            return result
        except Exception as e:
            logger.error(f"TOML解析失败: {e}")
            return {}
    
    def _save_with_toml(self, config_path: str, config_data: Dict[str, Any], config_schema: Dict[str, Any]) -> bool:
        """使用TOML格式保存配置文件"""
        try:
            final_data_to_dump = {}

            for section_key, section_data in config_data.items():
                
                # Find the corresponding section in the schema
                schema_section = None
                for s in config_schema.get('sections', []):
                    if s.get('key', 'default') == section_key:
                        schema_section = s
                        break
                
                has_key_in_schema = schema_section and 'key' in schema_section

                # Process the data for the current section
                processed_section_data = {}
                for field_name, field_value in section_data.items():
                    # 检查是否为嵌套字段
                    field_schema = None
                    if schema_section:
                        for field in schema_section.get('fields', []):
                            if field['name'] == field_name:
                                field_schema = field
                                break
                    
                    if field_schema and field_schema.get('type') == 'nested':
                        # 处理嵌套字段，将字符串数组转换为TOML表格
                        if isinstance(field_value, list):
                            nested_obj = {}
                            for element in field_value:
                                if '=' in element:
                                    key, value = element.split('=', 1)
                                    # 去掉可能的引号
                                    if value.startswith('"') and value.endswith('"'):
                                        value = value[1:-1]
                                    
                                    # 尝试转换为合适的类型
                                    try:
                                        if value.lower() in ('true', 'false'):
                                            nested_obj[key] = value.lower() == 'true'
                                        elif value.isdigit():
                                            nested_obj[key] = int(value)
                                        elif '.' in value and value.replace('.', '').isdigit():
                                            nested_obj[key] = float(value)
                                        else:
                                            nested_obj[key] = value
                                    except:
                                        nested_obj[key] = value
                            processed_section_data[field_name] = nested_obj
                        else:
                            processed_section_data[field_name] = field_value
                    else:
                        processed_section_data[field_name] = field_value

                if has_key_in_schema:
                    final_data_to_dump[section_key] = processed_section_data
                else:
                    final_data_to_dump.update(processed_section_data)

            # 保存为TOML文件
            with open(config_path, 'w', encoding='utf-8') as f:
                toml.dump(final_data_to_dump, f)
            
            logger.info(f"TOML配置保存成功: {config_path}")
            return True
        except Exception as e:
            logger.error(f"TOML保存失败: {e}")
            return False

# 全局实例
game_config_manager = GameConfigManager()