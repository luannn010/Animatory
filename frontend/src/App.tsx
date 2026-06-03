import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AgentsView } from './views/AgentsView'
import { RunsHistory } from './views/RunsHistory'
import { RunDetail } from './views/RunDetail'
import { RunMonitor } from './views/RunMonitor'
import { MetricsView } from './views/MetricsView'
import { DashboardView } from './studio/views/DashboardView'
import { ParseView } from './studio/views/ParseView'
import { ChapterView } from './studio/views/ChapterView'
import { PreProductionView } from './studio/views/PreProductionView'
import { VendorView } from './studio/views/VendorView'
import { PostView } from './studio/views/PostView'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardView />} />
        <Route path="/project/:id/parse" element={<ParseView />} />
        <Route path="/project/:id/chapter/:episodeId/:chunkId" element={<ChapterView />} />
        <Route path="/project/:id/pre" element={<PreProductionView />} />
        <Route path="/project/:id/vendor" element={<VendorView />} />
        <Route path="/project/:id/post" element={<PostView />} />
        <Route path="/agents" element={<AgentsView />} />
        <Route path="/runs" element={<RunsHistory />} />
        <Route path="/runs/:runId" element={<RunDetail />} />
        <Route path="/runs/:runId/monitor" element={<RunMonitor />} />
        <Route path="/metrics" element={<MetricsView />} />
      </Routes>
    </AppShell>
  )
}
