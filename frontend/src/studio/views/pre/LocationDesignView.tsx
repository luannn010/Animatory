import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { DesignAsset } from '../../types'
import { Placeholder } from './Placeholder'

export function LocationDesignView() {
  const { id = '', assetId = '' } = useParams()
  const [assets, setAssets] = useState<DesignAsset[] | null>(null)
  useEffect(() => { studioApi.getDesignAssets(id).then(setAssets) }, [id])
  const locs = assets?.filter(a => a.kind === 'location') ?? null
  return <Placeholder name="LocationDesignView" params={{ id, assetId }} data={locs ? `${locs.length} location assets` : null} />
}
