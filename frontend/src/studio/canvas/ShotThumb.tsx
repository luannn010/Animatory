import { type CanvasShot, STATUS_ORDER } from './canvasData'

// Aspect-ratio options shared by the board's ratio picker + the thumbnails.
export type RatioKey = '16:9' | '9:16' | '4:3' | '1:1'
export const RATIO_KEYS: RatioKey[] = ['16:9', '9:16', '4:3', '1:1']
export const RATIO_CSS: Record<RatioKey, string> = { '16:9': '16 / 9', '9:16': '9 / 16', '4:3': '4 / 3', '1:1': '1 / 1' }

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

/**
 * Deterministic storyboard-style gesture sketch — an honest pencil placeholder,
 * never fake finished art. Denser for boarded+ shots, sparse for early ones.
 */
export function ShotThumb({ shot, ratio }: { shot: CanvasShot; ratio: RatioKey }) {
  const seeded = STATUS_ORDER.indexOf(shot.status) >= STATUS_ORDER.indexOf('boarded')
  const h = hashId(shot.id)
  const horizon = 60 + (h % 40)
  const figX = 50 + (h % 5) * 34
  const op = seeded ? 0.5 : 0.16
  return (
    <div className="ppc-shot__sketch ppc-hatch" style={{ aspectRatio: RATIO_CSS[ratio] }}>
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style={{ display: 'block' }} aria-hidden="true">
        <g stroke="var(--ink)" fill="none" strokeWidth="1.6" strokeLinecap="round" opacity={op}>
          {/* horizon + framing crop marks */}
          <line x1="14" y1={horizon} x2="306" y2={horizon + (h % 7) - 3} />
          <path d="M14 14 H30 M14 14 V30 M306 14 H290 M306 14 V30 M14 166 H30 M14 166 V150 M306 166 H290 M306 166 V150" opacity="0.7" />
          {seeded && (
            <>
              {/* figure gesture */}
              <ellipse cx={figX} cy={horizon - 34} rx="9" ry="11" />
              <path d={`M${figX} ${horizon - 23} L${figX} ${horizon + 8} M${figX} ${horizon - 16} L${figX - 14} ${horizon - 4} M${figX} ${horizon - 16} L${figX + 13} ${horizon - 8} M${figX} ${horizon + 8} L${figX - 10} ${horizon + 30} M${figX} ${horizon + 8} L${figX + 11} ${horizon + 30}`} />
              {/* depth scribble */}
              <path d={`M${190 + (h % 30)} ${horizon - 10} q 20 -16 44 -4 t 40 6`} opacity="0.55" />
            </>
          )}
        </g>
      </svg>
    </div>
  )
}
