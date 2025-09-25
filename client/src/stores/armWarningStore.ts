import { create } from 'zustand'

interface ArmWarningState {
  isVisible: boolean
  isClosing: boolean
}

interface ArmWarningStore extends ArmWarningState {
  showWarning: () => void
  hideWarning: () => void
  closeWarning: () => void
}

export const useArmWarningStore = create<ArmWarningStore>((set) => ({
  isVisible: false,
  isClosing: false,

  showWarning: () => {
    set({ isVisible: true, isClosing: false })
  },

  hideWarning: () => {
    set({ isVisible: false, isClosing: false })
  },

  closeWarning: () => {
    set({ isClosing: true })
    // 延迟隐藏以播放关闭动画
    setTimeout(() => {
      set({ isVisible: false, isClosing: false })
    }, 300)
  },
}))