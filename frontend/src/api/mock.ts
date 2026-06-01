import type {
  AgentSchema,
  RunRecord,
  RunTriggerRequest,
  RunTriggerResponse,
  HealthResponse,
  RunEvent,
  OutputArtifact,
} from '../types'

// ── Fixture agents ───────────────────────────────────────────────────────────

export const MOCK_AGENTS: AgentSchema[] = [
  {
    id: 'orch.showrunner',
    name: 'Showrunner / Orchestrator',
    layer: 'orchestration',
    stack: 'orchestration',
    role: 'Producer / Script Breakdown',
    responsibility: 'Parse script, build asset breakdown, spawn tracks, gate handoffs',
    status: 'idle',
    inputs: [{ name: 'final_script', type: 'text', required: true }],
    outputs: [{ name: 'breakdown', type: 'json', required: false, path: 'breakdown.json' }],
    trigger: 'manual',
    idempotent: false,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 120,
    acceptance: ['every script entity present in breakdown'],
    cost_estimate: '~$0.05 / episode',
  },
  {
    id: 'orch.editor_retake',
    name: 'Editor / Retakes Loop',
    layer: 'orchestration',
    stack: 'orchestration',
    role: 'Editor / Retakes loop',
    responsibility: 'Assemble Take-1 shots, judge timing/quality, loop retakes, emit 1st cut',
    status: 'idle',
    inputs: [{ name: 'take1_shots', type: 'video', required: true }],
    outputs: [{ name: 'first_cut', type: 'video', required: false, path: 'first_cut.mp4' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 7, backoff: 'none' },
    timeout_s: 600,
    acceptance: ['timing reads clean', 'no wrong assets', 'no puppety snapping'],
    cost_estimate: '~$0.80 / retake loop',
  },
  {
    id: 'gate.checking',
    name: 'Checking Gate',
    layer: 'orchestration',
    stack: 'orchestration',
    role: 'Checking / Final Materials Ship',
    responsibility: 'Cross-check animatic vs designs, validate completeness, package for vendor',
    status: 'idle',
    inputs: [{ name: 'all_prepro_assets', type: 'file', required: true }],
    outputs: [{ name: 'vendor_package', type: 'file', required: false, path: 'vendor_package.zip' }],
    trigger: 'called_by_orchestrator',
    idempotent: true,
    retry: { max_attempts: 1, backoff: 'none' },
    timeout_s: 60,
    acceptance: ['no omitted assets', 'no unaddressed added assets', 'package self-contained'],
    cost_estimate: '~$0.02',
  },
  {
    id: 'design.lineart',
    name: 'Design Agent — Line Art',
    layer: 'execution',
    stack: 'image',
    role: 'B&W Rough → Final Models',
    responsibility: 'Generate clean line model sheets + turnarounds (all angles)',
    status: 'idle',
    inputs: [{ name: 'breakdown', type: 'json', required: true }],
    outputs: [{ name: 'model_sheets', type: 'image', required: false, path: 'model_sheets/' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 3, backoff: 'linear' },
    timeout_s: 300,
    acceptance: ['consistent identity across sheets', 'every angle present'],
    cost_estimate: '~$0.30 / character',
  },
  {
    id: 'design.color',
    name: 'Design Agent — Color',
    layer: 'execution',
    stack: 'image',
    role: 'Color Styling / BG Paint / Final Color',
    responsibility: 'Color characters & props; paint backgrounds; lighting variants',
    status: 'idle',
    inputs: [{ name: 'model_sheets', type: 'image', required: true }],
    outputs: [{ name: 'color_sheets', type: 'image', required: false, path: 'color_sheets/' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 3, backoff: 'linear' },
    timeout_s: 300,
    acceptance: ['palette consistent per asset', 'wide high-res BG (2K/4K)'],
    cost_estimate: '~$0.25 / character',
  },
  {
    id: 'design.mouthchart',
    name: 'Mouth Chart Agent',
    layer: 'execution',
    stack: 'image',
    role: 'Mouth Charts / Phoneme library',
    responsibility: 'One mouth shape per phoneme x emotion; map phoneme→frames',
    status: 'idle',
    inputs: [
      { name: 'color_sheets', type: 'image', required: true },
      { name: 'xsheets', type: 'json', required: true },
    ],
    outputs: [{ name: 'mouth_charts', type: 'image', required: false, path: 'mouth_charts/' }],
    trigger: 'called_by_orchestrator',
    idempotent: true,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 120,
    acceptance: ['language-agnostic mapping', 'aligned to dialogue timing'],
    cost_estimate: '~$0.10',
  },
  {
    id: 'board.storyboard',
    name: 'Storyboard Agent',
    layer: 'execution',
    stack: 'text',
    role: 'Storyboard → Animatic',
    responsibility: 'Plan shots/poses, build timed animatic from key poses',
    status: 'idle',
    inputs: [
      { name: 'script', type: 'text', required: true },
      { name: 'predesign', type: 'image', required: false },
    ],
    outputs: [
      { name: 'animatic', type: 'video', required: false, path: 'animatic.mp4' },
      { name: 'boards', type: 'image', required: false, path: 'boards/' },
    ],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 240,
    acceptance: ['key poses only', 'camera + timing annotations present'],
    cost_estimate: '~$0.15 / scene',
  },
  {
    id: 'cast.dialogue',
    name: 'Dialogue / Casting Agent',
    layer: 'execution',
    stack: 'audio',
    role: 'Casting / Record / Dialogue Edit',
    responsibility: 'Per-character voices, generate reads, clean clicks/breaths, X-sheets',
    status: 'idle',
    inputs: [{ name: 'script', type: 'text', required: true }],
    outputs: [
      { name: 'dialogue', type: 'audio', required: false, path: 'dialogue/' },
      { name: 'xsheets', type: 'json', required: false, path: 'xsheets.json' },
    ],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 3, backoff: 'linear' },
    timeout_s: 180,
    acceptance: ['consistent voice per character', 'timing data emitted'],
    cost_estimate: '~$0.20 / minute of dialogue',
  },
  {
    id: 'post.adr',
    name: 'ADR Agent',
    layer: 'execution',
    stack: 'audio',
    role: 'ADR / Final Dialogue',
    responsibility: 'Spot & re-generate changed lines, final clean dialogue',
    status: 'idle',
    inputs: [{ name: 'first_cut', type: 'video', required: true }],
    outputs: [{ name: 'final_dialogue', type: 'audio', required: false, path: 'final_dialogue.wav' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 120,
    acceptance: [],
    cost_estimate: '~$0.10',
  },
  {
    id: 'post.composer',
    name: 'Music Composer Agent',
    layer: 'execution',
    stack: 'audio',
    role: 'Music Spot / Final Music',
    responsibility: 'Spot music placement & intent, compose final score',
    status: 'idle',
    inputs: [{ name: 'first_cut', type: 'video', required: true }],
    outputs: [{ name: 'final_music', type: 'audio', required: false, path: 'final_music.wav' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 300,
    acceptance: [],
    cost_estimate: '~$0.40 / minute of music',
  },
  {
    id: 'post.sfx',
    name: 'SFX Agent',
    layer: 'execution',
    stack: 'audio',
    role: 'SFX Spot / Final SFX',
    responsibility: 'List needed effects, source/synthesize, place frame-accurate',
    status: 'idle',
    inputs: [{ name: 'first_cut', type: 'video', required: true }],
    outputs: [{ name: 'final_sfx', type: 'audio', required: false, path: 'final_sfx.wav' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 180,
    acceptance: [],
    cost_estimate: '~$0.15',
  },
  {
    id: 'exec.rigging',
    name: 'Rig Build Agent',
    layer: 'execution',
    stack: 'comfyui',
    role: 'Rig Build (Harmony/Flash equivalent)',
    responsibility: 'Assemble reusable character puppet from multi-angle sheets',
    status: 'idle',
    inputs: [{ name: 'vendor_package', type: 'file', required: true }],
    outputs: [{ name: 'rigs', type: 'file', required: false, path: 'rigs/' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 3, backoff: 'exponential' },
    timeout_s: 600,
    acceptance: ['all angles present', 'reusable pose library'],
    cost_estimate: '~$0.80 / character (GPU)',
  },
  {
    id: 'exec.animation',
    name: 'Animation Agent',
    layer: 'execution',
    stack: 'comfyui',
    role: 'Physical Animation + Lip-sync',
    responsibility: 'Block action, draw in-betweens (smooth), animate lip-flap',
    status: 'idle',
    inputs: [
      { name: 'rigs', type: 'file', required: true },
      { name: 'animatic', type: 'video', required: true },
      { name: 'mouth_charts', type: 'image', required: true },
      { name: 'dialogue', type: 'audio', required: true },
    ],
    outputs: [{ name: 'take1_shots', type: 'video', required: false, path: 'take1_shots/' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 7, backoff: 'none' },
    timeout_s: 1800,
    acceptance: ['smooth motion (no snapping)', 'lip-flap matches dialogue'],
    cost_estimate: '~$2.50 / shot (GPU)',
  },
  {
    id: 'exec.vfx',
    name: 'VFX Agent',
    layer: 'execution',
    stack: 'comfyui',
    role: 'After-FX / Final FX',
    responsibility: 'Plus-up drawn effects into particles/glows/composites',
    status: 'idle',
    inputs: [{ name: 'first_cut', type: 'video', required: true }],
    outputs: [{ name: 'final_fx_shots', type: 'video', required: false, path: 'final_fx_shots/' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 3, backoff: 'exponential' },
    timeout_s: 900,
    acceptance: ['matches show visual style'],
    cost_estimate: '~$1.20 / shot (GPU)',
  },
  {
    id: 'exec.mix_deliver',
    name: 'Mix & Deliver Agent',
    layer: 'execution',
    stack: 'utility',
    role: 'Picture Lock / Mix / Color / Online / QC-CC / Deliver',
    responsibility: 'Lock picture, mix audio balance, color correct, QC, caption, ship',
    status: 'idle',
    inputs: [
      { name: 'final_fx_shots', type: 'video', required: true },
      { name: 'final_dialogue', type: 'audio', required: true },
      { name: 'final_music', type: 'audio', required: true },
      { name: 'final_sfx', type: 'audio', required: true },
      { name: 'credits', type: 'image', required: true },
    ],
    outputs: [{ name: 'episode_master', type: 'video', required: false, path: 'episode_master.mov' }],
    trigger: 'called_by_orchestrator',
    idempotent: true,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 300,
    acceptance: ['dialogue audible over music', 'all elements present at lock'],
    cost_estimate: '~$0.10',
  },
]

// ── Fixture runs ─────────────────────────────────────────────────────────────

const IMG_OUTPUTS: OutputArtifact[] = [
  { name: 'model_sheets/hero_front.png', type: 'image', url: 'https://placehold.co/512x512/1c1c1e/00d4a4?text=model+sheet', size_bytes: 204800 },
  { name: 'model_sheets/hero_side.png', type: 'image', url: 'https://placehold.co/512x512/1c1c1e/00d4a4?text=side+view', size_bytes: 189440 },
]

const JSON_OUTPUTS: OutputArtifact[] = [
  { name: 'breakdown.json', type: 'json', url: '#', size_bytes: 4096 },
]

export const MOCK_RUNS: RunRecord[] = [
  {
    run_id: 'run_001',
    agent_id: 'orch.showrunner',
    status: 'done',
    attempts: 1,
    duration_s: 12.4,
    cost: 0.048,
    gpu_seconds: null,
    acceptance_passed: true,
    outputs: JSON_OUTPUTS,
    error: null,
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    logs: ['Parsing script...', 'Found 14 entities', 'Breakdown complete'],
    context: { final_script: 'Episode 1 script...' },
    system_prompt: 'You are a showrunner agent.',
  },
  {
    run_id: 'run_002',
    agent_id: 'design.lineart',
    status: 'done',
    attempts: 2,
    duration_s: 184.2,
    cost: 0.31,
    gpu_seconds: null,
    acceptance_passed: true,
    outputs: IMG_OUTPUTS,
    error: null,
    created_at: new Date(Date.now() - 2_400_000).toISOString(),
    logs: ['Loading breakdown...', 'Generating front view...', 'Retry 1: improving consistency', 'All angles complete'],
    context: { breakdown: 'breakdown.json' },
    system_prompt: 'Generate character model sheets.',
  },
  {
    run_id: 'run_003',
    agent_id: 'exec.animation',
    status: 'failed',
    attempts: 3,
    duration_s: 420.0,
    cost: 2.12,
    gpu_seconds: 380,
    acceptance_passed: false,
    outputs: [],
    error: 'Consistency check failed: character identity drift > 15% on frames 48-96',
    created_at: new Date(Date.now() - 900_000).toISOString(),
    logs: ['Loading rigs...', 'Blocking pass done', 'In-betweens started', 'Consistency check FAILED'],
    context: { rigs: 'rigs/', animatic: 'animatic.mp4' },
    system_prompt: 'Animate shot sequence with lip-sync.',
  },
  {
    run_id: 'run_004',
    agent_id: 'cast.dialogue',
    status: 'running',
    attempts: 1,
    duration_s: null,
    cost: null,
    gpu_seconds: null,
    acceptance_passed: null,
    outputs: [],
    error: null,
    created_at: new Date(Date.now() - 120_000).toISOString(),
    logs: ['Parsing script for dialogue lines...', 'Generating voice for HERO...'],
    context: { script: 'ep1_script.txt' },
    system_prompt: 'Cast and record all dialogue.',
  },
]

// ── Mock API ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function getAgents(): Promise<AgentSchema[]> {
  await delay(300)
  return MOCK_AGENTS
}

export async function getRun(runId: string): Promise<RunRecord> {
  await delay(200)
  const run = MOCK_RUNS.find(r => r.run_id === runId)
  if (!run) throw new Error(`Run ${runId} not found`)
  return run
}

export async function triggerRun(
  agentId: string,
  body: RunTriggerRequest,
): Promise<RunTriggerResponse> {
  await delay(400)
  const run_id = `run_${agentId.replace(/\./g, '_')}_${Date.now()}`
  MOCK_RUNS.unshift({
    run_id,
    agent_id: agentId,
    status: 'queued',
    attempts: 0,
    duration_s: null,
    cost: null,
    gpu_seconds: null,
    acceptance_passed: null,
    outputs: [],
    error: null,
    created_at: new Date().toISOString(),
    logs: [],
    context: body.context,
    system_prompt: body.system_prompt,
    scene_id: body.context.scene_id as string | undefined,
  })
  return { run_id }
}

export async function getHealth(): Promise<HealthResponse> {
  await delay(100)
  return { ok: true }
}

export async function getRuns(_agentId?: string, _limit = 25): Promise<RunRecord[]> {
  await delay(200)
  return [...MOCK_RUNS]
}

export async function listRuns(agentId?: string): Promise<RunRecord[]> {
  await delay(200)
  if (agentId) return MOCK_RUNS.filter(r => r.agent_id === agentId)
  return [...MOCK_RUNS]
}

export async function getMetrics(_agentId?: string): Promise<import('../types').MetricsSnapshot> {
  await delay(150)
  const runs = MOCK_RUNS
  const total_runs = runs.length
  const total_cost = runs.reduce((s, r) => s + (r.cost ?? 0), 0)
  const total_gpu_seconds = runs.reduce((s, r) => s + (r.gpu_seconds ?? 0), 0)
  const avg_attempts = total_runs > 0 ? runs.reduce((s, r) => s + r.attempts, 0) / total_runs : 0
  const completed = runs.filter(r => r.status === 'done')
  const pass_rate = completed.length > 0 ? completed.filter(r => r.acceptance_passed).length / completed.length : 0
  const runs_by_status = runs.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {} as import('../types').MetricsSnapshot['runs_by_status'])
  const runs_by_stack = {} as import('../types').MetricsSnapshot['runs_by_stack']
  return { total_runs, total_cost, total_gpu_seconds, avg_attempts, pass_rate, runs_by_status, runs_by_stack }
}

// ── Mock SSE emitter ──────────────────────────────────────────────────────────

export interface MockEventSource {
  addEventListener(type: 'message', handler: (e: MessageEvent) => void): void
  removeEventListener(type: 'message', handler: (e: MessageEvent) => void): void
  close(): void
}

export function streamRun(runId: string): MockEventSource {
  const et = new EventTarget()
  let closed = false

  const schedule: Array<{ ms: number; event: RunEvent }> = [
    {
      ms: 500,
      event: {
        type: 'status', run_id: runId, timestamp: new Date().toISOString(),
        data: { status: 'running', attempts: 1, message: 'Agent started' },
      },
    },
    {
      ms: 1500,
      event: {
        type: 'log', run_id: runId, timestamp: new Date().toISOString(),
        data: { message: 'Loading inputs...' },
      },
    },
    {
      ms: 2800,
      event: {
        type: 'log', run_id: runId, timestamp: new Date().toISOString(),
        data: { message: 'Processing... (this may take a while for GPU agents)' },
      },
    },
    {
      ms: 4500,
      event: {
        type: 'status', run_id: runId, timestamp: new Date().toISOString(),
        data: { status: 'retrying', attempts: 2, message: 'Retrying: improving output quality' },
      },
    },
    {
      ms: 6500,
      event: {
        type: 'log', run_id: runId, timestamp: new Date().toISOString(),
        data: { message: 'Acceptance check running...' },
      },
    },
    {
      ms: 8000,
      event: {
        type: 'complete', run_id: runId, timestamp: new Date().toISOString(),
        data: {
          status: 'done',
          attempts: 2,
          duration_s: 7.5,
          cost: 0.22,
          gpu_seconds: 45,
          acceptance_passed: true,
          outputs: [
            { name: 'output.png', type: 'image', url: 'https://placehold.co/512x512/1a3d4a/00d4a4?text=output', size_bytes: 204800 },
          ],
        },
      },
    },
  ]

  for (const { ms, event } of schedule) {
    setTimeout(() => {
      if (closed) return
      et.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }))
    }, ms)
  }

  return {
    addEventListener: (type, handler) => et.addEventListener(type, handler as EventListener),
    removeEventListener: (type, handler) => et.removeEventListener(type, handler as EventListener),
    close: () => { closed = true },
  }
}
