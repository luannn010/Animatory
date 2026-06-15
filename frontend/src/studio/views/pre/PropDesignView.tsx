import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { DesignAsset } from '../../types'
import { Placeholder } from './Placeholder'

export function PropDesignView() {
  const { id = '', assetId = '' } = useParams()
  const [assets, setAssets] = useState<DesignAsset[] | null>(null)
  useEffect(() => { studioApi.getDesignAssets(id).then(setAssets) }, [id])
  const props = assets?.filter(a => a.kind === 'prop') ?? null
  return <Placeholder name="PropDesignView" params={{ id, assetId }} data={props ? `${props.length} prop assets` : null} />
}
