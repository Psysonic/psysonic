/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_PSYSONIC_FLATPAK?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    __psyHidden?: boolean;
    __psyBlurred?: boolean;
    __psyStartMinimizedToTray?: boolean;
    __psyIsTilingWm?: boolean;
    __psyLifecycleGeneration?: number;
  }
}

export {};
