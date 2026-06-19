import { Navigate } from 'react-router-dom'
import { seedCanvasScenes } from './canvasData'

/** `/pre/canvas` → the first scene's board. */
export function CanvasIndexRedirect() {
  return <Navigate to={seedCanvasScenes()[0].id} replace />
}

// Stub — fleshed out in Task 4.
export function CanvasSceneBoard() {
  return (
    <div className="ppc">
      <div className="ppc-board__bar">
        <span className="ppc-board__title">Scene Board</span>
      </div>
    </div>
  )
}
