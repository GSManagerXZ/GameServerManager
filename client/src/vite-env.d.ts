/// <reference types="vite/client" />

declare const __GSM3_BUILD_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_SERVER_PORT?: string
  readonly VITE_CLIENT_PORT?: string
  readonly VITE_APP_VERSION?: string
  // 更多环境变量可以在这里添加
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
