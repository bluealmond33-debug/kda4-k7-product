/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_REAL_STT?: string;
  readonly VITE_USE_REAL_SUMMARY?: string;
  readonly VITE_USE_REAL_EMOTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
