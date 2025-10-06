import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface WallpaperSettings {
  // 主面板壁纸
  enabled: boolean
  imageUrl: string | null
  brightness: number // 0-100
  
  // 登录页壁纸
  loginEnabled: boolean
  loginImageUrl: string | null
  loginBrightness: number
  syncWithMain: boolean // 是否同步主面板壁纸
}

interface WallpaperStore {
  settings: WallpaperSettings
  setSettings: (settings: Partial<WallpaperSettings>) => void
  resetSettings: () => void
  updateMainWallpaper: (imageUrl: string | null) => void
  updateLoginWallpaper: (imageUrl: string | null) => void
  setBrightness: (brightness: number) => void
  setLoginBrightness: (brightness: number) => void
  toggleWallpaper: (enabled: boolean) => void
  toggleLoginWallpaper: (enabled: boolean) => void
  toggleSyncWithMain: (sync: boolean) => void
}

const defaultSettings: WallpaperSettings = {
  enabled: false,
  imageUrl: null,
  brightness: 50,
  loginEnabled: false,
  loginImageUrl: null,
  loginBrightness: 50,
  syncWithMain: true,
}

export const useWallpaperStore = create<WallpaperStore>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,

      setSettings: (newSettings: Partial<WallpaperSettings>) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings }
        }))
      },

      resetSettings: () => {
        set({ settings: defaultSettings })
      },

      updateMainWallpaper: (imageUrl: string | null) => {
        set((state) => ({
          settings: {
            ...state.settings,
            imageUrl,
            enabled: imageUrl !== null,
          }
        }))
      },

      updateLoginWallpaper: (imageUrl: string | null) => {
        set((state) => ({
          settings: {
            ...state.settings,
            loginImageUrl: imageUrl,
            loginEnabled: imageUrl !== null,
          }
        }))
      },

      setBrightness: (brightness: number) => {
        set((state) => ({
          settings: { ...state.settings, brightness }
        }))
      },

      setLoginBrightness: (brightness: number) => {
        set((state) => ({
          settings: { ...state.settings, loginBrightness: brightness }
        }))
      },

      toggleWallpaper: (enabled: boolean) => {
        set((state) => ({
          settings: { ...state.settings, enabled }
        }))
      },

      toggleLoginWallpaper: (enabled: boolean) => {
        set((state) => ({
          settings: { ...state.settings, loginEnabled: enabled }
        }))
      },

      toggleSyncWithMain: (sync: boolean) => {
        set((state) => ({
          settings: { ...state.settings, syncWithMain: sync }
        }))
      },
    }),
    {
      name: 'gsm3-wallpaper',
      partialize: (state) => ({ settings: state.settings }),
    }
  )
)

