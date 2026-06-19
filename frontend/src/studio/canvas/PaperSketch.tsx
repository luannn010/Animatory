import { useEffect, useRef, useState } from 'react'
import { RATIO_CSS, type RatioKey } from './ShotThumb'

// Interactive ink sketch surface for the Shot Detail draw-frame. Ephemeral in v1
// (clears on shot change / Clear) — matches the design; no persistence yet.
export function PaperSketch({ shotId, ratio, clearSignal }: { shotId: string; ratio: RatioKey; clearSignal: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    setDirty(false)
  }, [clearSignal, shotId])

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true
    last.current = pos(e)
    setDirty(true)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = ref.current?.getContext('2d')
    if (!ctx || !last.current) return
    const p = pos(e)
    ctx.strokeStyle = '#2a2620'
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }
  function up() { drawing.current = false }

  return (
    <div className="ppc-drawframe ppc-hatch" style={{ aspectRatio: RATIO_CSS[ratio] }}>
      <canvas
        ref={ref} width={1024} height={576} className="ppc-drawframe__canvas"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
      />
      {!dirty && <span className="ppc-drawframe__hint">Draw the key pose / composition here</span>}
    </div>
  )
}
