import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // config.js vit à la racine du dépôt : il est partagé avec l'extension.
    fs: { allow: ['..'] },
  },
});
