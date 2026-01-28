import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['electron-store'],
        // Native AI modules must be externalized
        include: ['node-llama-cpp', 'better-sqlite3']
      })
    ],
    build: {
      rollupOptions: {
        // Explicitly mark native modules as external
        external: ['node-llama-cpp', 'better-sqlite3']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@preload': resolve('src/preload')
      }
    },
    plugins: [
      TanStackRouterVite({
        autoCodeSplitting: true,
        routeToken: 'layout'
      }),
      tailwindcss(),
      react()
    ]
  }
})
