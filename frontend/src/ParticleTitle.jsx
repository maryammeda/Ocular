import { useEffect, useRef } from 'react'

const REPEL_RADIUS = 90
const REPEL_STRENGTH = 7
const SPRING = 0.055
const FRICTION = 0.82

export default function ParticleTitle({ text = 'OCULAR' }) {
  const canvasRef = useRef(null)
  const mouseRef = useRef({ x: -9999, y: -9999 })
  const particlesRef = useRef([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf

    // Pre-render glow stamp once (reused via drawImage + globalAlpha)
    const glowStampSize = 32
    const glowStamp = document.createElement('canvas')
    glowStamp.width = glowStampSize
    glowStamp.height = glowStampSize
    const gsCtx = glowStamp.getContext('2d')
    const gsg = gsCtx.createRadialGradient(glowStampSize / 2, glowStampSize / 2, 0, glowStampSize / 2, glowStampSize / 2, glowStampSize / 2)
    gsg.addColorStop(0, 'white')
    gsg.addColorStop(1, 'transparent')
    gsCtx.fillStyle = gsg
    gsCtx.fillRect(0, 0, glowStampSize, glowStampSize)

    const init = async () => {
      await document.fonts.load("italic 80px 'Instrument Serif'")

      const dpr = window.devicePixelRatio || 1
      const containerW = canvas.offsetWidth
      const canvasH = 180
      canvas.width = containerW * dpr
      canvas.height = canvasH * dpr
      canvas.style.height = canvasH + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const fontSize = Math.min(containerW * 0.14, 110)

      // Render text offscreen to sample pixels
      const offscreen = document.createElement('canvas')
      offscreen.width = containerW
      offscreen.height = canvasH
      const offCtx = offscreen.getContext('2d')
      offCtx.fillStyle = 'white'
      offCtx.font = `italic ${fontSize}px 'Instrument Serif'`
      offCtx.textAlign = 'center'
      offCtx.textBaseline = 'middle'
      offCtx.fillText(text, containerW / 2, canvasH / 2)

      // Sample pixels
      const imageData = offCtx.getImageData(0, 0, containerW, canvasH)
      const stride = 3
      const particles = []

      for (let y = 0; y < canvasH; y += stride) {
        for (let x = 0; x < containerW; x += stride) {
          const idx = (y * containerW + x) * 4
          if (imageData.data[idx + 3] > 100) {
            const startAbove = Math.random() > 0.5
            particles.push({
              x: Math.random() * containerW,
              y: startAbove ? -Math.random() * canvasH : canvasH + Math.random() * canvasH,
              tx: x,
              ty: y,
              vx: 0,
              vy: 0,
              r: Math.random() * 0.85 + 0.45,
              opacity: 0,
              phase: Math.random() * Math.PI * 2,
            })
          }
        }
      }

      particlesRef.current = particles
    }

    const animate = () => {
      const w = canvas.offsetWidth
      const h = 180
      ctx.clearRect(0, 0, w, h)

      const mouse = mouseRef.current
      const particles = particlesRef.current

      for (const p of particles) {
        // Cursor repulsion
        const dx = p.x - mouse.x
        const dy = p.y - mouse.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist < REPEL_RADIUS && dist > 0) {
          const force = (REPEL_RADIUS - dist) / REPEL_RADIUS * REPEL_STRENGTH
          p.vx += (dx / dist) * force
          p.vy += (dy / dist) * force
        }

        // Spring back to target
        const sx = p.tx - p.x
        const sy = p.ty - p.y
        p.vx += sx * SPRING
        p.vy += sy * SPRING

        // Friction
        p.vx *= FRICTION
        p.vy *= FRICTION

        p.x += p.vx
        p.y += p.vy

        // Breathing drift when settled
        const settled = Math.abs(sx) < 2 && Math.abs(sy) < 2
        if (settled) {
          p.phase += 0.02
          p.x += Math.sin(p.phase) * 0.3
          p.y += Math.cos(p.phase * 0.7) * 0.3
        }

        // Fade in
        if (p.opacity < 1) p.opacity = Math.min(1, p.opacity + 0.022)

        // Near cursor glow — draw pre-rendered stamp with varying alpha
        if (dist < REPEL_RADIUS * 1.5 && dist > 0) {
          const nearFactor = 1 - dist / (REPEL_RADIUS * 1.5)
          const glowR = p.r * 4
          ctx.globalAlpha = nearFactor * 0.3 * p.opacity
          ctx.drawImage(glowStamp, p.x - glowR, p.y - glowR, glowR * 2, glowR * 2)
          ctx.globalAlpha = 1
        }

        // Draw particle
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${p.opacity})`
        ctx.fill()
      }

      raf = requestAnimationFrame(animate)
    }

    init().then(() => {
      raf = requestAnimationFrame(animate)
    })

    const handleMove = (e) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const handleLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 }
    }

    const handleResize = () => {
      // Re-init on resize
      cancelAnimationFrame(raf)
      init().then(() => {
        raf = requestAnimationFrame(animate)
      })
    }

    canvas.addEventListener('mousemove', handleMove)
    canvas.addEventListener('mouseleave', handleLeave)
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('mousemove', handleMove)
      canvas.removeEventListener('mouseleave', handleLeave)
      window.removeEventListener('resize', handleResize)
    }
  }, [text])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '180px',
        cursor: 'none',
        background: 'transparent',
      }}
    />
  )
}
