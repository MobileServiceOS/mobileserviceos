import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Change this to match your GitHub repo name exactly
const REPO_NAME = 'mobileserviceos'

export default defineConfig({
  plugins: [react()],
  // base is the URL path prefix — must match your repo name for GitHub Pages
  base: process.env.NODE_ENV === 'production' ? `/${REPO_NAME}/` : '/',
  resolve: { alias: { '@': '/src' } },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split vendor chunks for better caching
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        }
      }
    }
  }
})
