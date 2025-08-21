import React, { useState, useEffect } from 'react'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { X, ChevronLeft, ChevronRight, Check, SkipForward, Save, Loader2 } from 'lucide-react'
import SteamCMDOnboardingStep from './onboarding/SteamCMDOnboardingStep'
import GamePathOnboardingStep from './onboarding/GamePathOnboardingStep'

const OnboardingWizard: React.FC = () => {
  const {
    currentStep,
    steps,
    showOnboarding,
    shouldShowOnboarding,
    nextStep,
    prevStep,
    completeOnboarding,
    setShowOnboarding
  } = useOnboardingStore()
  const { addNotification } = useNotificationStore()

  // 动画状态管理
  const [isVisible, setIsVisible] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [stepContentKey, setStepContentKey] = useState(0)
  const [isSaving, setIsSaving] = useState(false)

  // 控制整体显示/隐藏动画
  useEffect(() => {
    if (shouldShowOnboarding() && showOnboarding) {
      setIsVisible(true)
      setIsClosing(false)
    } else {
      setIsVisible(false)
    }
  }, [shouldShowOnboarding, showOnboarding])

  // 步骤切换时的内容动画
  useEffect(() => {
    setStepContentKey(prev => prev + 1)
  }, [currentStep])

  // 如果不需要显示引导，返回null
  if (!shouldShowOnboarding() || !showOnboarding) {
    return null
  }

  const currentStepData = steps[currentStep]
  const isLastStep = currentStep === steps.length - 1
  // 可以继续的条件：步骤已完成 或 步骤可跳过 或 是最后一步
  const canGoNext = currentStepData?.completed || currentStepData?.skippable || isLastStep



  // 保存游戏路径配置
  const saveGamePathConfig = async () => {
    const gamePathFromStorage = localStorage.getItem('gsm3_temp_game_path')
    if (!gamePathFromStorage) {
      console.log('没有找到临时游戏路径，跳过保存')
      return true
    }

    console.log('正在保存游戏路径:', gamePathFromStorage)
    try {
      const response = await fetch('/api/settings/game-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        },
        body: JSON.stringify({ defaultGamePath: gamePathFromStorage })
      })

      const result = await response.json()
      console.log('游戏路径保存响应:', result)

      if (result.success) {
        localStorage.setItem('gsm3_default_game_path', gamePathFromStorage)
        localStorage.removeItem('gsm3_temp_game_path')
        console.log('游戏路径保存成功')
        return true
      } else {
        console.error('游戏路径保存失败:', result.message)
        return false
      }
    } catch (error) {
      console.error('保存游戏路径失败:', error)
      return false
    }
  }

  // 保存SteamCMD配置
  const saveSteamCMDConfig = async () => {
    const steamcmdPathFromStorage = localStorage.getItem('gsm3_temp_steamcmd_path')
    if (!steamcmdPathFromStorage) {
      console.log('没有找到临时SteamCMD路径，跳过保存')
      return true
    }

    console.log('正在保存SteamCMD路径:', steamcmdPathFromStorage)
    try {
      const response = await fetch('/api/steamcmd/manual-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        },
        body: JSON.stringify({ installPath: steamcmdPathFromStorage })
      })

      const result = await response.json()
      console.log('SteamCMD路径保存响应:', result)

      if (result.success) {
        localStorage.removeItem('gsm3_temp_steamcmd_path')
        console.log('SteamCMD路径保存成功')
        return true
      } else {
        console.error('SteamCMD路径保存失败:', result.message)
        return false
      }
    } catch (error) {
      console.error('保存SteamCMD配置失败:', error)
      return false
    }
  }

  // 保存所有已配置的内容
  const saveAllConfigurations = async () => {
    setIsSaving(true)
    console.log('开始保存所有配置...')

    try {
      // 检查临时存储的配置数据，而不仅仅依赖步骤完成状态
      const tempGamePath = localStorage.getItem('gsm3_temp_game_path')
      const tempSteamCMDPath = localStorage.getItem('gsm3_temp_steamcmd_path')

      console.log('临时游戏路径:', tempGamePath)
      console.log('临时SteamCMD路径:', tempSteamCMDPath)

      const saveResults = []

      // 保存SteamCMD配置（如果有）
      if (tempSteamCMDPath) {
        console.log('正在保存SteamCMD配置...')
        const steamcmdResult = await saveSteamCMDConfig()
        saveResults.push({ step: 'SteamCMD 设置', success: steamcmdResult })
      }

      // 保存游戏路径配置（如果有）
      if (tempGamePath) {
        console.log('正在保存游戏路径配置...')
        const gamePathResult = await saveGamePathConfig()
        saveResults.push({ step: '游戏默认安装路径', success: gamePathResult })
      }

      console.log('保存结果:', saveResults)

      if (saveResults.length === 0) {
        console.log('没有需要保存的配置')
        addNotification({
          type: 'info',
          title: '引导完成',
          message: '您可以随时在设置页面重新配置这些选项'
        })
        return true
      }

      // 检查保存结果
      const failedSaves = saveResults.filter(result => !result.success)
      const successfulSaves = saveResults.filter(result => result.success)

      if (failedSaves.length > 0) {
        addNotification({
          type: 'warning',
          title: '部分配置保存失败',
          message: `成功保存：${successfulSaves.map(s => s.step).join('、')}。失败：${failedSaves.map(s => s.step).join('、')}`
        })
      } else if (successfulSaves.length > 0) {
        addNotification({
          type: 'success',
          title: '配置已保存',
          message: `已成功保存。您可以在设置页面进行进一步调整。`
        })
      }

      return true
    } catch (error) {
      console.error('保存配置失败:', error)
      addNotification({
        type: 'error',
        title: '保存失败',
        message: '保存配置时发生错误，请稍后重试'
      })
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleNext = () => {
    if (isLastStep) {
      handleClose()
    } else {
      nextStep()
    }
  }

  const handleClose = async () => {
    setIsClosing(true)

    // 调试：检查localStorage中的临时数据
    console.log('关闭前检查localStorage:')
    console.log('gsm3_temp_game_path:', localStorage.getItem('gsm3_temp_game_path'))
    console.log('gsm3_temp_steamcmd_path:', localStorage.getItem('gsm3_temp_steamcmd_path'))

    // 先保存所有配置
    await saveAllConfigurations()

    // 延迟执行关闭，让动画播放完成
    setTimeout(() => {
      setShowOnboarding(false)
      completeOnboarding()
      setIsClosing(false)
    }, 300) // 与CSS动画时间匹配
  }

  const renderStepContent = () => {
    switch (currentStepData?.id) {
      case 'steamcmd':
        return <SteamCMDOnboardingStep />
      case 'game-path':
        return <GamePathOnboardingStep />
      default:
        return <div>未知步骤</div>
    }
  }

  return (
    <div
      className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-all duration-300 ease-in-out ${
        isVisible && !isClosing ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden transition-all duration-300 ease-in-out relative ${
          isVisible && !isClosing
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 translate-y-4'
        }`}
      >
        {/* 保存中的覆盖层 */}
        {isSaving && (
          <div className="absolute inset-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="flex items-center space-x-3 bg-white dark:bg-gray-800 px-6 py-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <span className="text-gray-900 dark:text-white font-medium">正在保存配置...</span>
            </div>
          </div>
        )}
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="animate-fade-in-up">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              欢迎使用 GSManager3
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              让我们快速配置您的游戏服务器管理环境
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={isSaving}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-all duration-200 hover:scale-110 animate-fade-in-up animation-delay-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* 进度指示器 */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div className={`
                  flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-all duration-300 ease-in-out
                  ${index < currentStep ? 'bg-green-500 text-white transform scale-110' :
                    index === currentStep ? 'bg-blue-500 text-white animate-pulse-glow' :
                    'bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-400'}
                `}>
                  {index < currentStep ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                <div className="ml-3">
                  <p className={`text-sm font-medium ${
                    index === currentStep ? 'text-blue-600 dark:text-blue-400' : 
                    'text-gray-600 dark:text-gray-400'
                  }`}>
                    {step.title}
                  </p>
                </div>
                {index < steps.length - 1 && (
                  <div className={`w-16 h-0.5 mx-4 transition-all duration-500 ease-in-out ${
                    index < currentStep ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 步骤内容 */}
        <div className="p-6 flex-1 overflow-y-auto min-h-0">
          <div
            key={`header-${stepContentKey}`}
            className="mb-6 animate-fade-in-up"
          >
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              {currentStepData?.title}
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              {currentStepData?.description}
            </p>
          </div>

          <div
            key={`content-${stepContentKey}`}
            className="animate-fade-in-up animation-delay-100"
          >
            {renderStepContent()}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <button
            onClick={prevStep}
            disabled={currentStep === 0}
            className="flex items-center space-x-2 px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105 animate-fade-in-up animation-delay-300"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>上一步</span>
          </button>

          <div className="flex items-center space-x-3">
            {currentStepData?.skippable && !currentStepData.completed && (
              <button
                onClick={() => {
                  useOnboardingStore.getState().skipStep(currentStepData.id)
                  // 跳过后自动进入下一步
                  if (!isLastStep) {
                    nextStep()
                  } else {
                    handleClose()
                  }
                }}
                className="flex items-center space-x-2 px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-all duration-200 hover:scale-105 animate-fade-in-up animation-delay-400"
              >
                <SkipForward className="w-4 h-4" />
                <span>跳过</span>
              </button>
            )}

            <button
              onClick={handleNext}
              disabled={!canGoNext || isSaving}
              className="flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105 animate-fade-in-up animation-delay-500"
            >
              {isLastStep ? (
                <>
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{isSaving ? '保存中...' : '保存并退出'}</span>
                </>
              ) : (
                <>
                  <span>下一步</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OnboardingWizard
