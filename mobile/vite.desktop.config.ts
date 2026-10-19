import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// PC에는 모바일 화면 대신 저장·계정 처리 코드만 포함합니다.
export default defineConfig({
  publicDir: false,
  plugins: [{
    name: 'desktop-service-only',
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue
        for (const id of item.moduleIds) {
          const path = id.replaceAll('\\', '/').split('?')[0]
          if (/\/src\/(?:views|game)\//.test(path)
              || /\/src\/(?:app|logo)\.ts$/.test(path)
              || /\.(?:css|wasm)$/.test(path)
              || /\/engine\.worker\.ts$/.test(path)) {
            this.error(`Mobile UI or engine included in desktop save service: ${id}`)
          }
        }
      }
    },
  }],
  build: {
    outDir: 'build/desktop-web',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./desktop-service.html', import.meta.url)) },
  },
})
