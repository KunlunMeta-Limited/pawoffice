/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAWOFFICE_CHAT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css' {}
