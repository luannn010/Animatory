import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { DesignAsset } from '../../types'
import { Placeholder } from './Placeholder'

export function DesignTrackView() {
  const { id = '' } = useParams()
  const [assets, setAssets] = useState<DesignAsset[] | null>(null)
  useEffect(() => { studioApi.getDesignAssets(id).then(setAssets) }, [id])
  return <Placeholder name="DesignTrackView" params={{ id }} data={assets ? `${assets.length} design assets` : null} />
}
