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
    return Math.max(0, Math.min(1, (clientX - trackStart) / (trackEnd - trackStart)))
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
    if (progressRef.current > 0.75) {
      progressRef.current = 1
      setProgress(1)
      setTimeout(() => {
        setDissolving(true)
        setTimeout(() => {
          setDone(true)
          onComplete?.()
        }, 900)
      }, 150)
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

  const zipX = 6 + progress * 88
  const gapHeight = Math.min(progress * 220, 220)

  // Much more aggressive curl for fabric feel
  const curlAngle = progress * 45 // up to 45 degrees
  const curlY = progress * 80 // strong lift
  const scaleX = 1 - progress * 0.08 // slight horizontal squeeze as it curls

  const teethCount = 36

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[200]"
      style={{ cursor: dragging ? 'grabbing' : 'default', perspective: '1200px' }}
    >
      {/* Top half — curls upward like fabric */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: `calc(50% - ${gapHeight / 2}px)`,
          opacity: dissolving ? 0 : 1,
          transformOrigin: 'center bottom',
          transform: dissolving
            ? `perspective(600px) rotateX(75deg) translateY(-120px) scaleX(0.9)`
            : `perspective(600px) rotateX(${curlAngle}deg) translateY(-${curlY}px) scaleX(${scaleX})`,
          transition: dissolving ? 'all 900ms cubic-bezier(0.36, 0, 0.66, -0.56)' : 'transform 0.05s ease-out',
          backfaceVisibility: 'hidden',
        }}
      >
        <div className="absolute inset-0 bg-black">
          <div className="absolute inset-0" style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
          }} />
          {/* Fold shadow — gets darker as it curls more */}
          <div className="absolute bottom-0 left-0 right-0" style={{
            height: `${30 + progress * 40}%`,
            background: `linear-gradient(to bottom, transparent, rgba(0,0,0,${progress * 0.8}))`,
          }} />
          {/* Highlight on the fold edge */}
          <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{
            background: `linear-gradient(90deg, transparent 5%, rgba(255,255,255,${0.05 + progress * 0.12}) 50%, transparent 95%)`,
            boxShadow: progress > 0.05 ? `0 0 ${8 + progress * 15}px rgba(255,255,255,${progress * 0.08})` : 'none',
          }} />
        </div>
      </div>

      {/* Bottom half — curls downward like fabric */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          height: `calc(50% - ${gapHeight / 2}px)`,
          opacity: dissolving ? 0 : 1,
          transformOrigin: 'center top',
          transform: dissolving
            ? `perspective(600px) rotateX(-75deg) translateY(120px) scaleX(0.9)`
            : `perspective(600px) rotateX(-${curlAngle}deg) translateY(${curlY}px) scaleX(${scaleX})`,
          transition: dissolving ? 'all 900ms cubic-bezier(0.36, 0, 0.66, -0.56)' : 'transform 0.05s ease-out',
          backfaceVisibility: 'hidden',
        }}
      >
        <div className="absolute inset-0 bg-black">
          <div className="absolute inset-0" style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
          }} />
          {/* Fold shadow */}
          <div className="absolute top-0 left-0 right-0" style={{
            height: `${30 + progress * 40}%`,
            background: `linear-gradient(to top, transparent, rgba(0,0,0,${progress * 0.8}))`,
          }} />
          {/* Highlight on the fold edge */}
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{
            background: `linear-gradient(90deg, transparent 5%, rgba(255,255,255,${0.05 + progress * 0.12}) 50%, transparent 95%)`,
            boxShadow: progress > 0.05 ? `0 0 ${8 + progress * 15}px rgba(255,255,255,${progress * 0.08})` : 'none',
          }} />
        </div>
      </div>

      {/* Gap glow — bright light pouring through */}
      {progress > 0.01 && !dissolving && (
        <>
          <div
            className="absolute left-0 right-0 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              height: gapHeight + 100,
              background: `radial-gradient(ellipse 80% 100% at center, rgba(255,255,255,${0.03 + progress * 0.06}) 0%, transparent 60%)`,
            }}
          />
          {/* Horizontal light streak in the gap */}
          <div
            className="absolute left-0 top-1/2 pointer-events-none"
            style={{
              width: `${zipX}%`,
              height: '1px',
              transform: 'translateY(-0.5px)',
              background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,${progress * 0.06}) 30%, rgba(255,255,255,${progress * 0.1}) 100%)`,
              boxShadow: `0 0 ${20 + progress * 40}px ${4 + progress * 10}px rgba(255,255,255,${progress * 0.04})`,
            }}
          />
        </>
      )}

      {/* Zipper teeth */}
      {!dissolving && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
          {Array.from({ length: teethCount }, (_, i) => {
            const toothX = 6 + (i / (teethCount - 1)) * 88
            const isOpen = toothX < zipX
            const separation = gapHeight / 2
            const distFromZip = Math.abs(toothX - zipX)
            const nearGlow = distFromZip < 5 ? (1 - distFromZip / 5) * 0.4 : 0

            if (isOpen) {
              return (
                <g key={i}>
                  <rect
                    x={`${toothX}%`} y={`calc(50% - ${separation + 7}px)`}
                    width="3" height="5" rx="0.5"
                    fill={`rgba(255,255,255,${0.1 + nearGlow})`}
                  />
                  <rect
                    x={`${toothX}%`} y={`calc(50% + ${separation + 2}px)`}
                    width="3" height="5" rx="0.5"
                    fill={`rgba(255,255,255,${0.1 + nearGlow})`}
                  />
                </g>
              )
            } else {
              return (
                <g key={i}>
                  <rect
                    x={`${toothX}%`} y="calc(50% - 5px)"
                    width="3" height="4" rx="0.5"
                    fill={`rgba(255,255,255,${0.06 + nearGlow})`}
                  />
                  <rect
                    x={`${toothX}%`} y="calc(50% + 1px)"
                    width="3" height="4" rx="0.5"
                    fill={`rgba(255,255,255,${0.06 + nearGlow})`}
                  />
                </g>
              )
            }
          })}

          <line
            x1={`${zipX}%`} y1="50%" x2="94%" y2="50%"
            stroke="rgba(255,255,255,0.05)" strokeWidth="1"
          />
        </svg>
      )}

      {/* Zipper pull handle — GLOWY */}
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
            {/* Outer glow ring */}
            <div className="absolute -inset-6 rounded-full pointer-events-none" style={{
              background: `radial-gradient(circle, rgba(255,255,255,${dragging ? 0.12 : 0.05}) 0%, transparent 70%)`,
              transition: 'background 200ms',
            }} />
            {/* Pulsing glow ring */}
            <div className="absolute -inset-10 rounded-full pointer-events-none" style={{
              background: `radial-gradient(circle, rgba(255,255,255,${dragging ? 0.06 : 0.02}) 0%, transparent 70%)`,
              animation: dragging ? 'none' : 'pulse-glow 2.5s ease-in-out infinite',
            }} />
            {/* Connector */}
            <div className="h-px w-3 mr-0.5" style={{
              background: `rgba(255,255,255,${0.2 + progress * 0.3})`,
              boxShadow: `0 0 6px rgba(255,255,255,${progress * 0.2})`,
            }} />
            {/* The pull tab */}
            <div
              className="relative w-11 h-8 rounded-full flex items-center justify-center"
              style={{
                background: dragging
                  ? 'linear-gradient(135deg, rgba(255,255,255,0.3), rgba(255,255,255,0.12))'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0.07))',
                border: `1px solid rgba(255,255,255,${dragging ? 0.5 : 0.3})`,
                boxShadow: dragging
                  ? '0 0 30px rgba(255,255,255,0.35), 0 0 60px rgba(255,255,255,0.15), 0 0 100px rgba(255,255,255,0.05), inset 0 1px 1px rgba(255,255,255,0.2)'
                  : '0 0 15px rgba(255,255,255,0.15), 0 0 40px rgba(255,255,255,0.05), inset 0 1px 1px rgba(255,255,255,0.1)',
                transition: 'all 200ms',
              }}
            >
              <div className="flex gap-[3px]">
                <div className="w-[2px] h-3.5 rounded-full" style={{ background: `rgba(255,255,255,${dragging ? 0.5 : 0.3})` }} />
                <div className="w-[2px] h-3.5 rounded-full" style={{ background: `rgba(255,255,255,${dragging ? 0.35 : 0.2})` }} />
              </div>
            </div>
            {/* Hint */}
            {progress < 0.02 && (
              <div className="absolute left-full ml-5 whitespace-nowrap animate-pulse">
                <p className="text-white/30 text-[11px] tracking-[0.12em]" style={{ fontFamily: 'Barlow', fontWeight: 300 }}>
                  drag to open
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pulse glow keyframes */}
      <style>{`
        @keyframes pulse-glow {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}
