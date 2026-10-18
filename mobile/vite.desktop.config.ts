import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// PC에는 모바일 화면 대신 저장·계정 처리 코드만 포함합니다.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'build/desktop-web',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./desktop-service.html', import.meta.url)) },
  },
})
