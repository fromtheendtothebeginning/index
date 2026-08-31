import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import { t } from '../../i18n'

// 用 Vite ?worker 把 PDF.js worker 打包为独立 worker 文件（.js，标准 MIME），
// 避免动态 import .mjs 在部分服务器返回错误 MIME 时被浏览器拒绝
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker()

// 开源 PDF.js 渲染：canvas 逐页绘制，绕开 iframe/object 在 CSP（frame-src 不含 blob:）下的预览阻拦
function PdfPreview({ url }) {
  const containerRef = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container || !url) return
    let cancelled = false
    container.innerHTML = ''
    setError('')

    pdfjsLib.getDocument({ url }).promise
      .then(async pdf => {
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return
          const page = await pdf.getPage(i)
          const viewport = page.getViewport({ scale: 1.5 })
          const canvas = document.createElement('canvas')
          canvas.className = 'i2l-pdf-page'
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
          if (!cancelled) container.appendChild(canvas)
        }
      })
      .catch(e => {
        if (!cancelled) setError(e?.message || String(e))
      })

    return () => { cancelled = true }
  }, [url])

  if (error) {
    return <div className="i2l-pdf-err">{t('img2latex.err.preview')}：{error}</div>
  }
  return <div className="i2l-pdf" ref={containerRef} />
}

export default PdfPreview