import React, { useState, useEffect } from 'react';
import {
  Card,
  Form,
  Select,
  Button,
  Input,
  InputNumber,
  Switch,
  message,
  Spin,
  Typography,
  Space,
  Divider,
  Row,
  Col,
  Alert,
  Tooltip
} from 'antd';
import {
  SaveOutlined,
  ReloadOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  UndoOutlined,
  UpOutlined
} from '@ant-design/icons';
import axios from 'axios';

const { Title, Text } = Typography;
const { Option } = Select;

interface Server {
  id: string;
  name: string;
  path: string;
}

interface GameConfig {
  id: string;
  name: string;
  config_file: string;
  filename: string;
}

interface ConfigField {
  name: string;
  display: string;
  default?: any;
  type?: string;
  description?: string;
  options?: Array<{value: string; label: string}>;
  nested_fields?: ConfigField[];
}

interface ConfigSection {
  key: string;
  name?: string;
  fields: ConfigField[];
}

interface ConfigSchema {
  meta: {
    game_name: string;
    config_file: string;
    description?: string;
  };
  sections: ConfigSection[];
}

const GameConfigManager: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [servers, setServers] = useState<Server[]>([]);
  const [gameConfigs, setGameConfigs] = useState<GameConfig[]>([]);
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [selectedConfig, setSelectedConfig] = useState<string>('');
  const [configSchema, setConfigSchema] = useState<ConfigSchema | null>(null);
  const [configData, setConfigData] = useState<any>(null);
  const [selectedParser, setSelectedParser] = useState<string>('configobj'); // 动态选择解析器
  const [showBackToTop, setShowBackToTop] = useState(false);

  // 加载可用服务端
  const loadServers = async () => {
    try {
      const response = await axios.get('/api/game-config/servers');
      if (response.data.status === 'success') {
        setServers(response.data.servers);
      } else {
        message.error(response.data.message || '加载服务端列表失败');
      }
    } catch (error: any) {
      console.error('加载服务端列表失败:', error);
      message.error('加载服务端列表失败');
    }
  };

  // 加载可用配置文件
  const loadGameConfigs = async () => {
    try {
      const response = await axios.get('/api/game-config/available');
      if (response.data.status === 'success') {
        setGameConfigs(response.data.configs);
      } else {
        message.error(response.data.message || '加载配置文件列表失败');
      }
    } catch (error: any) {
      console.error('加载配置文件列表失败:', error);
      message.error('加载配置文件列表失败');
    }
  };

  // 加载配置文件模板
  const loadConfigSchema = async (configId: string) => {
    try {
      const response = await axios.get(`/api/game-config/schema/${configId}`);
      if (response.data.status === 'success') {
        setConfigSchema(response.data.schema);
        // 根据schema中的parser设置来选择解析器
        const parser = response.data.schema?.meta?.parser || 'configobj';
        setSelectedParser(parser);
      } else {
        message.error(response.data.message || '加载配置文件模板失败');
      }
    } catch (error: any) {
      console.error('加载配置文件模板失败:', error);
      message.error('加载配置文件模板失败');
    }
  };

  // 读取配置文件
  const loadConfigData = async () => {
    if (!selectedServer || !selectedConfig) {
      message.warning('请先选择服务端和配置文件');
      return;
    }

    setLoading(true);
    try {
      const serverPath = servers.find(s => s.id === selectedServer)?.path;
      if (!serverPath) {
        message.error('找不到选中的服务端路径');
        return;
      }

      const response = await axios.post('/api/game-config/read', {
        server_path: serverPath,
        config_id: selectedConfig,
        parser_type: selectedParser
      });

      if (response.data.status === 'success') {
        setConfigData(response.data.config_data);
        setConfigSchema(response.data.schema);
        
        // 将配置数据填充到表单
        const formData: any = {};
        
        // 遍历schema中定义的所有sections和fields
        response.data.schema?.sections?.forEach((section: any) => {
          const sectionKey = section.key;
          const sectionData = response.data.config_data[sectionKey] || {};
          
          section.fields?.forEach((field: any) => {
            const fieldKey = field.name;
            const fieldValue = sectionData[fieldKey];
            
            if (field.type === 'nested' && field.nested_fields) {
              // 处理嵌套字段数据
              field.nested_fields.forEach((nestedField: any) => {
                const nestedFieldKey = `${sectionKey}.${fieldKey}.${nestedField.name}`;
                
                if (Array.isArray(fieldValue)) {
                  // 从字符串数组中查找对应的值
                  const matchingValue = fieldValue.find((item: string) => {
                    if (typeof item === 'string') {
                      return item.startsWith(`${nestedField.name}=`) || item.startsWith(`(${nestedField.name}=`);
                    }
                    return false;
                  });
                  
                  if (matchingValue) {
                    // 提取值部分
                    let value = matchingValue.split('=')[1];
                    if (value) {
                      // 处理不同类型的值
                      if (nestedField.type === 'boolean') {
                        value = value.toLowerCase() === 'true';
                      } else if (nestedField.type === 'number') {
                        value = parseFloat(value);
                      }
                      formData[nestedFieldKey] = value;
                    }
                  } else {
                    // 使用默认值
                    formData[nestedFieldKey] = nestedField.default;
                  }
                } else {
                  // 如果没有数据或数据格式不正确，使用默认值
                  formData[nestedFieldKey] = nestedField.default;
                }
              });
            } else {
              // 普通字段处理
              const formFieldKey = `${sectionKey}.${fieldKey}`;
              if (fieldValue !== undefined) {
                // 使用实际值
                formData[formFieldKey] = fieldValue;
              } else {
                // 使用默认值
                formData[formFieldKey] = field.default;
              }
            }
          });
        });
        
        form.setFieldsValue(formData);
        
        message.success('配置文件读取成功');
      } else {
        message.error(response.data.message || '读取配置文件失败');
      }
    } catch (error: any) {
      console.error('读取配置文件失败:', error);
      message.error('读取配置文件失败');
    } finally {
      setLoading(false);
    }
  };

  // 恢复默认值
  const resetToDefaults = () => {
    if (!configSchema) {
      message.warning('请先读取配置文件');
      return;
    }

    const defaultFormData: any = {};
    
    configSchema.sections.forEach(section => {
      section.fields.forEach(field => {
        if (field.type === 'nested' && field.nested_fields) {
          // 处理嵌套字段的默认值
          field.nested_fields.forEach((nestedField: any) => {
            const nestedFieldKey = `${section.key}.${field.name}.${nestedField.name}`;
            if (nestedField.default !== undefined) {
              defaultFormData[nestedFieldKey] = nestedField.default;
            }
          });
        } else {
          // 普通字段的默认值
          const fieldKey = `${section.key}.${field.name}`;
          if (field.default !== undefined) {
            defaultFormData[fieldKey] = field.default;
          }
        }
      });
    });
    
    form.setFieldsValue(defaultFormData);
    message.success('已恢复为默认值');
  };

  // 保存配置文件
  const saveConfigData = async () => {
    if (!selectedServer || !selectedConfig || !configSchema) {
      message.warning('请先选择服务端和配置文件，并读取配置');
      return;
    }

    setSaving(true);
    try {
      const formValues = await form.validateFields();
      
      // 将表单数据转换为配置数据格式
      const configData: any = {};
      configSchema.sections.forEach(section => {
        configData[section.key] = {};
        section.fields.forEach(field => {
          if (field.type === 'nested' && field.nested_fields) {
            // 处理嵌套字段，将子字段组合成字符串数组
            const nestedValues: string[] = [];
            
            field.nested_fields.forEach((nestedField: any) => {
              const nestedFieldKey = `${section.key}.${field.name}.${nestedField.name}`;
              if (nestedFieldKey in formValues) {
                let value = formValues[nestedFieldKey];
                
                // 根据字段类型格式化值
                if (nestedField.type === 'boolean') {
                  value = value ? 'True' : 'False';
                } else if (nestedField.type === 'number') {
                  value = value.toString();
                } else if (nestedField.type === 'string') {
                  value = value || '';
                }
                
                nestedValues.push(`${nestedField.name}=${value}`);
              } else if (nestedField.default !== undefined) {
                // 使用默认值
                let defaultValue = nestedField.default;
                if (nestedField.type === 'boolean') {
                  defaultValue = defaultValue ? 'True' : 'False';
                } else if (nestedField.type === 'number') {
                  defaultValue = defaultValue.toString();
                }
                nestedValues.push(`${nestedField.name}=${defaultValue}`);
              }
            });
            
            configData[section.key][field.name] = nestedValues;
          } else {
            // 普通字段处理
            const fieldKey = `${section.key}.${field.name}`;
            if (fieldKey in formValues) {
              configData[section.key][field.name] = formValues[fieldKey];
            }
          }
        });
      });

      const serverPath = servers.find(s => s.id === selectedServer)?.path;
      if (!serverPath) {
        message.error('找不到选中的服务端路径');
        return;
      }

      const response = await axios.post('/api/game-config/save', {
        server_path: serverPath,
        config_id: selectedConfig,
        config_data: configData,
        parser_type: selectedParser
      });

      if (response.data.status === 'success') {
        message.success('配置文件保存成功');
      } else {
        message.error(response.data.message || '保存配置文件失败');
      }
    } catch (error: any) {
      console.error('保存配置文件失败:', error);
      message.error('保存配置文件失败');
    } finally {
      setSaving(false);
    }
  };

  // 渲染配置字段
  const renderConfigField = (section: ConfigSection, field: ConfigField) => {
    const fieldKey = `${section.key}.${field.name}`;
    const fieldType = field.type || typeof field.default;
    
    let inputComponent;
    let valuePropName = 'value';
    
    if (fieldType === 'boolean') {
      inputComponent = <Switch />;
      valuePropName = 'checked';
    } else if (fieldType === 'number') {
      inputComponent = <InputNumber style={{ width: '100%', textAlign: 'center' }} />;
    } else if (fieldType === 'select' && field.options) {
      inputComponent = (
        <Select 
          showSearch
          allowClear
          style={{ width: '100%', textAlign: 'center' }} 
          placeholder="请选择或输入选项"
          listHeight={320}
          filterOption={(input, option) =>
            option?.children?.toString().toLowerCase().includes(input.toLowerCase()) ?? false
          }
        >
          {field.options.map(option => (
            <Option key={option.value} value={option.value}>
              {option.label}
            </Option>
          ))}
        </Select>
      );
    } else if (fieldType === 'nested' && field.nested_fields) {
      // 嵌套字段类型，展开显示子字段
      return (
        <div key={fieldKey}>
          <Row style={{ marginBottom: 16, alignItems: 'center' }}>
            <Col span={24}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 16, color: '#1890ff', borderBottom: '1px solid #e6f7ff', paddingBottom: '8px' }}>
                {field.display}
              </div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                {field.name}
              </div>
              {field.description && (
                <div style={{ fontSize: 11, color: '#999', marginBottom: 12 }}>
                  {field.description}
                </div>
              )}
            </Col>
          </Row>
          <div style={{ paddingLeft: 20, borderLeft: '2px solid #f0f0f0' }}>
            {field.nested_fields.map(nestedField => {
              const nestedFieldKey = `${fieldKey}.${nestedField.name}`;
              const nestedFieldType = nestedField.type || typeof nestedField.default;
              
              let nestedInputComponent;
              let nestedValuePropName = 'value';
              
              if (nestedFieldType === 'boolean') {
                nestedInputComponent = <Switch />;
                nestedValuePropName = 'checked';
              } else if (nestedFieldType === 'number') {
                nestedInputComponent = <InputNumber style={{ width: '100%', textAlign: 'center' }} />;
              } else if (nestedFieldType === 'select' && nestedField.options) {
                nestedInputComponent = (
                  <Select 
                    showSearch
                    allowClear
                    style={{ width: '100%', textAlign: 'center' }} 
                    placeholder="请选择或输入选项"
                    listHeight={320}
                    filterOption={(input, option) =>
                      option?.children?.toString().toLowerCase().includes(input.toLowerCase()) ?? false
                    }
                  >
                    {nestedField.options.map(option => (
                      <Option key={option.value} value={option.value}>
                        {option.label}
                      </Option>
                    ))}
                  </Select>
                );
              } else {
                nestedInputComponent = <Input style={{ textAlign: 'center' }} />;
              }
              
              return (
                <Row key={nestedFieldKey} style={{ marginBottom: 12, alignItems: 'center', minHeight: '60px' }}>
                  <Col span={12}>
                    <div style={{ 
                      paddingRight: 24, 
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      height: '100%',
                      borderRight: '1px solid #f0f0f0'
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: '14px', color: '#262626' }}>
                        {nestedField.display}
                      </div>
                      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4, fontFamily: 'monospace' }}>
                        {nestedField.name}
                      </div>
                      {nestedField.description && (
                        <div style={{ fontSize: 11, color: '#bfbfbf', lineHeight: 1.4, maxWidth: '200px', margin: '0 auto' }}>
                          {nestedField.description}
                        </div>
                      )}
                    </div>
                  </Col>
                  <Col span={12}>
                    <div style={{ 
                      paddingLeft: 24,
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '100%'
                    }}>
                      <Form.Item
                        name={nestedFieldKey}
                        valuePropName={nestedValuePropName}
                        style={{ marginBottom: 0, width: '80%' }}
                      >
                        {nestedInputComponent}
                      </Form.Item>
                    </div>
                  </Col>
                </Row>
              );
            })}
          </div>
        </div>
      );
    } else {
      inputComponent = <Input style={{ textAlign: 'center' }} />;
    }
    
    return (
      <Row key={fieldKey} style={{ marginBottom: 20, alignItems: 'center', minHeight: '80px', borderBottom: '1px solid #f5f5f5', paddingBottom: '16px' }}>
        <Col span={12}>
          <div style={{ 
            paddingRight: 24, 
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            height: '100%',
            borderRight: '2px solid #f0f0f0'
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '16px', color: '#262626' }}>
              {field.display}
            </div>
            <div style={{ fontSize: 13, color: '#8c8c8c', marginBottom: 6, fontFamily: 'monospace', backgroundColor: '#f8f8f8', padding: '2px 8px', borderRadius: '4px', display: 'inline-block' }}>
              {field.name}
            </div>
            {field.description && (
              <div style={{ fontSize: 12, color: '#bfbfbf', lineHeight: 1.5, maxWidth: '280px', margin: '0 auto', textAlign: 'center' }}>
                {field.description}
              </div>
            )}
          </div>
        </Col>
        <Col span={12}>
          <div style={{ 
            paddingLeft: 24,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%'
          }}>
            <Form.Item
              name={fieldKey}
              valuePropName={valuePropName}
              style={{ marginBottom: 0, width: '80%' }}
            >
              {inputComponent}
            </Form.Item>
          </div>
        </Col>
      </Row>
    );
  };

  // 回到顶端功能
  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  // 监听滚动事件，控制回到顶端按钮显示
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.pageYOffset > 300);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 组件初始化
  useEffect(() => {
    loadServers();
    loadGameConfigs();
  }, []);

  // 当选择配置文件时，加载模板
  useEffect(() => {
    if (selectedConfig) {
      loadConfigSchema(selectedConfig);
    }
  }, [selectedConfig]);

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2}>
        <SettingOutlined /> 游戏配置文件管理
      </Title>
      
      <Alert
        message="配置文件管理说明"
        description="选择服务端和配置文件类型，然后读取现有配置进行可视化编辑。支持多种配置文件格式的解析和保存。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Card title="基本设置" style={{ marginBottom: 24 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="选择服务端">
              <Select
                showSearch
                allowClear
                placeholder="请选择或输入服务端名称"
                value={selectedServer}
                onChange={setSelectedServer}
                style={{ width: '100%' }}
                listHeight={320}
                filterOption={(input, option) =>
                  option?.children?.toString().toLowerCase().includes(input.toLowerCase()) ?? false
                }
              >
                {servers.map(server => (
                  <Option key={server.id} value={server.id}>
                    {server.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          
          <Col span={12}>
            <Form.Item label="配置文件类型">
              <Select
                showSearch
                allowClear
                placeholder="请选择或输入配置文件类型"
                value={selectedConfig}
                onChange={setSelectedConfig}
                style={{ width: '100%' }}
                listHeight={320}
                filterOption={(input, option) =>
                  option?.children?.toString().toLowerCase().includes(input.toLowerCase()) ?? false
                }
              >
                {gameConfigs.map(config => (
                  <Option key={config.id} value={config.id}>
                    {config.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>
        
        <Space>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={loadConfigData}
            loading={loading}
            disabled={!selectedServer || !selectedConfig}
          >
            读取配置文件
          </Button>
          
          <Button
            type="default"
            icon={<SaveOutlined />}
            onClick={saveConfigData}
            loading={saving}
            disabled={!configSchema || !configData}
          >
            保存配置文件
          </Button>
          
          <Button
            type="default"
            icon={<UndoOutlined />}
            onClick={resetToDefaults}
            disabled={!configSchema}
          >
            恢复默认值
          </Button>
        </Space>
      </Card>

      {configSchema && (
        <Card 
          title={`${configSchema.meta.game_name} - 配置编辑`}
          extra={
            <Tooltip title={`配置文件路径: ${configSchema.meta.config_file}`}>
              <InfoCircleOutlined />
            </Tooltip>
          }
        >
          <Spin spinning={loading}>
            <Form
              form={form}
              layout="vertical"
              onFinish={saveConfigData}
            >
              {configSchema.sections.map((section, sectionIndex) => (
                <div key={section.key}>
                  {sectionIndex > 0 && <Divider />}
                  <Title level={4}>{section.name || section.key}</Title>
                  
                  <div>
                    {section.fields.map((field, fieldIndex) => 
                      renderConfigField(section, field)
                    )}
                  </div>
                </div>
              ))}
            </Form>
          </Spin>
        </Card>
      )}
      
      {!configSchema && (
        <Card>
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Text type="secondary">
              请选择服务端和配置文件，然后点击"读取配置文件"开始编辑
            </Text>
          </div>
        </Card>
      )}

      {/* 回到顶端按钮 */}
      {showBackToTop && (
        <div
          style={{
            position: 'fixed',
            bottom: '50px',
            right: '50px',
            zIndex: 1000,
            cursor: 'pointer'
          }}
        >
          <Button
            type="primary"
            shape="circle"
            size="large"
            icon={<UpOutlined />}
            onClick={scrollToTop}
            style={{
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              backgroundColor: '#1890ff',
              borderColor: '#1890ff'
            }}
            title="回到顶端"
          />
        </div>
      )}
    </div>
  );
};

export default GameConfigManager;