// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020'
  },
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/exporters/GLTFExporter.js',
      'three/examples/jsm/exporters/STLExporter.js',
      'three-csg-ts'
    ]
  }
})
