import tailwindcss from '@tailwindcss/vite'
import tanstackRouter from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(() => ({
  plugins: [tailwindcss(), tanstackRouter({ autoCodeSplitting: true }), react({ compiler: true })],
  resolve: { dedupe: ['react', 'react-dom'], tsconfigPaths: true },
  server: {
    port: Number(process.env.PORT || 3300),
    // The worker owns /go and /p in production; in dev, proxy them to wrangler is overkill,
    // so the SPA answers them with a small page that calls the same Convex functions.
  },
}))
