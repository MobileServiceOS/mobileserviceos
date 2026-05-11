/// <reference types="vite/client" />

// Project-specific env vars in addition to Vite's built-ins (MODE, DEV, PROD, BASE_URL, SSR).
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_BASE_PATH?: string;
}

// CSS / asset import declarations are provided by `vite/client` above. The block
// below is a defensive fallback for environments where `vite/client` cannot be
// resolved (e.g. partial typecheck runs without node_modules); it has no effect
// when Vite's types are present because identical declarations win once.
declare module '*.css' { const c: string; export default c; }
declare module '*.svg' { const s: string; export default s; }
declare module '*.png' { const s: string; export default s; }
declare module '*.jpg' { const s: string; export default s; }
declare module '*.jpeg' { const s: string; export default s; }
declare module '*.gif' { const s: string; export default s; }
declare module '*.webp' { const s: string; export default s; }
