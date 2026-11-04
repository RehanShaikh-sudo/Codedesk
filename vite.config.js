import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  resolve: {
    dedupe: [
      'monaco-editor',
      'vscode',
      '@codingame/monaco-vscode-api',
    ],
  },
})
