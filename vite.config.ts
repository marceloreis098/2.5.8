import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react-dom/client',
        'lucide-react',
        'recharts',
        'qrcode.react',
        '@google/genai',
        'xlsx',
      ],
    },
  },
})