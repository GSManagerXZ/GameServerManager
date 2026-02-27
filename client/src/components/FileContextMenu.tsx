import React from 'react'
import {
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  ScissorOutlined,
  DownloadOutlined,
  CloudDownloadOutlined,
  FileOutlined,
  FolderOpenOutlined,
  EyeOutlined,
  SnippetsOutlined,
  FileZipOutlined,
  FolderOutlined,
  ConsoleSqlOutlined,
  SoundOutlined,
  RightOutlined,
  PlusOutlined,
  SafetyOutlined,
  StarOutlined,
  StarFilled
} from '@ant-design/icons'
import { FileItem } from '@/types/file'
import { copyToClipboard } from '@/utils/clipboard'
import { useNotificationStore } from '@/stores/notificationStore'
import { useSystemStore } from '@/stores/systemStore'

interface FileContextMenuProps {
  children: React.ReactNode
  file: FileItem | null // 修改为可选，null表示空白区域
  files?: FileItem[] // 新增：所有文件列表，用于根据 path 查找文件对象
  selectedFiles: Set<string>
  clipboard: {
    items: string[]
    operation: 'copy' | 'cut' | null
  }
  // 菜单全局状态props
  globalContextMenuInfo: {
    file: FileItem | null
    position: { x: number; y: number }
  } | null
  onClose?: () => void // 新增：关闭菜单回调
  onOpen?: (file: FileItem) => void
  onRename?: (file: FileItem) => void
  onDelete?: (files: FileItem[]) => void
  onDownload?: (file: FileItem) => void
  onDownloadWithProgress?: (file: FileItem) => void
  onCopy?: (files: FileItem[]) => void
  onCut?: (files: FileItem[]) => void
  onPaste: () => void
  onView?: (file: FileItem) => void
  onCompress?: (files: FileItem[]) => void
  onExtract?: (file: FileItem) => void
  onOpenTerminal?: (file: FileItem) => void
  onAddToPlaylist?: (files: FileItem[]) => void
  onCreateFile?: () => void // 新增：创建文件
  onCreateFolder?: () => void // 新增：创建文件夹
  onCreateTextFile?: () => void // 新增：创建文本文档
  onCreateJsonFile?: () => void // 新增：创建JSON文件
  onCreateIniFile?: () => void // 新增：创建INI文件
  onPermissions?: (file: FileItem) => void // 新增：权限管理
  onToggleFavorite?: (file: FileItem, isFavorited: boolean) => void // 新增：切换收藏
  isFavorited?: boolean // 新增：是否已收藏
  // 菜单全局状态props
  setGlobalContextMenuInfo: React.Dispatch<React.SetStateAction<{
    file: FileItem | null
    position: { x: number; y: number }
  } | null>>
}

export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  children,
  file,
  files = [], // 新增：默认为空数组
  selectedFiles,
  clipboard,
  globalContextMenuInfo,
  onClose,
  onOpen,
  onRename,
  onDelete,
  onDownload,
  onDownloadWithProgress,
  onCopy,
  onCut,
  onPaste,
  onView,
  onCompress,
  onExtract,
  onOpenTerminal,
  onAddToPlaylist,
  onCreateFile,
  onCreateFolder,
  onCreateTextFile,
  onCreateJsonFile,
  onCreateIniFile,
  onPermissions,
  onToggleFavorite,
  isFavorited = false,
  setGlobalContextMenuInfo
}) => {
  const { addNotification } = useNotificationStore()
  const { isLinux, fetchSystemInfo } = useSystemStore()
  const [showNewSubmenu, setShowNewSubmenu] = React.useState(false)
  
  // 在组件挂载时获取系统信息（带缓存机制）
  React.useEffect(() => {
    fetchSystemInfo()
  }, [])
  
  // 空白区域菜单的处理
  const isBlankAreaMenu = file === null
  const isSelected = file ? selectedFiles.has(file.path) : false
  const selectedCount = selectedFiles.size
  const isMultipleSelected = selectedCount > 1
  
  // 菜单显示逻辑
  const contextMenuVisible = isBlankAreaMenu 
    ? globalContextMenuInfo?.file === null
    : globalContextMenuInfo?.file?.path === file?.path
    
  const contextMenuPosition = globalContextMenuInfo?.position || { x: 0, y: 0 }
  
  // 解决右键菜单溢出问题
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = React.useState(contextMenuPosition);

  const getSelectedFiles = (): FileItem[] => {
    if (isBlankAreaMenu) {
      // 空白区域菜单不操作任何文件
      return []
    }

    if (isSelected && isMultipleSelected) {
      // 如果当前文件被选中且有多个选中项，操作所有选中的文件
      // 从 files 数组中查找对应的文件对象，而不是复制当前文件的属性
      return Array.from(selectedFiles)
        .map(path => files.find(f => f.path === path))
        .filter((f): f is FileItem => f !== undefined)
    } else {
      // 否则只操作当前文件
      return [file!]
    }
  }

  // 检查是否为音频文件
  const isAudioFile = (fileName: string): boolean => {
    const supportedFormats = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']
    return supportedFormats.some(format => 
      fileName.toLowerCase().endsWith(format)
    )
  }

  // 检查是否为支持的压缩文件
  const isArchiveFile = (fileName: string): boolean => {
    const supportedFormats = ['.zip', '.7z', '.tar', '.tar.gz', '.tar.xz', '.tgz']
    return supportedFormats.some(format => 
      fileName.toLowerCase().endsWith(format)
    )
  }

  // 检查选中的文件中是否有音频文件
  const hasAudioFiles = (): boolean => {
    const files = getSelectedFiles()
    return files.some(f => f.type === 'file' && isAudioFile(f.name))
  }

  const handleContextMenu = (event: React.MouseEvent) => {
    if (isBlankAreaMenu) {
      // 空白区域菜单已在父组件处理
      return
    }
    
    event.preventDefault();
    setGlobalContextMenuInfo({file, position: { x: event.clientX, y: event.clientY }});
    //日志
    console.log('显示右键菜单:', file?.name);
  };

  const handleMenuClick = () => {
  setGlobalContextMenuInfo(null);
  };

  // 复制绝对路径到剪贴板
  const handleCopyAbsolutePath = async (file: FileItem) => {
    const absolutePath = file.path
    
    try {
      const success = await copyToClipboard(absolutePath)
      
      if (success) {
        addNotification({
          type: 'success',
          title: '复制成功',
          message: `已复制路径到剪贴板: ${absolutePath}`
        })
        console.log("路径已复制到剪贴板:", absolutePath)
      } else {
        addNotification({
          type: 'error',
          title: '复制失败',
          message: '无法复制路径到剪贴板，请手动复制'
        })
        console.error("无法复制路径到剪贴板")
      }
    } catch (err) {
      addNotification({
        type: 'error',
        title: '复制失败',
        message: '复制路径时发生错误'
      })
      console.error("复制路径时发生错误:", err)
    }
  }

  React.useEffect(() => {
    if (contextMenuVisible) {
      const handleClickOutside = () => setGlobalContextMenuInfo(null);
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenuVisible, setGlobalContextMenuInfo]);
  
  // 解决菜单溢出问题
  React.useLayoutEffect(() => {
    if (contextMenuVisible && menuRef.current) {
      const { x, y } = contextMenuPosition;
      const menuRect = menuRef.current.getBoundingClientRect();
      const menuWidth = menuRect.width;
      const menuHeight = menuRect.height;
      const winWidth = window.innerWidth;
      const winHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      // 判断是否溢出右边或下边，需修正
      if (x + menuWidth > winWidth) {
        adjustedX = Math.max(0, x - menuWidth);
      }
      if (y + menuHeight > winHeight) {
        adjustedY = Math.max(0, y - menuHeight);
      }
      if (adjustedX !== adjustedPosition.x || adjustedY !== adjustedPosition.y) {
        setAdjustedPosition({ x: adjustedX, y: adjustedY });
      }
    }
    // 菜单关闭时回到初始坐标
    if (!contextMenuVisible && (adjustedPosition.x !== contextMenuPosition.x || adjustedPosition.y !== contextMenuPosition.y)) {
      setAdjustedPosition(contextMenuPosition);
    }
  }, [contextMenuVisible, contextMenuPosition, file?.path, menuRef.current]);

  return (
    <>
      {!isBlankAreaMenu && (
        <div onContextMenu={handleContextMenu}>
          {children}
        </div>
      )}
      
      {isBlankAreaMenu && children}
      
      {contextMenuVisible && (
        <div
          className="fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-2 min-w-[280px]"
          ref={menuRef}
          style={{
            left: adjustedPosition.x,
            top: adjustedPosition.y,
            zIndex: 1000,
            opacity: adjustedPosition === contextMenuPosition ? 0 : 1,
            pointerEvents: adjustedPosition === contextMenuPosition ? 'none' : 'auto'
          }}
          onClick={handleMenuClick}
        >
          {isBlankAreaMenu ? (
            // 空白区域菜单
            <>
              {/* 粘贴 - Windows 11风格 - 仅在有内容时显示 */}
              {clipboard.operation && clipboard.items.length > 0 && (
                <>
                  <div className="px-2 py-1">
                    <div className="flex items-center gap-1">
                      <div
                        className="flex-1 px-2 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex flex-col items-center justify-center rounded-md transition-all duration-200 min-h-[60px] group"
                        onClick={onPaste}
                        title={`粘贴 ${clipboard.items.length} 项`}
                      >
                        <SnippetsOutlined className="text-lg mb-1 group-hover:scale-110 transition-transform duration-200" />
                        <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">粘贴</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>
                </>
              )}
              
              {/* 新建菜单 - 折叠模式 */}
               {(onCreateFolder || onCreateFile || onCreateTextFile || onCreateJsonFile || onCreateIniFile) && (
                 <div className="relative">
                   <div
                     className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center justify-between"
                     onMouseEnter={() => setShowNewSubmenu(true)}
                   >
                     <div className="flex items-center">
                       <PlusOutlined className="mr-2" />
                       新建
                     </div>
                     <RightOutlined className="text-xs" />
                   </div>
                   
                   {/* 子菜单 */}
                   {showNewSubmenu && (
                     <div 
                       className="absolute left-full top-0 ml-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-2 min-w-[160px] z-10"
                       onMouseLeave={() => setShowNewSubmenu(false)}
                     >
                       {onCreateFolder && (
                         <div
                           className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                           onClick={() => {
                             onCreateFolder()
                             setShowNewSubmenu(false)
                             onClose()
                           }}
                         >
                           <FolderOutlined className="mr-2" />
                           文件夹
                         </div>
                       )}
                       
                       {(onCreateTextFile || onCreateJsonFile || onCreateIniFile) && onCreateFolder && (
                         <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>
                       )}
                       
                       {onCreateTextFile && (
                         <div
                           className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                           onClick={() => {
                             onCreateTextFile()
                             setShowNewSubmenu(false)
                             onClose()
                           }}
                         >
                           <FileOutlined className="mr-2" />
                           文本文档
                         </div>
                       )}
                       
                       {onCreateJsonFile && (
                         <div
                           className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                           onClick={() => {
                             onCreateJsonFile()
                             setShowNewSubmenu(false)
                             onClose()
                           }}
                         >
                           <FileOutlined className="mr-2" />
                           JSON 文件
                         </div>
                       )}
                       
                       {onCreateIniFile && (
                         <div
                           className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                           onClick={() => {
                             onCreateIniFile()
                             setShowNewSubmenu(false)
                             onClose()
                           }}
                         >
                           <FileOutlined className="mr-2" />
                           INI 文件
                         </div>
                       )}
                     </div>
                   )}
                 </div>
               )}
              
              {/* 从此文件夹处打开终端 */}
              {onOpenTerminal && (onCreateFolder || onCreateFile) && (
                <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>
              )}
              {onOpenTerminal && (
                <div
                  className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                  onClick={() => onOpenTerminal({ name: '', path: '', type: 'directory', size: 0, modified: '' })}
                >
                  <ConsoleSqlOutlined className="mr-2" />
                  从此文件夹处打开终端
                </div>
              )}
            </>
          ) : (
            // 文件项菜单（原有逻辑）
            <>
              {/* 剪切、复制、重命名、删除操作组 - Windows 11风格 */}
              <div className="px-2 py-1">
                <div className="flex items-center gap-1">
                  {/* 剪切 */}
                  <div
                    className="flex-1 px-2 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex flex-col items-center justify-center rounded-md transition-all duration-200 min-h-[60px] group"
                    onClick={() => onCut?.(getSelectedFiles())}
                    title={isMultipleSelected ? `剪切 ${selectedCount} 项` : '剪切'}
                  >
                    <ScissorOutlined className="text-lg mb-1 group-hover:scale-110 transition-transform duration-200" />
                    <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">剪切</span>
                  </div>
                  
                  {/* 复制 */}
                  <div
                    className="flex-1 px-2 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex flex-col items-center justify-center rounded-md transition-all duration-200 min-h-[60px] group"
                    onClick={() => onCopy?.(getSelectedFiles())}
                    title={isMultipleSelected ? `复制 ${selectedCount} 项` : '复制'}
                  >
                    <CopyOutlined className="text-lg mb-1 group-hover:scale-110 transition-transform duration-200" />
                    <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">复制</span>
                  </div>
                  
                  {/* 重命名 */}
                  <div
                    className={`flex-1 px-2 py-2 cursor-pointer flex flex-col items-center justify-center rounded-md transition-all duration-200 min-h-[60px] group ${
                      !isMultipleSelected 
                        ? 'hover:bg-gray-100 dark:hover:bg-gray-700' 
                        : 'opacity-50 cursor-not-allowed'
                    }`}
                    onClick={!isMultipleSelected && file ? () => onRename?.(file) : undefined}
                    title={!isMultipleSelected ? '重命名' : '多选时无法重命名'}
                  >
                    <EditOutlined className={`text-lg mb-1 transition-transform duration-200 ${
                      !isMultipleSelected ? 'group-hover:scale-110' : ''
                    }`} />
                    <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">重命名</span>
                  </div>
                  
                  {/* 删除 */}
                  <div
                    className="flex-1 px-2 py-2 hover:bg-red-100 dark:hover:bg-red-900/30 cursor-pointer flex flex-col items-center justify-center rounded-md transition-all duration-200 min-h-[60px] group"
                    onClick={() => onDelete?.(getSelectedFiles())}
                    title={isMultipleSelected ? `删除 ${selectedCount} 项` : '删除'}
                  >
                    <DeleteOutlined className="text-lg mb-1 group-hover:scale-110 transition-transform duration-200 text-red-600 dark:text-red-400" />
                    <span className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap">删除</span>
                  </div>
                </div>
              </div>
              
              <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>

              {/* 打开/查看 */}
              {file && (
                <div
                  className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                  onClick={() => {
                    console.log('右键菜单 - 打开:', file.name)
                    onOpen?.(file)
                  }}
                >
                  {file.type === 'directory' ? <FolderOpenOutlined className="mr-2" /> : <FileOutlined className="mr-2" />}
                  {file.type === 'directory' ? '打开文件夹' : '打开文件'}
                </div>
              )}
              
              {/* 查看（仅文件） */}
              {file && file.type === 'file' && (
                <div
                  className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                  onClick={() => onView?.(file)}
                >
                  <EyeOutlined className="mr-2" />
                  预览
                </div>
              )}
              
              {/* 收藏/取消收藏 */}
              {file && onToggleFavorite && (
                <div
                  className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                  onClick={() => onToggleFavorite(file, isFavorited)}
                >
                  {isFavorited ? (
                    <>
                      <StarFilled className="mr-2 text-yellow-500" />
                      取消收藏
                    </>
                  ) : (
                    <>
                      <StarOutlined className="mr-2" />
                      收藏
                    </>
                  )}
                </div>
              )}
              
              {/* 从此文件夹处打开终端（仅文件夹） */}
              {file && file.type === 'directory' && (
                <div
                  className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                  onClick={() => onOpenTerminal?.(file)}
                >
                  <ConsoleSqlOutlined className="mr-2" />
                  从此文件夹处打开终端
                </div>
              )}
              
              {/* 复制绝对路径 */}
              {file && (
                <div
                  className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                  onClick={() => handleCopyAbsolutePath(file)}
                >
                  <CopyOutlined className="mr-2" />
                  复制绝对路径
                </div>
              )}

              {/* 粘贴 */}
              <div
                className={`px-4 py-2 cursor-pointer flex items-center ${
                  clipboard.operation && clipboard.items.length > 0 
                    ? 'hover:bg-gray-100 dark:hover:bg-gray-700' 
                    : 'opacity-50 cursor-not-allowed'
                }`}
                onClick={clipboard.operation && clipboard.items.length > 0 ? onPaste : undefined}
              >
                <SnippetsOutlined className="mr-2" />
                {clipboard.operation && clipboard.items.length > 0 ? `粘贴 ${clipboard.items.length} 项` : '粘贴'}
              </div>

              {/* 添加到播放列表（仅音频文件） */}
              {onAddToPlaylist && hasAudioFiles() && (
                <div
                  className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                  onClick={() => onAddToPlaylist(getSelectedFiles())}
                >
                  <SoundOutlined className="mr-2" />
                  {isMultipleSelected ? `添加 ${selectedCount} 项到播放列表` : '添加到播放列表'}
                </div>
              )}
              
              <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>
              
              {/* 压缩 */}
              <div
                className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                onClick={() => onCompress?.(getSelectedFiles())}
              >
                <FileZipOutlined className="mr-2" />
                {isMultipleSelected ? `压缩 ${selectedCount} 项` : '压缩'}
              </div>
              
              {/* 解压（支持多种压缩格式） */}
              {file && file.type === 'file' && !isMultipleSelected && 
                isArchiveFile(file.name) && (
                <div
                  className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                  onClick={() => onExtract?.(file)}
                >
                  <FolderOutlined className="mr-2" />
                  解压
                </div>
              )}
              
              {/* 权限管理（仅Linux系统且单选） */}
              {isLinux && onPermissions && file && !isMultipleSelected && (
                <div
                  className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                  onClick={() => onPermissions(file)}
                >
                  <SafetyOutlined className="mr-2" />
                  权限
                </div>
              )}
              
              <div className="border-t border-gray-200 dark:border-gray-600 my-1"></div>
              
              {/* 下载（仅文件） */}
              {file && file.type === 'file' && !isMultipleSelected && (
                <>
                  <div
                    className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                    onClick={() => onDownload?.(file)}
                  >
                    <DownloadOutlined className="mr-2" />
                    直接下载
                  </div>
                  <div
                    className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center"
                    onClick={() => onDownloadWithProgress?.(file)}
                  >
                    <CloudDownloadOutlined className="mr-2" />
                    异步下载
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}