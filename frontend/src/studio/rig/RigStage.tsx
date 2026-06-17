// Placeholder stage for the rig editor. Renders the FK-resolved skeleton as a
// read-only SVG so the data flow is visible/demoable before the real canvas
// lands. THE KONVA STAGE DROPS IN HERE — replace this component; keep the props
// (bones, pose, selection, onSelectBone) so RigEditorView wiring is unchanged.
import type { Bone, RigMode } from '../types'
import { resolveSkeleton, type Pose } from './fk'

interface Props {
  bones: Bone[]
  pose: Pose
  selectedBoneId: string | null
  onSelectBone: (id: string) => void
  mode: RigMode
  width?: number
  height?: number
}

export function RigStage({ bones, pose, selectedBoneId, onSelectBone, width = 520, height = 460 }: Props) {
  const resolved = resolveSkeleton(bones, pose)

  return (
    <div className="relative rounded-lg border border-hairline bg-surface overflow-hidden">
      <span className="absolute left-2 top-2 z-10 rounded-full bg-canvas/90 px-2 py-0.5 text-[10px] font-medium text-stone backdrop-blur-sm">
        Preview · Konva stage mounts here
      </span>

      {bones.length === 0 ? (
        <div className="grid place-items-center text-center" style={{ height }}>
          <p className="max-w-[260px] text-sm text-stone">
            No bones yet. Switch to <span className="font-medium text-steel">Rig</span> mode and add the
            root bone to start the skeleton.
          </p>
        </div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="block h-full w-full" style={{ aspectRatio: `${width} / ${height}` }}>
          {bones.map(b => {
            const r = resolved.get(b.id)
            if (!r) return null
            const sel = b.id === selectedBoneId
            return (
              <g key={b.id} className="cursor-pointer" onClick={() => onSelectBone(b.id)}>
                {/* bone segment */}
                <line x1={r.x} y1={r.y} x2={r.tipX} y2={r.tipY}
                  stroke={sel ? '#3772cf' : '#5a5a5c'} strokeWidth={sel ? 4 : 3} strokeLinecap="round" />
                {/* pivot joint */}
                <circle cx={r.x} cy={r.y} r={5} fill="#ffffff" stroke={sel ? '#3772cf' : '#888888'} strokeWidth={2} />
                {/* tip handle */}
                <circle cx={r.tipX} cy={r.tipY} r={sel ? 5 : 4} fill={sel ? '#3772cf' : '#888888'} />
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}
