import { defineConfig } from 'vite';

// Bind to 0.0.0.0 so the VM preview proxy can reach the dev server.
// Allowed preview hosts come from __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS at runtime.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
});
