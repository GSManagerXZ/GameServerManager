import { useState, useEffect } from 'react';

/**
 * 自定义钩子，用于检测当前设备是否为移动设备
 * @param breakpoint 断点宽度，默认为768px
 * @returns 布尔值，表示当前设备是否为移动设备
 */
export function useIsMobile(breakpoint: number = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth <= breakpoint);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= breakpoint);
    };

    // 添加窗口大小改变事件监听器
    window.addEventListener('resize', handleResize);
    
    // 组件卸载时移除事件监听器
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [breakpoint]);

  return isMobile;
}

export default useIsMobile; 