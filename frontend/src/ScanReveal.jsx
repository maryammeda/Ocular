import { useState, useEffect, useRef, useCallback } from 'react'

export default function ScanReveal({ onComplete }) {
  const [progress, setProgress] = useState(0) // 0 to 1
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState(false)
  const [dissolving, setDissolving] = useState(false)
  const containerRef = useRef(null)
  const startYRef = useRef(0)
  const progressRef = useRef(0)

  useEffect(() => {
    if (sessionStorage.getItem('ocular_revealed')) {
      setDone(true)
      onComplete?.()
    }
  }, [onComplete])

  const getProgress = useCallback((clientY) => {
    const container = containerRef.current
    if (!container) return 0
    const rect = container.getBoundingClientRect()
    const topPadding = rect.height * 0.08 // zipper starts 8% from top
    const bottomPadding = rect.height * 0.08
    const trackStart = rect.top + topPadding
    const trackEnd = rect.bottom - bottomPadding
    const trackHeight = trackEnd - trackStart
    return Math.max(0, Math.min(1, (clientY - trackStart) / trackHeight))
  }, [])

  const handlePointerDown = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
    startYRef.current = e.clientY
    progressRef.current = progress
    e.target.setPointerCapture(e.pointerId)
  }, [progress])

  const handlePointerMove = useCallback((e) => {
    if (!dragging) return
    const newProgress = getProgress(e.clientY)
    // Only allow dragging forward
    if (newProgress > progressRef.current) {
      progressRef.current = newProgress
    }
    setProgress(progressRef.current)
  }, [dragging, getProgress])

  const handlePointerUp = useCallback(() => {
    setDragging(false)
    // If past 85%, auto-complete
    if (progressRef.current > 0.85) {
      progressRef.current = 1
      setProgress(1)
      setTimeout(() => {
        setDissolving(true)
        setTimeout(() => {
          setDone(true)
          sessionStorage.setItem('ocular_revealed', '1')
          onComplete?.()
        }, 700)
      }, 300)
    }
  }, [onComplete])

  useEffect(() => {
    if (!dragging) return
    const handleMove = (e) => handlePointerMove(e)
    const handleUp = () => handlePointerUp()
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [dragging, handlePointerMove, handlePointerUp])

  if (done) return null

  const zipY = 8 + progress * 84 // percentage from top (8% to 92%)
  const teethCount = 28
  const gapWidth = Math.min(progress * 120, 120) // how far teeth separate

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[200]"
      style={{ cursor: dragging ? 'grabbing' : 'default' }}
    >
      {/* Left half */}
      <div
        className="absolute top-0 bottom-0 left-0 overflow-hidden"
        style={{
          width: `calc(50% - ${gapWidth / 2}px)`,
          opacity: dissolving ? 0 : 1,
          transform: dissolving ? 'translateX(-8%) scale(0.97)' : 'none',
          transition: dissolving ? 'all 700ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
        }}
      >
        <div className="absolute inset-0 bg-black">
          <div className="absolute inset-0" style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
          }} />
        </div>
      </div>

      {/* Right half */}
      <div
        className="absolute top-0 bottom-0 right-0 overflow-hidden"
        style={{
          width: `calc(50% - ${gapWidth / 2}px)`,
          opacity: dissolving ? 0 : 1,
          transform: dissolving ? 'translateX(8%) scale(0.97)' : 'none',
          transition: dissolving ? 'all 700ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
        }}
      >
        <div className="absolute inset-0 bg-black">
          <div className="absolute inset-0" style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
          }} />
        </div>
      </div>

      {/* Center gap glow (visible through the opening) */}
      {progress > 0.01 && !dissolving && (
        <div
          className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 pointer-events-none"
          style={{
            width: gapWidth + 40,
            background: `radial-gradient(ellipse at center, rgba(255,255,255,0.03) 0%, transparent 70%)`,
          }}
        />
      )}

      {/* Zipper teeth */}
      {!dissolving && (
        <svg
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
          style={{ opacity: dissolving ? 0 : 1 }}
        >
          {Array.from({ length: teethCount }, (_, i) => {
            const toothY = (8 + (i / (teethCount - 1)) * 84) // percentage
            const toothYpx = `${toothY}%`
            const isBelowZip = toothY > zipY
            const isNearZip = Math.abs(toothY - zipY) < 4

            // Teeth above zipper pull: separated
            // Teeth below: interlocked
            if (isBelowZip) {
              // Interlocked teeth (closed)
              return (
                <g key={i}>
                  {/* Left tooth */}
                  <rect
                    x="calc(50% - 6px)" y={toothYpx}
                    width="5" height="3" rx="0.5"
                    fill="rgba(255,255,255,0.12)"
                    style={{ transform: `translateX(-1px)` }}
                  />
                  {/* Right tooth */}
                  <rect
                    x="calc(50% + 1px)" y={toothYpx}
                    width="5" height="3" rx="0.5"
                    fill="rgba(255,255,255,0.12)"
                    style={{ transform: `translateX(1px)` }}
                  />
                </g>
              )
            } else {
              // Separated teeth (open)
              const separation = gapWidth / 2
              return (
                <g key={i} style={{ opacity: isNearZip ? 0.5 : 0.3 }}>
                  <rect
                    x={`calc(50% - ${separation + 6}px)`} y={toothYpx}
                    width="5" height="3" rx="0.5"
                    fill="rgba(255,255,255,0.15)"
                  />
                  <rect
                    x={`calc(50% + ${separation + 1}px)`} y={toothYpx}
                    width="5" height="3" rx="0.5"
                    fill="rgba(255,255,255,0.15)"
                  />
                </g>
              )
            }
          })}

          {/* Zipper track line below pull */}
          <line
            x1="50%" y1={`${zipY}%`} x2="50%" y2="92%"
            stroke="rgba(255,255,255,0.08)" strokeWidth="1"
          />
        </svg>
      )}

      {/* Zipper pull handle */}
      {!dissolving && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-10"
          style={{
            top: `${zipY}%`,
            transform: `translate(-50%, -50%)`,
            cursor: dragging ? 'grabbing' : 'grab',
            touchAction: 'none',
          }}
          onPointerDown={handlePointerDown}
        >
          {/* Pull tab */}
          <div className="relative flex flex-col items-center">
            {/* Connector line to track */}
            <div className="w-px h-3 bg-white/20 mb-0.5" />
            {/* The actual pull */}
            <div
              className="relative w-7 h-10 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(180deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05))',
                border: '1px solid rgba(255,255,255,0.2)',
                boxShadow: dragging
                  ? '0 0 20px rgba(255,255,255,0.2), 0 0 60px rgba(255,255,255,0.05)'
                  : '0 0 10px rgba(255,255,255,0.08)',
                transition: 'box-shadow 200ms',
              }}
            >
              {/* Inner detail */}
              <div className="w-1 h-4 rounded-full bg-white/20" />
            </div>
            {/* Hint text */}
            {progress < 0.02 && (
              <div className="absolute top-full mt-4 whitespace-nowrap animate-pulse">
                <p className="text-white/25 text-[11px] tracking-[0.15em]" style={{ fontFamily: 'Barlow', fontWeight: 300 }}>
                  drag to open
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Center text on cover */}
      {progress < 0.15 && !dissolving && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center" style={{ opacity: 1 - progress * 8 }}>
            <p className="text-white/[0.04] text-[11px] tracking-[0.6em] uppercase mb-2" style={{ fontFamily: 'Barlow', fontWeight: 300 }}>
              ocular
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
