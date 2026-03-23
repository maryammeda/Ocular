import { useState, useEffect, useRef, useCallback } from 'react'

export default function ScanReveal({ onComplete }) {
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState(false)
  const [dissolving, setDissolving] = useState(false)
  const containerRef = useRef(null)
  const progressRef = useRef(0)

  const getProgress = useCallback((clientX) => {
    const container = containerRef.current
    if (!container) return 0
    const rect = container.getBoundingClientRect()
    const padding = rect.width * 0.06
    const trackStart = rect.left + padding
    const trackEnd = rect.right - padding
    const trackWidth = trackEnd - trackStart
    return Math.max(0, Math.min(1, (clientX - trackStart) / trackWidth))
  }, [])

  const handlePointerDown = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
    progressRef.current = progress
    e.target.setPointerCapture(e.pointerId)
  }, [progress])

  const handlePointerMove = useCallback((e) => {
    if (!dragging) return
    const newProgress = getProgress(e.clientX)
    if (newProgress > progressRef.current) {
      progressRef.current = newProgress
    }
    setProgress(progressRef.current)
  }, [dragging, getProgress])

  const handlePointerUp = useCallback(() => {
    setDragging(false)
    if (progressRef.current > 0.8) {
      progressRef.current = 1
      setProgress(1)
      setTimeout(() => {
        setDissolving(true)
        setTimeout(() => {
          setDone(true)
          onComplete?.()
        }, 800)
      }, 200)
    }
  }, [onComplete])

  useEffect(() => {
    if (!dragging) return
    const move = (e) => handlePointerMove(e)
    const up = () => handlePointerUp()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, handlePointerMove, handlePointerUp])

  if (done) return null

  const zipX = 6 + progress * 88 // percentage from left
  const gapHeight = Math.min(progress * 160, 160)
  const curlAngle = Math.min(progress * 12, 12) // degrees of curl
  const curlY = Math.min(progress * 30, 30) // pixels of lift
  const teethCount = 32

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[200]"
      style={{ cursor: dragging ? 'grabbing' : 'default' }}
    >
      {/* Top half — curls upward */}
      <div
        className="absolute top-0 left-0 right-0 overflow-hidden"
        style={{
          height: `calc(50% - ${gapHeight / 2}px)`,
          opacity: dissolving ? 0 : 1,
          transformOrigin: 'center bottom',
          transform: dissolving
            ? `perspective(800px) rotateX(${curlAngle + 20}deg) translateY(-40px) scale(0.95)`
            : `perspective(800px) rotateX(${curlAngle}deg) translateY(-${curlY}px)`,
          transition: dissolving ? 'all 800ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
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
          {/* Bottom edge shadow for depth */}
          <div className="absolute bottom-0 left-0 right-0 h-16" style={{
            background: progress > 0.01
              ? `linear-gradient(to bottom, transparent, rgba(0,0,0,${0.3 + progress * 0.5}))`
              : 'none',
          }} />
        </div>
      </div>

      {/* Bottom half — curls downward */}
      <div
        className="absolute bottom-0 left-0 right-0 overflow-hidden"
        style={{
          height: `calc(50% - ${gapHeight / 2}px)`,
          opacity: dissolving ? 0 : 1,
          transformOrigin: 'center top',
          transform: dissolving
            ? `perspective(800px) rotateX(-${curlAngle + 20}deg) translateY(40px) scale(0.95)`
            : `perspective(800px) rotateX(-${curlAngle}deg) translateY(${curlY}px)`,
          transition: dissolving ? 'all 800ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
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
          {/* Top edge shadow for depth */}
          <div className="absolute top-0 left-0 right-0 h-16" style={{
            background: progress > 0.01
              ? `linear-gradient(to top, transparent, rgba(0,0,0,${0.3 + progress * 0.5}))`
              : 'none',
          }} />
        </div>
      </div>

      {/* Gap glow — light leaking through the opening */}
      {progress > 0.01 && !dissolving && (
        <div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            height: gapHeight + 60,
            background: `radial-gradient(ellipse at center, rgba(255,255,255,${0.02 + progress * 0.03}) 0%, transparent 70%)`,
          }}
        />
      )}

      {/* Zipper teeth along the horizontal center */}
      {!dissolving && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {Array.from({ length: teethCount }, (_, i) => {
            const toothX = 6 + (i / (teethCount - 1)) * 88
            const isAfterZip = toothX < zipX
            const separation = gapHeight / 2

            if (isAfterZip) {
              // Open teeth — separated vertically
              return (
                <g key={i} style={{ opacity: 0.25 }}>
                  <rect
                    x={`${toothX}%`} y={`calc(50% - ${separation + 6}px)`}
                    width="3" height="5" rx="0.5"
                    fill="rgba(255,255,255,0.2)"
                  />
                  <rect
                    x={`${toothX}%`} y={`calc(50% + ${separation + 1}px)`}
                    width="3" height="5" rx="0.5"
                    fill="rgba(255,255,255,0.2)"
                  />
                </g>
              )
            } else {
              // Closed teeth — interlocked at center
              return (
                <g key={i}>
                  <rect
                    x={`${toothX}%`} y="calc(50% - 5px)"
                    width="3" height="4" rx="0.5"
                    fill="rgba(255,255,255,0.1)"
                  />
                  <rect
                    x={`${toothX}%`} y="calc(50% + 1px)"
                    width="3" height="4" rx="0.5"
                    fill="rgba(255,255,255,0.1)"
                  />
                </g>
              )
            }
          })}

          {/* Track line after pull */}
          <line
            x1={`${zipX}%`} y1="50%" x2="94%" y2="50%"
            stroke="rgba(255,255,255,0.06)" strokeWidth="1"
          />
        </svg>
      )}

      {/* Zipper pull handle */}
      {!dissolving && (
        <div
          className="absolute top-1/2 -translate-y-1/2 z-10"
          style={{
            left: `${zipX}%`,
            transform: 'translate(-50%, -50%)',
            cursor: dragging ? 'grabbing' : 'grab',
            touchAction: 'none',
          }}
          onPointerDown={handlePointerDown}
        >
          <div className="relative flex items-center">
            {/* Connector to track */}
            <div className="h-px w-3 bg-white/20 mr-0.5" />
            {/* The pull tab */}
            <div
              className="relative w-10 h-7 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06))',
                border: '1px solid rgba(255,255,255,0.25)',
                boxShadow: dragging
                  ? '0 0 25px rgba(255,255,255,0.25), 0 0 60px rgba(255,255,255,0.08)'
                  : '0 0 12px rgba(255,255,255,0.1)',
                transition: 'box-shadow 200ms',
              }}
            >
              <div className="flex gap-0.5">
                <div className="w-0.5 h-3 rounded-full bg-white/25" />
                <div className="w-0.5 h-3 rounded-full bg-white/15" />
              </div>
            </div>
            {/* Hint */}
            {progress < 0.02 && (
              <div className="absolute left-full ml-4 whitespace-nowrap animate-pulse">
                <p className="text-white/30 text-[11px] tracking-[0.12em]" style={{ fontFamily: 'Barlow', fontWeight: 300 }}>
                  drag to open
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
