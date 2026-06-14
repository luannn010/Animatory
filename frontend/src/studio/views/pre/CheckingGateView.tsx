import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import { canAdvance, PRE_TRACKS } from '../../phases'
import type { Project } from '../../types'
import { Placeholder } from './Placeholder'

export function CheckingGateView() {
  const { id = '' } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  useEffect(() => { studioApi.getProject(id).then(setProject) }, [id])
  const ready = project ? PRE_TRACKS.filter(t => project.preTracks[t].status === 'ready').length : 0
  const data = project
    ? `${ready}/${PRE_TRACKS.length} tracks ready · ${canAdvance(project, 'pre') ? 'can advance' : 'locked'}`
    : null
  return <Placeholder name="CheckingGateView" params={{ id }} data={data} />
}
