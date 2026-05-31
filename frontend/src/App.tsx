import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AgentsView } from './views/AgentsView'
import { RunsHistory } from './views/RunsHistory'
import { RunDetail } from './views/RunDetail'
import { RunMonitor } from './views/RunMonitor'
import { MetricsView } from './views/MetricsView'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/agents" replace />} />
        <Route path="/agents" element={<AgentsView />} />
        <Route path="/runs" element={<RunsHistory />} />
        <Route path="/runs/:runId" element={<RunDetail />} />
        <Route path="/runs/:runId/monitor" element={<RunMonitor />} />
        <Route path="/metrics" element={<MetricsView />} />
      </Routes>
    </AppShell>
  )
}
