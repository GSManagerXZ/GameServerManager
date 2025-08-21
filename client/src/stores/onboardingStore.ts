import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface OnboardingStep {
  id: string
  title: string
  description: string
  completed: boolean
  skippable: boolean
}

export interface OnboardingState {
  isFirstLogin: boolean
  currentStep: number
  steps: OnboardingStep[]
  isOnboardingComplete: boolean
  showOnboarding: boolean
}

interface OnboardingStore extends OnboardingState {
  // 设置首次登录状态
  setFirstLogin: (isFirst: boolean) => void
  
  // 显示/隐藏引导
  setShowOnboarding: (show: boolean) => void
  
  // 步骤导航
  nextStep: () => void
  prevStep: () => void
  goToStep: (stepIndex: number) => void
  
  // 步骤状态管理
  completeStep: (stepId: string) => void
  skipStep: (stepId: string) => void
  
  // 完成引导
  completeOnboarding: () => void
  
  // 重置引导
  resetOnboarding: () => void
  
  // 检查是否需要显示引导
  shouldShowOnboarding: () => boolean
}

const defaultSteps: OnboardingStep[] = [
  {
    id: 'steamcmd',
    title: 'SteamCMD 设置',
    description: '配置 SteamCMD 用于下载和管理 Steam 游戏服务器',
    completed: false,
    skippable: true
  },
  {
    id: 'game-path',
    title: '游戏默认安装路径',
    description: '设置游戏服务器的默认安装路径，简化后续部署流程',
    completed: false,
    skippable: false
  }
]

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set, get) => ({
      isFirstLogin: false,
      currentStep: 0,
      steps: defaultSteps,
      isOnboardingComplete: false,
      showOnboarding: false,

      setFirstLogin: (isFirst: boolean) => {
        set({ isFirstLogin: isFirst })
      },

      setShowOnboarding: (show: boolean) => {
        set({ showOnboarding: show })
      },

      nextStep: () => {
        const { currentStep, steps } = get()
        if (currentStep < steps.length - 1) {
          set({ currentStep: currentStep + 1 })
        }
      },

      prevStep: () => {
        const { currentStep } = get()
        if (currentStep > 0) {
          set({ currentStep: currentStep - 1 })
        }
      },

      goToStep: (stepIndex: number) => {
        const { steps } = get()
        if (stepIndex >= 0 && stepIndex < steps.length) {
          set({ currentStep: stepIndex })
        }
      },

      completeStep: (stepId: string) => {
        const { steps } = get()
        const updatedSteps = steps.map(step =>
          step.id === stepId ? { ...step, completed: true } : step
        )
        set({ steps: updatedSteps })
      },

      skipStep: (stepId: string) => {
        const { steps, currentStep } = get()
        const step = steps.find(s => s.id === stepId)
        if (step && step.skippable) {
          const updatedSteps = steps.map(s =>
            s.id === stepId ? { ...s, completed: true } : s
          )
          set({ steps: updatedSteps })
          
          // 如果是当前步骤，自动跳到下一步
          if (steps[currentStep]?.id === stepId) {
            get().nextStep()
          }
        }
      },

      completeOnboarding: () => {
        set({
          isOnboardingComplete: true,
          showOnboarding: false,
          isFirstLogin: false
        })
      },

      resetOnboarding: () => {
        set({
          currentStep: 0,
          steps: defaultSteps.map(step => ({ ...step, completed: false })),
          isOnboardingComplete: false,
          showOnboarding: false,
          isFirstLogin: true  // 重置时设置为true，允许重新显示引导
        })
      },

      shouldShowOnboarding: () => {
        const { isFirstLogin, isOnboardingComplete, showOnboarding } = get()
        return isFirstLogin && !isOnboardingComplete && showOnboarding
      }
    }),
    {
      name: 'gsm3-onboarding',
      partialize: (state) => ({
        isFirstLogin: state.isFirstLogin,
        currentStep: state.currentStep,
        steps: state.steps,
        isOnboardingComplete: state.isOnboardingComplete,
        showOnboarding: state.showOnboarding
      })
    }
  )
)
