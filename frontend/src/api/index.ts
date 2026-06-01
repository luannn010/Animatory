import { USE_MOCK } from '../config'
import * as live from './client'
import * as mock from './mock'

export const api = USE_MOCK
  ? {
      getAgents:  mock.getAgents,
      triggerRun: mock.triggerRun,
      getRun:     mock.getRun,
      getRuns:    mock.getRuns,
      listRuns:   mock.listRuns,
      getMetrics: mock.getMetrics,
      getHealth:  mock.getHealth,
      streamRun:  mock.streamRun,
    }
  : {
      getAgents:  live.getAgents,
      triggerRun: live.triggerRun,
      getRun:     live.getRun,
      getRuns:    live.getRuns,
      listRuns:   live.getRuns,
      getMetrics: live.getMetrics,
      getHealth:  live.getHealth,
      streamRun:  live.streamRun,
    }
