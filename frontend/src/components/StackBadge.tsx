import type { AgentStack } from '../types'

interface StackStyle { bg: string; text: string; label: string; border: string }

const STACK: Record<AgentStack, StackStyle> = {
  orchestration: { bg: 'bg-[#E0A800]/15', text: 'text-[#b88400]', label: 'Orchestration', border: 'border-l-[#E0A800]' },
  comfyui:       { bg: 'bg-[#C97BE0]/15', text: 'text-[#9b4fbb]', label: 'ComfyUI',       border: 'border-l-[#C97BE0]' },
  text:          { bg: 'bg-[#5B8DEF]/15', text: 'text-[#3565cc]', label: 'Text / LLM',    border: 'border-l-[#5B8DEF]' },
  audio:         { bg: 'bg-[#3FB68B]/15', text: 'text-[#1d8f68]', label: 'Audio',         border: 'border-l-[#3FB68B]' },
  image:         { bg: 'bg-[#E0529C]/15', text: 'text-[#b8236e]', label: 'Image Gen',     border: 'border-l-[#E0529C]' },
  video:         { bg: 'bg-[#9B7FD4]/15', text: 'text-[#6b4daa]', label: 'Video',         border: 'border-l-[#9B7FD4]' },
  utility:       { bg: 'bg-[#7C8AA0]/15', text: 'text-[#4a5568]', label: 'Utility',       border: 'border-l-[#7C8AA0]' },
}

export function stackBorderClass(stack: AgentStack): string {
  return STACK[stack].border
}

interface Props { stack: AgentStack }

export function StackBadge({ stack }: Props) {
  const s = STACK[stack]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-mono font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}
