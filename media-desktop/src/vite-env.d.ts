/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MEDIA_SERVICE_URL?: string;
  readonly VITE_MEDIA_SERVICE_API_KEY?: string;
  readonly VITE_CONTROL_PLANE_URL?: string;
  readonly VITE_CONTROL_PLANE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
