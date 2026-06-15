import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { StoryboardPanel } from '../../types'
import { Placeholder } from './Placeholder'

export function PanelBoardView() {
  const { id = '', sceneId = '' } = useParams()
  const [panels, setPanels] = useState<StoryboardPanel[] | null>(null)
  useEffect(() => { studioApi.getStoryboardPanels(id, sceneId).then(setPanels) }, [id, sceneId])
  return <Placeholder name="PanelBoardView" params={{ id, sceneId }} data={panels ? `${panels.length} panels in scene` : null} />
}
