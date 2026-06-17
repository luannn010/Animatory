import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { DialogueClip } from '../../types'
import { Placeholder } from './Placeholder'

export function DialogueStudioView() {
  const { id = '', sceneId = '' } = useParams()
  const [clips, setClips] = useState<DialogueClip[] | null>(null)
  useEffect(() => { studioApi.getDialogueClips(id, sceneId).then(setClips) }, [id, sceneId])
  return <Placeholder name="DialogueStudioView" params={{ id, sceneId }} data={clips ? `${clips.length} dialogue clips` : null} />
}
