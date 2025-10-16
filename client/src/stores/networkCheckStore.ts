import { create } from 'zustand'
import { NetworkCheckState, NetworkCheckCategory, NetworkCheckItem } from '@/types'
import apiClient from '@/utils/api'

// 初始化网络检测项
const initialCategories: NetworkCheckCategory[] = [
  {
    id: 'internet',
    name: '互联网',
    items: [
      {
        id: 'baidu',
        name: '互联网连接状态',
        url: 'www.baidu.com',
        status: 'pending',
        errorMessage: '外网连接失败，您将无法对外请求，这可能会影响Steam游戏等需要联网的服务端'
      }
    ]
  },
  {
    id: 'steam',
    name: 'Steam网络',
    items: [
      {
        id: 'steamworks-api',
        name: 'Steamworks API(全球)',
        url: 'api.steampowered.com',
        status: 'pending',
        errorMessage: 'Steamworks连接失败，可能会无法正常登录Steam。您的Steam游戏服务端可能受到影响,通常可能无法被搜索或通过Steam网络连接，若服务端支持直连使用直连则不受影响'
      },
      {
        id: 'steamworks-partner',
        name: 'Steamworks API（合作/私有）',
        url: 'partner.steam-api.com',
        status: 'pending',
        errorMessage: 'Steamworks连接失败，您的Steam游戏服务端可能受到影响，通常可能无法被搜索或通过Steam网络连接，若服务端支持直连使用直连则不受影响'
      }
    ]
  },
  {
    id: 'modrinth',
    name: 'Modrinth',
    items: [
      {
        id: 'modrinth-api',
        name: 'Modrinth API',
        url: 'api.modrinth.com',
        status: 'pending',
        errorMessage: 'modrinth API连接失败，您可能无法搜索MC整合包'
      },
      {
        id: 'modrinth-cdn',
        name: 'Modrinth CDN',
        url: 'cdn.modrinth.com',
        status: 'pending',
        errorMessage: 'modrinth 边缘节点连接失败，您可能无法下载MC整合包'
      }
    ]
  },
  {
    id: 'minecraft',
    name: 'Minecraft',
    items: [
      {
        id: 'mojang-session',
        name: 'Mojang 会话服务器',
        url: 'sessionserver.mojang.com',
        status: 'pending',
        errorMessage: 'mojang sessionserver连接失败，您可能遇到正版验证失败报错等正版无法进服问题'
      },
      {
        id: 'msl-api',
        name: 'MSL API',
        url: 'https://api.mslmc.cn/v3',
        status: 'pending',
        errorMessage: 'MSL API连接失败，您可能无法部署MC核心'
      }
    ]
  },
  {
    id: 'gsmanager',
    name: 'GSManager',
    items: [
      {
        id: 'gsm-deploy',
        name: 'GSManager在线部署服务',
        url: 'http://gsm.server.xiaozhuhouses.asia:10002/',
        status: 'pending',
        errorMessage: 'GSManager在线部署服务 连接失败，您将无法使用在线部署和赞助者密钥功能'
      },
      {
        id: 'gsm-mirror',
        name: 'GSManager镜像服务器',
        url: 'http://download.server.xiaozhuhouses.asia:8082/',
        status: 'pending',
        errorMessage: 'GSManager镜像服务器 连接失败，您将无法使用环境管理中加速下载'
      }
    ]
  }
]

export const useNetworkCheckStore = create<NetworkCheckState>((set, get) => ({
  categories: JSON.parse(JSON.stringify(initialCategories)), // 深拷贝
  allChecksComplete: false,
  allChecksPassed: false,
  checking: false,
  lastCheckTime: undefined,

  // 检测所有项目
  checkAll: async () => {
    // 先将所有项目的状态设置为checking
    const checkingCategories = get().categories.map(category => ({
      ...category,
      items: category.items.map(item => ({
        ...item,
        status: 'checking' as const
      }))
    }))
    
    set({ 
      checking: true, 
      allChecksComplete: false,
      categories: checkingCategories
    })
    
    try {
      const response = await apiClient.checkNetwork()
      
      if (response.success && response.data) {
        const updatedCategories = get().categories.map(category => ({
          ...category,
          items: category.items.map(item => {
            const result = response.data.results.find((r: any) => r.id === item.id)
            if (result) {
              return {
                ...item,
                status: result.status,
                responseTime: result.responseTime,
                lastCheckTime: new Date().toISOString()
              }
            }
            return item
          })
        }))

        const allComplete = updatedCategories.every(cat => 
          cat.items.every(item => item.status === 'success' || item.status === 'failed')
        )
        const allPassed = updatedCategories.every(cat =>
          cat.items.every(item => item.status === 'success')
        )

        set({
          categories: updatedCategories,
          allChecksComplete: allComplete,
          allChecksPassed: allPassed,
          checking: false,
          lastCheckTime: new Date().toISOString()
        })
      }
    } catch (error) {
      console.error('网络检测失败:', error)
      set({ checking: false })
    }
  },

  // 检测单个项目
  checkSingle: async (categoryId: string, itemId: string) => {
    const categories = get().categories
    const category = categories.find(c => c.id === categoryId)
    const item = category?.items.find(i => i.id === itemId)
    
    if (!item) return

    // 更新状态为检测中
    const updatedCategories = categories.map(cat => {
      if (cat.id === categoryId) {
        return {
          ...cat,
          items: cat.items.map(i => {
            if (i.id === itemId) {
              return { ...i, status: 'checking' as const }
            }
            return i
          })
        }
      }
      return cat
    })
    set({ categories: updatedCategories })

    try {
      const response = await apiClient.checkSingleNetwork(item.url)
      
      if (response.success && response.data) {
        const finalCategories = get().categories.map(cat => {
          if (cat.id === categoryId) {
            return {
              ...cat,
              items: cat.items.map(i => {
                if (i.id === itemId) {
                  return {
                    ...i,
                    status: response.data.status,
                    responseTime: response.data.responseTime,
                    lastCheckTime: new Date().toISOString()
                  }
                }
                return i
              })
            }
          }
          return cat
        })
        
        set({ categories: finalCategories })
      }
    } catch (error) {
      console.error('单项网络检测失败:', error)
      const failedCategories = get().categories.map(cat => {
        if (cat.id === categoryId) {
          return {
            ...cat,
            items: cat.items.map(i => {
              if (i.id === itemId) {
                return {
                  ...i,
                  status: 'failed' as const,
                  lastCheckTime: new Date().toISOString()
                }
              }
              return i
            })
          }
        }
        return cat
      })
      set({ categories: failedCategories })
    }
  },

  // 重置所有检测状态
  reset: () => {
    set({
      categories: JSON.parse(JSON.stringify(initialCategories)),
      allChecksComplete: false,
      allChecksPassed: false,
      checking: false,
      lastCheckTime: undefined
    })
  }
}))

