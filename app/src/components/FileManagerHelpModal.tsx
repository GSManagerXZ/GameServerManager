import React, { useState } from 'react';
import { Modal, Button, Checkbox } from 'antd';
import Cookies from 'js-cookie';

interface FileManagerHelpModalProps {
  visible: boolean;
  onClose: () => void;
}

const FileManagerHelpModal: React.FC<FileManagerHelpModalProps> = ({ visible, onClose }) => {
  const [checked, setChecked] = useState<boolean>(false);
  
  const handleOk = () => {
    if (checked) {
      // 设置Cookie，有效期为30天
      Cookies.set('file_manager_help_viewed', 'true', { expires: 30 });
    }
    onClose();
  };

  return (
    <Modal
      title="文件管理使用帮助"
      visible={visible}
      onCancel={onClose}
      width={600}
      footer={[
        <Checkbox 
          key="checkbox" 
          checked={checked} 
          onChange={(e) => setChecked(e.target.checked)}
        >
          我已了解，不再提示
        </Checkbox>,
        <Button key="ok" type="primary" onClick={handleOk}>
          我已知道
        </Button>
      ]}
      style={{ top: 20 }}
    >
      <div style={{ padding: '20px', fontSize: '16px', lineHeight: '1.8' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>GSM面板的文件管理具有强大的功能，以下是给您的使用帮助</h2>
        <ol style={{ paddingLeft: '20px' }}>
          <li>您可以使用常用文件快捷键 ctrl+c 复制 ctrl+x 剪切 ctrl+v 粘贴，支持多选文件操作</li>
          <li>文件管理支持多选功能，可以通过勾选框选择多个文件，然后使用快捷键或右键菜单进行批量操作</li>
          <li>文件管理支持右键菜单选项，您可以很方便的对文件解压缩和剪切复制</li>
          <li>您可以双击文件夹打开文件夹，双击文件进入编辑</li>
        </ol>
        <p style={{ marginTop: '20px', textAlign: 'center' }}>以上是对您的使用帮助</p>
      </div>
    </Modal>
  );
};

export default FileManagerHelpModal;