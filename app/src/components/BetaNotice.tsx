import React, { useState, useEffect } from 'react';
import { Modal, Button, Typography } from 'antd';
// 导入antd样式
import 'antd/dist/antd.css';
import '../App.css';
import Cookies from 'js-cookie';

const { Title, Paragraph } = Typography;

interface BetaNoticeProps {
  // 可以传入自定义的通知内容
  title?: string;
  content?: React.ReactNode;
}

const BetaNotice: React.FC<BetaNoticeProps> = ({
  title = "项目内测须知",
  content
}) => {
  const [visible, setVisible] = useState(false);
  
  useEffect(() => {
    // 检查cookie是否存在
    const hasAcknowledged = Cookies.get('beta_notice_acknowledged');
    if (!hasAcknowledged) {
      setVisible(true);
    }
  }, []);

  const handleOk = () => {
    // 设置cookie，有效期24小时
    Cookies.set('beta_notice_acknowledged', 'true', { expires: 1 });
    setVisible(false);
  };

  const defaultContent = (
    <>
      <Paragraph>
        欢迎参与本项目的公测。请注意以下事项：
      </Paragraph>
      <Paragraph>
        1. 本项目目前处于公测阶段，可能存在部分功能使用异常。(在发布之前作者已做过全局测试，正常使用基本不会出现bug)
      </Paragraph>
      <Paragraph>
        2. 如遇到任何问题，请加入QQ群交流：1040201322，反馈给开发者。
      </Paragraph>
      <Paragraph>
        3. 最后非常感谢您的使用，本项目没有任何限制，全靠玩家自觉赞助，如果喜欢记得帮忙宣传下项目和赞助项目(关于项目页面)，好的项目离不开大家的支持与赞助。
      </Paragraph>
    </>
  );

  return (
    <Modal
      title={<Title level={4}>{title}</Title>}
      visible={visible}
      closable={false}
      maskClosable={false}
      className="beta-notice-modal"
      footer={[
        <Button key="submit" type="primary" onClick={handleOk}>
          我已知晓
        </Button>
      ]}
    >
      {content || defaultContent}
    </Modal>
  );
};

export default BetaNotice; 