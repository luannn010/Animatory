import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Project, Scene } from '../types'
import { studioApi } from '../api'
import { phasePath } from '../phases'
import { PhaseStepperBar } from '../components/PhaseStepperBar'
import { SceneCard } from '../components/SceneCard'

interface UploadedFile { name: string; size: string }

export function ParseView() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [files, setFiles] = useState<UploadedFile[]>([
    { name: 'ep_script_v1.fountain', size: '42 KB' },
  ])
  const [pasteText, setPasteText] = useState('')

  useEffect(() => {
    studioApi.getProject(id).then(setProject)
    studioApi.getScenes(id).then(setScenes)
  }, [id])

  if (!project) return <div className="text-sm text-stone">Loading…</div>

  function mockUpload() {
    setFiles(f => [...f, { name: `transcript_${f.length + 1}.txt`, size: '8 KB' }])
  }
  async function rename(title: string) {
    setProject(await studioApi.updateProjectTitle(id, title))
  }
  async function cont() {
    await studioApi.advancePhase(id, 'pre')
    navigate(phasePath(id, 'pre'))
  }

  return (
    <div className="max-w-5xl">
      <PhaseStepperBar project={project} current="parse" onRename={rename} />

      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3772cf] font-mono mb-0.5">Phase 1</p>
      <h1 className="text-xl font-semibold text-ink tracking-tight">Script Parsing</h1>
      <p className="text-sm text-steel mt-1 mb-6">Upload scripts or transcripts. The AI extracts scene clips automatically.</p>

      <button
        onClick={mockUpload}
        className="w-full border-2 border-dashed border-hairline rounded-lg p-10 text-center hover:border-[#3772cf]/50 hover:bg-[#3772cf]/[0.03] transition-colors mb-5"
      >
        <div className="text-2xl mb-2">📄</div>
        <div className="font-medium text-ink">Drop scripts here, or click to browse</div>
        <div className="text-sm text-stone mt-0.5">.txt, .pdf, .fdx, .fountain</div>
      </button>

      <textarea
        value={pasteText}
        onChange={e => setPasteText(e.target.value)}
        placeholder="…or paste script text here"
        className="w-full h-20 mb-5 rounded-md border border-hairline bg-canvas p-3 text-sm text-ink outline-none focus:border-[#3772cf] resize-none"
      />

      <div className="flex flex-wrap gap-2.5 mb-6">
        {files.map((f, i) => (
          <div key={i} className="flex items-center gap-2 bg-canvas border border-hairline rounded-sm px-3 py-2 text-sm">
            <span>📄</span>
            <div>
              <div className="font-medium text-ink text-xs">{f.name}</div>
              <div className="text-stone text-[11px]">{f.size} · uploaded</div>
            </div>
            <span className="text-[#00b48a] ml-1">✓</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-px bg-hairline" />
        <span className="text-xs text-stone">{scenes.length} scenes extracted</span>
        <div className="flex-1 h-px bg-hairline" />
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 mb-7">
        {scenes.map(s => <SceneCard key={s.id} scene={s} />)}
      </div>

      <div className="flex justify-end gap-2.5 border-t border-hairline pt-5">
        <button className="px-4 py-2 rounded-md border border-hairline text-steel text-sm hover:bg-surface">Re-parse</button>
        <button onClick={cont} className="px-4 py-2 rounded-md bg-[#3772cf] text-white text-sm font-medium hover:bg-[#2c5cab]">
          Continue to Pre-production →
        </button>
      </div>
    </div>
  )
}
