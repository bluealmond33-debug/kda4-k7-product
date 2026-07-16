/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_REAL_STT?: string;
  readonly VITE_USE_REAL_SUMMARY?: string;
  readonly VITE_USE_REAL_EMOTION?: string;
  readonly VITE_USE_REAL_DATA_API?: string;
  readonly VITE_DATA_API_PREFIX?: string;
  readonly VITE_DATA_ACCESS_PURPOSE?: string;
  readonly VITE_DEMO_SESSION_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
