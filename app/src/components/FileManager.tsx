import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Table, Button, Input, Modal, Form, 
  Space, message, Breadcrumb, Menu, Dropdown, 
  Tooltip, Typography, Spin, Upload, Image, Select, Slider, InputNumber,
  Checkbox
} from 'antd';
import { 
  FileOutlined, FolderOutlined, 
  EditOutlined, CopyOutlined, 
  ScissorOutlined, DeleteOutlined, 
  DownloadOutlined, UploadOutlined, 
  SaveOutlined, ArrowUpOutlined,
  FileAddOutlined, FolderAddOutlined,
  InboxOutlined, EyeOutlined, FileImageOutlined,
  ReloadOutlined, CompressOutlined, FileZipOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons';
import axios from 'axios';
import Editor, { Monaco } from "@monaco-editor/react";
import * as monaco from 'monaco-editor';
import ReactDOM from 'react-dom';
import FileManagerHelpModal from './FileManagerHelpModal';
import Cookies from 'js-cookie';
// 导入我们自定义的monaco配置
import '../monaco-config';

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
  isVisible?: boolean; // New prop
}

const FileManager: React.FC<FileManagerProps> = ({ initialPath = '/home/steam', isVisible = true }) => {
  // 创建一个唯一的实例ID，用于识别当前组件实例
  const instanceId = useRef<string>(Math.random().toString(36).substring(2, 15));
  const isMountedRef = useRef<boolean>(false); // Initialize to false, set to true in mount effect
  
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
  // 工具栏折叠状态
  const [toolbarCollapsed, setToolbarCollapsed] = useState<boolean>(() => {
    // 从本地存储中获取工具栏折叠状态
    const savedState = localStorage.getItem('fileManagerToolbarCollapsed');
    return savedState ? JSON.parse(savedState) : false;
  });
  // 悬停状态
  const [isHovering, setIsHovering] = useState<boolean>(false);
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

  // 添加一个状态来跟踪编辑器中的语法错误
  const [syntaxErrors, setSyntaxErrors] = useState<monaco.editor.IMarker[]>([]);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // 添加状态来跟踪文件是否被修改
  const [isFileModified, setIsFileModified] = useState<boolean>(false);
  const [originalContent, setOriginalContent] = useState<string>('');
  
  // Refs to hold the latest values of frequently changing states for use in callbacks
  const selectedFilesRef = useRef(selectedFiles);
  const clipboardRef = useRef(clipboard);
  const currentPathRef = useRef(currentPath);
  const selectedFileRef = useRef(selectedFile);
  const fileContentRef = useRef(fileContent);
  const syntaxErrorsRef = useRef(syntaxErrors);

  // Ref to track the latest isVisible prop value, for debugging in shortcuts
  const isVisibleRef_debug = useRef(isVisible);

  // Effect to keep refs updated with the latest state values
  useEffect(() => { selectedFilesRef.current = selectedFiles; }, [selectedFiles]);
  useEffect(() => { clipboardRef.current = clipboard; }, [clipboard]);
  useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);
  useEffect(() => { selectedFileRef.current = selectedFile; }, [selectedFile]);
  useEffect(() => { fileContentRef.current = fileContent; }, [fileContent]);
  useEffect(() => { syntaxErrorsRef.current = syntaxErrors; }, [syntaxErrors]);
  
  useEffect(() => { 
    isVisibleRef_debug.current = isVisible;
    // const myId = instanceId.current; // For debugging specific instance visibility changes
    // const currentTimestamp = () => new Date().toLocaleTimeString();
    // console.log(`${currentTimestamp()} FM ${myId}: isVisible prop changed to: ${isVisible}`);
  }, [isVisible]);

  // 检查文件是否有未保存的变更并处理关闭编辑器的逻辑
  const handleEditorClose = useCallback(() => {
    if (isFileModified) {
      Modal.confirm({
        title: '文件未保存',
        content: '当前文件已发生变更，但您还没有保存。确定要关闭编辑器吗？',
        okText: '不保存并关闭',
        cancelText: '取消',
        onOk: () => {
          setIsEditModalVisible(false);
          setIsFileModified(false);
        },
        onCancel: () => {} // 不做任何操作，用户可以继续编辑
      });
    } else {
      setIsEditModalVisible(false);
    }
  }, [isFileModified]);
  
  // 添加窗口关闭事件监听
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // 检查当前活跃的文件管理器实例是否是这个实例
      if ((window as any).activeFileManagerId !== instanceId.current) {
        return; // 如果不是当前实例，不处理事件
      }
      
      // 检查组件是否已卸载
      if (!isMountedRef.current) {
        return; // 如果组件已卸载，不处理事件
      }
      
      if (isEditModalVisible && isFileModified) {
        // 现代浏览器不允许自定义消息，但这会触发浏览器的默认确认对话框
        e.preventDefault();
        e.returnValue = ''; // Chrome需要设置returnValue
        return ''; // 返回空字符串会显示浏览器默认的确认消息
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isEditModalVisible, isFileModified]);
  
  // 实际保存文件的函数
  const saveFileContentInternal = useCallback(async () => {
    if (!selectedFileRef.current) return;
    
    setLoading(true); // setLoading is a stable dispatcher
    try {
      const response = await axios.post(`/api/save_file`, {
        path: selectedFileRef.current.path,
        content: fileContentRef.current
      });
      
      if (response.data.status === 'success') {
        message.success('文件已保存');
        if (loadDirectoryRef.current) {
          loadDirectoryRef.current(currentPathRef.current); // Refresh directory using current path from ref
        }
      } else {
        message.error(response.data.message || '保存文件失败');
      }
    } catch (error: any) {
      message.error(`保存文件失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  // Removed direct state dependencies: selectedFile, fileContent, currentPath. 
  // Relies on their refs. loadDirectoryRef is a ref to a function, stable.
  // setLoading, message are stable.
  }, []); 

  // 保存文件内容
  const saveFileInternal = useCallback(async () => {
    if (!selectedFileRef.current) return;
    
    if (syntaxErrorsRef.current.length > 0) {
      Modal.confirm({
        title: '警告',
        content: `当前代码存在 ${syntaxErrorsRef.current.length} 个语法错误，是否仍要保存？`,
        okText: '继续保存',
        cancelText: '返回编辑',
        onOk: () => {
          saveFileContentInternal();
          setIsFileModified(false); // setIsFileModified is stable dispatcher
        },
        onCancel: () => {}
      });
      return;
    }
    
    await saveFileContentInternal();
    setIsFileModified(false);
  // Removed direct state dependencies: selectedFile, syntaxErrors.
  // Depends on saveFileContentInternal (now stable due to its own ref usage) and setIsFileModified (stable).
  }, [saveFileContentInternal]);

  // 处理点击保存按钮的事件
  const handleSaveClick = useCallback(async () => {
    await saveFileInternal();
    // 不关闭编辑器模态框
    return false; // 返回false阻止Modal自动关闭
  }, [saveFileInternal]);

  const saveFileRef = useRef(saveFileInternal);
  useEffect(() => {
    saveFileRef.current = saveFileInternal;
  }, [saveFileInternal]);

  // 创建包含认证信息的请求头
  const getHeaders = () => {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // 文件右键菜单处理
  const handleContextMenu = (e: React.MouseEvent, file: FileInfo) => {
    e.preventDefault();
    e.stopPropagation(); // 阻止事件冒泡

    // 获取视口尺寸
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = 200; // 估计的菜单宽度
    const menuHeight = 350; // 估计的菜单高度

    // 直接使用鼠标事件的客户端坐标
    let x = e.clientX;
    let y = e.clientY;

    // 确保菜单不会超出屏幕
    if (x + menuWidth > viewportWidth) {
      x = viewportWidth - menuWidth - 5;
    }
    if (y + menuHeight > viewportHeight) {
      y = viewportHeight - menuHeight - 5;
    }

    // 设置菜单位置
    setContextMenuPosition({ x, y, visible: true });
    setContextMenuFile(file);
    setBlankContextMenuPosition({ x: 0, y: 0, visible: false });
  };

  // 空白区域右键菜单处理
  const handleBlankContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // 确保点击的是空白区域，而不是表格行
    if ((e.target as HTMLElement).closest('tr')) {
      return;
    }

    // 获取视口尺寸
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = 200; // 估计的菜单宽度
    const menuHeight = 350; // 估计的菜单高度

    // 直接使用鼠标事件的客户端坐标
    let x = e.clientX;
    let y = e.clientY;

    // 确保菜单不会超出屏幕
    if (x + menuWidth > viewportWidth) {
      x = viewportWidth - menuWidth - 5;
    }
    if (y + menuHeight > viewportHeight) {
      y = viewportHeight - menuHeight - 5;
    }

    setBlankContextMenuPosition({ x, y, visible: true });
    setContextMenuPosition({ x: 0, y: 0, visible: false });
  };

  // 隐藏所有右键菜单
  const hideAllContextMenus = () => {
    setContextMenuPosition(prev => ({ ...prev, visible: false }));
    setBlankContextMenuPosition(prev => ({ ...prev, visible: false }));
  };

  // Effect for isMountedRef (Effect 1)
  useEffect(() => {
    isMountedRef.current = true;
    const myId = instanceId.current;
    // const currentTimestamp = () => new Date().toLocaleTimeString();
    // console.log(`${currentTimestamp()} FM ${myId}: Component TRULY MOUNTED (isMountedRef effect). instanceId: ${myId}`);

    return () => {
      isMountedRef.current = false; // This is the primary purpose
      // const timestamp = currentTimestamp();
      // console.log(`${timestamp} FM ${myId}: Component TRULY UNMOUNTED (isMountedRef effect cleanup). instanceId: ${myId}.`);
      
      // Final safeguard for activeFileManagerId on true unmount
      if ((window as any).activeFileManagerId === myId) {
        (window as any).activeFileManagerId = null;
        // console.log(`${timestamp} FM ${myId}: Deactivated on TRUE UNMOUNT. New activeId: null`);
      } else {
        // console.log(`${timestamp} FM ${myId}: Not deactivating on TRUE UNMOUNT as activeId (${(window as any).activeFileManagerId}) is not ${myId}.`);
      }
      // DO NOT remove keydown listener here. That's for the other effect which is responsible for its own listener.
    };
  }, []); // Corrected: ONLY runs on mount and unmount

  // Memoized keyboard shortcut handler
  const memoizedHandleKeyboardShortcuts = useCallback((e: KeyboardEvent) => {
    // const currentTimestamp = () => new Date().toLocaleTimeString();
    if (!isMountedRef.current) {
      // console.warn(`${currentTimestamp()} FM ${instanceId.current}: handleKeyboardShortcuts called on UNMOUNTED component. Listener cleanup issue?`);
      return;
    }

    // Debug: Check if this instance is supposed to be visible when handling a shortcut
    if (!isVisibleRef_debug.current) {
      // console.warn(`${currentTimestamp()} FM ${instanceId.current}: handleKeyboardShortcuts EXECUTING but isVisibleRef_debug is FALSE. This should not happen if cleanup is correct. Key: ${e.key}`);
      return; // If not visible (according to the ref that tracks the prop), do nothing.
    }

    if ((window as any).activeFileManagerId !== instanceId.current) {
      // console.log(`${currentTimestamp()} FM ${instanceId.current}: handleKeyboardShortcuts SKIPPING. ActiveId is ${(window as any).activeFileManagerId}, MY id is ${instanceId.current}. Key: ${e.key}`);
      return;
    }
    
    // console.log(`${currentTimestamp()} FM ${instanceId.current}: handleKeyboardShortcuts EXECUTING. ActiveId is ${instanceId.current}. isVisibleRef_debug: ${isVisibleRef_debug.current}. Key: ${e.key}, Ctrl: ${e.ctrlKey}`);

    if (isEditModalVisible || isRenameModalVisible || isPreviewModalVisible || 
        isNewFolderModalVisible || isNewFileModalVisible || isUploadModalVisible) {
      if (isEditModalVisible && e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveFile(); // Calls the stable saveFile which now uses saveFileInternal
        return;
      }
      return;
    }

    if (e.ctrlKey) {
      switch (e.key.toLowerCase()) {
        case 'c':
          e.preventDefault();
          if (selectedFilesRef.current.length > 0 && copyToClipboardRef.current) {
            copyToClipboardRef.current(selectedFilesRef.current[0]);
          }
          break;
        case 'x':
          e.preventDefault();
          if (selectedFilesRef.current.length > 0 && cutToClipboardRef.current) {
            cutToClipboardRef.current(selectedFilesRef.current[0]);
          }
          break;
        case 'v':
          e.preventDefault();
          if (clipboardRef.current && pasteFromClipboardRef.current) {
            pasteFromClipboardRef.current(); // Assumes pasteFromClipboardRef uses clipboardRef.current or its own mechanism
          } else {
            message.info('剪贴板为空');
          }
          break;
        case 's': 
          if (isEditModalVisible) { 
           e.preventDefault();
           saveFile(); // Calls the stable saveFile
          }
          break;
        default:
          break;
      }
    }
  }, [
    isEditModalVisible, isRenameModalVisible, isPreviewModalVisible,
    isNewFolderModalVisible, isNewFileModalVisible, isUploadModalVisible,
    saveFileInternal, // Correctly depend on saveFileInternal
  ]);

  // Keyboard shortcut and activeFileManagerId management (Effect 2)
  useEffect(() => {
    const myId = instanceId.current;
    // const currentTimestamp = () => new Date().toLocaleTimeString();

    // Log entry into this effect and current isVisible state
    // console.log(`${currentTimestamp()} FM ${myId}: EFFECT 2 RUNNING. isVisible: ${isVisible}, isMounted: ${isMountedRef.current}`);

    if (isVisible && isMountedRef.current) {
      // console.log(`${currentTimestamp()} FM ${myId}: EFFECT 2 - Setting ACTIVE. isVisible: ${isVisible}. Setting activeId to ${myId}. Adding listener. Prev activeId: ${(window as any).activeFileManagerId}`);
      (window as any).activeFileManagerId = myId;
      document.addEventListener('keydown', memoizedHandleKeyboardShortcuts);

      return () => {
        // const timestamp = currentTimestamp();
        // isVisible in this cleanup function's scope will be the value it had when the effect last ran (i.e., true)
        // We are more interested in the *current* isMountedRef.current when cleanup is called.
        // console.log(`${timestamp} FM ${myId}: EFFECT 2 CLEANUP triggered. InstanceId ${myId}. Current isMounted: ${isMountedRef.current}. About to remove listener. ActiveId was: ${(window as any).activeFileManagerId}`);
        document.removeEventListener('keydown', memoizedHandleKeyboardShortcuts);
        if ((window as any).activeFileManagerId === myId) {
          (window as any).activeFileManagerId = null;
          // console.log(`${timestamp} FM ${myId}: Deactivated in EFFECT 2 cleanup. New activeId: null`);
        }
      };
    } else {
      // const timestamp = currentTimestamp();
      // This block runs if isVisible is false OR component is not mounted when effect runs.
      // console.log(`${timestamp} FM ${myId}: EFFECT 2 - Condition NOT MET (isVisible: ${isVisible}, isMounted: ${isMountedRef.current}). Ensuring DEACTIVATED. Current activeId: ${(window as any).activeFileManagerId}. Removing listener for ${myId}.`);
      document.removeEventListener('keydown', memoizedHandleKeyboardShortcuts); // Ensure listener is removed if conditions aren't met
      if ((window as any).activeFileManagerId === myId) {
        (window as any).activeFileManagerId = null;
        // console.log(`${timestamp} FM ${myId}: Deactivated in EFFECT 2 (due to !isVisible or !isMounted). New activeId: null`);
      }
    }
  }, [isVisible, memoizedHandleKeyboardShortcuts, instanceId]); // instanceId should be stable, memoizedHandleKeyboardShortcuts is now stable

  // 在组件加载时添加点击事件监听器，用于隐藏右键菜单
  useEffect(() => {
    const handleClick = () => {
      // 检查当前活跃的文件管理器实例是否是这个实例
      if ((window as any).activeFileManagerId !== instanceId.current) {
        return; // 如果不是当前实例，不处理事件
      }
      
      // 检查组件是否已卸载
      if (!isMountedRef.current) {
        return; // 如果组件已卸载，不处理事件
      }
      
      hideAllContextMenus();
    };

    document.addEventListener('click', handleClick);
    
    // 组件卸载时移除事件监听器
    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, [hideAllContextMenus]); // hideAllContextMenus is stable or memoized correctly

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
        const content = response.data.content || '';
        setFileContent(content);
        setOriginalContent(content); // 保存原始内容以便后续比较
        setSelectedFile(file);
        setIsFileModified(false); // 重置修改状态
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

  const [isCompressModalVisible, setIsCompressModalVisible] = useState<boolean>(false);
  const [isExtractModalVisible, setIsExtractModalVisible] = useState<boolean>(false);
  const [extractPath, setExtractPath] = useState<string>('');
  const [compressName, setCompressName] = useState<string>('');
  const [compressFormat, setCompressFormat] = useState<string>('zip');
  const [compressionLevel, setCompressionLevel] = useState<number>(6);
  const [isCompressing, setIsCompressing] = useState<boolean>(false);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [isChangingPermissions, setIsChangingPermissions] = useState<boolean>(false);
  const [isPermissionsModalVisible, setIsPermissionsModalVisible] = useState<boolean>(false);
  const [permissions, setPermissions] = useState<{
    owner: { read: boolean; write: boolean; execute: boolean };
    group: { read: boolean; write: boolean; execute: boolean };
    others: { read: boolean; write: boolean; execute: boolean };
  }>({
    owner: { read: true, write: true, execute: false },
    group: { read: true, write: false, execute: false },
    others: { read: true, write: false, execute: false }
  });
  const [isRecursive, setIsRecursive] = useState<boolean>(false);

  // 压缩文件
  const compressFiles = async () => {
    if (selectedFiles.length === 0) {
      message.warning('请选择要压缩的文件或文件夹');
      return;
    }
    
    setIsCompressing(true);
    setLoading(true);
    
    // 显示全局压缩进度提示
    const compressNotification = message.loading({
      content: '正在压缩文件，请稍候...',
      duration: 0,
    });
    
    // 构建要压缩的文件路径列表
    const paths = selectedFiles.map(file => file.path);
    
    try {
      const response = await axios.post('/api/compress', { 
        paths, 
        currentPath,
        format: compressFormat,
        level: compressionLevel
      });
      
      if (response.data.status === 'success') {
        const zipPath = response.data.zipPath;
        
        // 根据选择的格式确定文件扩展名
        let fileExtension = '.zip';
        switch (compressFormat) {
          case 'tar':
            fileExtension = '.tar';
            break;
          case 'tgz':
            fileExtension = '.tar.gz';
            break;
          case 'tbz2':
            fileExtension = '.tar.bz2';
            break;
          case 'txz':
            fileExtension = '.tar.xz';
            break;
          case 'tzst':
            fileExtension = '.tar.zst';
            break;
          default:
            fileExtension = '.zip';
        }
        
        // 移动压缩文件到当前目录，使用新的文件名
        const zipName = compressName.endsWith(fileExtension) ? compressName : `${compressName}${fileExtension}`;
        const destinationPath = `${currentPath}/${zipName}`;
        
        const moveResponse = await axios.post('/api/move', {
          sourcePath: zipPath,
          destinationPath: destinationPath
        });
        
        if (moveResponse.data.status === 'success') {
          compressNotification(); // 关闭加载通知
          message.success('文件已压缩完成');
          // 刷新当前目录
          loadDirectory(currentPath);
        } else {
          compressNotification(); // 关闭加载通知
          message.error(moveResponse.data.message || '移动压缩文件失败');
        }
      } else {
        compressNotification(); // 关闭加载通知
        message.error(response.data.message || '压缩文件失败');
      }
    } catch (error) {
      compressNotification(); // 关闭加载通知
      message.error(`压缩文件失败: ${error.message}`);
    } finally {
      setIsCompressing(false);
      setLoading(false);
      setIsCompressModalVisible(false);
      setCompressName('');
      setCompressFormat('zip');
      setCompressionLevel(6);
    }
  };
  
  // 解压文件
  const extractFile = async () => {
    if (!selectedFile) {
      message.warning('请选择要解压的文件');
      return;
    }
    
    if (selectedFile.type !== 'file') {
      message.warning('只能解压文件');
      return;
    }
    
    // 判断文件类型是否为可解压类型
    const fileExt = selectedFile.name.toLowerCase();
    const supportedExts = ['.zip', '.tar', '.gz', '.tgz', '.tar.gz', '.bz2', '.tar.bz2', '.xz', '.tar.xz', '.zst', '.tar.zst', '.rar', '.7z', '.jar', '.apk'];
    const isArchive = supportedExts.some(ext => fileExt.endsWith(ext));
    
    if (!isArchive) {
      message.warning('不支持解压此类型的文件');
      return;
    }
    
    setLoading(true);
    setIsExtracting(true);
    
    // 显示全局解压进度提示
    const extractNotification = message.loading({
      content: '正在解压文件，请稍候...',
      duration: 0,
    });
    
    try {
      // 默认解压到当前目录或指定目录
      const targetDir = extractPath || currentPath;
      
      const response = await axios.post('/api/extract', {
        path: selectedFile.path,
        targetDir
      });
      
      if (response.data.status === 'success') {
        extractNotification(); // 关闭加载通知
        message.success('文件已解压');
        // 刷新当前目录或跳转到解压目标目录
        loadDirectory(targetDir);
      } else {
        extractNotification(); // 关闭加载通知
        message.error(response.data.message || '解压文件失败');
      }
    } catch (error) {
      extractNotification(); // 关闭加载通知
      message.error(`解压文件失败: ${error.message}`);
    } finally {
      setLoading(false);
      setIsExtracting(false);
      setIsExtractModalVisible(false);
      setExtractPath('');
    }
  };

  // 批量删除选中的文件和文件夹
  const deleteSelectedItems = () => {
    if (selectedFiles.length === 0) {
      message.warning('请选择要删除的文件或文件夹');
      return;
    }

    Modal.confirm({
      title: '确认删除',
      content: `确定要删除选中的 ${selectedFiles.length} 个文件/文件夹吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setLoading(true);
        try {
          let successCount = 0;
          let failCount = 0;
          
          // 逐个删除选中的文件/文件夹
          for (const file of selectedFiles) {
            try {
              const response = await axios.post('/api/delete', {
                path: file.path,
                type: file.type
              });
              
              if (response.data.status === 'success') {
                successCount++;
              } else {
                failCount++;
              }
            } catch (error) {
              failCount++;
              console.error(`删除失败: ${file.path}`, error);
            }
          }
          
          // 显示结果消息
          if (successCount > 0 && failCount === 0) {
            message.success(`成功删除 ${successCount} 个文件/文件夹`);
          } else if (successCount > 0 && failCount > 0) {
            message.warning(`删除完成: ${successCount} 个成功, ${failCount} 个失败`);
          } else {
            message.error('删除失败');
          }
          
          // 刷新目录
          loadDirectory(currentPath);
          // 清空选择
          setSelectedFiles([]);
          setSelectedFile(null);
        } catch (error) {
          message.error(`删除操作失败: ${error.message}`);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  // 将权限对象转换为数字模式
  const permissionsToMode = (perms: typeof permissions): number => {
    let mode = 0;
    if (perms.owner.read) mode |= 0o400;
    if (perms.owner.write) mode |= 0o200;
    if (perms.owner.execute) mode |= 0o100;
    if (perms.group.read) mode |= 0o040;
    if (perms.group.write) mode |= 0o020;
    if (perms.group.execute) mode |= 0o010;
    if (perms.others.read) mode |= 0o004;
    if (perms.others.write) mode |= 0o002;
    if (perms.others.execute) mode |= 0o001;
    return mode;
  };

  // 将数字模式转换为权限对象
  const modeToPermissions = (mode: number) => {
    return {
      owner: {
        read: !!(mode & 0o400),
        write: !!(mode & 0o200),
        execute: !!(mode & 0o100)
      },
      group: {
        read: !!(mode & 0o040),
        write: !!(mode & 0o020),
        execute: !!(mode & 0o010)
      },
      others: {
        read: !!(mode & 0o004),
        write: !!(mode & 0o002),
        execute: !!(mode & 0o001)
      }
    };
  };

  // 修改文件权限
  const changePermissions = async () => {
    if (!selectedFile) {
      message.warning('请选择要修改权限的文件或文件夹');
      return;
    }

    setIsChangingPermissions(true);
    
    try {
      const mode = permissionsToMode(permissions);
      const response = await axios.post('/api/chmod', {
        path: selectedFile.path,
        mode: mode,
        recursive: isRecursive
      });
      
      if (response.data.status === 'success') {
        message.success('权限修改成功');
        loadDirectory(currentPath); // 刷新当前目录
      } else {
        message.error(response.data.message || '权限修改失败');
      }
    } catch (error) {
      message.error(`权限修改失败: ${error.message}`);
    } finally {
      setIsChangingPermissions(false);
      setIsPermissionsModalVisible(false);
      setIsRecursive(false);
    }
  };

  // 获取文件语言类型
  const getFileLanguage = (filename: string): string => {
    const ext = filename.toLowerCase().split('.').pop() || '';
    const languageMap: { [key: string]: string } = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'cpp',
      'hpp': 'cpp',
      'cs': 'csharp',
      'json': 'json',
      'xml': 'xml',
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'md': 'markdown',
      'yml': 'yaml',
      'yaml': 'yaml',
      'sh': 'shell',
      'bash': 'shell',
      'sql': 'sql',
      'txt': 'plaintext',
      'log': 'plaintext',
      'ini': 'ini',
      'conf': 'plaintext',
      'cfg': 'plaintext',
      'properties': 'plaintext'
    };
    return languageMap[ext] || 'plaintext';
  };

  // 处理编辑器加载完成的事件
  const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: Monaco) => {
    editorRef.current = editor;
    
    // 监听编辑器的标记（错误、警告等）变化
    monacoInstance.editor.onDidChangeMarkers((uris) => {
      const editorUri = editor.getModel()?.uri;
      if (editorUri && uris.some(uri => uri.toString() === editorUri.toString())) {
        const currentErrors = monacoInstance.editor.getModelMarkers({ resource: editorUri })
          .filter(marker => marker.severity === monacoInstance.MarkerSeverity.Error);
        setSyntaxErrors(currentErrors);
      }
    });

    // 添加Ctrl+S快捷键支持
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      saveFileRef.current();
      return null; // 防止事件继续传播
    });
    
    // 添加ESC键支持，检查文件是否有未保存的变更
    editor.addCommand(monacoInstance.KeyCode.Escape, () => {
      handleEditorClose();
      return null; // 防止事件继续传播
    });
    
    // 监听编辑器内容变化
    editor.onDidChangeModelContent(() => {
      const currentContent = editor.getValue();
      setIsFileModified(currentContent !== originalContent);
    });
  };

  // 工具栏切换函数
  const toggleToolbar = () => {
    const newState = !toolbarCollapsed;
    setToolbarCollapsed(newState);
    // 保存到本地存储
    localStorage.setItem('fileManagerToolbarCollapsed', JSON.stringify(newState));
  };

  // 组件挂载时添加全局样式
  useEffect(() => {
    // 创建全局样式元素
    const styleElement = document.createElement('style');
    styleElement.innerHTML = `
      .context-menu {
        background-color: white;
        border-radius: 4px;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
        min-width: 160px;
        max-width: 280px;
        animation: contextMenuFadeIn 0.15s ease-in-out;
      }
      @keyframes contextMenuFadeIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(styleElement);

    // 组件卸载时移除全局样式
    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  // 添加帮助弹窗状态
  const [helpModalVisible, setHelpModalVisible] = useState<boolean>(false);

  // 检查是否需要显示帮助弹窗
  useEffect(() => {
    const fileManagerHelpViewed = Cookies.get('file_manager_help_viewed');
    if (!fileManagerHelpViewed) {
      setHelpModalVisible(true);
    }
  }, []);

  // 关闭帮助弹窗
  const handleCloseHelpModal = () => {
    setHelpModalVisible(false);
  };

  // 显示帮助弹窗
  const showHelpModal = () => {
    setHelpModalVisible(true);
  };

  // Now that memoizedHandleKeyboardShortcuts is defined, we can alias saveFileInternal to saveFile
  // and set up the saveFileRef for the editor.
  const saveFile = saveFileInternal;
  useEffect(() => {
    saveFileRef.current = saveFileInternal;
  }, [saveFileInternal]); // Ensure saveFileRef is updated if saveFileInternal ever changes (it shouldn't much now)

  return (
    <>
      <div 
        className="file-manager-container"
        onContextMenu={handleBlankContextMenu}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onClick={hideAllContextMenus}
      >
        <div className="file-manager-toolbar" style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '16px',
          transition: 'all 0.3s ease',
          padding: isHovering ? '5px 10px' : '0',
          backgroundColor: isHovering ? 'rgba(230, 247, 255, 0.5)' : 'transparent',
          borderRadius: '4px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Button
              icon={toolbarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={toggleToolbar}
              style={{ marginRight: '8px' }}
            />
            {!toolbarCollapsed && (
              <Space>
                <Button 
                  icon={<FileAddOutlined />} 
                  onClick={() => setIsNewFileModalVisible(true)}
                >
                  新建文件
                </Button>
                <Button 
                  icon={<FolderAddOutlined />} 
                  onClick={() => setIsNewFolderModalVisible(true)}
                >
                  新建文件夹
                </Button>
                <Button 
                  icon={<UploadOutlined />} 
                  onClick={() => setIsUploadModalVisible(true)}
                >
                  上传
                </Button>
                <Button 
                  icon={<CompressOutlined />} 
                  onClick={compressFiles}
                  disabled={selectedFiles.length === 0}
                >
                  压缩
                </Button>
                <Button 
                  icon={<DeleteOutlined />} 
                  onClick={deleteSelectedItems}
                  disabled={selectedFiles.length === 0}
                  danger
                >
                  删除
                </Button>
                <Button 
                  icon={<ReloadOutlined />} 
                  onClick={() => {
                    if (loadDirectoryRef.current) {
                      loadDirectoryRef.current(currentPath);
                    }
                  }}
                >
                  刷新
                </Button>
                <Button 
                  icon={<QuestionCircleOutlined />} 
                  onClick={showHelpModal}
                >
                  帮助
                </Button>
              </Space>
            )}
          </div>
        </div>

        <Breadcrumb style={{ 
          margin: '16px 0', 
          transition: 'all 0.3s ease',
          padding: isHovering ? '5px 10px' : '0',
          backgroundColor: isHovering ? 'rgba(230, 247, 255, 0.5)' : 'transparent',
          borderRadius: '4px'
        }}>
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
                scroll={{ y: isHovering ? 'calc(100vh - 350px)' : 'calc(100vh - 420px)' }}
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

        <style jsx>{`
          .file-manager-container {
            width: 100%;
            padding: 8px;
            position: relative;
            transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
            z-index: 1;
            border-radius: 8px;
            overflow: hidden;
          }
          .file-manager-hover {
            transform: scale(1.01, 1.06);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
            z-index: 10;
            overflow: visible;
            margin: 20px -5px;
            border: 1px solid rgba(24, 144, 255, 0.3);
            background-color: rgba(255, 255, 255, 0.95);
          }
          .file-manager-toolbar {
            margin-bottom: 16px;
            transition: all 0.3s ease;
            border-radius: 6px;
          }
          .file-manager-hover .file-manager-toolbar {
            background-color: rgba(230, 247, 255, 0.5);
            padding: 5px;
          }
          .file-manager-hover .ant-btn {
            transition: all 0.3s ease;
            transform: translateY(-1px);
          }
          .file-manager-hover .ant-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          }
          .file-manager-content {
            background-color: white;
            border-radius: 4px;
            transition: all 0.3s ease;
          }
          .file-manager-hover .file-manager-content {
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
            border-radius: 8px;
            padding-bottom: 10px;
            margin-bottom: 10px;
          }
          .file-manager-hover .ant-table {
            transition: all 0.3s ease;
            max-height: calc(100vh - 320px);
          }
          .file-manager-hover .ant-pagination {
            margin-top: 12px;
            margin-bottom: 5px;
          }
          .directory-name {
            color: #1890ff;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .file-manager-hover .directory-name:hover {
            color: #40a9ff;
            text-decoration: underline;
          }
          .file-name {
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .file-manager-hover .file-name:hover {
            color: #1890ff;
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
          .selected-row {
            background-color: #e6f7ff !important;
          }
          .selected-row:hover > td {
            background-color: #bae7ff !important;
          }
          .file-manager-hover .ant-table-row:hover > td {
            background-color: #e6f7ff !important;
            transition: all 0.3s ease;
          }
        `}</style>

        {/* 使用Portal将右键菜单渲染到body上，避免受到文件管理器变换的影响 */}
        {contextMenuPosition.visible && contextMenuFile && ReactDOM.createPortal(
          <div 
            className="context-menu"
            style={{
              position: 'fixed',
              top: contextMenuPosition.y,
              left: contextMenuPosition.x,
              zIndex: 1050,
              maxHeight: 'calc(100vh - 20px)',
              overflowY: 'auto',
              boxShadow: '0 3px 10px rgba(0, 0, 0, 0.2)',
              border: '1px solid rgba(24, 144, 255, 0.2)',
              borderRadius: '4px',
              background: 'white'
            }}
            onClick={(e) => e.stopPropagation()}
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
                  {(() => {
                    // 判断文件类型是否为可解压类型
                    const fileExt = contextMenuFile.name.toLowerCase();
                    const supportedExts = ['.zip', '.tar', '.gz', '.tgz', '.tar.gz', '.bz2', '.tar.bz2', '.xz', '.tar.xz', '.zst', '.tar.zst', '.rar', '.7z', '.jar', '.apk'];
                    const isArchive = supportedExts.some(ext => fileExt.endsWith(ext));
                    
                    if (isArchive) {
                      return (
                        <Menu.Item key="extract" onClick={() => {
                          setSelectedFile(contextMenuFile);
                          setExtractPath(currentPath);
                          setIsExtractModalVisible(true);
                          hideAllContextMenus();
                        }}>
                          解压
                        </Menu.Item>
                      );
                    }
                    return null;
                  })()}
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
              <Menu.Item key="permissions" onClick={() => {
                setSelectedFile(contextMenuFile);
                setSelectedFiles([contextMenuFile]);
                setIsPermissionsModalVisible(true);
                hideAllContextMenus();
              }}>
                修改权限
              </Menu.Item>
              <Menu.Item key="compress-file" onClick={() => {
                // 设置当前文件为选中文件
                setSelectedFiles([contextMenuFile]);
                // 默认压缩文件名
                const defaultName = `${contextMenuFile.name}.zip`;
                setCompressName(defaultName);
                setIsCompressModalVisible(true);
                hideAllContextMenus();
              }}>
                压缩
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item key="delete" danger onClick={() => {
                deleteItem(contextMenuFile);
                hideAllContextMenus();
              }}>
                删除
              </Menu.Item>
            </Menu>
          </div>,
          document.body
        )}

        {/* 空白区域右键菜单也使用Portal */}
        {blankContextMenuPosition.visible && ReactDOM.createPortal(
          <div 
            className="context-menu"
            style={{
              position: 'fixed',
              top: blankContextMenuPosition.y,
              left: blankContextMenuPosition.x,
              zIndex: 1050,
              maxHeight: 'calc(100vh - 20px)',
              overflowY: 'auto',
              boxShadow: '0 3px 10px rgba(0, 0, 0, 0.2)',
              border: '1px solid rgba(24, 144, 255, 0.2)',
              borderRadius: '4px',
              background: 'white'
            }}
            onClick={(e) => e.stopPropagation()}
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
              {selectedFiles.length > 0 && (
                <>
                  <Menu.Item key="delete-selected" danger onClick={() => {
                    deleteSelectedItems();
                    hideAllContextMenus();
                  }}>
                    删除选中项
                  </Menu.Item>
                  <Menu.Item key="permissions-selected" onClick={() => {
                    setIsPermissionsModalVisible(true);
                    hideAllContextMenus();
                  }}>
                    修改权限
                  </Menu.Item>
                </>
              )}
              <Menu.Item key="compress" onClick={() => {
                if (selectedFiles.length > 0) {
                  // 默认压缩文件名
                  const defaultName = selectedFiles.length === 1 
                    ? `${selectedFiles[0].name}.zip` 
                    : `archive_${new Date().getTime()}.zip`;
                  setCompressName(defaultName);
                  setIsCompressModalVisible(true);
                } else {
                  message.warning('请选择要压缩的文件或文件夹');
                }
                hideAllContextMenus();
              }}>
                压缩选中文件
              </Menu.Item>
              {selectedFiles.length === 1 && selectedFiles[0].type === 'file' && (() => {
                // 判断文件类型是否为可解压类型
                const fileExt = selectedFiles[0].name.toLowerCase();
                const supportedExts = ['.zip', '.tar', '.gz', '.tgz', '.tar.gz', '.bz2', '.tar.bz2', '.xz', '.tar.xz', '.zst', '.tar.zst', '.rar', '.7z', '.jar', '.apk'];
                const isArchive = supportedExts.some(ext => fileExt.endsWith(ext));
                
                if (isArchive) {
                  return (
                    <Menu.Item key="extract-selected" onClick={() => {
                      setSelectedFile(selectedFiles[0]);
                      setExtractPath(currentPath);
                      setIsExtractModalVisible(true);
                      hideAllContextMenus();
                    }}>
                      解压选中文件
                    </Menu.Item>
                  );
                }
                return null;
              })()}
              <Menu.Item key="refresh" onClick={() => {
                loadDirectory(currentPath);
                hideAllContextMenus();
              }}>
                刷新
              </Menu.Item>
            </Menu>
          </div>,
          document.body
        )}

        {/* 隐藏的下载链接 */}
        <a
          ref={downloadLinkRef}
          style={{ display: 'none' }}
        />

        {/* 文件编辑对话框 */}
        <Modal
          title={`编辑文件: ${selectedFile?.name}${isFileModified ? ' *' : ''}`}
          open={isEditModalVisible}
          onCancel={handleEditorClose}
          onOk={handleSaveClick}
          width={1000}
          okText="保存"
          cancelText="取消"
          bodyStyle={{ 
            maxHeight: '80vh',
            overflow: 'hidden',
            padding: '12px'
          }}
        >
          <div style={{ height: 'calc(80vh - 130px)' }}>
            {/* 添加文件修改状态指示器 */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '8px',
              padding: '0 4px'
            }}>
              <div>
                {selectedFile?.path}
              </div>
              <div>
                {isFileModified ? (
                  <Text type="warning">已修改 - 未保存</Text>
                ) : (
                  <Text type="success">已保存</Text>
                )}
              </div>
            </div>
            <Editor
              height="100%"
              defaultLanguage={selectedFile ? getFileLanguage(selectedFile.name) : 'plaintext'}
              value={fileContent}
              onChange={(value) => setFileContent(value || '')}
              onMount={handleEditorDidMount}
              theme="vs-dark"
              options={{
                fontSize: 14,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                lineNumbers: 'on',
                folding: true,
                foldingHighlight: true,
                foldingStrategy: 'auto',
                showFoldingControls: 'always',
                matchBrackets: 'always',
                autoClosingBrackets: 'always',
                autoClosingQuotes: 'always',
                formatOnPaste: true,
                formatOnType: true,
                wordWrap: 'on',
                wrappingIndent: 'same'
              }}
            />
            {syntaxErrors.length > 0 && (
              <div style={{ 
                backgroundColor: '#FFF2F0', 
                border: '1px solid #FFCCC7', 
                padding: '8px 12px', 
                marginTop: '10px', 
                borderRadius: '4px',
                color: '#CF1322',
                maxHeight: '120px',
                overflowY: 'auto'
              }}>
                <div style={{ marginBottom: '5px', fontWeight: 'bold' }}>
                  检测到 {syntaxErrors.length} 个语法错误:
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                  {syntaxErrors.slice(0, 5).map((error, index) => (
                    <li key={index}>
                      第 {error.startLineNumber} 行: {error.message}
                    </li>
                  ))}
                  {syntaxErrors.length > 5 && (
                    <li>... 还有 {syntaxErrors.length - 5} 个错误</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </Modal>

        {/* 图片预览对话框 */}
        <Modal
          title={`预览图片: ${selectedFile?.name}`}
          open={isPreviewModalVisible}
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
          open={isRenameModalVisible}
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
          open={isNewFolderModalVisible}
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
          open={isNewFileModalVisible}
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
          open={isUploadModalVisible}
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

        {/* 压缩文件对话框 */}
        <Modal
          title="压缩文件"
          open={isCompressModalVisible}
          onCancel={() => {
            if (!isCompressing) {
              setIsCompressModalVisible(false);
              setCompressName('');
              setCompressFormat('zip');
              setCompressionLevel(6);
            }
          }}
          onOk={compressFiles}
          okText={isCompressing ? "压缩中..." : "压缩"}
          okButtonProps={{ loading: isCompressing, disabled: isCompressing }}
          cancelButtonProps={{ disabled: isCompressing }}
          closable={!isCompressing}
          maskClosable={!isCompressing}
          cancelText="取消"
        >
          <Form layout="vertical">
            <Form.Item label="压缩文件名称">
              <Input 
                value={compressName} 
                onChange={(e) => setCompressName(e.target.value)} 
                autoFocus 
                disabled={isCompressing}
                placeholder="输入压缩文件名称（文件扩展名将根据格式自动添加）"
              />
            </Form.Item>
            <Form.Item label="压缩格式">
              <Select
                value={compressFormat}
                onChange={(value) => setCompressFormat(value)}
                style={{ width: '100%' }}
                disabled={isCompressing}
              >
                <Select.Option value="zip">ZIP (兼容性最好)</Select.Option>
                <Select.Option value="tar">TAR (无压缩)</Select.Option>
                <Select.Option value="tgz">TAR.GZ (Linux常用)</Select.Option>
                <Select.Option value="tbz2">TAR.BZ2 (压缩率高)</Select.Option>
                <Select.Option value="txz">TAR.XZ (最高压缩率)</Select.Option>
                <Select.Option value="tzst">TAR.ZST (高压缩率+高速)</Select.Option>
              </Select>
            </Form.Item>
            {(compressFormat === 'zip' || compressFormat === 'tgz' || compressFormat === 'tbz2' || compressFormat === 'txz' || compressFormat === 'tzst') && (
              <Form.Item label="压缩级别">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <Slider
                    min={1}
                    max={9}
                    value={compressionLevel}
                    onChange={(value) => setCompressionLevel(value)}
                    style={{ flex: 1, marginRight: 16 }}
                    disabled={isCompressing}
                    marks={{
                      1: '快速',
                      5: '均衡',
                      9: '最小'
                    }}
                  />
                  <InputNumber
                    min={1}
                    max={9}
                    value={compressionLevel}
                    onChange={(value) => setCompressionLevel(value as number)}
                    disabled={isCompressing}
                  />
                </div>
                <div style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>
                  级别越高，压缩率越高，但速度越慢 (1-最快, 9-最高压缩率)
                </div>
              </Form.Item>
            )}
            <div style={{ marginBottom: '10px' }}>
              将压缩以下 {selectedFiles.length} 个文件/文件夹:
            </div>
            <div style={{ maxHeight: '150px', overflow: 'auto', border: '1px solid #d9d9d9', padding: '8px', borderRadius: '2px' }}>
              {selectedFiles.map((file, index) => (
                <div key={index} style={{ marginBottom: '4px' }}>
                  {file.type === 'directory' ? <FolderOutlined style={{ marginRight: '8px', color: '#1890ff' }} /> : <FileOutlined style={{ marginRight: '8px' }} />}
                  {file.name}
                </div>
              ))}
            </div>
            {isCompressing && (
              <div style={{ marginTop: '16px', textAlign: 'center' }}>
                <Spin />
                <div style={{ marginTop: '8px', color: '#1890ff' }}>正在压缩文件，请稍候...</div>
              </div>
            )}
          </Form>
        </Modal>

        {/* 解压文件对话框 */}
        <Modal
          title={`解压文件: ${selectedFile?.name}`}
          open={isExtractModalVisible}
          onCancel={() => {
            if (!isExtracting) {
              setIsExtractModalVisible(false);
              setExtractPath('');
            }
          }}
          onOk={extractFile}
          okText={isExtracting ? "解压中..." : "解压"}
          okButtonProps={{ loading: isExtracting, disabled: isExtracting }}
          cancelButtonProps={{ disabled: isExtracting }}
          closable={!isExtracting}
          maskClosable={!isExtracting}
          cancelText="取消"
        >
          <Form layout="vertical">
            <Form.Item label="解压到目录">
              <Input 
                value={extractPath} 
                onChange={(e) => setExtractPath(e.target.value)} 
                placeholder="留空表示解压到当前目录"
                disabled={isExtracting}
              />
            </Form.Item>
            <div style={{ color: '#888', fontSize: '12px' }}>
              支持的压缩格式: ZIP, TAR, GZ, TGZ, BZ2, XZ, ZST, TAR.ZST, RAR, 7Z, JAR, APK
            </div>
            {isExtracting && (
              <div style={{ marginTop: '16px', textAlign: 'center' }}>
                <Spin />
                <div style={{ marginTop: '8px', color: '#1890ff' }}>正在解压文件，请稍候...</div>
              </div>
            )}
          </Form>
        </Modal>

        {/* 修改权限对话框 */}
        <Modal
          title="修改文件权限"
          open={isPermissionsModalVisible}
          onCancel={() => {
            if (!isChangingPermissions) {
              setIsPermissionsModalVisible(false);
              setIsRecursive(false);
            }
          }}
          onOk={changePermissions}
          okText={isChangingPermissions ? "修改中..." : "修改"}
          okButtonProps={{ loading: isChangingPermissions, disabled: isChangingPermissions }}
          cancelButtonProps={{ disabled: isChangingPermissions }}
          closable={!isChangingPermissions}
          maskClosable={!isChangingPermissions}
          cancelText="取消"
        >
          <Form layout="vertical">
            <Form.Item label="权限">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Checkbox
                  checked={permissions.owner.read}
                  onChange={(e) => setPermissions(prev => ({ ...prev, owner: { ...prev.owner, read: e.target.checked } }))}
                >
                  读取
                </Checkbox>
                <Checkbox
                  checked={permissions.owner.write}
                  onChange={(e) => setPermissions(prev => ({ ...prev, owner: { ...prev.owner, write: e.target.checked } }))}
                >
                  写入
                </Checkbox>
                <Checkbox
                  checked={permissions.owner.execute}
                  onChange={(e) => setPermissions(prev => ({ ...prev, owner: { ...prev.owner, execute: e.target.checked } }))}
                >
                  执行
                </Checkbox>
              </div>
            </Form.Item>
            <Form.Item label="组权限">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Checkbox
                  checked={permissions.group.read}
                  onChange={(e) => setPermissions(prev => ({ ...prev, group: { ...prev.group, read: e.target.checked } }))}
                >
                  读取
                </Checkbox>
                <Checkbox
                  checked={permissions.group.write}
                  onChange={(e) => setPermissions(prev => ({ ...prev, group: { ...prev.group, write: e.target.checked } }))}
                >
                  写入
                </Checkbox>
                <Checkbox
                  checked={permissions.group.execute}
                  onChange={(e) => setPermissions(prev => ({ ...prev, group: { ...prev.group, execute: e.target.checked } }))}
                >
                  执行
                </Checkbox>
              </div>
            </Form.Item>
            <Form.Item label="其他权限">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Checkbox
                  checked={permissions.others.read}
                  onChange={(e) => setPermissions(prev => ({ ...prev, others: { ...prev.others, read: e.target.checked } }))}
                >
                  读取
                </Checkbox>
                <Checkbox
                  checked={permissions.others.write}
                  onChange={(e) => setPermissions(prev => ({ ...prev, others: { ...prev.others, write: e.target.checked } }))}
                >
                  写入
                </Checkbox>
                <Checkbox
                  checked={permissions.others.execute}
                  onChange={(e) => setPermissions(prev => ({ ...prev, others: { ...prev.others, execute: e.target.checked } }))}
                >
                  执行
                </Checkbox>
              </div>
            </Form.Item>
            <Form.Item label="递归修改">
              <Checkbox
                checked={isRecursive}
                onChange={(e) => setIsRecursive(e.target.checked)}
              >
                递归修改子目录和文件
              </Checkbox>
            </Form.Item>
            <div style={{ marginBottom: '10px' }}>
              将修改以下 {selectedFiles.length} 个文件/文件夹:
            </div>
            <div style={{ maxHeight: '150px', overflow: 'auto', border: '1px solid #d9d9d9', padding: '8px', borderRadius: '2px' }}>
              {selectedFiles.map((file, index) => (
                <div key={index} style={{ marginBottom: '4px' }}>
                  {file.type === 'directory' ? <FolderOutlined style={{ marginRight: '8px', color: '#1890ff' }} /> : <FileOutlined style={{ marginRight: '8px' }} />}
                  {file.name}
                </div>
              ))}
            </div>
            {isChangingPermissions && (
              <div style={{ marginTop: '16px', textAlign: 'center' }}>
                <Spin />
                <div style={{ marginTop: '8px', color: '#1890ff' }}>正在修改权限，请稍候...</div>
              </div>
            )}
          </Form>
        </Modal>
      </div>
      
      {/* 添加帮助弹窗 */}
      <FileManagerHelpModal visible={helpModalVisible} onClose={handleCloseHelpModal} />
    </>
  );
};

export default FileManager; 