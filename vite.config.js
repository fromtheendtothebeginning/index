import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 生产构建注入 CSP meta（dev 不注入，避免破坏 HMR）
const CSP_META = 'default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src \'self\' data: https://fonts.gstatic.com; img-src \'self\' data: blob: https:; media-src \'self\' blob: https:; connect-src \'self\'; frame-src https:; object-src \'none\'; base-uri \'self\'; form-action \'self\''

function cspPlugin() {
  return {
    name: 'inject-csp',
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html
      const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP_META}" />`
      return html.replace('<head>', `<head>\n    ${meta}`)
    },
  }
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
