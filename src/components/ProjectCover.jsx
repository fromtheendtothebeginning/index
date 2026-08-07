import { useEffect, useState } from 'react'
import { getDominantColor } from '../utils/dominantColor'

function ProjectCover({ src, alt, className, bgColor = '' }) {
  const [bg, setBg] = useState('')

  useEffect(() => {
    let cancelled = false
    setBg('')
    if (!src) return
    getDominantColor(src)
      .then(color => { if (!cancelled) setBg(color || '') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [src])

  const finalBg = bgColor || bg || ''

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={finalBg ? { background: finalBg } : undefined}
    />
  )
}

export default ProjectCover
