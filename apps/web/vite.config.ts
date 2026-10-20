import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { 'identity-provider': ['@supabase/supabase-js'] }
      }
    }
  },
  server: { proxy: { '/api': 'http://127.0.0.1:4000', '/mcp': 'http://127.0.0.1:4000' } }
});
