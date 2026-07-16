/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_REAL_DATA_API?: string;
  readonly VITE_DATA_API_PREFIX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
