import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { StoryboardPanel } from '../../types'
import { Placeholder } from './Placeholder'

export function StoryboardTrackView() {
  const { id = '' } = useParams()
  const [panels, setPanels] = useState<StoryboardPanel[] | null>(null)
  useEffect(() => { studioApi.getStoryboardPanels(id).then(setPanels) }, [id])
  return <Placeholder name="StoryboardTrackView" params={{ id }} data={panels ? `${panels.length} panels` : null} />
}
