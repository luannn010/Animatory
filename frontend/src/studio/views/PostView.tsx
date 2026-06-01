import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Project, PostStage, PostStatus } from '../types'
import { studioApi } from '../api'
import { PhaseStepperBar } from '../components/PhaseStepperBar'

const STATUS_LABEL: Record<PostStatus, string> = {
  done: 'done', active: 'in progress', pending: 'pending', locked: 'locked',
}
const STATUS_STYLE: Record<PostStatus, string> = {
  done:    'bg-[#00b48a]/10 text-[#00b48a]',
  active:  'bg-[#3772cf]/10 text-[#3772cf]',
  pending: 'bg-[#c37d0d]/10 text-[#c37d0d]',
  locked:  'bg-surface text-muted',
}

function StatusPill({ status }: { status: PostStatus }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
}

const ICONS: Record<string, string> = {
  Edit: '✂️', Mix: '🎚', 'Color Correction': '🎨', 'Online / QC': '🔍', Deliver: '🚀',
}

export function PostView() {
  const { id = '' } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [stages, setStages] = useState<PostStage[]>([])
  const [delivered, setDelivered] = useState(false)

  useEffect(() => {
    studioApi.getProject(id).then(setProject)
    studioApi.getPostStages(id).then(setStages)
  }, [id])

  if (!project) return <div className="text-sm text-stone">Loading…</div>

  const linear = stages.filter(s => !s.parallel)
  const audio = stages.filter(s => s.parallel)

  async function rename(title: string) { setProject(await studioApi.updateProjectTitle(id, title)) }
  function deliver() { setDelivered(true) }

  function row(stage: PostStage, isLast: boolean) {
    return (
      <div key={stage.id}>
        <div className="bg-canvas border border-hairline rounded-md px-5 py-4 flex items-center gap-3.5">
          <span className="text-lg w-9 text-center">{ICONS[stage.name] ?? '●'}</span>
          <div className="flex-1">
            <div className="font-medium text-sm text-ink">{stage.name}</div>
            <div className="text-xs text-stone mt-0.5">{stage.sub}</div>
          </div>
          <StatusPill status={stage.status} />
        </div>
        {!isLast && <div className="w-0.5 bg-hairline h-4 ml-[37px]" />}
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      <PhaseStepperBar project={project} current="post" onRename={rename} />

      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3772cf] font-mono mb-0.5">Phase 4</p>
      <h1 className="text-xl font-semibold text-ink tracking-tight">Post-production</h1>
      <p className="text-sm text-steel mt-1 mb-6">Edit → Audio → Mix → Color → QC → Deliver</p>

      <div className="flex flex-col">
        {/* Edit */}
        {linear[0] && row(linear[0], false)}

        {/* Parallel audio block */}
        <div className="bg-canvas border border-hairline rounded-md overflow-hidden">
          <div className="px-4 py-2.5 bg-surface border-b border-hairline text-[11px] font-semibold uppercase tracking-wider text-stone">
            Audio tracks — parallel
          </div>
          <div className="grid grid-cols-3">
            {audio.map((a, i) => (
              <div key={a.id} className={`p-4 ${i < audio.length - 1 ? 'border-r border-hairline' : ''}`}>
                <div className="font-semibold text-sm text-ink mb-1">{a.name}</div>
                <div className="text-xs text-stone mb-2">{a.sub}</div>
                <StatusPill status={a.status} />
              </div>
            ))}
          </div>
        </div>
        <div className="w-0.5 bg-hairline h-4 ml-[37px]" />

        {/* Remaining linear stages (Mix, Color, QC, Deliver) */}
        {linear.slice(1).map((s, i, arr) => row(s, i === arr.length - 1))}
      </div>

      <div className="flex justify-end items-center gap-3 border-t border-hairline mt-6 pt-5">
        {delivered && <span className="text-sm text-[#00b48a] font-medium">✓ Project delivered</span>}
        <button
          onClick={deliver}
          disabled={delivered}
          className="px-4 py-2 rounded-md bg-[#3772cf] text-white text-sm font-medium hover:bg-[#2c5cab] disabled:opacity-40"
        >
          Deliver Project →
        </button>
      </div>
    </div>
  )
}
