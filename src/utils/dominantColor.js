// utils/dominantColor.js — 从图片提取主色（量化为 16 级/通道的最高频颜色，降级为平均值）
const cache = new Map()

export function getDominantColor(src) {
  if (cache.has(src)) return Promise.resolve(cache.get(src))
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const size = 32
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        const buckets = new Map()
        let sumR = 0, sumG = 0, sumB = 0, count = 0
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3]
          if (a < 128) continue
          const r = data[i], g = data[i + 1], b = data[i + 2]
          sumR += r; sumG += g; sumB += b; count += 1
          const key = `${r >> 4},${g >> 4},${b >> 4}`
          buckets.set(key, (buckets.get(key) || 0) + 1)
        }
        let color = null
        if (count > 0) {
          let bestKey = null, bestN = 0
          for (const [k, n] of buckets) {
            if (n > bestN) { bestN = n; bestKey = k }
          }
          const parts = bestKey.split(',').map(Number)
          const mr = (parts[0] << 4) + 8
          const mg = (parts[1] << 4) + 8
          const mb = (parts[2] << 4) + 8
          const max = Math.max(mr, mg, mb)
          const min = Math.min(mr, mg, mb)
          if (max - min < 40) {
            // 主色偏灰则用平均值，避免脏灰背景
            color = `rgb(${Math.round(sumR / count)},${Math.round(sumG / count)},${Math.round(sumB / count)})`
          } else {
            color = `rgb(${mr},${mg},${mb})`
          }
        }
        cache.set(src, color)
        resolve(color)
      } catch {
        // 跨域/读取失败：不设背景色
        cache.set(src, null)
        resolve(null)
      }
    }
    img.onerror = () => { cache.set(src, null); resolve(null) }
    img.src = src
  })
}
