import { useEffect, useRef, useCallback } from 'react'

export default function ApertureCanvas({ triggerSnap }) {
  const canvasRef = useRef(null)
  const stateRef = useRef({
    breathPhase: 0,
    bladeAngle: 0,
    snapScale: 1,
    snapTarget: 1,
    rays: Array.from({ length: 12 }, (_, i) => ({
      angle: (i / 12) * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.008 + Math.random() * 0.006,
    })),
  })

  // Snap animation trigger
  const prevSnap = useRef(triggerSnap)
  useEffect(() => {
    if (triggerSnap !== prevSnap.current) {
      prevSnap.current = triggerSnap
      stateRef.current.snapScale = 0.25
    }
  }, [triggerSnap])

  const drawBlade = useCallback((ctx, cx, cy, radius, angle, openness) => {
    const bw = radius * 0.38
    const inner = radius * 0.18 * openness
    const outer = radius * openness

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)

    ctx.beginPath()
    ctx.moveTo(inner, -bw * 0.5)
    ctx.lineTo(outer, -bw * 0.25)
    ctx.quadraticCurveTo(outer + bw * 0.1, 0, outer, bw * 0.25)
    ctx.lineTo(inner, bw * 0.5)
    ctx.closePath()

    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.restore()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf
    let w = 0, h = 0

    // Pre-render glow stamp once
    const glowSize = 128
    const glowStamp = document.createElement('canvas')
    glowStamp.width = glowSize
    glowStamp.height = glowSize
    const gCtx = glowStamp.getContext('2d')
    const gg = gCtx.createRadialGradient(glowSize / 2, glowSize / 2, 0, glowSize / 2, glowSize / 2, glowSize / 2)
    gg.addColorStop(0, 'white')
    gg.addColorStop(1, 'transparent')
    gCtx.fillStyle = gg
    gCtx.fillRect(0, 0, glowSize, glowSize)

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      w = rect.width
      h = rect.height
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const animate = () => {
      const s = stateRef.current
      const cx = w / 2
      const cy = h / 2
      const radius = Math.min(w, h) * 0.3

      ctx.clearRect(0, 0, w, h)

      // Breathing
      s.breathPhase += 0.008
      const breath = 0.85 + 0.15 * Math.sin(s.breathPhase)

      // Snap recovery
      s.snapScale += (s.snapTarget - s.snapScale) * 0.04
      const scale = breath * s.snapScale

      // Blade rotation
      s.bladeAngle += 0.0015

      // Center glow — draw pre-rendered stamp with varying alpha
      const glowPulse = 0.04 + 0.02 * Math.sin(s.breathPhase * 1.3)
      const glowDrawSize = radius * 1.4
      ctx.globalAlpha = glowPulse
      ctx.drawImage(glowStamp, cx - glowDrawSize / 2, cy - glowDrawSize / 2, glowDrawSize, glowDrawSize)
      ctx.globalAlpha = 1

      // Light rays
      for (const ray of s.rays) {
        ray.phase += ray.speed
        const opacity = 0.03 + 0.04 * Math.sin(ray.phase)
        const len = radius * scale * 1.4

        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(ray.angle + s.bladeAngle)
        ctx.beginPath()
        ctx.moveTo(radius * 0.15, 0)
        ctx.lineTo(len, 0)
        ctx.strokeStyle = `rgba(255,255,255,${opacity})`
        ctx.lineWidth = 0.5
        ctx.stroke()
        ctx.restore()
      }

      // 8 aperture blades
      const BLADES = 8
      for (let i = 0; i < BLADES; i++) {
        const angle = (i / BLADES) * Math.PI * 2 + s.bladeAngle
        const dir = i % 2 === 0 ? 1 : -1
        const bladeRotation = angle + dir * s.breathPhase * 0.3
        drawBlade(ctx, cx, cy, radius, bladeRotation, scale)
      }

      // Inner ring
      ctx.beginPath()
      ctx.arc(cx, cy, radius * scale * 0.18, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 0.5
      ctx.stroke()

      // Outer ring
      ctx.beginPath()
      ctx.arc(cx, cy, radius * scale, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'
      ctx.lineWidth = 0.5
      ctx.stroke()

      raf = requestAnimationFrame(animate)
    }

    raf = requestAnimationFrame(animate)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [drawBlade])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    />
  )
}
