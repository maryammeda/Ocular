import { useEffect, useRef } from 'react'

export default function ParticleCanvas() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf

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
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
      const w = rect.width
      const h = rect.height
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
      const w = canvas.getBoundingClientRect().width
      const h = canvas.getBoundingClientRect().height
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

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.5)
        grad.addColorStop(0, `rgba(255,255,255,${opacity})`)
        grad.addColorStop(1, 'transparent')
        ctx.fillStyle = grad
        ctx.fillRect(p.x - p.r * 2.5, p.y - p.r * 2.5, p.r * 5, p.r * 5)
      }

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
