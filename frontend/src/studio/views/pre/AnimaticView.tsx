import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { Animatic } from '../../types'
import { Placeholder } from './Placeholder'

export function AnimaticView() {
  const { id = '' } = useParams()
  const [animatic, setAnimatic] = useState<Animatic | null>(null)
  useEffect(() => { studioApi.getAnimatic(id).then(setAnimatic) }, [id])
  return (
    <Placeholder
      name="AnimaticView"
      params={{ id }}
      data={animatic ? `${animatic.status} · ${animatic.entries.length} entries · ${animatic.totalDurationS}s` : null}
    />
  )
}
