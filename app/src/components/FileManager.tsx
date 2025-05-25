import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Table, Button, Input, Modal, Form, 
  Space, message, Breadcrumb, Menu, Dropdown, 
  Tooltip, Typography, Spin, Upload, Image
} from 'antd';
import { 
  FileOutlined, FolderOutlined, 
  EditOutlined, CopyOutlined, 
  ScissorOutlined, DeleteOutlined, 
  DownloadOutlined, UploadOutlined, 
  SaveOutlined, ArrowUpOutlined,
  FileAddOutlined, FolderAddOutlined,
  InboxOutlined, EyeOutlined, FileImageOutlined
} from '@ant-design/icons';
import axios from 'axios';

const { TextArea } = Input;
const { Text } = Typography;
const { Dragger } = Upload;

interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

interface ClipboardItem {
  path: string;
  type: 'file' | 'directory';
  operation: 'copy' | 'cut';
}

interface ContextMenuPosition {
  x: number;
  y: number;
  visible: boolean;
}

interface FileManagerProps {
  initialPath?: string;
}

const FileManager: React.FC<FileManagerProps> = ({ initialPath = '/home/steam' }) => {
  const [currentPath, setCurrentPath] = useState<string>(initialPath || '/home/steam');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileInfo[]>([]);
  const [fileContent, setFileContent] = useState<string>('');
  const [isEditModalVisible, setIsEditModalVisible] = useState<boolean>(false);
  const [isRenameModalVisible, setIsRenameModalVisible] = useState<boolean>(false);
  const [isPreviewModalVisible, setIsPreviewModalVisible] = useState<boolean>(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string>('');
  const [newFileName, setNewFileName] = useState<string>('');
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(null);
  const [isNewFolderModalVisible, setIsNewFolderModalVisible] = useState<boolean>(false);
  const [isNewFileModalVisible, setIsNewFileModalVisible] = useState<boolean>(false);
  const [isUploadModalVisible, setIsUploadModalVisible] = useState<boolean>(false);
  const [newItemName, setNewItemName] = useState<string>('');
  const [breadcrumbItems, setBreadcrumbItems] = useState<{ path: string; title: string }[]>([]);
  const downloadLinkRef = useRef<HTMLAnchorElement>(null);
  // 右键菜单状态
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition>({
    x: 0,
    y: 0,
    visible: false
  });
  const [contextMenuFile, setContextMenuFile] = useState<FileInfo | null>(null);
  // 空白区域右键菜单状态
  const [blankContextMenuPosition, setBlankContextMenuPosition] = useState<ContextMenuPosition>({
    x: 0,
    y: 0,
    visible: false
  });
  // 添加分页状态
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
  });

  // 创建函数引用，避免循环依赖
  const copyToClipboardRef = useRef<(file: FileInfo) => void>();
  const cutToClipboardRef = useRef<(file: FileInfo) => void>();
  const pasteFromClipboardRef = useRef<() => void>();
  const loadDirectoryRef = useRef<(path: string) => void>();

  // 创建包含认证信息的请求头
  const getHeaders = () => {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // 处理右键菜单显示
  const handleContextMenu = (e: React.MouseEvent, file: FileInfo) => {
    e.preventDefault();
    e.stopPropagation();
    // 设置选中的文件
    setSelectedFile(file);
    // 同时更新多选列表，如果当前文件不在已选中列表中，则清空已选中列表并只选中当前文件
    if (!selectedFiles.some(item => item.path === file.path)) {
      setSelectedFiles([file]);
    }
    setContextMenuFile(file);
    setContextMenuPosition({
      x: e.clientX,
      y: e.clientY,
      visible: true
    });
    // 隐藏空白区域右键菜单
    setBlankContextMenuPosition(prev => ({ ...prev, visible: false }));
  };

  // 处理空白区域右键菜单
  const handleBlankContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // 确保点击的是空白区域，而不是表格行
    if ((e.target as HTMLElement).closest('tr')) {
      return;
    }
    
    setBlankContextMenuPosition({
      x: e.clientX,
      y: e.clientY,
      visible: true
    });
    // 隐藏文件右键菜单
    setContextMenuPosition(prev => ({ ...prev, visible: false }));
  };

  // 隐藏所有右键菜单
  const hideAllContextMenus = () => {
    setContextMenuPosition(prev => ({ ...prev, visible: false }));
    setBlankContextMenuPosition(prev => ({ ...prev, visible: false }));
  };

  // 在组件加载时添加点击事件监听器，用于隐藏右键菜单
  useEffect(() => {
    const handleClick = () => {
      hideAllContextMenus();
    };

    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, []);

  // 添加键盘事件监听器
  useEffect(() => {
    // 在 useEffect 内部定义处理函数，避免循环依赖
    const handleKeyboardShortcuts = (e: KeyboardEvent) => {
      // 如果有模态框打开，不处理快捷键
      if (isEditModalVisible || isRenameModalVisible || isPreviewModalVisible || 
          isNewFolderModalVisible || isNewFileModalVisible || isUploadModalVisible) {
        return;
      }

      // 只有当按下Ctrl键时才处理
      if (e.ctrlKey) {
        switch (e.key.toLowerCase()) {
          case 'c': // Ctrl+C: 复制
            e.preventDefault();
            if (selectedFiles.length > 0 && copyToClipboardRef.current) {
              // 目前只支持复制单个文件，所以只复制第一个选中的文件
              copyToClipboardRef.current(selectedFiles[0]);
            }
            break;
          case 'x': // Ctrl+X: 剪切
            e.preventDefault();
            if (selectedFiles.length > 0 && cutToClipboardRef.current) {
              // 目前只支持剪切单个文件，所以只剪切第一个选中的文件
              cutToClipboardRef.current(selectedFiles[0]);
            }
            break;
          case 'v': // Ctrl+V: 粘贴
            e.preventDefault();
            if (clipboard && pasteFromClipboardRef.current) {
              pasteFromClipboardRef.current();
            } else {
              message.info('剪贴板为空');
            }
            break;
          default:
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, [
    selectedFiles, 
    clipboard, 
    isEditModalVisible, 
    isRenameModalVisible, 
    isPreviewModalVisible, 
    isNewFolderModalVisible, 
    isNewFileModalVisible, 
    isUploadModalVisible
  ]);

  // 检查文件是否为图片
  const isImageFile = (filename: string): boolean => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    const lowerFilename = filename.toLowerCase();
    return imageExtensions.some(ext => lowerFilename.endsWith(ext));
  };

  // 更新面包屑导航
  const updateBreadcrumb = useCallback((path: string) => {
    const parts = path.split('/').filter(part => part);
    let items = [{ path: '/', title: '根目录' }];
    
    let currentPath = '';
    parts.forEach(part => {
      currentPath += `/${part}`;
      items.push({
        path: currentPath,
        title: part
      });
    });
    
    setBreadcrumbItems(items);
  }, []);

  // 加载目录内容
  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const response = await axios.get(`/api/files`, {
        params: { path }
      });
      
      if (response.data.status === 'success') {
        setFiles(response.data.files || []);
        // 使用服务器返回的实际路径，它可能与请求的路径不同
        const actualPath = response.data.path || path;
        setCurrentPath(actualPath);
        
        // 更新面包屑
        const parts = actualPath.split('/').filter(part => part);
        let items = [{ path: '/', title: '根目录' }];
        
        let currentBreadcrumbPath = '';
        parts.forEach(part => {
          currentBreadcrumbPath += `/${part}`;
          items.push({
            path: currentBreadcrumbPath,
            title: part
          });
        });
        
        setBreadcrumbItems(items);
        
        // 切换目录时重置分页到第一页，但保留页面大小
        setPagination(prev => ({
          ...prev,
          current: 1
        }));
        
        // 如果服务器返回了消息，显示提示
        if (response.data.message) {
          message.info(response.data.message);
        }
      } else {
        message.error(response.data.message || '无法加载目录');
        // 如果路径无效，尝试导航到上一级目录
        const parentPath = path.split('/').slice(0, -1).join('/') || '/';
        if (parentPath !== path) {
          loadDirectory(parentPath);
        } else {
          loadDirectory('/');
        }
      }
    } catch (error: any) {
      message.error(`加载目录失败: ${error.message}`);
      // 如果发生错误，尝试导航到上一级目录
      const parentPath = path.split('/').slice(0, -1).join('/') || '/';
      if (parentPath !== path) {
        loadDirectory(parentPath);
      } else {
        loadDirectory('/');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // 更新loadDirectoryRef
  loadDirectoryRef.current = loadDirectory;

  // 复制文件/文件夹到剪贴板
  const copyToClipboard = useCallback((file: FileInfo) => {
    setClipboard({
      path: file.path,
      type: file.type,
      operation: 'copy'
    });
    message.success(`已复制${file.type === 'file' ? '文件' : '文件夹'} "${file.name}"`);
  }, []);

  // 更新copyToClipboardRef
  copyToClipboardRef.current = copyToClipboard;

  // 剪切文件/文件夹到剪贴板
  const cutToClipboard = useCallback((file: FileInfo) => {
    setClipboard({
      path: file.path,
      type: file.type,
      operation: 'cut'
    });
    message.success(`已剪切${file.type === 'file' ? '文件' : '文件夹'} "${file.name}"`);
  }, []);

  // 更新cutToClipboardRef
  cutToClipboardRef.current = cutToClipboard;

  // 粘贴文件/文件夹
  const pasteFromClipboard = useCallback(async () => {
    if (!clipboard) return;
    
    const fileName = clipboard.path.split('/').pop() || '';
    const destinationPath = `${currentPath}/${fileName}`;
    
    setLoading(true);
    try {
      const response = await axios.post(`/api/${clipboard.operation === 'copy' ? 'copy' : 'move'}`, {
        sourcePath: clipboard.path,
        destinationPath
      });
      
      if (response.data.status === 'success') {
        message.success(`${clipboard.type === 'file' ? '文件' : '文件夹'}已${clipboard.operation === 'copy' ? '复制' : '移动'}`);
        
        // 如果是剪切操作，清空剪贴板
        if (clipboard.operation === 'cut') {
          setClipboard(null);
        }
        
        if (loadDirectoryRef.current) {
          loadDirectoryRef.current(currentPath);
        }
      } else {
        message.error(response.data.message || `${clipboard.operation === 'copy' ? '复制' : '移动'}失败`);
      }
    } catch (error: any) {
      message.error(`${clipboard.operation === 'copy' ? '复制' : '移动'}失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [clipboard, currentPath]);

  // 更新pasteFromClipboardRef
  pasteFromClipboardRef.current = pasteFromClipboard;

  // 导航到目录
  const navigateToDirectory = useCallback((path: string) => {
    if (loadDirectoryRef.current) {
      loadDirectoryRef.current(path);
    }
  }, []);

  // 返回上级目录
  const navigateUp = useCallback(() => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateToDirectory(parentPath);
  }, [currentPath, navigateToDirectory]);

  // 当initialPath变化时重新加载目录
  useEffect(() => {
    if (initialPath && loadDirectoryRef.current) {
      loadDirectoryRef.current(initialPath);
    } else if (loadDirectoryRef.current) {
      // 如果initialPath为空或无效，默认到/home/steam
      loadDirectoryRef.current('/home/steam');
    }
  }, [initialPath]);

  // 初始加载
  useEffect(() => {
    if (currentPath && loadDirectoryRef.current) {
      loadDirectoryRef.current(currentPath);
    } else if (loadDirectoryRef.current) {
      // 如果currentPath为空或无效，默认到/home/steam
      loadDirectoryRef.current('/home/steam');
    }
  }, []);

  // 打开文件进行编辑
  const openFileForEdit = async (file: FileInfo) => {
    if (file.type !== 'file') return;
    
    // 如果是图片文件，打开预览而不是编辑
    if (isImageFile(file.name)) {
      previewImage(file);
      return;
    }
    
    setLoading(true);
    try {
      const response = await axios.get(`/api/file_content`, {
        params: { path: file.path }
      });
      
      if (response.data.status === 'success') {
        setFileContent(response.data.content || '');
        setSelectedFile(file);
        setIsEditModalVisible(true);
      } else {
        message.error(response.data.message || '无法读取文件内容');
      }
    } catch (error: any) {
      message.error(`读取文件失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 预览图片
  const previewImage = (file: FileInfo) => {
    if (file.type !== 'file' || !isImageFile(file.name)) return;
    
    // 获取认证令牌
    const token = localStorage.getItem('auth_token');
    
    // 使用完整URL而不是相对路径
    const imageUrl = `${window.location.protocol}//${window.location.host}/api/download?path=${encodeURIComponent(file.path)}&preview=true${token ? `&token=${token}` : ''}`;
    setPreviewImageUrl(imageUrl);
    setSelectedFile(file);
    setIsPreviewModalVisible(true);
  };

  // 保存文件内容
  const saveFile = async () => {
    if (!selectedFile) return;
    
    setLoading(true);
    try {
      const response = await axios.post(`/api/save_file`, {
        path: selectedFile.path,
        content: fileContent
      });
      
      if (response.data.status === 'success') {
        message.success('文件已保存');
        setIsEditModalVisible(false);
        if (loadDirectoryRef.current) {
          loadDirectoryRef.current(currentPath); // 刷新目录
        }
      } else {
        message.error(response.data.message || '保存文件失败');
      }
    } catch (error: any) {
      message.error(`保存文件失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 重命名文件/文件夹
  const renameItem = async () => {
    if (!selectedFile || !newFileName) return;
    
    const newPath = `${currentPath}/${newFileName}`;
    
    setLoading(true);
    try {
      const response = await axios.post(`/api/rename`, {
        oldPath: selectedFile.path,
        newPath
      });
      
      if (response.data.status === 'success') {
        message.success(`${selectedFile.type === 'file' ? '文件' : '文件夹'}已重命名`);
        setIsRenameModalVisible(false);
        if (loadDirectoryRef.current) {
          loadDirectoryRef.current(currentPath);
        }
      } else {
        message.error(response.data.message || '重命名失败');
      }
    } catch (error: any) {
      message.error(`重命名失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 删除文件/文件夹
  const deleteItem = async (file: FileInfo) => {
    Modal.confirm({
      title: `确定要删除${file.type === 'file' ? '文件' : '文件夹'} "${file.name}"吗?`,
      content: '此操作不可恢复',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setLoading(true);
        try {
          const response = await axios.post(`/api/delete`, {
            path: file.path,
            type: file.type
          });
          
          if (response.data.status === 'success') {
            message.success(`${file.type === 'file' ? '文件' : '文件夹'}已删除`);
            if (loadDirectoryRef.current) {
              loadDirectoryRef.current(currentPath);
            }
          } else {
            message.error(response.data.message || '删除失败');
          }
        } catch (error: any) {
          message.error(`删除失败: ${error.message}`);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  // 创建新文件夹
  const createNewFolder = async () => {
    if (!newItemName) return;
    
    const folderPath = `${currentPath}/${newItemName}`;
    
    setLoading(true);
    try {
      const response = await axios.post(`/api/create_folder`, {
        path: folderPath
      });
      
      if (response.data.status === 'success') {
        message.success('文件夹已创建');
        setIsNewFolderModalVisible(false);
        setNewItemName('');
        if (loadDirectoryRef.current) {
          loadDirectoryRef.current(currentPath);
        }
      } else {
        message.error(response.data.message || '创建文件夹失败');
      }
    } catch (error: any) {
      message.error(`创建文件夹失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 创建新文件
  const createNewFile = async () => {
    if (!newItemName) return;
    
    const filePath = `${currentPath}/${newItemName}`;
    
    setLoading(true);
    try {
      const response = await axios.post(`/api/save_file`, {
        path: filePath,
        content: ''
      });
      
      if (response.data.status === 'success') {
        message.success('文件已创建');
        setIsNewFileModalVisible(false);
        setNewItemName('');
        if (loadDirectoryRef.current) {
          loadDirectoryRef.current(currentPath);
        }
      } else {
        message.error(response.data.message || '创建文件失败');
      }
    } catch (error: any) {
      message.error(`创建文件失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 下载文件
  const downloadFile = (file: FileInfo) => {
    if (file.type !== 'file') return;
    
    // 获取认证令牌
    const token = localStorage.getItem('auth_token');
    
    // 创建下载链接，使用完整URL而不是相对路径
    const downloadUrl = `${window.location.protocol}//${window.location.host}/api/download?path=${encodeURIComponent(file.path)}${token ? `&token=${token}` : ''}`;
    
    if (downloadLinkRef.current) {
      downloadLinkRef.current.href = downloadUrl;
      downloadLinkRef.current.download = file.name;
      downloadLinkRef.current.click();
    } else {
      // 如果ref不可用，创建一个临时链接
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // 下载多个文件
  const downloadMultipleFiles = () => {
    if (selectedFiles.length === 0) {
      message.warning('请选择要下载的文件');
      return;
    }
    
    if (selectedFiles.length === 1 && selectedFiles[0].type === 'file') {
      // 如果只选择了一个文件，直接下载
      downloadFile(selectedFiles[0]);
      return;
    }
    
    // 多个文件或文件夹，先压缩再下载
    setLoading(true);
    
    // 构建要压缩的文件路径列表
    const paths = selectedFiles.map(file => file.path);
    
    axios.post('/api/compress', { paths, currentPath })
      .then(response => {
        if (response.data.status === 'success') {
          const zipPath = response.data.zipPath;
          const zipName = zipPath.split('/').pop() || 'download.zip';
          
          // 获取认证令牌
          const token = localStorage.getItem('auth_token');
          
          // 下载压缩文件，使用完整URL而不是相对路径
          const downloadUrl = `${window.location.protocol}//${window.location.host}/api/download?path=${encodeURIComponent(zipPath)}${token ? `&token=${token}` : ''}`;
          
          if (downloadLinkRef.current) {
            downloadLinkRef.current.href = downloadUrl;
            downloadLinkRef.current.download = zipName;
            downloadLinkRef.current.click();
          } else {
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = zipName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
          
          // 下载完成后删除临时文件
          setTimeout(() => {
            axios.post('/api/delete', {
              path: zipPath,
              type: 'file'
            }).catch(error => {
              // 忽略错误，不打印到控制台
            });
          }, 5000);
        } else {
          message.error(response.data.message || '压缩文件失败');
        }
      })
      .catch(error => {
        message.error(`压缩文件失败: ${error.message}`);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  // 处理表格选择
  const rowSelection = {
    selectedRowKeys: selectedFiles.map(file => file.path),
    onChange: (selectedRowKeys: React.Key[], selectedRows: FileInfo[]) => {
      setSelectedFiles(selectedRows);
    },
  };

  // 格式化文件大小
  const formatFileSize = (size: number): string => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // 获取文件图标
  const getFileIcon = (file: FileInfo) => {
    if (file.type === 'directory') {
      return <FolderOutlined style={{ color: '#1890ff' }} />;
    } else if (isImageFile(file.name)) {
      return <FileImageOutlined style={{ color: '#52c41a' }} />;
    } else {
      return <FileOutlined />;
    }
  };

  // 表格列定义
  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: FileInfo) => (
        <Space>
          {getFileIcon(record)}
          <span 
            className={record.type === 'directory' ? 'directory-name' : 'file-name'}
            onClick={() => record.type === 'directory' ? navigateToDirectory(record.path) : openFileForEdit(record)}
          >
            {text}
          </span>
        </Space>
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => type === 'directory' ? '文件夹' : '文件'
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      render: (size: number) => formatFileSize(size)
    },
    {
      title: '修改时间',
      dataIndex: 'modified',
      key: 'modified'
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record: FileInfo) => (
        <Space size="small">
          {record.type === 'file' && (
            <>
              <Tooltip title="编辑">
                <Button 
                  type="text" 
                  icon={<EditOutlined />} 
                  onClick={() => openFileForEdit(record)} 
                />
              </Tooltip>
              {isImageFile(record.name) && (
                <Tooltip title="预览">
                  <Button 
                    type="text" 
                    icon={<EyeOutlined />} 
                    onClick={() => previewImage(record)} 
                  />
                </Tooltip>
              )}
            </>
          )}
          <Tooltip title="复制">
            <Button 
              type="text" 
              icon={<CopyOutlined />} 
              onClick={() => copyToClipboard(record)} 
            />
          </Tooltip>
          <Tooltip title="剪切">
            <Button 
              type="text" 
              icon={<ScissorOutlined />} 
              onClick={() => cutToClipboard(record)} 
            />
          </Tooltip>
          <Tooltip title="重命名">
            <Button 
              type="text" 
              icon={<EditOutlined />} 
              onClick={() => {
                setSelectedFile(record);
                setNewFileName(record.name);
                setIsRenameModalVisible(true);
              }} 
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button 
              type="text" 
              danger 
              icon={<DeleteOutlined />} 
              onClick={() => deleteItem(record)} 
            />
          </Tooltip>
        </Space>
      )
    }
  ];

  return (
    <div className="file-manager" style={{paddingBottom: '50px'}}>
      <div className="file-manager-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button 
            icon={<ArrowUpOutlined />} 
            onClick={navigateUp}
            disabled={currentPath === '/'}
          >
            上级目录
          </Button>
          <Button 
            icon={<FolderAddOutlined />} 
            onClick={() => setIsNewFolderModalVisible(true)}
          >
            新建文件夹
          </Button>
          <Button 
            icon={<FileAddOutlined />} 
            onClick={() => setIsNewFileModalVisible(true)}
          >
            新建文件
          </Button>
          <Button 
            icon={<DownloadOutlined />} 
            disabled={selectedFiles.length === 0}
            onClick={downloadMultipleFiles}
          >
            下载
          </Button>
          <Button 
            icon={<UploadOutlined />}
            onClick={() => setIsUploadModalVisible(true)}
          >
            上传
          </Button>
          <Button 
            icon={<SaveOutlined />} 
            disabled={!clipboard}
            onClick={pasteFromClipboard}
          >
            粘贴
          </Button>
        </Space>
        <div style={{ fontSize: '12px', color: '#888' }}>
          支持快捷键：Ctrl+C 复制 | Ctrl+X 剪切 | Ctrl+V 粘贴
        </div>
      </div>

      <Breadcrumb style={{ margin: '16px 0' }}>
        {breadcrumbItems.map((item, index) => (
          <Breadcrumb.Item key={index} onClick={() => navigateToDirectory(item.path)}>
            <a>{item.title}</a>
          </Breadcrumb.Item>
        ))}
      </Breadcrumb>

      <div className="file-manager-content">
        {loading ? (
          <div className="loading-container">
            <Spin size="large" />
          </div>
        ) : (
          <div onContextMenu={handleBlankContextMenu}>
            <Table 
              rowSelection={{
                type: 'checkbox',
                ...rowSelection,
              }}
              columns={columns} 
              dataSource={files.map(file => ({ ...file, key: file.path }))} 
              pagination={{ 
                current: pagination.current,
                pageSize: pagination.pageSize,
                showSizeChanger: true,
                pageSizeOptions: ['10', '20', '50', '100'],
                showTotal: (total) => `共 ${total} 项`,
                style: { marginBottom: '30px', padding: '10px 0' },
                onChange: (current: number, pageSize: number) => {
                  setPagination({ current, pageSize });
                },
                onShowSizeChange: (current: number, size: number) => {
                  setPagination({
                    current: 1, // 改变每页显示数量时，通常会跳转到第一页
                    pageSize: size
                  });
                }
              }}
              size="middle"
              scroll={{ y: 'calc(100vh - 420px)' }}
              onRow={(record: FileInfo) => ({
                onClick: () => {
                  setSelectedFile(record);
                  // 如果按住Ctrl键，则添加到多选列表
                  if (window.event && (window.event as any).ctrlKey) {
                    const isSelected = selectedFiles.some(file => file.path === record.path);
                    if (isSelected) {
                      setSelectedFiles(selectedFiles.filter(file => file.path !== record.path));
                    } else {
                      setSelectedFiles([...selectedFiles, record]);
                    }
                  } else {
                    // 否则只选中当前文件
                    setSelectedFiles([record]);
                  }
                },
                onDoubleClick: () => {
                  if (record.type === 'directory') {
                    navigateToDirectory(record.path);
                  } else {
                    openFileForEdit(record);
                  }
                },
                onContextMenu: (e) => handleContextMenu(e, record),
                className: selectedFiles.some(file => file.path === record.path) ? 'selected-row' : ''
              })}
            />
          </div>
        )}
      </div>

      {/* 文件右键菜单 */}
      {contextMenuPosition.visible && contextMenuFile && (
        <div 
          className="context-menu"
          style={{
            position: 'fixed',
            top: contextMenuPosition.y,
            left: contextMenuPosition.x,
            zIndex: 1000
          }}
        >
          <Menu>
            {contextMenuFile.type === 'directory' ? (
              <Menu.Item key="open" onClick={() => {
                navigateToDirectory(contextMenuFile.path);
                hideAllContextMenus();
              }}>
                打开文件夹
              </Menu.Item>
            ) : (
              <>
                <Menu.Item key="edit" onClick={() => {
                  openFileForEdit(contextMenuFile);
                  hideAllContextMenus();
                }}>
                  编辑
                </Menu.Item>
                {isImageFile(contextMenuFile.name) && (
                  <Menu.Item key="preview" onClick={() => {
                    previewImage(contextMenuFile);
                    hideAllContextMenus();
                  }}>
                    预览
                  </Menu.Item>
                )}
                <Menu.Item key="download" onClick={() => {
                  downloadFile(contextMenuFile);
                  hideAllContextMenus();
                }}>
                  下载
                </Menu.Item>
              </>
            )}
            <Menu.Divider />
            <Menu.Item key="copy" onClick={() => {
              copyToClipboard(contextMenuFile);
              hideAllContextMenus();
            }}>
              复制
            </Menu.Item>
            <Menu.Item key="cut" onClick={() => {
              cutToClipboard(contextMenuFile);
              hideAllContextMenus();
            }}>
              剪切
            </Menu.Item>
            <Menu.Item key="rename" onClick={() => {
              setSelectedFile(contextMenuFile);
              setNewFileName(contextMenuFile.name);
              setIsRenameModalVisible(true);
              hideAllContextMenus();
            }}>
              重命名
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item key="delete" danger onClick={() => {
              deleteItem(contextMenuFile);
              hideAllContextMenus();
            }}>
              删除
            </Menu.Item>
          </Menu>
        </div>
      )}

      {/* 空白区域右键菜单 */}
      {blankContextMenuPosition.visible && (
        <div 
          className="context-menu"
          style={{
            position: 'fixed',
            top: blankContextMenuPosition.y,
            left: blankContextMenuPosition.x,
            zIndex: 1000
          }}
        >
          <Menu>
            <Menu.Item key="new-folder" onClick={() => {
              setIsNewFolderModalVisible(true);
              hideAllContextMenus();
            }}>
              新建文件夹
            </Menu.Item>
            <Menu.Item key="new-file" onClick={() => {
              setIsNewFileModalVisible(true);
              hideAllContextMenus();
            }}>
              新建文件
            </Menu.Item>
            <Menu.Item key="upload" onClick={() => {
              setIsUploadModalVisible(true);
              hideAllContextMenus();
            }}>
              上传文件
            </Menu.Item>
            {clipboard && (
              <Menu.Item key="paste" onClick={() => {
                pasteFromClipboard();
                hideAllContextMenus();
              }}>
                粘贴
              </Menu.Item>
            )}
            <Menu.Item key="refresh" onClick={() => {
              loadDirectory(currentPath);
              hideAllContextMenus();
            }}>
              刷新
            </Menu.Item>
          </Menu>
        </div>
      )}

      {/* 隐藏的下载链接 */}
      <a
        ref={downloadLinkRef}
        style={{ display: 'none' }}
      />

      {/* 文件编辑对话框 */}
      <Modal
        title={`编辑文件: ${selectedFile?.name}`}
        visible={isEditModalVisible}
        onCancel={() => setIsEditModalVisible(false)}
        onOk={saveFile}
        width={800}
        okText="保存"
        cancelText="取消"
        bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
      >
        <TextArea
          value={fileContent}
          onChange={(e) => setFileContent(e.target.value)}
          autoSize={{ minRows: 20, maxRows: 30 }}
        />
      </Modal>

      {/* 图片预览对话框 */}
      <Modal
        title={`预览图片: ${selectedFile?.name}`}
        visible={isPreviewModalVisible}
        onCancel={() => setIsPreviewModalVisible(false)}
        footer={null}
        width={800}
        centered
        bodyStyle={{ textAlign: 'center', padding: '20px' }}
      >
        <div className="image-preview-container">
          <Image
            src={previewImageUrl}
            alt={selectedFile?.name || '图片预览'}
            style={{ maxWidth: '100%' }}
            preview={false}
          />
          <div className="image-preview-actions" style={{ marginTop: '16px' }}>
            <Button 
              type="primary" 
              onClick={() => selectedFile && downloadFile(selectedFile)}
              icon={<DownloadOutlined />}
              style={{ marginRight: '8px' }}
            >
              下载图片
            </Button>
            <Button 
              onClick={() => window.open(previewImageUrl, '_blank')}
              icon={<EyeOutlined />}
            >
              在新窗口打开
            </Button>
          </div>
        </div>
      </Modal>

      {/* 重命名对话框 */}
      <Modal
        title={`重命名${selectedFile?.type === 'file' ? '文件' : '文件夹'}`}
        visible={isRenameModalVisible}
        onCancel={() => setIsRenameModalVisible(false)}
        onOk={renameItem}
        okText="确定"
        cancelText="取消"
      >
        <Form layout="vertical">
          <Form.Item label="新名称">
            <Input 
              value={newFileName} 
              onChange={(e) => setNewFileName(e.target.value)} 
              autoFocus 
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 新建文件夹对话框 */}
      <Modal
        title="新建文件夹"
        visible={isNewFolderModalVisible}
        onCancel={() => {
          setIsNewFolderModalVisible(false);
          setNewItemName('');
        }}
        onOk={createNewFolder}
        okText="创建"
        cancelText="取消"
      >
        <Form layout="vertical">
          <Form.Item label="文件夹名称">
            <Input 
              value={newItemName} 
              onChange={(e) => setNewItemName(e.target.value)} 
              autoFocus 
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 新建文件对话框 */}
      <Modal
        title="新建文件"
        visible={isNewFileModalVisible}
        onCancel={() => {
          setIsNewFileModalVisible(false);
          setNewItemName('');
        }}
        onOk={createNewFile}
        okText="创建"
        cancelText="取消"
      >
        <Form layout="vertical">
          <Form.Item label="文件名称">
            <Input 
              value={newItemName} 
              onChange={(e) => setNewItemName(e.target.value)} 
              autoFocus 
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 上传文件对话框 */}
      <Modal
        title="上传文件"
        visible={isUploadModalVisible}
        onCancel={() => setIsUploadModalVisible(false)}
        footer={null}
        width={600}
      >
        <Dragger
          name="file"
          multiple={true}
          action={`/api/upload?path=${encodeURIComponent(currentPath)}${localStorage.getItem('auth_token') ? `&token=${localStorage.getItem('auth_token')}` : ''}`}
          headers={getHeaders()}
          onChange={info => {
            const { status } = info.file;
            if (status === 'done') {
              message.success(`${info.file.name} 上传成功`);
              loadDirectory(currentPath); // 刷新当前目录
            } else if (status === 'error') {
              message.error(`${info.file.name} 上传失败`);
            }
          }}
          showUploadList={{ showRemoveIcon: true }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
          <p className="ant-upload-hint">
            支持单个或批量上传。当前上传目录: {currentPath}
          </p>
        </Dragger>
      </Modal>

      <style jsx>{`
        .file-manager {
          width: 100%;
          padding: 8px;
        }
        .file-manager-toolbar {
          margin-bottom: 16px;
        }
        .file-manager-content {
          background-color: white;
          border-radius: 4px;
        }
        .directory-name {
          color: #1890ff;
          cursor: pointer;
        }
        .file-name {
          cursor: pointer;
        }
        .loading-container {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 200px;
        }
        .image-preview-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .image-preview-actions {
          margin-top: 16px;
          display: flex;
          justify-content: center;
        }
        .context-menu {
          background-color: white;
          border-radius: 2px;
          box-shadow: 0 3px 6px rgba(0, 0, 0, 0.16);
          min-width: 160px;
        }
        .selected-row {
          background-color: #e6f7ff !important;
        }
        .selected-row:hover > td {
          background-color: #bae7ff !important;
        }
      `}</style>
    </div>
  );
};

export default FileManager; 