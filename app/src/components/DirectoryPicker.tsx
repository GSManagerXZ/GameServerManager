import React, { useState, useEffect } from 'react';
import { Modal, Tree, Button, Input, message, Spin } from 'antd';
import { FolderOutlined, FolderOpenOutlined, FileOutlined } from '@ant-design/icons';
import axios from 'axios';

interface DirectoryNode {
  title: string;
  key: string;
  isLeaf?: boolean;
  children?: DirectoryNode[];
  type?: 'directory' | 'file';
}

interface DirectoryPickerProps {
  visible: boolean;
  onCancel: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
  allowFileSelection?: boolean; // 新增：是否允许选择文件
}

const DirectoryPicker: React.FC<DirectoryPickerProps> = ({
  visible,
  onCancel,
  onSelect,
  initialPath = '/home/steam',
  title = '选择目录',
  allowFileSelection = false
}) => {
  const [treeData, setTreeData] = useState<DirectoryNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>(initialPath);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [manualPath, setManualPath] = useState<string>(initialPath);

  // 加载目录数据
  const loadDirectoryData = async (path: string): Promise<DirectoryNode[]> => {
    try {
      const response = await axios.get(`/api/list_files?path=${encodeURIComponent(path)}`);
      if (response.data.status === 'success') {
        const items = response.data.files.map((item: any) => ({
          title: item.name,
          key: item.path,
          isLeaf: item.type === 'file',
          children: item.type === 'directory' ? undefined : null,
          type: item.type
        }));
        
        // 如果不允许选择文件，则只返回目录
        if (!allowFileSelection) {
          return items.filter((item: DirectoryNode) => item.type === 'directory');
        }
        
        return items;
      }
      return [];
    } catch (error) {
      console.error('加载目录失败:', error);
      return [];
    }
  };

  // 初始化树数据
  const initializeTree = async () => {
    setLoading(true);
    try {
      // 构建根路径到当前路径的树结构
      const pathParts = initialPath.split('/').filter(part => part);
      const rootNode: DirectoryNode = {
        title: '/',
        key: '/',
        isLeaf: false,
        children: await loadDirectoryData('/')
      };

      let currentNode = rootNode;
      let currentPath = '';
      const keysToExpand = ['/'];

      for (const part of pathParts) {
        currentPath += '/' + part;
        keysToExpand.push(currentPath);
        
        if (currentNode.children) {
          const childNode = currentNode.children.find(child => child.key === currentPath);
          if (childNode) {
            childNode.children = await loadDirectoryData(currentPath);
            currentNode = childNode;
          }
        }
      }

      setTreeData([rootNode]);
      setExpandedKeys(keysToExpand);
    } catch (error) {
      console.error('初始化目录树失败:', error);
      message.error('初始化目录树失败');
    } finally {
      setLoading(false);
    }
  };

  // 动态加载子节点
  const onLoadData = async (node: any): Promise<void> => {
    if (node.children) {
      return;
    }

    const children = await loadDirectoryData(node.key);
    
    const updateTreeData = (list: DirectoryNode[], key: string, children: DirectoryNode[]): DirectoryNode[] => {
      return list.map(node => {
        if (node.key === key) {
          return { ...node, children };
        }
        if (node.children) {
          return { ...node, children: updateTreeData(node.children, key, children) };
        }
        return node;
      });
    };

    setTreeData(prevData => updateTreeData(prevData, node.key, children));
  };

  // 处理节点选择
  const handleSelect = (selectedKeys: React.Key[]) => {
    if (selectedKeys.length > 0) {
      const path = selectedKeys[0] as string;
      setSelectedPath(path);
      setManualPath(path);
    }
  };

  // 处理节点展开
  const onExpand = (expandedKeys: React.Key[]) => {
    setExpandedKeys(expandedKeys as string[]);
  };

  // 手动输入路径验证
  const validatePath = async (path: string): Promise<boolean> => {
    try {
      const response = await axios.get(`/api/list_files?path=${encodeURIComponent(path)}`);
      return response.data.status === 'success';
    } catch (error) {
      return false;
    }
  };

  // 确认选择
  const handleConfirm = async () => {
    if (!selectedPath) {
      const selectionType = allowFileSelection ? '文件或目录' : '目录';
      message.warning(`请选择一个${selectionType}`);
      return;
    }

    // 验证路径是否存在
    const isValid = await validatePath(selectedPath);
    if (!isValid) {
      message.error('所选路径不存在或无法访问');
      return;
    }

    onSelect(selectedPath);
  };

  // 手动输入路径后跳转
  const handleManualPathChange = async () => {
    if (!manualPath) return;
    
    const isValid = await validatePath(manualPath);
    if (!isValid) {
      message.error('路径不存在或无法访问');
      return;
    }

    setSelectedPath(manualPath);
    // 重新初始化树以显示新路径
    await initializeTree();
  };

  // 组件挂载时初始化
  useEffect(() => {
    if (visible) {
      initializeTree();
      setManualPath(initialPath);
      setSelectedPath(initialPath);
    }
  }, [visible, initialPath]);

  return (
    <Modal
      title={title}
      open={visible}
      onCancel={onCancel}
      onOk={handleConfirm}
      width={600}
      okText="确定"
      cancelText="取消"
    >
      <div style={{ marginBottom: 16 }}>
        <Input.Group compact>
          <Input
            style={{ width: 'calc(100% - 80px)' }}
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder="输入目录路径"
            onPressEnter={handleManualPathChange}
          />
          <Button 
            style={{ width: 80 }}
            onClick={handleManualPathChange}
          >
            跳转
          </Button>
        </Input.Group>
      </div>
      
      <div style={{ height: 400, overflow: 'auto', border: '1px solid #d9d9d9', padding: 8 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 50 }}>
            <Spin size="large" />
          </div>
        ) : (
          <Tree
            treeData={treeData}
            loadData={onLoadData}
            selectedKeys={[selectedPath]}
            expandedKeys={expandedKeys}
            onSelect={handleSelect}
            onExpand={onExpand}
            showIcon
            icon={({ expanded, isLeaf, type }) => {
              if (isLeaf || type === 'file') {
                return <FileOutlined />;
              }
              return expanded ? <FolderOpenOutlined /> : <FolderOutlined />;
            }}
          />
        )}
      </div>
      
      <div style={{ marginTop: 16, color: '#666' }}>
        已选择: {selectedPath}
      </div>
    </Modal>
  );
};

export default DirectoryPicker;