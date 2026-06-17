import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { VoiceCast } from '../../types'
import { Placeholder } from './Placeholder'

export function AudioCastingView() {
  const { id = '' } = useParams()
  const [cast, setCast] = useState<VoiceCast[] | null>(null)
  useEffect(() => { studioApi.getVoiceCast(id).then(setCast) }, [id])
  return <Placeholder name="AudioCastingView" params={{ id }} data={cast ? `${cast.length} characters cast` : null} />
}
