import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AgentsView } from './views/AgentsView'
import { RunsHistory } from './views/RunsHistory'
import { RunDetail } from './views/RunDetail'
import { RunMonitor } from './views/RunMonitor'
import { MetricsView } from './views/MetricsView'
import { DashboardView } from './studio/views/DashboardView'
import { ParseView } from './studio/views/ParseView'
import { ChapterView } from './studio/views/ChapterView'
import { PreShell } from './studio/views/PreShell'
import { DesignTrackView } from './studio/views/pre/DesignTrackView'
import { CharacterDesignView } from './studio/views/pre/CharacterDesignView'
import { LocationDesignView } from './studio/views/pre/LocationDesignView'
import { PropDesignView } from './studio/views/pre/PropDesignView'
import { StoryboardTrackView } from './studio/views/pre/StoryboardTrackView'
import { PanelBoardView } from './studio/views/pre/PanelBoardView'
import { AudioCastingView } from './studio/views/pre/AudioCastingView'
import { DialogueStudioView } from './studio/views/pre/DialogueStudioView'
import { AnimaticView } from './studio/views/pre/AnimaticView'
import { CheckingGateView } from './studio/views/pre/CheckingGateView'
import { RigEditorView } from './studio/views/pre/RigEditorView'
import { CanvasSceneBoard, CanvasIndexRedirect } from './studio/canvas/CanvasSceneBoard'
import { CanvasShotDetail } from './studio/canvas/CanvasShotDetail'
import { ProductionView } from './studio/views/ProductionView'
import { PostView } from './studio/views/PostView'

export default function App() {
  return (
    <AppShell>
      <Routes>
        {/* Surface A — studio */}
        <Route path="/" element={<DashboardView />} />
        <Route path="/project/:id/parse" element={<ParseView />} />
        {/* Surface B — chapter (untouched) */}
        <Route path="/project/:id/chapter/:episodeId/:chunkId" element={<ChapterView />} />
        {/* Surface A — Pre-Production (parallel tracks, nested layout) */}
        <Route path="/project/:id/pre" element={<PreShell />}>
          <Route index element={<Navigate to="design" replace />} />
          <Route path="design" element={<DesignTrackView />} />
          <Route path="design/character/:assetId" element={<CharacterDesignView />} />
          <Route path="design/location/:assetId" element={<LocationDesignView />} />
          <Route path="design/prop/:assetId" element={<PropDesignView />} />
          {/* Rig editor (bones-only v1) — a property of a character Asset */}
          <Route path="rig" element={<RigEditorView />} />
          <Route path="rig/:assetId" element={<RigEditorView />} />
          {/* Canvas track — Scene Board → Shot Detail (Rig Studio = Step 2) */}
          <Route path="canvas" element={<CanvasIndexRedirect />} />
          <Route path="canvas/:sceneId" element={<CanvasSceneBoard />} />
          <Route path="canvas/:sceneId/:shotId" element={<CanvasShotDetail />} />
          <Route path="storyboard" element={<StoryboardTrackView />} />
          <Route path="storyboard/scene/:sceneId" element={<PanelBoardView />} />
          <Route path="audio" element={<AudioCastingView />} />
          <Route path="audio/scene/:sceneId" element={<DialogueStudioView />} />
          <Route path="animatic" element={<AnimaticView />} />
          <Route path="checking" element={<CheckingGateView />} />
        </Route>
        <Route path="/project/:id/production" element={<ProductionView />} />
        {/* Legacy redirect: /vendor → /production */}
        <Route path="/project/:id/vendor" element={<Navigate to="../production" relative="path" replace />} />
        <Route path="/project/:id/post" element={<PostView />} />
        {/* Surface C — agents / runs / metrics (untouched) */}
        <Route path="/agents" element={<AgentsView />} />
        <Route path="/runs" element={<RunsHistory />} />
        <Route path="/runs/:runId" element={<RunDetail />} />
        <Route path="/runs/:runId/monitor" element={<RunMonitor />} />
        <Route path="/metrics" element={<MetricsView />} />
      </Routes>
    </AppShell>
  )
}
