import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { DesignAsset } from '../../types'
import { Placeholder } from './Placeholder'

export function CharacterDesignView() {
  const { id = '', assetId = '' } = useParams()
  const [assets, setAssets] = useState<DesignAsset[] | null>(null)
  useEffect(() => { studioApi.getDesignAssets(id).then(setAssets) }, [id])
  const chars = assets?.filter(a => a.kind === 'character') ?? null
  return <Placeholder name="CharacterDesignView" params={{ id, assetId }} data={chars ? `${chars.length} character assets` : null} />
}
