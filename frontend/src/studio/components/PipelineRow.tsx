import { Link } from 'react-router-dom'
import type { VendorScene, VendorStage } from '../types'

const STAGES: { key: VendorStage; label: string }[] = [
  { key: 'rigs', label: 'Build Rigs' },
  { key: 'setup', label: 'Set Up' },
  { key: 'block', label: 'Block' },
  { key: 'animate', label: 'Animate' },
  { key: 'take1', label: 'Take 1s' },
  { key: 'editor', label: 'Editor' },
]

interface Props { scene: VendorScene }

export function PipelineRow({ scene }: Props) {
  function pipClass(stage: VendorStage): string {
    if (scene.completedStages.includes(stage)) return 'bg-[#00b48a]/10 text-[#00b48a]'
    if (stage === scene.stage && scene.stageStatus === 'retake') return 'bg-[#d45656]/10 text-[#d45656]'
    if (stage === scene.stage && scene.stageStatus === 'active') return 'bg-[#3772cf] text-white'
    return 'bg-surface text-stone border border-hairline'
  }
  const borderClass = scene.approved ? 'border-[#00d4a4]/40'
    : scene.stageStatus === 'retake' ? 'border-[#d45656]/50'
    : scene.stageStatus === 'active' ? 'border-[#3772cf]/40'
    : 'border-hairline'

  return (
    <div className={`bg-canvas border rounded-md px-4 py-3 flex items-center gap-4 ${borderClass}`}>
      <span className="font-mono text-xs text-stone w-14 shrink-0">{scene.sceneRef}</span>
      <div className="flex items-center gap-1 flex-wrap flex-1">
        {STAGES.map((s, i) => (
          <span key={s.key} className="flex items-center gap-1">
            {i > 0 && <span className="text-hairline text-[10px]">›</span>}
            <span className={`px-2 py-1 rounded-xs text-[11px] font-medium whitespace-nowrap ${pipClass(s.key)}`}>
              {s.label}{s.key === scene.stage && scene.stageStatus === 'retake' ? ' ↺' : ''}
              {s.key === 'editor' && scene.approved ? ' ✓' : ''}
            </span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {scene.retakeCount > 0 && (
          <span className="text-[11px] bg-[#d45656]/10 text-[#d45656] px-2 py-0.5 rounded-full font-medium">
            retake ×{scene.retakeCount}
          </span>
        )}
        {scene.approved && (
          <span className="text-[11px] bg-[#00b48a]/10 text-[#00b48a] px-2 py-0.5 rounded-full font-medium">approved</span>
        )}
        <Link to={`/agents?scene=${scene.sceneRef}`} className="text-[11px] text-[#3772cf] hover:underline underline-offset-2 whitespace-nowrap">
          ↗ Agent Canvas
        </Link>
      </div>
    </div>
  )
}
