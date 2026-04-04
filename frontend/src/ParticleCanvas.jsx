import { useEffect, useRef } from 'react'

export default function ParticleCanvas() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf
    let w = 0, h = 0

    // Pre-render gradient stamp once (reused via drawImage + globalAlpha)
    const stampSize = 32
    const stamp = document.createElement('canvas')
    stamp.width = stampSize
    stamp.height = stampSize
    const sCtx = stamp.getContext('2d')
    const sg = sCtx.createRadialGradient(stampSize / 2, stampSize / 2, 0, stampSize / 2, stampSize / 2, stampSize / 2)
    sg.addColorStop(0, 'white')
    sg.addColorStop(1, 'transparent')
    sCtx.fillStyle = sg
    sCtx.fillRect(0, 0, stampSize, stampSize)

    const particles = Array.from({ length: 90 }, () => ({
      x: 0, y: 0,
      r: Math.random() * 1.6 + 0.2,
      baseOpacity: Math.random() * 0.55 + 0.08,
      speed: Math.random() * 0.35 + 0.08,
      drift: (Math.random() - 0.5) * 0.25,
      phase: Math.random() * Math.PI * 2,
    }))

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      w = rect.width
      h = rect.height
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)
      for (const p of particles) {
        if (p.x === 0) {
          p.x = Math.random() * w
          p.y = Math.random() * h
        }
      }
    }
    resize()
    window.addEventListener('resize', resize)

    const animate = () => {
      ctx.clearRect(0, 0, w, h)

      for (const p of particles) {
        p.y -= p.speed
        p.x += p.drift
        p.phase += 0.012

        // Wrap
        if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w }
        if (p.x < -5) p.x = w + 5
        if (p.x > w + 5) p.x = -5

        const opacity = p.baseOpacity * (0.65 + 0.35 * Math.sin(p.phase))
        const size = p.r * 5

        ctx.globalAlpha = opacity
        ctx.drawImage(stamp, p.x - size / 2, p.y - size / 2, size, size)
      }
      ctx.globalAlpha = 1

      raf = requestAnimationFrame(animate)
    }

    raf = requestAnimationFrame(animate)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  )
}
