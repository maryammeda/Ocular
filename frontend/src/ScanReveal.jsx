import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

export default function ScanReveal({ onComplete }) {
  const [phase, setPhase] = useState('scanning') // scanning | dissolving | done
  const [scanY, setScanY] = useState(0)
  const rafRef = useRef(null)
  const startRef = useRef(null)

  const SCAN_DURATION = 2200
  const DISSOLVE_DURATION = 600

  useEffect(() => {
    // Check if already seen this session
    if (sessionStorage.getItem('ocular_revealed')) {
      setPhase('done')
      onComplete?.()
      return
    }

    const animate = (timestamp) => {
      if (!startRef.current) startRef.current = timestamp
      const elapsed = timestamp - startRef.current

      if (phase === 'scanning') {
        const progress = Math.min(elapsed / SCAN_DURATION, 1)
        // Ease out cubic for a natural deceleration
        const eased = 1 - Math.pow(1 - progress, 3)
        setScanY(eased * 100)

        if (progress >= 1) {
          setPhase('dissolving')
          startRef.current = timestamp
        }
      }

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase, onComplete])

  useEffect(() => {
    if (phase === 'dissolving') {
      const timer = setTimeout(() => {
        setPhase('done')
        sessionStorage.setItem('ocular_revealed', '1')
        onComplete?.()
      }, DISSOLVE_DURATION)
      return () => clearTimeout(timer)
    }
  }, [phase, onComplete])

  if (phase === 'done') return null

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none" style={{ perspective: '1000px' }}>
      {/* Dark cover — top half (already scanned, peels away) */}
      <div
        className="absolute left-0 right-0 top-0 overflow-hidden"
        style={{
          height: `${scanY}%`,
          opacity: phase === 'dissolving' ? 0 : 1,
          transition: phase === 'dissolving' ? `opacity ${DISSOLVE_DURATION}ms ease-out` : 'none',
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(180deg, #000 0%, #050505 100%)',
            transformOrigin: 'bottom center',
            transform: phase === 'dissolving' ? 'scaleY(0.95) translateY(-3%)' : 'none',
            transition: phase === 'dissolving' ? `transform ${DISSOLVE_DURATION}ms ease-out` : 'none',
          }}
        >
          {/* Subtle grid pattern on the cover */}
          <div className="absolute inset-0" style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }} />
          {/* Center text */}
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-white/[0.06] text-sm tracking-[0.5em] uppercase" style={{ fontFamily: 'Barlow', fontWeight: 300 }}>
              initializing
            </p>
          </div>
        </div>
      </div>

      {/* Dark cover — bottom half (not yet scanned) */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          top: `${scanY}%`,
          opacity: phase === 'dissolving' ? 0 : 1,
          transition: phase === 'dissolving' ? `opacity ${DISSOLVE_DURATION}ms ease-out` : 'none',
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: '#000',
            transformOrigin: 'top center',
            transform: phase === 'dissolving' ? 'scaleY(0.95) translateY(3%)' : 'none',
            transition: phase === 'dissolving' ? `transform ${DISSOLVE_DURATION}ms ease-out` : 'none',
          }}
        >
          <div className="absolute inset-0" style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }} />
        </div>
      </div>

      {/* Scan line */}
      {phase === 'scanning' && (
        <div
          className="absolute left-0 right-0"
          style={{ top: `${scanY}%`, transform: 'translateY(-50%)' }}
        >
          {/* Main bright line */}
          <div className="w-full h-[2px]" style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.8) 15%, white 50%, rgba(255,255,255,0.8) 85%, transparent 100%)',
            boxShadow: '0 0 20px rgba(255,255,255,0.6), 0 0 60px rgba(255,255,255,0.3), 0 0 120px rgba(255,255,255,0.1)',
          }} />
          {/* Glow above */}
          <div className="absolute bottom-full left-0 right-0 h-24" style={{
            background: 'linear-gradient(to top, rgba(255,255,255,0.06), transparent)',
          }} />
          {/* Glow below */}
          <div className="absolute top-full left-0 right-0 h-24" style={{
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.06), transparent)',
          }} />
          {/* Scan data fragments near the line */}
          <div className="absolute left-[10%] -top-6 text-[9px] font-mono text-white/20" style={{ fontWeight: 300 }}>
            {`OCR :: extracting`}
          </div>
          <div className="absolute right-[10%] top-3 text-[9px] font-mono text-white/15" style={{ fontWeight: 300 }}>
            {`idx:${Math.floor(scanY * 47)}`}
          </div>
        </div>
      )}
    </div>
  )
}
