import React, { useState, useEffect } from 'react';
import { Modal, Button, Checkbox } from 'antd';
import Cookies from 'js-cookie';

interface FrpDocModalProps {
  visible: boolean;
  onClose: () => void;
}

const FrpDocModal: React.FC<FrpDocModalProps> = ({ visible, onClose }) => {
  const [checked, setChecked] = useState<boolean>(false);
  
  const handleOk = () => {
    if (checked) {
      // 设置Cookie，有效期为30天
      Cookies.set('frp_doc_viewed', 'true', { expires: 30 });
    }
    onClose();
  };

  return (
    <Modal
      title="内网穿透使用方法"
      visible={visible}
      onCancel={onClose}
      width={800}
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
      <div style={{ height: '70vh', width: '100%' }}>
        <iframe
          src="http://blogpage.xiaozhuhouses.asia/html6/index.html#/docs/%E5%86%85%E7%BD%91%E7%A9%BF%E9%80%8F%E7%9A%84%E4%BD%BF%E7%94%A8%E6%96%B9%E6%B3%95"
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="内网穿透使用方法"
        />
      </div>
    </Modal>
  );
};

export default FrpDocModal; 